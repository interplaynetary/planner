# Free Association — Demand-Driven Planning Engine

A TypeScript library implementing **ValueFlows** as the economic modelling substrate for a fully-featured **Demand Driven Material Requirements Planning (DDMRP)** engine. The stack models the complete VF lifecycle from knowledge/recipes through planning, observation and algorithm layers, with spatio-temporal indexes on top for distributed-network supply chains.

---

## Architecture Overview

The codebase is organised into four cleanly-separated layers that map directly onto the VF lifecycle:

```
Knowledge  →  Plan  →  Observation  →  Algorithm
(recipes)    (commitments / intents)   (events / inventory)   (computations)
```

| Layer           | Primary concern                                      | Key files                         |
| --------------- | ---------------------------------------------------- | --------------------------------- |
| **Knowledge**   | BOM, routing, recipes, buffer profiles               | `src/lib/knowledge/`              |
| **Plan**        | Supply orders, demand signals, scheduling            | `src/lib/planning/`               |
| **Observation** | Actual events, on-hand inventory, fulfillment        | `src/lib/observation/observer.ts` |
| **Algorithm**   | Pure-function computations: MRP, DDMRP, cost, trace  | `src/lib/algorithms/`             |
| **Indexes**     | Spatio-temporal fast lookups for distributed queries | `src/lib/indexes/`                |

The canonical VF temporal ladder:

```
Intent  →  Commitment  →  EconomicEvent
  ↑ satisfies    ↑ fulfills
```

- **Intent** — unilateral desire (provider _or_ receiver, never both)
- **Commitment** — bilateral promise (both provider _and_ receiver); satisfies an Intent
- **EconomicEvent** — immutable observed fact; fulfills a Commitment _or_ satisfies an Intent (never both)

---

## ValueFlows Core

### Schemas (`src/lib/schemas.ts`)

Full Zod-validated TypeScript types for the entire VF ontology (~1800 lines), including:

- **EconomicResource** — `accountingQuantity` (rights) + `onhandQuantity` (custody), `stage`, `containedIn`, `lot`, `previousEvent`
- **EconomicEvent** — all VF actions with `ACTION_DEFINITIONS` (accounting/onhand/location/containment/stage/state effects per action)
- **Process / ProcessSpecification** — scheduling substrate; `hasBeginning`/`hasEnd`; `basedOn` → ProcessSpecification links to decoupling points
- **RecipeProcess / RecipeFlow / Recipe** — BOM + routing templates; `minimumBatchQuantity` (MOQ); `hasDuration`; `stage`/`state` filters on flows
- **Plan / Scenario / ScenarioDefinition** — planning hierarchy; `refinementOf`; `hasIndependentDemand[]`
- **Commitment / Intent** — `fulfills`/`satisfies` links; `independentDemandOf`; `availability_window`; `minimumQuantity`/`availableQuantity`
- **Agreement / AgreementBundle / Proposal / ProposalList** — exchange and marketplace constructs
- **Claim** — receiver-initiated obligation tracking
- **BufferZone / BufferProfile / ReplenishmentSignal / DemandAdjustmentFactor** — full DDMRP schema extensions
- **SpatialThing / Agent / AgentRelationship** — network participants with H3-indexed location

### Observer (`src/lib/observation/observer.ts`)

Event-sourced stockbook. The `Observer` class:

- Receives `EconomicEvent` records (immutable facts)
- Derives `EconomicResource` state by applying action effects (accounting/onhand/location/containment/accountable/stage/state)
- Implements all VF action semantics including split-custody for `pickup`/`dropoff`, implied-transfer ownership propagation, and containment via `separate`/`combine`
- Tracks **fulfillment** (`Commitment` → `FulfillmentState`) and **satisfaction** (`Intent` → `SatisfactionState`) — mutually exclusive per event
- Tracks **claim settlement** (`Claim` → `ClaimState`)
- Auto-creates batch/lot records on `produce` events
- Emits typed stream events (`recorded`, `resource_created`, `resource_updated`, `batch_created`, `fulfilled`, `over_fulfilled`, `satisfied`, `claim_settled`, `process_completed`)
- Maintains multi-dimensional indexes: by resource, process, agent, action
- Chained `previousEvent` breadcrumbs for track & trace
- Correction events (`EconomicEvent.corrects`) for immutable amendment

