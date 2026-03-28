# Free Association — Guile Scheme Architecture

A ValueFlows economic planning system built on Goblins actors, organized into
five layers. 62 modules, ~13,400 lines of Scheme, 105 test checks.

## System diagram

```
                    ┌─────────────────────────────────────────┐
                    │          Layer 5: Query Facade           │
                    │                                          │
                    │  query.scm — 84 VF spec queries          │
                    │  (unified dispatcher over all stores)    │
                    └──────────────┬────────────────────────────┘
                                   │
                    ┌──────────────┴────────────────────────────┐
                    │          Layer 4: Federation               │
                    │                                            │
                    │  plan-federation    store-registry          │
                    │  (hierarchy fold)   (qualified refs)        │
                    └──────────────┬────────────────────────────┘
                                   │
                    ┌──────────────┴────────────────────────────┐
                    │      Layer 3: Execution & Monitoring       │
                    │                                            │
                    │  monitors   scope-execution   alerts       │
                    └──────────────┬────────────────────────────┘
                                   │
                    ┌──────────────┴────────────────────────────┐
                    │      Layer 2: Planning Algorithms          │
                    │                                            │
                    │  plan-for-unit ── plan-for-scope           │
                    │       │      └── plan-for-region           │
                    │       │                                    │
                    │  dependent-demand   dependent-supply       │
                    │  (BFS unfold +      (BFS unfold)           │
                    │   durable inputs,                          │
                    │   transport routing,                       │
                    │   container resolution)                    │
                    │       │                  │                 │
                    │    netting (state monad)                   │
                    │       │                                    │
                    │  propagation  sne  ddmrp  signals          │
                    │                                            │
                    │  ── Extended algorithms ──                  │
                    │  critical-path  shortest-path  network-flow│
                    │  flow-graph  custody  otif  metabolism      │
                    │  positioning  track-trace  value-equations  │
                    │  rollup  resource-flows                    │
                    │                                            │
                    │  ── Indexes ──                              │
                    │  intents  commitments  economic-events      │
                    │  economic-resources  independent-demand     │
                    │  independent-supply  membership  proposals  │
                    │  agents                                    │
                    └──────────────┬────────────────────────────┘
                                   │
                    ┌──────────────┴────────────────────────────┐
                    │     Layer 1: Store Actors (Goblins)        │
                    │                                            │
                    │  scope-root (coordinator)                  │
                    │    ├── recipe-store     (7 hashmaps)       │
                    │    ├── agent-store      (3 hashmaps)       │
                    │    ├── observer         (fold kernel)      │
                    │    ├── plan-store       (10+ hashmaps)     │
                    │    ├── buffer-zone-store                   │
                    │    ├── account-store    (commune)          │
                    │    ├── capacity-buffer-store               │
                    │    ├── spatial-thing-store                 │
                    │    ├── snapshot-store   (append-only)      │
                    │    ├── alert-store      (append-only)      │
                    │    └── process-registry                    │
                    └──────────────┬────────────────────────────┘
                                   │
                    ┌──────────────┴────────────────────────────┐
                    │     Layer 0: VF Record Types               │
                    │                                            │
                    │  schemas.scm — 47 immutable records        │
                    │  store-utils.scm — hashmap helpers         │
                    └────────────────────────────────────────────┘
```

## Layer 0 — Record types (`schemas.scm`, 2160 lines)

The ValueFlows ontology as Guile `make-record-type` definitions. All fields
immutable. Optional fields hold `#f`. Enums are symbols with validation predicates.

**47 record types** organized by VF layer:

| Category | Records |
|----------|---------|
| **Temporal** | `<time-range>`, `<day-schedule>`, `<week-schedule>`, `<month-schedule>`, `<availability-window>`, `<specific-date-window>` |
| **Primitives** | `<measure>`, `<duration>`, `<unit>`, `<spatial-thing>`, `<batch-lot-record>` |
| **Actions** | `<action-definition>` + `*action-definitions*` alist (19 VF actions) |
| **Agents** | `<agent>`, `<agent-relationship-role>`, `<agent-relationship>` |
| **Knowledge** | `<resource-specification>`, `<process-specification>`, `<positioning-analysis>`, `<decoupling-test-entry>`, `<decoupling-test-result>`, `<capacity-buffer>`, `<recipe-flow>`, `<recipe-process>`, `<recipe-exchange>`, `<recipe>`, `<recipe-group>` |
| **Observation** | `<economic-resource>`, `<economic-event>`, `<process>` |
| **Planning** | `<intent>`, `<commitment>`, `<claim>`, `<plan>`, `<scenario-definition>`, `<scenario>`, `<agreement>`, `<agreement-bundle>`, `<proposal>`, `<proposal-list>` |
| **DDMRP** | `<buffer-profile>`, `<buffer-zone>`, `<replenishment-signal>`, `<demand-adjustment-factor>` |
| **Tracking** | `<fulfillment-state>`, `<satisfaction-state>`, `<claim-state>`, `<buffer-snapshot>`, `<account>` |

