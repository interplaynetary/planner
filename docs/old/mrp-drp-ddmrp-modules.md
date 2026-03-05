# MRP / DRP / DDMRP Module Outline

This document maps ValueFlows (VF) concepts and existing codebase modules to the three major
planning methodologies: **MRP** (Material Requirements Planning), **DRP** (Distribution
Requirements Planning), and **DDMRP** (Demand-Driven MRP). It serves as a roadmap showing what
exists, what is partial, and what is missing for each methodology.

---

## 1. Introduction

### Methodology Lineage

- **MRP** — Material Requirements Planning. Classic 1970s factory-scheduling technique: explode
  the Master Production Schedule (MPS) backwards through the Bill of Materials (BOM) to derive
  time-phased material and work-center requirements.
- **DRP** — Distribution Requirements Planning. Extends MRP across a multi-echelon distribution
  network: each warehouse/DC is treated as a "factory" whose inputs are replenishment shipments
  rather than manufactured parts.
- **DDMRP** — Demand-Driven MRP. A 2011 hybrid of MRP, Lean, and Theory of Constraints that
  replaces forecast-push with strategically positioned inventory buffers and real-time demand
  signals. Introduces five layers: strategic inventory positioning, buffer profiles/levels,
  dynamic adjustments, demand-driven planning, and visible collaborative execution.

### ValueFlows as a Lingua Franca