Key queries: `inventory()`, `inventoryForSpec()`, `inventoryAtLocation()`, `inventoryForAgent()`, `conformingResources()`, `eventsForProcess()`, `eventsForResource()`, `eventsForAgent()`.

### PlanStore (`src/lib/planning/planning.ts`)

The planning-layer state machine:

- CRUD for **Plans**, **Commitments**, **Intents**, **Agreements**, **AgreementBundles**, **Proposals**, **ProposalLists**, **Scenarios**, **ScenarioDefinitions**, **Claims**
- VF constraint enforcement: Intents enforce `provider XOR receiver`; `promoteToCommitment()` validates `minimumQuantity` and decrements `availableQuantity` (ATP mechanism)
- `acceptProposal()` — full Intent→Commitment→Agreement lifecycle with `unitBased` scaling and `proposedTo` access control
- `publishOffer()` / `publishRequest()` — convenience helpers for marketplace participation
- `instantiateRecipe()` / `buildRecipeGraph()` — BOM explosion from recipe templates into scheduled Processes and Commitments/Intents with back-scheduling from due date
- `merge()` / `removeRecords()` / `removeRecordsForPlan()` — batch operations for backtracking

### PlanNetter (`src/lib/planning/netting.ts`)

Shared stateful netting engine across a planning session:

- `netDemand()` — nets demand against (1) observer inventory, (2) scheduled output Intents, (3) scheduled output Commitments; with stage/state/location/temporal guards
- `netSupply()` — nets supply against scheduled consumption flows
- `netUse()` — books time-slot `[from, to)` reservations for durable resources with double-booking prevention
- `netAvailableQty()` — read-only peek at net available inventory
- `fork()` — creates a child netter inheriting current allocation state (for speculative planning)
- `retract()` — releases allocations and removes plan records atomically
- `pruneStale()` — cleans stale soft-allocations after plan retraction
- Per-plan attribution via `claimedForPlan()` enables surgical retraction without affecting sibling plans

### RecipeStore (`src/lib/knowledge/recipes.ts`)

Knowledge-layer recipe registry:

- `getProcessChain()` — ordered `RecipeProcess` sequence for a recipe (topological sort)
- `flowsForProcess()` — inputs and outputs for a recipe process
- `recipesForOutput()` — all recipes that produce a given spec
- `recipesForTransport()` — recipes for transporting a spec (enables location mismatch detection)
- `allResourceSpecs()` — all registered `ResourceSpecification` entities

### ScheduleBook (`src/lib/planning/schedule-book.ts`)

Unified schedule view across Intents and Commitments:

- `blocksFor(entityId)` — `ScheduleBlock[]` for an agent or resource (unified over Intents + Commitments)
- `committedEffortOn(agentId, dt)` — confirmed work hours on a calendar date (work Commitments only, not Intents)
- `hasUseConflict(resourceId, from, to)` — half-open interval `[from, to)` conflict detection
- `isResourceAvailable(resourceId, dt)` — checks `availability_window` via `TemporalExpression`

---

## Core Algorithms

### Dependent Demand (`src/lib/algorithms/dependent-demand.ts`)

Full recursive **BOM explosion** (MRP backward explosion):