**`store-utils.scm`** provides `hashmap-values`, `hashmap-filter`, `hashmap-find`,
`serialize-hashmap`/`deserialize-hashmap` (for persistence), `generate-id`,
`iso-datetime->epoch`.

## Layer 1 — Store actors (11 actors + coordinator)

Each store is a Goblins `define-actor` with:
- Immutable state transitioned via `bcom`
- `methods` macro for message dispatch
- `#:portrait` / `#:restore` / `#:version` for persistence
- Record-to-list converters for serialization (Goblins can't persist raw Guile records)

### `^scope-root` — the coordinator

Wires all stores into a single Goblins vat. A scope (organization, commune,
ecological agent) IS a vat. All stores are near (same vat), so operations
within a scope are synchronous and transactional (single turn = all-or-nothing).

### `^observer` — the fold kernel (1,256 lines)

The Observer is architecturally a **left fold**: `(fold event->state events initial-state)`.

Each event is folded through a 6-phase pipeline:

```
phase-append-event  →  phase-index-event  →  phase-apply-effects
                                              →  phase-breadcrumb-chain
                                                  →  phase-implied-transfer
                                                      →  phase-track
```

Features:
- **Split-custody detection**: pickup/dropoff with different provider/receiver creates
  two resource records with overridden effects per direction
- **Container unpacking**: `separate` action captures container location before
  detachment, inherits it post-effects
- **Batch creation**: `produce` action auto-creates `BatchLotRecord` linked to resource
- **Auto-resource creation**: `createResource='optional'/'optionalTo'` triggers
  resource creation when it doesn't exist
- **previousEvent breadcrumb chain**: each affected resource's `previousEvent` field
  is set to the event ID, building the chain that `trace-resource` walks
- **Validation**: fulfills/satisfies mutual exclusivity enforced
- **Enriched inventory**: `enriched-inventory` returns InventoryEntry format with
  spec, qty, unit, location, accountable, batches
- **Process completion**: standalone `check-process-completion` detects when all
  output commitments are fulfilled and marks the process finished

### `^plan-store` — planning layer (1,300 lines)

Holds all planning artifacts: intents, commitments, plans, agreements, claims,
proposals, scenarios. Maintains secondary indexes (tag-index, intents-by-spec,
commitments-by-spec, commitments-by-process) for O(k) lookups.

Key operations:
- **`promote-to-commitment`** — elevates an Intent to a Commitment with
  `minimumQuantity` validation, `availableQuantity` check and decrement (ATP mechanism)
- **`instantiate-recipe`** — full recipe expansion with scaleFactor computation,
  back/forward scheduling, durable input detection, observer-based inventory
  allocation, and RecipeExchange→Agreement conversion
- **`accept-proposal`** — temporal validation, proposedTo enforcement, unit-based
  scaling, promotes primary + reciprocal intents, creates Agreement with
  stipulates/stipulatesReciprocal linkage
- **`approve-replenishment`** — tag validation, action override, outputOf/plannedWithin
- **`emit-signal` / `signals-of-kind`** — typed signal lifecycle via tagged intents
- **`merge`** — monoidal fold of source store into self (single bcom transition)
- **Full CRUD** for scenarios, scenario-definitions, agreement-bundles, proposals,
  proposal-lists

### `^account-store` — commune labor-credit system

Implements the SNLT-based elastic claim capacity system.

### Persistence

Every store actor serializes via `#:portrait` and deserializes via `#:restore`.
Persistence round-trips verified by spawning a fresh vat from the same memory-store.

## Layer 2 — Algorithms

### Core planning algorithms (7 modules)

| Module | Functions | Pattern |
|--------|-----------|---------|
| **propagation.scm** | `rp-duration-ms`, `rp-duration-days`, `compute-snlt`, `create-flow-record` | Duration conversion, SNLT per-output-unit |
| **sne.scm** | `build-sne-index`, `compute-recipe-sne`, `compute-sne-for-recipe` | SNE = direct labor + embodied labor + depreciation |
| **ddmrp.scm** (1,213 lines) | 69 functions: ADU, NFP, zones, recalibration, prioritized-share, alerts, analytics, profiles | Ptak & Smith Ch 7-9 formulas + execution analytics |
| **signals.scm** | `signal->intent`, `intent->signal`, `*plan-tags*` | Bidirectional isomorphism: typed signal alist <-> VF Intent |
| **netting.scm** | `netter-net-demand`, `netter-reserve`, `netter-net-available`, `netter-fork`, `netter-retract` | Pure state monad: fork = identity, retract = restore |
| **dependent-demand.scm** (453 lines) | BFS demand explosion + durable inputs (use/cite) + transport routing + container-mediated resolution + SNE ranking | Unfold with back-scheduling |
| **dependent-supply.scm** | BFS supply forward-scheduling | Dual of demand unfold |

### Extended algorithms (12 modules)

| Module | Key Functions |
|--------|--------------|
| **critical-path.scm** | CPM forward/backward pass, float, critical path |
| **shortest-path.scm** | Dijkstra O(V^2), Bellman-Ford O(VE), path reconstruction |
| **network-flow.scm** | Edmonds-Karp max-flow, min-cut |
| **flow-graph.scm** | Scope flow analysis: coherence, interdependence, merge/split candidates |
| **custody.scm** | 14 functions: ledger, entrustment limits, penalties, tranches |
| **otif.scm** | On-Time In-Full metrics |
| **metabolism.scm** | Net metabolic balance (output - input by spec) |
| **positioning.scm** | Routing geometry, decoupling/control point scoring |
| **track-trace.scm** | DFS backward trace (provenance) + forward track (destination) |
| **value-equations.scm** | Effort/resource/equal/depreciation scorers, income distribution |
| **rollup.scm** | Standard cost (recipe), actual cost (events), variance |
| **resource-flows.scm** | Period-bucketed cash flow timeline |

### Indexes (10 modules)

Pre-built hashmap indexes for O(log n) queries over intents, commitments,
economic events, economic resources, independent demand/supply, membership,
proposals, and agent capacity.

### Utilities (2 modules)

- **buffer-type.scm** — buffer type classification from tags, composite priority
- **recurrence.scm** — occurrence grouping, date matching, unfulfilled occurrences

### Orchestration (3 modules)

**`plan-for-unit.scm`** — the multi-pass DDMRP planner (compiler pipeline):

```
Demands (source)
  → Extract (demand/supply slots from stores)
  → Classify (locally-satisfiable / transport / producible / external)
  → Formulate (multi-pass fold with buffer guards)
      Block A (Pass 0): Buffer evaluation + capacity reservation
      Block B (Pass 1): Primary demand explosion (with TOY guard -> deferred)
      Block C (Pass 2): Derived replenishment from consumed specs
      Pass 1b: Retry deferred demands (replenishment increased capacity)
      Backtracking: Sacrifice low-priority to resolve metabolic debts
  → Supply phase: Forward-schedule supply, route surplus to buffers
  → Collect: Emit deficit/surplus/conservation signals
```

**`plan-for-scope.scm`** and **`plan-for-region.scm`** configure spatial
normalization policies, then delegate to `plan-for-unit`.

### Planning utilities (3 modules)

- **schedule-book.scm** — per-entity schedule queries, use-conflict detection
- **remote-transport.scm** — snapshot/hydrate serialization for cross-scope sync
- **knowledge/federation-recipes.scm** — bootstrap recipe data for demos

### Observation extensions (2 modules)

- **transition.scm** — 24 scope transition economics functions (flow fractions,
  worker hours, wages, claim capacities, substitution ratios, phase-out)
- **demand-policy.scm** — derived/communal demand expansion policies

## Layer 3 — Execution (3 modules)

- **alerts.scm** — `^alert-store` (append-only)
- **monitors.scm** — execution monitors for buffer health
- **scope-execution.scm** — execution engine orchestration

## Layer 4 — Federation (2 modules)

### `^store-registry` — cross-scope namespace

Maps scope IDs to plan-store actor references. Supports qualified references
(`"scope-id::record-id"`), cross-scope tag queries, and near/far transparency.

### `plan-federation.scm` — hierarchical planning

Monoidal fold over scope hierarchy: build-hierarchy -> fold-scopes (bottom-up)
-> match-laterally (greedy surplus<->deficit matching across peers).

## Layer 5 — Query facade (`query.scm`)

Unified VF query dispatcher with 84 methods covering agents, events, resources,
batches, fulfillment/satisfaction, plans, intents, commitments, claims,
agreements, proposals, scenarios, signals, recipes, processes, and algorithm
delegations (critical-path, trace, track, rollup, cash-flow, distribute-income).

## Categorical structure

| Component | Pattern | Why it matters |
|-----------|---------|----------------|
| Observer | **Left fold** | Replay, branch, checkpoint at any point |
| Dependent demand/supply | **Unfold** (BFS) | Dual of fold — grows structure from a seed |
| PlanNetter | **State monad** | Fork = identity, retract = restore, no copy overhead |
| Buffer zone formulas | **Catamorphism** | Profile IS the F-algebra; TOR/TOY/TOG are the carrier |
| Signal round-trip | **Isomorphism** | Lossless Intent <-> typed signal conversion |
| Recipe chain | **Free monad** | Same syntax tree, two interpreters (back/forward schedule) |
| Scope merge | **Monoid** | Associative merge; empty scope = identity |
| VF action table | **Tagless final** | Effects defined by algebra, not syntax; swappable interpreters |
| Whole planner | **Compiler pipeline** | Demands -> classify -> explode -> net -> schedule -> emit |

## Complexity

All hashmap operations (get, set, remove) are O(log32 n) via HAMT, which is
effectively O(1) for practical sizes.

### Secondary indexes

| Store | Index | Enables |
|-------|-------|---------|
| **Observer** | `idx-by-spec` (spec-id -> resource-ids) | `conforming-resources` O(log n) |
| **Observer** | `idx-by-resource/process/agent/action` | All event queries O(log n) |
| **Recipe Store** | `idx-flows-by-input/output` (process-id -> flow-ids) | `flows-for-process` O(log n) |
| **Recipe Store** | `idx-recipes-by-output` (spec-id -> recipe-ids) | `recipes-for-output` O(log n) |
| **Plan Store** | `intents/commitments-by-plan` (plan-id -> ids) | Plan queries O(log n) |
| **Plan Store** | `commitments-by-process` (process-id -> ids) | Process query O(log n) |
| **Plan Store** | `tag-index`, `*-by-spec` | Tag/spec queries O(log n) |

### Key algorithms

| Algorithm | Complexity | Notes |
|-----------|-----------|-------|
| `record-event` (observer fold) | O(log n) | 6 phases, each O(log n) hashmap ops |
| `get-process-chain` (topo sort) | O(P^2 + E) | Kahn's algorithm with indexed flow lookups |
| `dependent-demand` (BFS unfold) | O(B * P) | B = BFS breadth, P = processes per recipe |
| `compute-nfp` | O(log n + C) | Indexed conforming-resources + commitment scan |
| `match-laterally` | O(S^2) | Greedy offer x request matching (S = scopes) |
| `prioritized-share` | O(N * 3) | 3-phase zone fill: TOR -> TOY -> proportional green |
| `critical-path` | O(V + E) | Forward/backward CPM passes |
| `max-flow` | O(V * E^2) | Edmonds-Karp BFS augmenting paths |

## File inventory

```
planner/lib/
├── schemas.scm                          2,160 lines  Layer 0: 47 record types
├── store-utils.scm                        109 lines  Layer 0: shared helpers
├── scope-root.scm                          89 lines  Layer 1: vat coordinator
├── agents.scm                             177 lines  Layer 1: ^agent-store
├── process-registry.scm                    55 lines  Layer 1: ^process-registry
├── query.scm                              174 lines  Layer 5: VF query facade
├── knowledge/
│   ├── buffer-zones.scm                   210 lines  Layer 1: ^buffer-zone-store
│   ├── buffer-snapshots.scm                96 lines  Layer 1: ^snapshot-store
│   ├── capacity-buffers.scm                96 lines  Layer 1: ^capacity-buffer-store
│   ├── recipes.scm                        548 lines  Layer 1: ^recipe-store
│   ├── spatial-things.scm                  68 lines  Layer 1: ^spatial-thing-store
│   └── federation-recipes.scm              91 lines  Bootstrap: seed data
├── observation/
│   ├── observer.scm                     1,256 lines  Layer 1: ^observer (6-phase fold)
│   ├── account.scm                        249 lines  Layer 1: ^account-store
│   ├── transition.scm                     151 lines  Economics: scope transition
│   └── demand-policy.scm                   56 lines  Economics: demand derivation
├── execution/
│   ├── alerts.scm                          84 lines  Layer 1: ^alert-store
│   ├── monitors.scm                        68 lines  Layer 3: execution monitors
│   └── scope-execution.scm                 81 lines  Layer 3: execution engine
├── planning/
│   ├── planning.scm                     1,300 lines  Layer 1: ^plan-store
│   ├── plan-for-unit.scm                  362 lines  Layer 2: DDMRP orchestrator
│   ├── plan-for-scope.scm                  38 lines  Layer 2: scope wrapper
│   ├── plan-for-region.scm                 34 lines  Layer 2: region wrapper
│   ├── store-registry.scm                  93 lines  Layer 4: ^store-registry
│   ├── plan-federation.scm                180 lines  Layer 4: federation planner
│   ├── schedule-book.scm                   60 lines  Layer 2: schedule queries
│   └── remote-transport.scm                20 lines  Layer 2: snapshot/hydrate
├── algorithms/
│   ├── propagation.scm                    144 lines  Core: duration, SNLT
│   ├── sne.scm                            139 lines  Core: SNE index
│   ├── ddmrp.scm                        1,213 lines  Core: 69 DDMRP functions
│   ├── signals.scm                        211 lines  Core: signal conversion
│   ├── netting.scm                        235 lines  Core: state monad netter
│   ├── dependent-demand.scm               453 lines  Core: BFS demand unfold
│   ├── dependent-supply.scm               236 lines  Core: BFS supply unfold
│   ├── critical-path.scm                  113 lines  Extended: CPM scheduling
│   ├── shortest-path.scm                   89 lines  Extended: Dijkstra, Bellman-Ford
│   ├── network-flow.scm                    96 lines  Extended: max-flow, min-cut
│   ├── flow-graph.scm                      98 lines  Extended: scope flow analysis
│   ├── custody.scm                        161 lines  Extended: custody protocol
│   ├── otif.scm                            62 lines  Extended: OTIF metrics
│   ├── metabolism.scm                      56 lines  Extended: metabolic balance
│   ├── positioning.scm                     82 lines  Extended: decoupling candidates
│   ├── track-trace.scm                     84 lines  Extended: provenance/destination
│   ├── value-equations.scm                119 lines  Extended: income distribution
│   ├── rollup.scm                          78 lines  Extended: cost rollup
│   └── resource-flows.scm                  56 lines  Extended: cash flow timeline
├── indexes/
│   ├── index-utils.scm                     31 lines  Shared: generic index builder
│   ├── intents.scm                         49 lines  Index: intents by spec/action/agent/plan
│   ├── commitments.scm                     61 lines  Index: commitments by spec/action/agent/plan/process
│   ├── economic-events.scm                 55 lines  Index: events by spec/action/agent/resource/process
│   ├── economic-resources.scm              48 lines  Index: resources by spec/accountable/stage/location
│   ├── independent-demand.scm              52 lines  Index: demand by spec/action/scope
│   ├── independent-supply.scm              55 lines  Index: supply by spec (inventory + scheduled)
│   ├── membership.scm                      49 lines  Index: citizen/scope mapping
│   ├── proposals.scm                       27 lines  Index: proposals by purpose/scope
│   └── agents.scm                          32 lines  Index: agent capacity by spec
└── utils/
    ├── buffer-type.scm                     38 lines  Utility: buffer type from tags
    └── recurrence.scm                     100 lines  Utility: occurrence tracking

tests/
├── scope-integration.scm                  407 lines  48 checks: full VF lifecycle
├── algorithms-foundation.scm              333 lines  37 checks: DDMRP, SNLT, SNE
└── planning-federation.scm                280 lines  20 checks: 3-scope federation

Total: 62 files, ~13,400 lines, 105 test checks
```