[ValueFlows](https://valueflo.ws) is an open vocabulary for economic activity that can express
MRP, DRP, and DDMRP without requiring methodology-specific schemas. Its generality comes from two
architectural patterns:

- **REA** (Resources–Events–Agents): economic resources flow between agents via events.
- **IPO** (Input–Process–Output): resources flow into a process and out as transformed resources.

### The Four VF Layers

```
Knowledge  →  Plan  →  Observation  →  Algorithm
```

| Layer | Contents | Role |
|---|---|---|
| **Knowledge** | `Recipe`, `RecipeProcess`, `RecipeFlow`, `ResourceSpecification`, `ProcessSpecification` | Templates; reusable BOM + routing definitions |
| **Plan** | `Plan`, `Process`, `Commitment`, `Intent`, `Agreement`, `Proposal`, `Scenario` | Forward-looking, mutable; may be retracted |
| **Observation** | `EconomicEvent`, `EconomicResource` (derived), `Claim` | Immutable historical record |
| **Algorithm** | `dependent-demand`, `dependent-supply`, `critical-path`, `rollup`, … | Computations over the three layers above |

---

## 2. ValueFlows Foundation Layer

Core schemas and primitives shared across all three methodologies.

### 2.1 Core Infrastructure

| VF Concept | File | Purpose |
|---|---|---|
| Schemas (all types) | `src/lib/schemas.ts` | Type definitions for all VF entities |
| Actions (19 standard) | `src/lib/schemas.ts` — `ACTION_DEFINITIONS` | Data-driven behavioral rules per action |
| ProcessRegistry | `src/lib/process-registry.ts` | Shared process instance management |
| AgentStore | `src/lib/agents.ts` | Agents, relationships, roles |
| VfQueries (main API) | `src/lib/query.ts` | Unified VF-spec query interface |
| Observer (stockbook) | `src/lib/observation/observer.ts` | Event-derived resource state; emits `resource_created`, `resource_updated`, `batch_created` stream events |
| RecipeStore (BOM/routing) | `src/lib/knowledge/recipes.ts` | Knowledge layer templates; Kahn's topological sort for process chains; validates structural integrity |
| PlanStore | `src/lib/planning/planning.ts` | Commitments, Intents, Plans |
| PlanNetter | `src/lib/planning/netting.ts` | Soft-allocation netting engine |
| ScheduleBook | `src/lib/planning/schedule-book.ts` | Agent/resource schedule queries |

### 2.2 Primitives

| Schema | Fields | Planning Role |
|---|---|---|
| `Measure` | `hasNumericalValue`, `hasUnit` (OM2 URI or label) | All quantity expressions |
| `Duration` | `hasNumericalValue`, `hasUnit` | Process lead time, `hasDuration` on RecipeProcess |
| `Unit` | `id`, `label`, `symbol`, `classifiedAs` | Unit of measure catalog |
| `SpatialThing` | `id`, `lat`, `long`, `alt`, `mappableAddress` | Location for resources, events, agents |
| `BatchLotRecord` | `id`, `batchLotCode`, `expirationDate` | Lot/serial control; expiry tracking for perishables |

### 2.3 Actions Reference

All 19 VF actions are defined in `ACTION_DEFINITIONS` with data-driven behavioral rules. The
table below maps each action to its planning-methodology role.

| Action | `inputOutput` | Accounting Effect | Onhand Effect | Planning Role |
|---|---|---|---|---|
| `produce` | output | increment | increment | MRP: finished goods output; BOM terminal node |
| `consume` | input | decrement | decrement | MRP: raw material draw-down; BOM input edges |
| `use` | input | **no effect** | **no effect** | CRP: equipment time-slot scheduling; durable tool reservation |
| `work` | input | **no effect** | **no effect** | CRP: labour effort; SNLT/SNE cost basis |
| `cite` | input | **no effect** | **no effect** | Existence gate (document, specification) — no quantity consumed |
| `deliverService` | **outputInput** | **no effect** | **no effect** | Service components; contract milestones |
| `pickup` | input | no effect | **decrement** (custody) | DRP: load cargo at origin; pairs with `dropoff` |
| `dropoff` | output | no effect | **increment** (custody) | DRP: deliver cargo at destination; pairs with `pickup` |
| `accept` | input | no effect | decrement (custody) | Subcontracting: receive item for rework; pairs with `modify` |
| `modify` | output | no effect | increment (custody) | Subcontracting: return item after rework; pairs with `accept` |
| `combine` | input | no effect | decrement | Kitting/packing: sets `containedIn` |
| `separate` | output | no effect | increment | Disassembly/unpacking: removes `containedIn` |
| `transferAllRights` | notApplicable | decrementIncrement | **no effect** | Ownership transfer (accounting only; no physical move) |
| `transferCustody` | notApplicable | **no effect** | decrementIncrement + location | Physical handoff (custody only; no accounting change) |
| `transfer` | notApplicable | decrementIncrement | decrementIncrement + location | Full transfer (ownership + custody + location) |
| `move` | notApplicable | decrementIncrement | decrementIncrement + location | Internal relocation (same accountable agent) |
| `copy` | notApplicable | incrementTo (new) | incrementTo (new) | Create a new resource at a new location from an existing one |
| `raise` | notApplicable | increment | increment | Positive stocktake variance / inventory adjustment |
| `lower` | notApplicable | decrement | decrement | Negative stocktake variance / write-off |

**Key groupings for planners:**
- **Quantity-reducing inputs** (`consume`): BOM material explosions — the only input action that
  draws down inventory in both accounting and onhand.
- **Non-consuming inputs** (`use`, `work`, `cite`, `deliverService`): `PlanNetter` explicitly
  excludes these from inventory drawdown (`NON_CONSUMING_ACTIONS` set in `netting.ts`).
- **Custody-only** (`pickup`/`dropoff`, `accept`/`modify`): `eligibleForExchange: false` —
  logistics and rework handoffs cannot be part of an exchange Agreement.
- **Containment** (`combine`/`separate`): mutate `containedIn`; netting guards skip contained
  resources (`containedIn !== undefined`).
- **Inventory adjustments** (`raise`/`lower`): stocktake reconciliation; both sides affect
  accounting and onhand simultaneously with no paired action.

### 2.4 Knowledge Layer — Full Schema Inventory

| Schema | Key Fields | Role |
|---|---|---|
| `ResourceSpecification` | `defaultUnitOfResource`, `defaultUnitOfEffort`, `substitutable`, `mediumOfExchange` | Item master; `substitutable` enables MRP substitution; `mediumOfExchange` marks currency |
| `ProcessSpecification` | `id`, `name` | Work-center type; also used as `stage` marker on `EconomicResource` |
| `RecipeFlow` | `action`, `resourceConformsTo`, `resourceQuantity`, `effortQuantity`, `stage`, `state`, `isPrimary` | BOM edge with stage/state filtering; `stage`+`state` propagated by `dependentDemand` to restrict netting |
| `RecipeProcess` | `hasDuration`, `minimumBatchQuantity`, `processConformsTo` | Work-center step; `minimumBatchQuantity` = minimum lot size per run |
| `RecipeExchange` | `id`, `name` | Template exchange agreement; instantiated into `Agreement` + `Commitment` pairs by recipe instantiation |
| `Recipe` | `primaryOutput`, `recipeProcesses`, `recipeExchanges` | Named template; `recipeExchanges` enables purchase/sale template patterns |
| `RecipeGroup` | `recipes[]` | Groups multiple Recipes for multi-output production plans (plant-level scheduling) |

### 2.5 Observation Layer — Full Schema Inventory

| Schema | Key Fields | Role |
|---|---|---|
| `EconomicResource` | `conformsTo`, `accountingQuantity`, `onhandQuantity`, `currentLocation`, `primaryAccountable`, `stage`, `state`, `containedIn`, `lot`, `trackingIdentifier`, `availability_window`, `previousEvent` | Derived inventory; dual quantity split is the foundation of DRP custody tracking |
| `EconomicEvent` | `action`, `fulfills`, `satisfies`, `corrects`, `realizationOf`, `settles`, `atLocation`, `toLocation`, `state`, `previousEvent` | Immutable economic fact; `corrects` enables stocktake adjustments; `realizationOf` links to Agreement; `settles` closes a Claim |
| `Process` | `basedOn`, `plannedWithin`, `nestedIn`, `finished` | Spans plan + observation; `nestedIn` → Scenario enables scenario grouping |
| `Claim` | `triggeredBy`, `action`, `provider`, `receiver`, `resourceQuantity`, `due`, `finished` | Receiver-initiated obligation; triggered by an event (e.g. service delivery triggers payment claim); settled by `EconomicEvent.settles` |

### 2.6 Planning Layer — Full Schema Inventory

| Schema | Key Fields | Role |
|---|---|---|
| `Intent` | `action`, `resourceConformsTo`, `availableQuantity`, `minimumQuantity`, `stage`, `state`, `due`, `availability_window` | **Unilateral** — provider OR receiver, never both (hard VF constraint enforced by `PlanStore.addIntent()`); `availableQuantity` = ATP supply ceiling; `minimumQuantity` = order minimum / buffer floor; recurring when `availability_window` set |
| `Commitment` | `action`, `satisfies`, `clauseOf`, `independentDemandOf`, `plannedWithin`, `stage`, `state`, `due` | **Bilateral** — requires both provider AND receiver; `independentDemandOf` marks MPS deliverables; `clauseOf` links to Agreement; `satisfies` links back to the Intent it filled |
| `Plan` | `hasIndependentDemand`, `due`, `refinementOf` | Schedule container; `refinementOf` → Scenario ID for scenario-based planning |
| `ScenarioDefinition` | `id`, `name`, `hasDuration`, `inScopeOf` | Template for scenario types (e.g. "Q3 Budget", "Risk Analysis"); stored in PlanStore |
| `Scenario` | `definedAs`, `refinementOf`, `hasBeginning`, `hasEnd`, `inScopeOf` | Stored in PlanStore; `refinementOf` enables nested zoom-in/out; `scenarioRefinements()` / `plansForScenario()` queries implemented |
| `Agreement` | `stipulates[]`, `stipulatesReciprocal[]` | Bilateral exchange; `stipulates` = primary Commitments, `stipulatesReciprocal` = reciprocal Commitments; created by `acceptProposal()` |
| `AgreementBundle` | `bundles[]` | Groups multiple Agreements (e.g. master framework with call-off orders); `agreementsInBundle()` implemented |
| `Proposal` | `purpose: offer|request`, `publishes[]`, `reciprocal[]`, `proposedTo[]`, `unitBased`, `eligibleLocation` | Market-facing offer/request; `publishOffer()` / `publishRequest()` convenience methods; `acceptProposal()` converts to Agreement + Commitments with temporal + `proposedTo` + `unitBased` scaling validation |
| `ProposalList` | `lists[]` | Groups Proposals (e.g. product catalogue, RFQ batch); `proposalsInList()` implemented |
| `Claim` | `triggeredBy`, `action`, `provider`, `receiver`, `resourceQuantity`, `due` | Stored in PlanStore; `addClaim()`, `getClaim()`, `allClaims()`, `claimsForAgent()` all implemented |

---

## 3. MRP Module Map

Classic demand-driven, back-scheduled production planning.

### 3.1 Bill of Materials (BOM)

| Aspect | Detail |
|---|---|
| VF equivalent | `RecipeProcess` + `RecipeFlow` — `resourceConformsTo` links form BOM edges |
| Single-level BOM | Direct `RecipeFlow` inputs/outputs on one `RecipeProcess` |
| Multi-level BOM | Recursive recipe chains via `RecipeStore.getProcessChain()` — Kahn's topological sort; matches `(spec, stage)` pairs so workflow recipes with same spec but different stages are treated as distinct process steps |
| Multi-product plan | `RecipeGroup` groups multiple Recipes for plant-level scheduling; `RecipeStore.recipesForGroup(groupId)` |
| Stage-specific inputs | `RecipeFlow.stage` + `RecipeFlow.state` propagated by `dependentDemand()` to netting stage/state guards |
| BOM validation | `RecipeStore.validateRecipe(recipeId)` — checks processes exist, each has flows, primary output found, no circular dependencies |
| BOM costing | `src/lib/algorithms/rollup.ts` — `rollupStandardCost()`, `rollupActualCost()`, `costVariance()` |
| Recipe ranking | `src/lib/algorithms/SNE.ts` — `computeRecipeSNE()` picks most labour-efficient recipe; `buildSNEIndex()` pre-builds complete index; equipment depreciation requires caller-supplied `lifespans` Map |
| Material substitution | `ResourceSpecification.substitutable` — flags that alternative specs may be used when preferred is unavailable; **no algorithmic substitution engine yet** |
| Kitting / disassembly | `combine` action (sets `containedIn`; netting excludes contained resources) / `separate` action (clears `containedIn`); model kit/disassembly processes as RecipeProcesses with these actions |

### 3.2 Master Production Schedule (MPS)

| Aspect | Detail |
|---|---|
| VF equivalent | `Plan` + `Commitment` with `independentDemandOf` |
| Independent demand | `Intent` records (customer orders, forecasts) |
| MPS definition | Set of top-level `Commitment` records where `independentDemandOf` = Plan ID |
| `Plan.hasIndependentDemand` | Reverse index: array of Commitment/Intent IDs that are deliverables of this plan |
| Scenario-based MPS | `Plan.refinementOf` → Scenario ID; `Scenario.refinementOf` enables nested alternatives |

### 3.3 Demand Explosion

| Aspect | Detail |
|---|---|
| Implementation | `src/lib/algorithms/dependent-demand.ts` — `dependentDemand()` |
| Algorithm | BFS backward through `RecipeProcess` chain from `(specId, quantity, dueDate)` |
| Outputs | `Intent` (unilateral — no agents) or `Commitment` (bilateral — agents provided) |
| External sourcing | Purchase `Intent` (action=`transfer`) for specs with no recipe |
| Durable inputs | `use`: time-slot reservation via `PlanNetter.netUse()` + creates use-Intent; `cite`: existence gate only, no scheduling |
| Work inputs | Carried as labour Commitments/Intents with `effortQuantity`; not material sub-demands |
| Stage/state propagation | `RecipeFlow.stage`/`state` propagated to `DemandTask.stage`/`state`; netting selects only matching-stage resources |
| Location awareness | `atLocation` propagated through BFS; transport recipe auto-selected on location mismatch |
| Minimum batch | `RecipeProcess.minimumBatchQuantity` raises `scaleFactor`; surplus beyond demand becomes available inventory |
| SNE ranking | Pass `sneIndex` param to rank recipes by embodied labour (SNE) rather than direct labour (SNLT) |
| Cycle protection | `visited` Set per BFS; deleted after recipe use to allow reuse for different demand items |
| Retraction | `PlanNetter.retract(result)` — releases claims and removes plan records |

### 3.4 Inventory Netting

| Aspect | Detail |
|---|---|
| Implementation | `src/lib/planning/netting.ts` — `PlanNetter` |
| Netting sources | (1) Observer inventory `accountingQuantity`; (2) scheduled output Intents; (3) scheduled output Commitments |
| `netDemand()` | Allocate demand against sources; temporal guard (`neededBy`); location guard (`atLocation`); stage/state guard |
| `netSupply()` | Allocate supply against scheduled consumptions; skips `NON_CONSUMING_ACTIONS` (`use`, `work`, `cite`, `deliverService`) |
| `netUse()` | Time-slot reservation for `use` flows; within-session (`useReservations` map) + pre-existing (`ScheduleBook.hasUseConflict`) |
| `netAvailableQty()` | Read-only net position: inventory + scheduled outputs − scheduled consumptions; supports `stage`, `state`, `asOf`, `atLocation` |
| Containment guard | Resources with `containedIn !== undefined` excluded from all netting (physically unavailable) |
| `fork()` | Child netter inheriting allocated set; for what-if sub-scenarios within a session |
| `releaseClaimsForPlan()` / `retract()` | Undo allocations by plan ID |
| `pruneStale()` | Remove allocated IDs no longer in PlanStore after `removeRecords()` |

### 3.5 Work Center / Routing

| Aspect | Detail |
|---|---|
| VF equivalent | `ProcessSpecification` (work-center type) + `RecipeProcess.hasDuration` |
| Routing | Ordered chain of `RecipeProcess` nodes; `RecipeStore.getProcessChain()` |
| Capacity query | `ScheduleBook.committedEffortOn(agentId, date)` — sums `work` Commitments (not Intents) |
| Agent schedule | `ScheduleBook.blocksFor(entityId)` — unified view over Intents + Commitments for any agent or resource; filterable by date and action |
| Resource availability | `EconomicResource.availability_window` + `Agent.availability_window`; checked via `ScheduleBook.isResourceAvailable()` |
| Subcontracting | `accept`/`modify` paired actions (custody-only); model as a RecipeProcess with `accept` input and `modify` output |

### 3.6 Capacity Requirements Planning (CRP)

| Aspect | Detail |
|---|---|
| Implementation | `src/lib/planning/schedule-book.ts` — `ScheduleBook` |
| Use-slot conflict detection | `ScheduleBook.hasUseConflict(resourceId, from, to)` — half-open interval overlap; called by `PlanNetter.netUse()` |
| Resource availability | `ScheduleBook.isResourceAvailable(resourceId, dt)` — checks `EconomicResource.availability_window` |
| Bottleneck identification | `src/lib/algorithms/critical-path.ts` — `criticalPath()` — longest path through recipe graph |
| Float / slack | `criticalPath()` also returns float for non-critical paths |
| **Gap** | No finite capacity scheduling / load-levelling module; no agent-level capacity ceiling enforcement |

### 3.7 Inventory Adjustments

| Aspect | Detail |
|---|---|
| `raise` action | Positive stocktake variance; increments both `accountingQuantity` and `onhandQuantity` |
| `lower` action | Negative stocktake variance or write-off; decrements both |
| `EconomicEvent.corrects` | Points to a previous EconomicEvent ID; enables retroactive corrections |
| Use case | Physical inventory count differs from system record → create `raise`/`lower` event with `corrects` pointer |
| Lot-controlled adjustments | `EconomicResource.lot.batchLotCode` + `lot.expirationDate` for serialized/lot-controlled goods |

### 3.8 Exception Management

> **Gap** — No alerting layer for past-due Commitments, overloaded work centers, or shortage
> conditions. The data exists: query `Observer` + `PlanStore` for violations (Commitments past
> `due` with `finished=false`, `netAvailableQty < 0`, `committedEffortOn > capacity`).

### 3.9 Pegging (Demand → Supply Links)

| Aspect | Detail |
|---|---|
| Satisfaction chain | `Intent` ← `Commitment.satisfies` ← `EconomicEvent.fulfills` |
| Soft pegging | `PlanNetter.allocated` set tracks which supply flows cover which demand |
| Plan-level attribution | `PlanNetter.claimedForPlan(planId)` returns exact set of supply IDs claimed by each explosion |
| Event → Agreement | `EconomicEvent.realizationOf` → Agreement ID (execution of a bilateral agreement) |
| Event → Claim settlement | `EconomicEvent.settles` → Claim ID (closes a receiver-initiated obligation) |
| **Gap** | No hard-pegging module that maintains explicit demand→supply allocation records as first-class persistent data through to execution |

### 3.10 Lot Sizing

| Aspect | Detail |
|---|---|
| Minimum lot | `RecipeProcess.minimumBatchQuantity` — minimum output per run; `dependentDemand()` raises `scaleFactor` accordingly |
| Batch/lot tracking | `EconomicResource.lot` (BatchLotRecord) — `batchLotCode`, `expirationDate`; set at produce time |
| Serial tracking | `EconomicResource.trackingIdentifier` — individual item serial number |
| **Gap** | No EOQ, fixed-order-quantity (FOQ), or period-order-quantity (POQ) algorithms |

### 3.11 Available-to-Promise (ATP)

| Aspect | Detail |
|---|---|
| `Intent.availableQuantity` | Supply ceiling declared by the provider; tracks how much remains committable |
| `PlanStore.promoteToCommitment(intentId, qty)` | **ATP mechanism**: validates `qty ≥ Intent.minimumQuantity`; decrements `Intent.availableQuantity` by qty; creates a Commitment linked via `Commitment.satisfies`; marks Intent `finished` when `availableQuantity` reaches 0; recurring Intents (`availability_window`) never auto-close (supply is periodic) |
| `PlanNetter.netAvailableQty(specId, opts)` | Read-only net position: on-hand inventory + on-order − qualified demand; supports `{ stage, state, asOf, atLocation }` |
| **Gap** | No customer-facing ATP service layer: no query endpoint that accepts `(specId, qty, dueDate)` and returns a confirmed Commitment or earliest-available-date |

### 3.12 What-if / Scenario Planning

| Aspect | Detail |
|---|---|
| PlanStore Scenario CRUD | `addScenario()`, `getScenario()`, `addScenarioDefinition()`, `getScenarioDefinition()`, `scenariosForDefinition(defId)`, `plansForScenario(scenarioId)`, `scenarioRefinements(scenarioId)` — full store layer in PlanStore |
| `Plan.refinementOf` | Links a Plan to a Scenario ID; multiple Plans can belong to the same scenario |
| `Process.nestedIn` | Links Process records to a Scenario ID; enables scenario-scoped process grouping |
| `PlanNetter.fork()` | Runtime what-if: child netter inherits parent allocated set for within-session scenario comparison |
| **Gap** | No scenario comparison / diff engine: no module to populate a scenario with explosion results, diff two scenarios, or generate side-by-side comparison reports |

---

## 4. DRP Module Map

Extends MRP to multi-location distribution networks.

### 4.1 Distribution Network Model

| Aspect | Detail |
|---|---|
| Locations | `SpatialThing` (`lat`, `long`, `mappableAddress`) |
| Custody split | `EconomicResource.onhandQuantity` (physical possession) vs `accountingQuantity` (rights) — core DRP invariant |
| Current location | `EconomicResource.currentLocation` → SpatialThing ID |
| Agent network | `AgentRelationship` + `AgentRelationshipRole`; `inScopeOf` scopes relationships to a context agent |
| Agent primary location | `Agent.primaryLocation` → SpatialThing ID |
| Location-aware netting | `PlanNetter.netDemand()` / `netSupply()` / `netAvailableQty()` all honour `atLocation` guard |
| Geo-spatial demand index | `IndependentDemandIndex` with H3 hex hierarchy; `queryDemandBySpecAndLocation()` — primary cross-echelon query: "does demand for specX exist near this DC?" |
| Radius queries | `queryHexIndexRadius()` in `space-time-index.ts`; `queryDemandByLocation()` with `radius_km` |
| Transport recipe selection | `RecipeStore.recipesForTransport(specId)` — finds recipes with both `pickup` input and `dropoff` output for the spec; used by `dependentDemand()` to auto-resolve location mismatch |

### 4.2 Forward Supply Explosion

| Aspect | Detail |
|---|---|
| Implementation | `src/lib/algorithms/dependent-supply.ts` — `dependentSupply()` |
| Algorithm | Inverse of `dependentDemand`: starts from available supply, BFS forward |
| Resource start | `dependentSupplyFromResource()` — starts from an existing `EconomicResource` |
| Material constraints | Limits executions by bottleneck input (min-ratio across all input specs) |
| Surplus vs terminal | Distinguishes surplus (supply unabsorbed by any downstream demand) vs terminal products (unabsorbed final outputs) |

### 4.3 Transfers and Movement

| Aspect | Detail |
|---|---|
| Full transfer | `transfer` — moves accounting + custody + location (`decrementIncrement` on both; `updateTo` location) |
| Rights only | `transferAllRights` — accounting transfer only; onhand unchanged; `accountableEffect: updateTo` |
| Custody only | `transferCustody` — physical handoff only; accounting unchanged; `locationEffect: updateTo` |
| Internal relocation | `move` — same accountable; moves both quantities and location |
| Logistics handoffs | `pickup`/`dropoff` paired actions (`eligibleForExchange: false`); `toLocation` on event |
| Multi-step transport | Transport Recipes in `RecipeStore` (pickup + dropoff chain); `dependentDemand()` auto-selects a transport recipe when inventory exists at wrong location |
| Packing / unpacking | `combine`/`separate` actions; `EconomicResource.containedIn` tracks container; contained resources excluded from netting until separated |
| Digital resources | `EconomicResource.currentVirtualLocation` (URI) for software licenses, digital assets |

### 4.4 Safety Stock

| Aspect | Detail |
|---|---|
| Partial | `Intent.minimumQuantity` — floor quantity; can model a reorder-point buffer |
| Partial | `Intent.availableQuantity` — ceiling of what is committed against |
| **Gap** | No safety stock calculation module (days-of-supply, statistical coverage factor, service-level-based) |

### 4.5 Resource Flow Timeline

| Aspect | Detail |
|---|---|
| Implementation | `src/lib/algorithms/resource-flows.ts` — `cashFlowReport()` |
| Scope | Any resource type (inventory, cash, energy, water); `ResourceSpecification.mediumOfExchange` flags currency specs |
| Period bucketing | Day / week / month / quarter / year |
| Sources | Actual (`Observer` events) + forecasted (`PlanStore` commitments/intents) |
| Output | Cumulative net running total per period |

### 4.6 Track & Trace

| Aspect | Detail |
|---|---|
| Implementation | `src/lib/algorithms/track-trace.ts` |
| `trace()` | Backwards provenance — where did this resource come from? |
| `track()` | Forwards destination — where is this resource going? |
| Mechanism | `EconomicResource.previousEvent` + `EconomicEvent.previousEvent` breadcrumbs set by Observer |
| Lot traceability | `EconomicResource.lot.batchLotCode` + `trackingIdentifier` for serialized provenance |
| Event corrections | `EconomicEvent.corrects` pointer preserved in trace chain |

### 4.7 Claims and Reciprocal Obligations

| Aspect | Detail |
|---|---|
| Schema | `Claim` — receiver-initiated; `triggeredBy` → EconomicEvent ID |
| Settlement | `EconomicEvent.settles` → Claim ID |
| Use case | Service delivery event triggers a payment Claim; payment event settles it |
| SNLT economy | Labour claims in the commune/account model |
| PlanStore Claim store | `addClaim()`, `getClaim()`, `allClaims()`, `claimsForAgent(agentId)` — full CRUD in PlanStore |
| **Gap** | No Claim workflow module: no automated triggering on service events, no overdue-Claim alerting, no settlement reporting dashboard |

### 4.8 MPS Levelling / Smoothing

> **Gap** — No horizon-based production smoothing across DRP echelons.

---

## 5. DDMRP Module Map

DDMRP has five canonical components (Ptak & Smith). Each is mapped to the VF codebase below.
Section 5.8 covers DDOM (Demand-Driven Operating Model) strategic extensions.

### 5.1 Component 1 — Strategic Inventory Positioning

Decides *where* in the BOM / supply chain to place decoupling points (buffered positions).

| Aspect | Detail |
|---|---|
| Decoupling point encoding | `EconomicResource.stage` → ProcessSpecification ID; each distinct stage value is a candidate buffer position |
| Stage DAG | `RecipeStore.getProcessChain()` — Kahn's topo sort over `(spec, stage)` pairs; each node is a potential decoupling candidate |
| Cumulative LT at each stage | `criticalPath()` — longest path through the recipe graph; compare CLT at each stage to Customer Tolerance Time to identify stages worth buffering |
| Demand hotspot map | `IndependentDemandIndex.queryDemandBySpecAndLocation()` with H3 hierarchy — where demand for each spec concentrates geographically; supports cross-echelon positioning decisions |
| Demand coverage assessment | `planForRegion.classifySlot()` → `DemandSlotClass`: `locally-satisfiable` / `transport-candidate` / `producible-with-imports` / `external-dependency` — each class implies a different buffering strategy at that echelon |
| Capacity gap signals | `Scenario.expansionSignals` (in `space-time-scenario.ts`) — per-spec `{ specId, needed, feasible, gap }` identified during Pareto search; persistent gaps signal where decoupling points AND new Means of Production may be needed |
| Substitution depth | `ResourceSpecification.substitutable` — substitution reduces required buffer depth at this stage |
| **Gap** | No decoupling point recommender: no algorithm scoring each DAG stage by the six DDMRP positioning factors (Customer Tolerance Time, Market Potential Lead Time, demand variability, supply variability, inventory carrying cost, critical operation protection) |
| **Gap** | No CTT / MPLT schema fields; `Intent.due` is a one-time deadline but there is no standing customer tolerance window on `ResourceSpecification` or `ProcessSpecification` |

### 5.2 Component 2 — Buffer Profiles and Levels

Sizes the three DDMRP zones at each decoupling point.

**Buffer zone formulas:**
```
Red Base    = ADU × DLT × LTF
Red Safety  = Red Base × Variability Factor (VF)
Red Zone    = Red Base + Red Safety
Yellow Zone = ADU × DLT
Green Zone  = max(ADU × min-order-cycle, MOQ)     [purchase / fixed-delivery item]
           OR ADU × DLT × LTF                      [make-to-stock item]
TOG (Top of Green)    = Red Zone + Yellow Zone + Green Zone
TOY (Top of Yellow)   = Red Zone + Yellow Zone      ← replenishment trigger threshold
```
where ADU = Average Daily Usage (rolling lookback), DLT = Decoupled Lead Time (from THIS buffer
to next upstream buffer arrival — NOT total CLT), LTF = Lead Time Factor (0.5 short / 1.0 medium
/ 1.5 long), VF = Variability Factor (0.25 low / 0.50 medium / 0.75 high).

| Aspect | Detail |
|---|---|
| DLT components | `RecipeProcess.hasDuration` per step; `criticalPath()` gives worst-case path |
| DLT note | `criticalPath()` returns TOTAL CLT from raw materials to end-item; DDMRP DLT is shorter — only the path from THIS decoupling stage back to the nearest upstream decoupling stage; requires segmenting the critical path at buffer boundaries |
| MOQ — production | `RecipeProcess.minimumBatchQuantity` |
| MOQ — purchase | `Intent.minimumQuantity` (validated by `PlanStore.promoteToCommitment()`) |
| Net position proxy | `PlanNetter.netAvailableQty(specId, { stage, atLocation, asOf })` ≈ NFP — on-hand + on-order − all open demand (not only qualified spikes; see 5.4) |
| **Gap** | No ADU calculator: no function querying Observer events for a spec over a rolling lookback window to compute average daily consumption |
| **Gap** | No Lead Time Factor / Variability Factor schema: `ResourceSpecification` has no `leadTimeCategory` or `variabilityCategory` field |
| **Gap** | No buffer zone formula: no `computeBufferZones(specId, ADU, DLT, LTF, VF, MOQ)` function |
| **Gap** | No buffer profile persistence: no schema for storing computed `{ redZone, yellowZone, greenZone, TOG, TOY }` per spec × location |
| **Gap** | No DLT segmentation algorithm: `criticalPath()` returns total CLT; no function splitting it at decoupling stage boundaries to yield per-buffer DLT |

### 5.3 Component 3 — Dynamic Adjustments

Adjusts buffer zone sizes in response to planned events (PAF) and detected demand trends (DAF).

| Aspect | Detail |
|---|---|
| Scenario-based adjustment | PlanStore `Scenario` + `addScenario()` / `scenariosForDefinition()` / `plansForScenario()` — model alternative buffer-level scenarios; compare with `ScenarioIndex.globalParetoFront()` |
| In-session what-if | `PlanNetter.fork()` — test buffer size changes without committing to PlanStore |
| EMA smoothing (closest pattern) | `SNE.updateSNEFromActuals(alpha=0.1)` — exponential moving average over actuals; same statistical technique as DDMRP Demand Adjustment Factor |
| **Gap** | No Planned Adjustment Factor (PAF): no schema field or engine that temporarily multiplies buffer targets by a seasonal / promotional / shutdown multiplier for a forward date range |
| **Gap** | No Demand Adjustment Factor (DAF): no rolling ADU trend detector; no auto-recalculation engine that periodically refreshes zone sizes from updated ADU and LT actuals |

### 5.4 Component 4 — Demand-Driven Planning

Generates supply orders when Net Flow Position (NFP) drops to or below Top of Yellow (TOY).

**DDMRP NFP formula:**
```
NFP = On-hand + On-order − Qualified Demand Spikes
  "Qualified spike" = individual demand order within the spike horizon (= DLT)
                      whose quantity exceeds the spike threshold (= Red Zone + Green Zone)
Replenishment trigger: NFP ≤ TOY
Replenishment order qty: TOG − NFP
```

| Aspect | Detail |
|---|---|
| NFP approximation | `PlanNetter.netAvailableQty(specId, { stage, atLocation, asOf })` — on-hand + on-order − ALL open demand; approximates NFP but does not filter for qualified spikes only |
| Supply order generation | `dependentDemand()` — back-schedules Intents/Commitments from `(specId, qty, dueDate)` |
| **Planning orchestrator** | `src/lib/planning/plan-for-region.ts` — `planForRegion(cells, horizon, ctx)` |
| — Phase 0 | `normalizeCells(cells)` — deduplicate H3 cells; drop cells dominated by an ancestor already in set |
| — Phase 1 | `extractSlots()` — `DemandSlot[]` + `SupplySlot[]` from canonical cell cover; filters by horizon `{from, to}` and `remaining_quantity > 0` |
| — Phase 2 | `classifySlot()` → `DemandSlotClass`: locally-satisfiable / transport-candidate / producible-with-imports / external-dependency |
| — Pass 1 | Explode primary independent demands sorted by (DemandSlotClass order, due date ASC) via `dependentDemand()` |
| — Pass 2 | Explode derived replenishment demands: specs tagged `tag:plan:replenishment-required` that were consumed in Pass 1; uses production-only netter (`observer=undefined`) to force recipe production rather than re-netting from inventory |
| — Backtrack | If `MetabolicDebt` unresolved: retract latest-due Pass 1 demands to free capacity; retry Pass 2 with freed capacity; iterates until debt resolved or all Pass 1 exhausted |
| — Phase B | Forward-schedule unabsorbed `SupplySlot`s via `dependentSupply()` |
| — Merge planner | Sub-stores merged via `PlanStore.merge()`; `detectConflicts()` → `inventory-overclaim` + `capacity-contention`; surgical retraction + re-explosion; max 10 iterations |
| `MetabolicDebt` | `{ specId, shortfall, plannedWithin }` — material that no recipe can produce from available resources; must be externally sourced |
| `DeficitSignal` | Unified deficit (unmet demand + metabolic debt) for upward hierarchical composition; `source: 'unmet_demand' \| 'metabolic_debt'`; `buildPlanSignals()` packages for parent planner |
| `SurplusSignal` | Unabsorbed supply with provenance (planId, specId, qty, atLocation, availableFrom) for upward routing |
| **Pareto search** | `src/lib/utils/space-time-scenario.ts` — `ScenarioIndex` |
| — Determinism | `computeScenarioId(signatures)` = djb2 hash of sorted commitment signatures → same content → same ID → safe dedup without coordination → embarrassingly parallel at leaf resolution |
| — Scoring | `scoreScenario()` → `ScenarioScore`: `coverage` (% of Intents satisfied) + `total_effort_hours` (minimize) |
| — Dominance | `scenarioDominates(a, b)`: A covers ≥ intents AND uses ≤ effort hours (at least one strict) |
| — Pareto front | `paretoFront(scenarios)` — O(n²) prune to non-dominated set |
| — Merge step | `mergeScenarios(a, b, resolution)` — resolves A's deficits using B's surpluses; creates cross-cell `transfer` Commitments; returns new Scenario with new deterministic ID |
| — Hierarchy | `mergeFrontier(index, scenarios, resolution)` — one H3 level of bottom-up merge; groups by parent cell; prunes to Pareto front per group |
| — Commit | `scenarioToPlan(scenario, addPlan, updateProcess, updateCommitment)` — promotes winning Scenario to committed VF Plan in PlanStore |
| **Gap** | No qualified demand spike filter: `netAvailableQty()` subtracts all open demand equally; DDMRP only subtracts spikes exceeding threshold within the spike horizon |
| **Gap** | No replenishment trigger function: no `shouldReplenish(NFP, TOY)` → `{ trigger: bool, orderQty: number }` that computes `TOG − NFP` as the order quantity |
| **Gap** | No automatic NFP monitor loop: Observer `resource_updated` events exist as a hook; no subscriber that continuously rechecks NFP vs. TOY across all tracked buffer specs |

### 5.5 Component 5 — Visible & Collaborative Execution

Real-time buffer status, execution priority, and cross-echelon collaboration.

| Aspect | Detail |
|---|---|
| Resource state stream | Observer emits `resource_created`, `resource_updated`, `batch_created` on every event record — core reactive hook for all DDMRP monitoring |
| Recurring demand fulfillment | `src/lib/utils/recurrence.ts` — `groupEventsByOccurrence()`: group fulfillment events by occurrence date (lazy, O(events)); `unfulfilledOccurrences(window, from, to, events)`: expected dates with no fulfilling events; `materializeOccurrenceDates(window, from, to)`: enumerate all expected dates eagerly |
| Occurrence status | `OccurrenceStatus`: per-date `{ fulfilled_quantity, committed_quantity, finished, events[] }` — building block for OTIF measurement |
| Fulfillment chain | `EconomicEvent.fulfills` → CommitmentID; `EconomicEvent.satisfies` → IntentID; `EconomicEvent.realizationOf` → AgreementID |
| Plan vs. actual variance | `costVariance()` in `rollup.ts` |
| Provenance | `trace()` / `track()` in `track-trace.ts` |
| Demand broadcasting | `Proposal.purpose = 'request'` + `ProposalList`; `acceptProposal()` converts to Agreement + Commitments |
| Supply broadcasting | `Proposal.purpose = 'offer'` + `eligibleLocation` + `unitBased` for collaborative replenishment offers |
| Multi-party coordination | `Agreement` + `AgreementBundle`; `Commitment.clauseOf` → Agreement ID |
| Full query visibility | `VfQueries` — agents, processes, resources, flows |
| **Gap** | No buffer status function: needs `bufferStatus(specId, atLocation, zones)` → `{ NFP, onHand, onOrder, zone: 'red'\|'yellow'\|'green', percentOfTOG, priority }` |
| **Gap** | No execution priority ranker: DDMRP ranks open supply orders by Relative On-Hand (ROH = onHand / TOG × 100); lowest ROH = most urgent; not implemented |
| **Gap** | No OTIF tracker: `unfulfilledOccurrences()` provides per-occurrence gap data; no aggregation into fill rate, on-time %, or average days late |
| **Gap** | No supplier collaboration dashboard: no module that publishes buffer status (zone + NFP) to external suppliers for synchronized replenishment |

### 5.6 Demand Signal Classification

| Signal | VF Entity | Fields Used | Description |
|---|---|---|---|
| Unilateral demand | `Intent` | `resourceConformsTo`, `resourceQuantity`, `due`, `stage`, `state` | Customer request / forecast |
| Agreed demand | `Commitment` | same + `satisfies`, `clauseOf` | Purchase order / production order |
| Actual fulfilled | `EconomicEvent` | `fulfills`, `satisfies`, `action` | Shipped, produced, consumed |
| Recurring demand | `availability_window` on Intent/Commitment | `TemporalExpression` | Recurring schedule (daily, weekly) |
| Demand broadcast | `Proposal.purpose = 'request'` | `publishes[]` (Intent IDs) | Market-facing demand signal |
| Demand offer | `Proposal.purpose = 'offer'` | `publishes[]` (Intent IDs), `unitBased` | Supply-side availability broadcast |
| Occurrence gap | `unfulfilledOccurrences()` | expected dates − fulfilling events | Recurring demand NOT yet met; building block for DDMRP buffer alert |

### 5.7 Lead Time & Variability

| Aspect | Detail |
|---|---|
| Per-step lead time | `RecipeProcess.hasDuration` (`hasNumericalValue` + `hasUnit`: days/hours/minutes/seconds) |
| Cumulative lead time (CLT) | `criticalPath()` — longest path through recipe graph; `CriticalPathNode.EF` at end-item = total CLT |
| Float / slack | `criticalPath()` returns total float for non-critical paths; float = 0 → on critical path |
| Decoupled Lead Time (DLT) | Subset of CLT: path from THIS buffer backward to the nearest upstream buffer; **not yet computed** — requires segmenting `criticalPath()` output at decoupling stage boundaries |
| **Gap** | No ADU (Average Daily Usage): no rolling window consumption computation from Observer events |
| **Gap** | No lead-time variability: `hasDuration` is a point estimate; no distribution or σ derived from actuals |
| **Gap** | No variability factor / coverage factor computation |

### 5.8 DDOM Extensions (Demand-Driven Operating Model)

| Layer | Aspect | Status | Detail |
|---|---|---|---|
| **Flow Replenishment** | Consumption-pull trigger | Exists | `ResourceSpecification.resourceClassifiedAs = ['tag:plan:replenishment-required']` triggers Pass 2 in `planForRegion()`; replenishment driven by actual consumption, not forecast |
| **Flow Replenishment** | Open demand frontier | Exists | `IndependentDemandIndex.queryOpenDemands()` + `DemandSlot.remaining_quantity` — actual unfulfilled demand for pull signal |
| **Demand-Driven S&OP** | Multi-scenario Pareto | Exists | `ScenarioIndex.globalParetoFront()` + `scenarioDominates()` — Pareto comparison across candidate plans |
| **Demand-Driven S&OP** | Scenario storage | Exists | `PlanStore.addScenario()` / `plansForScenario()` / `scenariosForDefinition()` |
| **Demand-Driven S&OP** | S&OP aggregation | **Gap** | No module rolling up `planForRegion()` results across all cells / echelons into a consolidated demand/supply balance by product family or geography |
| **DDMS (Master Scheduling)** | Capacity view | Exists | `ScheduleBook.committedEffortOn()` + `criticalPath()` |
| **DDMS (Master Scheduling)** | Horizon scheduling | **Gap** | No DDMS module: no horizon-based capacity synchronization resolving tactical aggregate plan conflicts against available work center capacity |
| **Financial Model (T/I/OE)** | Cost data | Exists | `rollupActualCost()`, `value-equations.ts`, `cashFlowReport()` |
| **Financial Model (T/I/OE)** | T/I/OE dashboard | **Gap** | No module computing Throughput (revenue − truly variable costs), Inventory (purchasing investment), and Operating Expense using ToC definitions |
| **D2 — Build Capacity** | Capacity gap signal | Exists | `Scenario.expansionSignals` — per-spec `{ needed, feasible, gap }` from Pareto search |
| **D2 — Build Capacity** | Investment planning | **Gap** | No module converting persistent `expansionSignals` into capital expenditure plans or new `RecipeProcess` / `ProcessSpecification` candidates |

---

## 6. Cross-Cutting Modules

Modules relevant across all three methodologies.

### 6.1 Algorithm Modules

| Module | File | Detail |
|---|---|---|
| SNE (Socially Necessary Effort) | `src/lib/algorithms/SNE.ts` | Three components: direct `work` effort + embodied labour of `consume` inputs (recursive) + equipment depreciation from `use` flows (`duration / lifespan × SNE(equipment)`); `cite` flows skipped; two update modes: recipe metadata (`buildSNEIndex`) and EMA actuals (`updateSNEFromActuals`, alpha=0.1) |
| Value Equations | `src/lib/algorithms/value-equations.ts` | `CONTRIBUTING_ACTIONS = {work, consume, use, cite, deliverService}`; built-in equations: `effortEquation` (100% labour), `equalEquation` (equal share), `hybridEquation` (70% effort / 30% equal), `makeHybridWithDepreciationEquation` (60% effort / 40% equal, depreciation-weighted); `makeDepreciationScorer(lifespans)` weights `use` events by `(duration/lifespan) × unitCost`; `distributeMultipleIncome()` applies equations across several income streams simultaneously |
| Critical Path | `src/lib/algorithms/critical-path.ts` | Full CPM: forward pass (ES/EF) + backward pass (LS/LF); float = 0 → critical; dependencies inferred from plan Commitments+Intents with `plannedWithin === planId`; default duration = 1 hour; cycle detection warns and excludes cyclic nodes |
| Cost Rollup | `src/lib/algorithms/rollup.ts` | `rollupStandardCost()` from recipe; `rollupActualCost()` via `trace()` backwards + groups by process; `INPUT_ACTIONS` = `consume`, `use`, `work`, `cite`, `accept`, `pickup`, `combine`; `costVariance()`: positive = under budget |
| Resource Flows | `src/lib/algorithms/resource-flows.ts` | `cashFlowReport(agentId, start, end, granularity, resourceSpecId?)`; `FLOW_ACTIONS` = `transfer`, `transferAllRights`, `transferCustody`, `produce`, `consume`, `deliverService`, `move`, `copy`, `raise`, `lower` (not `use`/`work`/`cite`/`pickup`/`dropoff`/`accept`/`modify`/`combine`/`separate`); intents use `availableQuantity ?? resourceQuantity` |
| Track & Trace | `src/lib/algorithms/track-trace.ts` | `trace(startId)` DFS backwards; `track(startId)` DFS forwards; `FlowNode` = `{ kind: event\|process\|resource, id, parent, data }`; `{ includeStale: true }` for audit (includes corrected events); `trace()` used internally by `rollupActualCost()` |
| Shortest Path | `src/lib/algorithms/shortest-path.ts` | **Stub** (1 line — not implemented); intended for route optimisation within distribution networks |
| Network Flow | `src/lib/algorithms/network-flow.ts` | Max-flow / min-cost (stub) |
| Metabolism | `src/lib/algorithms/metabolism.ts` | System dynamics / input-output (stub) |

### 6.2 Index Modules

| Index | File | Detail |
|---|---|---|
| `IndependentDemandIndex` | `src/lib/indexes/independent-demand.ts` | Full spatial H3 hierarchy + time; `DemandSlot` with `fulfilled_quantity` / `remaining_quantity` (partial fulfillment tracking via `Commitment.satisfies` + `Event.satisfies`); `plan_demand_index` maps Plan ID → Commitment IDs; `queryOpenDemands()` = open planning frontier; `queryDemandBySpecAndLocation()` primary leaf-level query |
| `AgentCapacity` index | `src/lib/indexes/agents.ts` | H3 + time-based; collapses multiple `work` Intents from same agent in same space-time window into one `AgentCapacity` node; `total_hours = max(effortQuantity)` across group (conservative dedup prevents double-counting skills) |
| `IntentIndex` | `src/lib/indexes/intents.ts` | All Intents (including finished); spatial + temporal queries |
| `CommitmentIndex` | `src/lib/indexes/commitments.ts` | All Commitments; space-time lookups |
| `EconomicEventIndex` | `src/lib/indexes/economic-events.ts` | Event lookup by agent, resource, spec, process |
| `EconomicResourceIndex` | `src/lib/indexes/economic-resources.ts` | Resource lookup by spec, location, stage |
| `ProposalIndex` | `src/lib/indexes/proposals.ts` | Proposal lookup; offer/request matching |
| `IndependentSupplyIndex` | `src/lib/indexes/independent-supply.ts` | Three strata: `inv:${id}` (on-hand inventory), `sched:${id}` (scheduled receipts — Commitments/Intents with `produce`/`transfer` outputs), `labor:${capacityId}` (available labour capacity); H3 spatial indexing; `SupplySlot` with quantity + location |

### 6.3 Supporting Modules

| Module | File | Detail |
|---|---|---|
| Commune/Account | `src/lib/observation/account.ts` | Alternative SNLT-based economy; subscribes to Observer `recorded` events — listens for `work` actions to accumulate SNLT contributions; `communalDeductionRate` default 0.5 (50% pooled); SNLT elastic Claims track each member's labour; `Account.balance()` = total SNLT contributed |
| Temporal Utils | `src/lib/utils/time.ts` | `TemporalExpression`, `isWithinTemporalExpression`, `hoursInWindowOnDate`; used by ScheduleBook, PlanNetter, AgentCapacity |
| Recurrence Utils | `src/lib/utils/recurrence.ts` | `OccurrenceStatus` — per-date `{ fulfilled_quantity, committed_quantity, finished, events[] }`; `groupEventsByOccurrence()` — lazy group by date key (O(events), no window scan); `unfulfilledOccurrences(window, from, to, events)` — expected dates with no fulfilling events; `materializeOccurrenceDates(window, from, to)` — eager enumeration of expected dates; `dateMatchesWindow()` — check single ISO date against AvailabilityWindow; critical for DDMRP recurring-demand gap tracking |
| Space-Time Keys | `src/lib/utils/space-time-keys.ts` | `getSpaceTimeSignature(ctx, h3Resolution)` — canonical `"${timeKey}::${locKey}"` bucket string; `intentToSpaceTimeContext()`, `commitmentToSpaceTimeContext()`, `economicEventToSpaceTimeContext()` — VF type → SpaceTimeContext bridges; `getCanonicalAvailabilityWindow()` — deterministic string from AvailabilityWindow (order-independent); `calendarComponents(isoDate)` → `{ day, week, month }` (shared with recurrence.ts); `toDateKey()`, `wrapDate()` — ISO → date key utilities |
| Space-Time Utils | `src/lib/utils/space-time-index.ts` | H3-based hex index; `queryHexIndexRadius()` for geo-radius queries |
| Space Utils | `src/lib/utils/space.ts` | `spatialThingToH3()` — converts SpatialThing to H3 cell |

### 6.4 Planning Orchestration & Scenario Search

The two modules below implement DDMRP Component 4 (Demand-Driven Planning) at the system level.
They were not previously documented in this outline.

| Module | File | Detail |
|---|---|---|
| `planForRegion` | `src/lib/planning/plan-for-region.ts` | Top-level planning orchestrator for an H3 cell region. **Types**: `DemandSlotClass` (`locally-satisfiable` / `transport-candidate` / `producible-with-imports` / `external-dependency`), `MetabolicDebt` (material no recipe can produce), `DeficitSignal` (unmet demand + metabolic debt, for upward composition), `SurplusSignal` (unabsorbed supply with provenance). **Functions**: `normalizeCells()` (deduplicate + drop dominated child cells), `classifySlot()` (per-slot coverage class), `detectConflicts()` (inventory-overclaim + capacity-contention), `mergePlanStores()`, `planForRegion()` (full 5-phase orchestrator), `buildPlanSignals()` (extract `{ deficits, surplus }` for parent planner). **Replenishment trigger**: specs tagged `tag:plan:replenishment-required` automatically trigger Pass 2 (consumption-pull replenishment). |
| `ScenarioIndex` | `src/lib/utils/space-time-scenario.ts` | Content-addressable Pareto scenario search index. **Types**: `Scenario` (deterministic ID, `processes`, `commitments`, `deficits`, `surpluses`, `score`, `expansionSignals`), `ScenarioScore` (coverage vs. effort — Pareto axes), `ScenarioNode` (keyed by `${h3Cell}::${processSpec}`), `ScenarioIndex` (nodes + scenarios, leaf_resolution=9, root_resolution=3). **Key property**: `computeScenarioId(signatures)` = djb2 hash of sorted commitment signatures → same content → same ID → embarrassingly parallel safe. **Functions**: `scoreScenario()`, `scenarioDominates()` (Pareto dominance), `paretoFront()` (O(n²) prune), `mergeScenarios(a, b, resolution)` (resolve deficits from surpluses; new cross-cell transfer Commitments), `mergeFrontier()` (one H3 level, prune to Pareto front), `globalParetoFront()` (across entire index), `addScenarioToIndex()` (bubble stats to ancestor nodes), `scenarioToPlan()` (commit winner to PlanStore). |

### 6.5 SNE Gap: Equipment Lifespan

The `use` action equipment depreciation in SNE requires a `lifespans: Map<specId, number>` (effort
hours per unit lifespan). This is **not stored in any schema field** — it is caller-supplied.
Without it, equipment depreciation contributes 0 to SNE (graceful degradation, but incomplete
cost basis). Adding `lifespan` to `ResourceSpecification` or `RecipeFlow` would close this gap.

---

## 7. Gap Summary

Modules that would complete a full MRP / DRP / DDMRP implementation.

| Module | Status | Methodology | Description |
|---|---|---|---|
| **DDMRP Component 1 (Positioning)** | | | |
| Decoupling Point Recommender | Gap | DDMRP | Score each BOM stage by CTT, MPLT, demand/supply variability, carrying cost, critical operation protection; stage DAG and demand hotspots exist but no scoring algorithm |
| CTT / MPLT Schema | Gap | DDMRP | `ResourceSpecification` has no `customerToleranceTime` or `marketPotentialLeadTime` field; needed as inputs to positioning algorithm |
| **DDMRP Component 2 (Buffer Zones)** | | | |
| ADU Calculator | Gap | DDMRP / DRP | Rolling average daily consumption from Observer events; `SNE.updateSNEFromActuals()` (EMA) is the closest structural pattern |
| Lead Time / Variability Category Schema | Gap | DDMRP | `ResourceSpecification` needs `leadTimeCategory` (short/medium/long) and `variabilityCategory` (low/medium/high) for LTF/VF lookup |
| Buffer Zone Formula | Gap | DDMRP | `computeBufferZones(specId, ADU, DLT, LTF, VF, MOQ)` → `{ redZone, yellowZone, greenZone, TOG, TOY }`; per-spec × per-location |
| Buffer Profile Persistence | Gap | DDMRP | No schema for storing computed zone thresholds; they would need to be persisted or recomputed each planning cycle |
| DLT Segmentation | Gap | DDMRP | `criticalPath()` returns total CLT; no algorithm to split it at decoupling stage boundaries to yield per-buffer Decoupled Lead Time |
| **DDMRP Component 3 (Dynamic Adjustments)** | | | |
| Planned Adjustment Factor (PAF) | Gap | DDMRP | Temporary buffer multiplier for known future events (seasonality, promotions, shutdowns); no schema field or calculation engine |
| Demand Adjustment Factor (DAF) | Gap | DDMRP | Rolling ADU trend / seasonality detector that auto-recalculates zone sizes; EMA pattern exists in `SNE.ts` but not applied to buffer sizing |
| **DDMRP Component 4 (Planning)** | | | |
| Qualified Demand Spike Filter | Gap | DDMRP | `netAvailableQty()` subtracts all open demand; DDMRP NFP subtracts only orders within spike horizon that exceed spike threshold |
| Replenishment Trigger Function | Gap | DDMRP | `shouldReplenish(NFP, TOY)` → `{ trigger: bool, orderQty: number = TOG − NFP }`; requires buffer zones to be computed first |
| Automatic NFP Monitor Loop | Partial (Observer hook exists) | DDMRP | Observer `resource_updated` events provide the reactive hook; missing: subscriber loop that rechecks NFP vs. TOY for all tracked buffer specs and fires `dependentDemand()` |
| **DDMRP Component 5 (Execution)** | | | |
| Buffer Status Function | Gap | DDMRP | `bufferStatus(specId, atLocation, zones)` → `{ NFP, zone: 'red'\|'yellow'\|'green', percentOfTOG, ROH, priority }`; all raw data exists in Observer + PlanNetter |
| Execution Priority Ranker (ROH) | Gap | DDMRP | Relative On-Hand = onHand / TOG × 100; lowest ROH = most urgent supply order; ranks all open orders by buffer health |
| OTIF Tracker | Partial (occurrence gaps exist) | DDMRP / DRP | `unfulfilledOccurrences()` provides per-commitment gap data; no aggregation into fill rate, on-time %, or average days late metrics |
| Supplier Collaboration Dashboard | Gap | DDMRP | No module publishing buffer status (zone + NFP) outbound to external suppliers for synchronized replenishment visibility |
| **DDOM Extensions** | | | |
| S&OP Aggregation Layer | Gap | DDMRP (DDOM) | No module rolling up `planForRegion()` results across all cells / echelons into consolidated demand/supply balance by product family or geography |
| DDMS (Demand-Driven Master Scheduling) | Gap | DDMRP (DDOM) | Horizon-based capacity synchronization resolving tactical plan against work center capacity; `ScheduleBook` + `criticalPath()` provide building blocks |
| T/I/OE Financial Dashboard | Gap | DDMRP (DDOM) | Theory of Constraints financial model: Throughput, Inventory, Operating Expense; raw cost data in `rollup.ts` / `cashFlowReport()` / `value-equations.ts` |
| D2 Investment Planning | Gap | DDMRP (DDOM) | Convert `Scenario.expansionSignals` into capital expenditure plans or new `RecipeProcess` candidates; signals exist but no investment planner |
| **MRP / DRP Gaps** | | | |
| Finite Capacity Scheduling | Gap | MRP / DDMRP | Load levelling across work centers; agent capacity ceiling enforcement during explosion |
| Material Substitution Engine | Partial (schema only) | MRP | `ResourceSpecification.substitutable` exists; no algorithm to select substitutes during explosion |
| Hard Pegging | Gap | MRP | Persistent demand→supply allocation records through to execution (beyond PlanNetter's in-memory soft pegs) |
| Lot Sizing Algorithms | Partial (`minimumBatchQuantity`) | MRP / DRP | EOQ, FOQ, POQ, min/max lot sizing rules |
| Safety Stock Calculator | Partial (`minimumQuantity`) | DRP / DDMRP | Statistical days-of-supply, service-level-based coverage factor; subsumed by buffer zone calculator in DDMRP |
| Exception Alert Engine | Gap | All | Past-due Commitments, shortage conditions, overload notifications; data exists in Observer + PlanStore |
| MPS Levelling / Smoothing | Gap | MRP | Horizon-based production smoothing across periods |
| Available-to-Promise (ATP) | Partial (mechanism exists) | MRP / DRP | `PlanStore.promoteToCommitment()` implements ATP (validates minimumQuantity, decrements availableQuantity); gap is a customer-facing service layer that accepts `(specId, qty, dueDate)` and returns a confirmed Commitment or earliest-available-date |
| Claim Workflow Module | Partial (PlanStore CRUD exists) | DRP / DDMRP | PlanStore has `addClaim/getClaim/allClaims/claimsForAgent`; gap is automated trigger-on-event, overdue alerting, and settlement reporting |
| **Infrastructure Gaps** | | | |
| Equipment Lifespan Store | Gap | All | `lifespans: Map<specId, number>` needed by SNE equipment depreciation is caller-supplied; no schema field or persistent store |
| Metabolism / Network Flow | Partial (stubs) | All | `metabolism.ts` (empty) + `network-flow.ts` (1-line stub); max-flow / system-dynamics |
| Shortest Path | Partial (1-line stub) | DRP | `shortest-path.ts` is effectively empty; needed for optimal route selection in distribution networks |

---

## 8. Architecture Diagram

```
┌───────────────────────────────────────────────────────────────┐
│  KNOWLEDGE LAYER                                              │
│  RecipeStore: Recipe, RecipeProcess, RecipeFlow               │
│  RecipeGroup (multi-product), RecipeExchange (templates)      │
│  ResourceSpecification (substitutable, mediumOfExchange,      │
│    resourceClassifiedAs: tag:plan:replenishment-required)     │
│  ProcessSpecification (work-center type + stage marker)       │
│  SNE index (embodied labor cost per spec)                    │
└───────────────────────┬───────────────────────────────────────┘
                        │ instantiate / explode
┌───────────────────────▼───────────────────────────────────────┐
│  PLAN LAYER                                                   │
│  PlanStore: Plan, Process, Commitment, Intent                 │
│  Agreement (stipulates + stipulatesReciprocal)                │
│  AgreementBundle, Proposal (offer|request), ProposalList      │
│  Scenario + ScenarioDefinition (what-if grouping)             │
│  Claim (receiver-initiated obligations)                       │
│  PlanNetter (netDemand / netSupply / netUse / netAvailableQty)│
│  ScheduleBook (blocksFor / committedEffortOn / hasUseConflict)│
└───────────────────────┬───────────────────────────────────────┘
                        │ fulfill / satisfy / settle
┌───────────────────────▼───────────────────────────────────────┐
│  OBSERVATION LAYER                                            │
│  Observer: EconomicEvent → EconomicResource (derived)         │
│    stream: resource_created | resource_updated | batch_created│
│  EconomicEvent.corrects (stocktake adjustments)               │
│  EconomicEvent.realizationOf / settles (Agreement / Claim)    │
│  BatchLotRecord (lot/serial control + expiry)                 │
│  Commune / Account (SNLT economy, Observer subscription)      │
└───────────────────────┬───────────────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────────────┐
│  ALGORITHM LAYER                                              │
│  dependent-demand  (MRP — back-schedule demand explosion)     │
│  dependent-supply  (DRP — forward supply explosion)           │
│  critical-path     (CPM: ES/EF/LS/LF/float, bottleneck)      │
│  rollup            (standard/actual cost, costVariance)       │
│  SNE               (embodied labor, EMA actuals update)       │
│  track-trace       (provenance & destination, includeStale)   │
│  resource-flows    (cash/inventory timeline, any resource)    │
│  value-equations   (income distribution, depreciation scorer) │
│  [metabolism]      (stub — system dynamics / I-O)             │
│  [network-flow]    (stub — max flow / min cost)               │
└───────────────────────┬───────────────────────────────────────┘
                        │ orchestrate
┌───────────────────────▼───────────────────────────────────────┐
│  ORCHESTRATION LAYER  (DDMRP Component 4)                     │
│  planForRegion         two-pass demand explosion + backtrack  │
│    DemandSlotClass     locally-satisfiable / transport /      │
│                        producible-with-imports / external     │
│    MetabolicDebt       unproducible shortfalls (external buy) │
│    DeficitSignal       upward hierarchical composition        │
│    SurplusSignal       surplus routing to parent planner      │
│    detectConflicts()   overclaim + contention resolution      │
│  ScenarioIndex         Pareto scenario search (H3 hierarchy)  │
│    computeScenarioId   content-addressable (djb2 hash)        │
│    mergeScenarios      deficit←surplus cross-cell resolution  │
│    mergeFrontier       bottom-up H3 hierarchy merge           │
│    paretoFront         coverage↑ × effort↓ Pareto prune       │
│    scenarioToPlan      commit winner → PlanStore              │
│    expansionSignals    capacity gap → D2 investment signal    │
└───────────────────────────────────────────────────────────────┘
```

### Methodology → Layer Mapping

```
MRP:
  Knowledge  →  RecipeStore (BOM + routing + RecipeGroup for multi-product)
  Plan       →  PlanStore (MPS Commitments via independentDemandOf, demand explosion Intents/Commitments)
  Algorithm  →  dependent-demand (back-schedule + netting + transport + minimum batch),
                PlanNetter (netDemand/netUse/netAvailableQty),
                ScheduleBook (capacity view), critical-path, rollup

DRP:
  Knowledge  →  RecipeStore (transport recipes via recipesForTransport(), multi-echelon BOM)
  Plan       →  PlanStore (replenishment Commitments, transfer Intents)
  Observation→  Observer (custody split: onhand vs accounting per location)
                Claim (reciprocal obligations from service/delivery events)
  Index      →  IndependentDemandIndex (H3 spatial + partial fulfillment; queryDemandBySpecAndLocation)
                AgentCapacity (dedup work Intents by space-time signature)
  Algorithm  →  dependent-supply (forward BFS), dependent-demand (atLocation + transport recipe auto-select),
                resource-flows (inventory/cash timeline per location),
                track-trace (lot/serial provenance), PlanNetter (atLocation guards)

DDMRP:
  Knowledge  →  RecipeStore + ProcessSpecification stages (decoupling points)
                ResourceSpecification.substitutable (buffer depth reduction)
                ResourceSpecification.resourceClassifiedAs: tag:plan:replenishment-required
  Plan       →  PlanStore (buffer-triggered Intents/Commitments, Scenarios, Claims)
                Intent.minimumQuantity (MOQ / reorder floor), promoteToCommitment (ATP)
                PlanNetter.netAvailableQty (stage-filtered NFP approximation)
  Observation→  Observer (on-hand per stage; resource_updated stream for DDMRP hooks)
                EconomicEvent.fulfills/satisfies (execution visibility)
                recurrence.ts: OccurrenceStatus, unfulfilledOccurrences (OTIF building block)
  Algorithm  →  dependent-demand (replenishment supply explosion)
                critical-path (cumulative LT; DLT requires segmentation at buffer stages)
                track-trace (execution visibility + lot traceability)
  Orchestration →
                planForRegion (two-pass planning: primary demands + replenishment)
                  + backtracking, MetabolicDebt, DeficitSignal/SurplusSignal, merge planner
                ScenarioIndex (Pareto search: coverage × effort; expansionSignals → D2)
                  + mergeFrontier (bottom-up H3 hierarchy) + scenarioToPlan (commit)
```

---

## 9. Action → Methodology Quick Reference

| Action | MRP | DRP | DDMRP |
|---|---|---|---|
| `produce` | Finished goods output; BOM terminal | DC output after processing | Buffer replenishment output |
| `consume` | Raw material / WIP draw-down | DC inventory draw-down | Buffer consumption trigger |
| `use` | Tool / equipment reservation (CRP) | Equipment at DC | Work-center time-slot |
| `work` | Labour input (SNLT cost basis) | Labour at DC | Labour commitment |
| `cite` | Spec / document existence gate | Regulatory doc gate | Quality document gate |
| `deliverService` | Service BOM component | 3PL service component | Service delivery signal |
| `pickup` | — | Cargo loading at origin | — |
| `dropoff` | — | Cargo delivery at destination | Buffer receipt |
| `accept` | Subcontract send-out | Rework send-out | — |
| `modify` | Subcontract return | Rework return | — |
| `combine` | Kitting (sets containedIn) | Packing / palletizing | Kit buffer |
| `separate` | Disassembly (clears containedIn) | Unpacking / depalletizing | Unbundle buffer |
| `transferAllRights` | Sale (accounting only) | Inter-company sale | — |
| `transferCustody` | Physical handoff, no sale | 3PL custody transfer | Buffer custody handoff |
| `transfer` | Full sale with delivery | DC replenishment shipment | Full buffer replenishment |
| `move` | Internal relocation (same org) | DC-to-DC internal move | Buffer repositioning |
| `copy` | Duplicate resource record | Create child resource at DC | — |
| `raise` | Positive stocktake variance | DC cycle count correction | Buffer count correction |
| `lower` | Write-off / negative count | DC shrinkage / loss | Buffer write-off |

---

## 10. Related Documentation

- `docs/value-flows/algorithms/cashflows.md` — Resource flow timeline detail
- `docs/value-flows/algorithms/critical-path.md` — CPM algorithm and float calculation
- `docs/value-flows/algorithms/rollup.md` — Standard/actual cost rollup
- `docs/value-flows/algorithms/provenance.md` — Track & trace design
- `docs/value-flows/algorithms/track.md` — Forward tracking
- `docs/value-flows/algorithms/netflows.md` — Net flow / netting engine
- `docs/value-flows/algorithms/equations.md` — Value equations / income distribution
- `docs/value-flows/appendix/rea.md` — REA (Resources–Events–Agents) background

### Key Source Files (DDMRP-Specific)

- `src/lib/planning/plan-for-region.ts` — Two-pass planning orchestrator; MetabolicDebt; DeficitSignal / SurplusSignal; merge planner
- `src/lib/utils/space-time-scenario.ts` — ScenarioIndex; Pareto search; deterministic scenario IDs; mergeFrontier; scenarioToPlan
- `src/lib/utils/recurrence.ts` — OccurrenceStatus; unfulfilledOccurrences; recurring demand fulfillment tracking
- `src/lib/utils/space-time-keys.ts` — getSpaceTimeSignature; VF type → SpaceTimeContext bridges; calendarComponents
- `src/lib/planning/netting.ts` — PlanNetter; netAvailableQty (NFP approximation); NON_CONSUMING_ACTIONS; fork
- `src/lib/indexes/independent-demand.ts` — DemandSlot; queryOpenDemands; H3 spatial demand index
- `src/lib/indexes/independent-supply.ts` — SupplySlot; three strata (inventory / scheduled_receipt / labor)