1. Starts with `(specId, quantity, dueDate)` demand
2. Nets against observer inventory + scheduled output flows (via `PlanNetter`)
3. Selects the most labor-efficient recipe — ranked by **SNLT** (Socially Necessary Labour Time) or **SNE** (Socially Necessary Effort, including embodied labour) when an `sneIndex` is provided
4. Back-schedules the recipe process chain from due date
5. Creates `Process` records and `Commitment`/`Intent` flows scaled to demand quantity
6. Respects `minimumBatchQuantity` (MOQ) — rounds up scale factor and produces surplus
7. Handles **durable inputs**: `use` → time-slot scheduling via `PlanNetter.netUse()`; `cite` → existence gate only
8. Detects **location mismatches** and prefers transport recipes over production when stock exists at a different location
9. Creates `purchaseIntents` for external sourcing when no recipe exists
10. Supports **shared netter** (Mode C) for coordinated demand+supply explosions
11. Cycle protection via visited-recipe tracking; `allocatedScheduledIds` enables surgical retraction

### Dependent Supply (`src/lib/algorithms/dependent-supply.ts`)

Forward supply explosion — the counterpart to dependent demand. Explodes what a supply schedule _produces_ and nets it against downstream demand, enabling full bidirectional planning in Mode C.

### SNE — Socially Necessary Effort (`src/lib/algorithms/SNE.ts`)

Recursive **embodied labour** computation:

- `buildSNEIndex(recipeStore)` — builds a complete `Map<specId, effortHours/unit>` index in one pass
- `computeRecipeSNE()` / `computeSNEForRecipe()` — per-spec and per-recipe SNE with memoization
- Includes direct labour (work flows), embodied labour (consumed inputs × SNE(input)), and equipment depreciation (`(duration/lifespan) × SNE(equipment)`)
- Cycle detection via `computing` Set — breaks circular recipes safely
- `updateSNEFromActuals()` / `updateSNEFromPlan()` — EMA update from observed events (blends prior estimate with actuals at `alpha = 0.1`)

### Critical Path (`src/lib/algorithms/critical-path.ts`)

Standard **CPM** on instantiated plan processes:

- `criticalPath(planId, planStore, processReg)` — forward + backward pass on all Plan processes
- Dependencies derived from matching `resourceConformsTo` across output/input flows
- Returns `CriticalPathNode[]` with `earliestStart`, `earliestFinish`, `latestStart`, `latestFinish`, `float`, `isCritical`, predecessors, successors
- Also returns the ordered `criticalPath` (process IDs) and absolute `projectStart`/`projectEnd`
- Used for DLT computation on instantiated plans (DDMRP C2/C3)

### Value Rollup (`src/lib/algorithms/rollup.ts`)

Two-mode cost accounting:

- `rollupStandardCost(recipeId, ...)` — **standard cost** from recipe (BOM + routing traversal)
- `rollupActualCost(startId, ...)` — **actual cost** by tracing backwards from a resource/event to all contributing input events
- `costVariance(standard, actual)` — variance analysis (positive = under budget)
- Per-stage breakdown and grand totals in a configurable common unit (USD, hours, credits)

### Value Equations (`src/lib/algorithms/value-equations.ts`)

**Income distribution** for value networks (Sensorica pattern):

- `distributeIncome(incomeEventId, observer, processReg, equation)` — traces backwards from a sale event and distributes income to contributors proportional to their weighted score
- Built-in scorers: `effortScorer` (work hours), `resourceScorer` (consumed quantity), `equalScorer` (flat share)
- Built-in equations: `effortEquation`, `equalEquation`, `hybridEquation` (70% effort + 30% resource)
- `makeDepreciationScorer()` — scores `use` events by `(duration/lifespan) × SNE(tool)` — properly credits tool owners for embodied labour consumed
- `makeHybridWithDepreciationEquation()` — 60% labor + 40% depreciation
- `distributeMultipleIncome()` — batch distribution for multi-deliverable sales

### Track & Trace (`src/lib/algorithms/track-trace.ts`)

Bidirectional resource provenance as required by the VF spec:

- `trace(startId, observer, processReg)` — **backwards** DFS from a resource or event to all causal origin nodes; returns ordered `FlowNode[]` tree
- `track(startId, observer, processReg)` — **forwards** DFS to all downstream destinations
- Nodes are typed as `event | process | resource` with parent breadcrumb links
- `{ includeStale: true }` includes corrected events for audit purposes
- Used internally by `rollupActualCost()` and `distributeIncome()`

### Resource Flows (`src/lib/algorithms/resource-flows.ts`)

Inventory and cash-flow timeline generation along the event-process graph.

### DDMRP (`src/lib/algorithms/ddmrp.ts`)

Full **Demand Driven MRP** algorithm layer — all functions are pure and stateless:

| Function                        | DDMRP chapter | Description                                                                                                      |
| ------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `computeADU()`                  | Ch 9          | Rolling past ADU from EconomicEvents; `onhandEffect: 'decrement'` actions only                                   |
| `computeForwardADU()`           | Ch 9          | Forward ADU from recurring Intents (`availability_window` + `due`)                                               |
| `blendADU()`                    | Ch 9          | Past/forward blend via `aduBlendRatio`                                                                           |
| `recipeLeadTime()`              | Ch 8          | Template DLT via longest-path through a RecipeProcess DAG                                                        |
| `aggregateAdjustmentFactors()`  | Ch 10         | Compound active DAF/Zone AF/LT AF for a spec+location on a date                                                  |
| `qualifyDemand()`               | Ch 9          | OST-filtered qualified demand (spike threshold + OST horizon)                                                    |
| `computeNFP()`                  | Ch 9          | **Signed NFP** = `onhand + onorder − qualifiedDemand`; zone classification (red/yellow/green/excess); priority % |
| `computeBufferZone()`           | Ch 8          | TOR/TOY/TOG from ADU × DLT × LTF/VF; three-way Green zone max (order-cycle, redBase, MOQ)                        |
| `recalibrateBufferZone()`       | Ch 8/10       | Refresh a zone with new ADU, DLT, and active adjustment factors; stamps `lastComputedAt`                         |
| `bufferStatus()`                | Ch 10         | On-hand % vs TOR/TOY/TOG (C5 execution metric using `onhandQuantity`)                                            |
| `projectOnHand()`               | Ch 10         | Day-by-day projected on-hand over DLT horizon; `stockout` zone when negative                                     |
| `generateReplenishmentSignal()` | Ch 9          | NFP ≤ TOY → `ReplenishmentSignal` with recommended qty = TOG − NFP; MOQ enforcement                              |
| `sortBySchedulingPriority()`    | Ch 11         | NFP%-based scheduling queue; composite sort with sequence group (allergen/regulatory)                            |
| `prioritizedShare()`            | Ch 11         | Scarce supply allocation: fill all locations to TOR → TOY → proportional within green                            |
| `signalIntegrityReport()`       | Ch 12         | Recommendation vs. actual: deviation in qty + due-date compliance; `over_fulfilled` detection                    |
| `onhandAlert()`                 | Ch 10         | Configurable alert threshold on `onhand / tor`; returns alert entries with zone color                            |
| `ltmAlert()`                    | Ch 10         | Lead Time Managed alert: open supply orders, days remaining, G/Y/R sub-zones within last-third of DLT            |

---

## Knowledge Layer

### BufferZoneStore (`src/lib/knowledge/buffer-zones.ts`)

Registry for DDMRP buffer configuration and replenishment signals:

- `addBufferZone()` / `findZone(specId, atLocation?)` — exact-match (spec + location) with fallback to global zone
- `updateZone()` / `replaceZone()` — incremental patch or full replacement after recalibration
- `zonesDueForRecalibration(asOf, profileMap)` — cadence-based recalc trigger (`daily` / `weekly` / `monthly`)
- `addSignal()` / `openSignals()` / `overdueSignals()` / `updateSignalStatus()` — full `ReplenishmentSignal` lifecycle

---

## Spatio-Temporal Indexes (`src/lib/indexes/`)

All indexes are built from VF entities and expose identical query patterns using **H3 hexagonal grid** spatial indexing (`h3-js`) at configurable resolutions.

### AgentIndex (`indexes/agents.ts`)

Aggregates agent labor supply from `work` Intents:

- One `AgentCapacity` record per `(agent, space_time_signature)` — prevents double-counting when an agent publishes multiple skill Intents for the same window
- `spec_index` (skill index): `specId → Set<capacityId>` — safe hour summation
- `spatial_hierarchy`: H3 hex tree over capacity nodes
- `buildAgentIndex(intents, agents, locations, commitments)` — tallies `committed_hours` from work Commitments; computes `remaining_hours`
- Queries: `queryAgentsBySpec()`, `queryAgentsByLocation()`, `queryAgentsBySpecAndLocation()`, `netEffortHours(agentId, dt, index, location?)`

### IndependentDemandIndex (`indexes/independent-demand.ts`)

Indexes all non-finished Intents as demand slots:

- Tracks `fulfilled_quantity` / `remaining_quantity` from satisfying Commitments and Events
- Indexes: `cell_index` (H3), `spec_index`, `action_index`, `space_time_index`, `plan_demand_index`, `spatial_hierarchy`
- Queries: `queryDemandBySpec()`, `queryDemandByLocation()`, `queryDemandBySpecAndLocation()`, `queryOpenDemands()`, `queryPlanDemands()`

### CommitmentIndex (`indexes/commitments.ts`)

Fast lookup for planned supply/demand flows by spec, agent, location, and time signature.

### EconomicEventIndex (`indexes/economic-events.ts`)

Historical event lookup by spec, action, agent, location, time window.

### EconomicResourceIndex (`indexes/economic-resources.ts`)

Inventory snapshot indexed by spec, location, accountable agent, stage, H3 cell.

### IntentIndex (`indexes/intents.ts`)

Full Intent catalog for marketplace discovery — all Intents (open and fulfilled), indexed by action, spec, location.

### IndependentSupplyIndex (`indexes/independent-supply.ts`)

Supply-side counterpart to `IndependentDemandIndex` — indexes supply Intents and Commitments for matching against demand.

---

## Planning Orchestrator

### planForRegion (`src/lib/planning/plan-for-region.ts`)

H3-cell based, two-pass DDMRP planning cycle:

- **Pass 1** — classifies demand slots per H3 cell: `locally-satisfiable` / `transport-candidate` / `producible-with-imports` / `external-dependency`
- **Pass 2** — triggers dependent demand explosion for replenishment signals (`tag:plan:replenishment-required`)
- Detects conflicts: inventory overclaim + capacity contention via `ScheduleBook`
- Backtracking via `PlanNetter.retract()` — releases soft-allocations and removes plan records atomically
- `DeficitSignal` / `SurplusSignal` — planning gap and surplus reporting
- `MetabolicDebt` — tracks orphan demands with no available recipe
- `ScenarioIndex` / `paretoFront()` / `mergeFrontier()` — content-addressed speculative scenarios by H3 × ProcessSpec

---

## Utilities

| Module                         | Description                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `utils/space-time-index.ts`    | H3 hex index core (`HexIndex`, `HexNode`, `addItemToHexIndex`, `queryHexIndexRadius`, `queryHexOnDate`)                          |
| `utils/space-time-keys.ts`     | Space-time signature generation; VF intent → context bridges                                                                     |
| `utils/space.ts`               | `spatialThingToH3()` and coordinate helpers                                                                                      |
| `utils/time.ts`                | `TemporalExpression`, `AvailabilityWindow`, `isWithinTemporalExpression()`, `hoursInWindowOnDate()`                              |
| `utils/recurrence.ts`          | `materializeOccurrenceDates()`, `groupEventsByOccurrence()`, `unfulfilledOccurrences()`, `dateMatchesWindow()` — ADU data source |
| `utils/space-time-scenario.ts` | `ScenarioIndex`, `paretoFront()`, `mergeFrontier()` — speculative plan scoring                                                   |
| `query.ts`                     | `VfQueries` — unified query API across Observer + PlanStore                                                                      |
| `agents.ts`                    | `AgentStore` with relationship tracking                                                                                          |
| `process-registry.ts`          | Shared `ProcessRegistry` — same Process instances in planning and observation layers                                             |

---

## DDMRP Implementation Status

### ✅ Implemented

| Component                   | Coverage                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| C1: Strategic Positioning   | Schema: `EconomicResource.stage` (decoupling points), `RecipeFlow.stage` (filter)                                 |
| C2: Buffer Zone Calculation | `computeBufferZone()` — full Red/Yellow/Green formula; `BufferZoneStore`                                          |
| C3: Dynamic Adjustments     | `DemandAdjustmentFactor`, `aggregateAdjustmentFactors()`, `recalibrateBufferZone()`, `zonesDueForRecalibration()` |
| C4: Net Flow Position       | `computeNFP()` — signed NFP with on-hand, on-order, qualified demand; zone classification                         |
| C4: ADU                     | `computeADU()` (past), `computeForwardADU()` (forward), `blendADU()`                                              |
| C4: DLT                     | `recipeLeadTime()` (template), `criticalPath()` (instantiated plan)                                               |
| C4: Supply Order Generation | `generateReplenishmentSignal()` — MOQ enforcement, TOG replenishment                                              |
| C4: Demand Classification   | `qualifyDemand()` — OST horizon + spike threshold filter                                                          |
| C5: Track & Trace           | `trace()` / `track()` — full backwards/forwards provenance                                                        |
| C5: Execution Tracking      | `Observer`: `FulfillmentState`, `SatisfactionState`, `ClaimState`, `process_completed`                            |
| C5: Signal Integrity        | `signalIntegrityReport()` — recommendation vs. actual qty + timing deviation                                      |
| C5: Projected On-Hand       | `projectOnHand()` — day-by-day DLT horizon, stockout detection                                                    |
| C5: Buffer Status           | `bufferStatus()` — on-hand vs TOR/TOY/TOG; `onhandAlert()`, `ltmAlert()`                                          |
| Scheduling                  | `ScheduleBook`, `sortBySchedulingPriority()`, `prioritizedShare()`                                                |
| BOM Explosion               | `dependentDemand()` — backward BFS; SNLT/SNE ranking; transport detection                                         |
| Cost Accounting             | `rollupStandardCost()`, `rollupActualCost()`, `costVariance()`                                                    |
| Value Distribution          | `distributeIncome()` — pluggable `ValueEquation` with depreciation scoring                                        |
| Spatio-Temporal Indexes     | Full H3-indexed indexes for agents, demand, supply, commitments, events, resources                                |

### 🔲 Gap Modules (planned)

| Module                      | Description                                               |
| --------------------------- | --------------------------------------------------------- |
| Buffer Profile Registry UI  | Part-to-profile assignment management interface           |
| Planning Screen / Dashboard | Priority-sorted queue with zone-colored NFP% columns      |
| WIP Priority Dashboard      | Released MO dispatch list by live buffer status           |
| Capacity-Time Translation   | TOG × `RecipeProcess.hasDuration` → work-center minutes   |
| Control Point Scheduler     | Finite capacity scheduling across control points          |
| Mixed-Mode Scheduler        | MTO/MTS composite priority (sequence group + NFP%)        |
| Order Activity Dashboard    | Unified PO/MO/TO execution view with fulfillment progress |

---

## Developing

Install dependencies:

```sh
bun install
```

Start the development server:

```sh
bun run dev

# or open the app in a new browser tab
bun run dev -- --open
```

Run tests:

```sh
bun test
```

## Building

```sh
bun run build
```

Preview the production build:

```sh
bun run preview
```

> To deploy, install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
