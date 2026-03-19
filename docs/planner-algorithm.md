# Planner Algorithm Design Notes

This document captures the design decisions behind the two-pass planning engine
(`planForScope`, `planForRegion`, `dependentDemand`).
Intended audience: contributors who need to extend or debug the planning logic.

---

## §0 — Architectural Identity

**Primary architecture: DDMRP-VF.**

MRP-style full BFS explosion is the **fallback** for specs not tagged
`tag:plan:replenishment-required`.

> The `tag:plan:replenishment-required` tag on a `ResourceSpec` is a **DDMRP
> decoupling point declaration** (Component 1: Strategic Inventory Positioning),
> and a **spec-v2 political decision** encoded in the knowledge layer by the scope
> assembly. Pass 1 treats tagged specs as buffer boundaries: it allocates from
> on-hand inventory if available, then stops. It never continues upstream into the
> spec's production recipe during Pass 1 — instead it records a replenishment signal
> (`boundaryStops`). Pass 2 fires the buffer's full recipe chain (unrestricted BFS).
> Specs without this tag receive full MRP-style BFS explosion in Pass 1.

**Deliberate divergence from distribution DDMRP:** When a buffer is depleted,
pure DDMRP fires a larger replenishment order and allows human expediting —
demand is backordered, not dropped. Our commune planning model makes a deliberate
architectural choice: boundary-stopped demand is declared **unmet in the current
planning cycle**. This surfaces buffer-sizing failures clearly and is consistent
with spec-v2's local/global inversion — the commune's failure at the buffer
boundary is the correct level of failure to propagate upward, not raw-material-level
shortfalls.

"The recipe set is the politics; the planner is the arithmetic" — the BFS stop
simply executes the scope assembly's buffer placement decision.

---

## §1 — Two-Pass Structure

### Pass 1 — Independent demand explosion with decoupling-point stops

Each demand slot (sourced from `IndependentDemandIndex`) is classified and
processed in priority order: locally-satisfiable → transport-candidate →
producible-with-imports → external-dependency, then by due date ascending.

For each slot `dependentDemand()` is called with `honorDecouplingPoints: true`.
The BFS:
- allocates existing inventory at each spec via `PlanNetter`
- if the spec is tagged `replenishment-required` and `remaining > 0` after netting:
  records the remainder in `result.boundaryStops` and **stops** (no recipe explosion)
- for non-buffer specs: continues full MRP BFS explosion upstream

`transport-candidate` slots are short-circuited: a single transfer intent is
created and no recipe explosion occurs.

**Result:** `boundaryStops` Map (specId → qty remaining at boundary) plus
`allocated` (inventory consumed from on-hand).

### Derived — Pass 2 inputs

After Pass 1 completes, two maps are computed:

- `consumedBySpec` — buffer inventory drawn down in Pass 1 (needs restocking)
- `boundaryBySpec` — demand that hit an empty buffer (genuine buffer deficit)

These are unioned: `allBufferSpecs = consumedBySpec ∪ boundaryBySpec`.
For each spec in the union, `qty = consumed + boundary`.

Sizing override: when `bufferAlerts` is provided and the spec has an alert,
`TOG − onhand` replaces the combined qty (fills to target regardless of
per-cycle consumption). `green`/`excess` zones suppress replenishment entirely.

A P7 sub-step injects proactive buffer-fill demands for `red`/`yellow` specs
not already in the derived set (buffers eroded in prior periods, not this run).

### Pass 2 — Replenishment

Each derived demand is exploded via `dependentDemand()` with
`honorDecouplingPoints` **not set** (full unrestricted BFS). The observer is
also omitted so replenishment fires production recipes rather than re-sourcing
existing stock.

Unresolvable replenishment demands accumulate as `MetabolicDebt` and are
emitted as `source: 'metabolic_debt'` deficit signals upward.

---

## §2 — BFS Algorithm Properties

Queue-based iterative BFS. Four decision points in `processDemand`, in order:

1. **Netting:** `if remaining <= 0 return` — fully covered by on-hand inventory
   or previously scheduled outputs.

2. **Decoupling stop (DDMRP-VF):** if `honorDecouplingPoints` AND spec tagged
   `replenishment-required` AND `remaining > 0` → record in `result.boundaryStops`,
   return. No purchaseIntent is emitted — demand is unmet this cycle.

3. **No-recipe:** emit `purchaseIntent` and return (MRP fallback for terminal
   raw materials that have no production recipe).

4. **Recipe found:** scale, back-schedule, enqueue inputs (MRP explosion
   continues upstream).

Point 2 fires before point 3: `replenishment-required` specs with recipes never
emit purchaseIntents in Pass 1.

---

## §3 — Backtracking Semantics

When Pass 2 replenishment fails (metabolic debt remains), the backtracking loop
retracts low-criticality Pass 1 demands to free capacity.

**Retraction order:**
1. Lowest sacrifice score (sacrificed qty / member count)
2. Highest demand class (external-dependency before locally-satisfiable)
3. Latest due date

**Steps for each candidate:**
1. `netter.retract(candidate.result)` — undo all allocations
2. Retry Pass 2 replenishment with freed capacity
3. Attempt re-explode of the retracted demand (`honorDecouplingPoints: true`)

**Re-explode and freed buffer inventory:** Re-explode calls use
`honorDecouplingPoints: true`. If retraction freed buffer inventory (e.g. flour),
the netting step (Decision A) satisfies the demand before the boundary check
fires — so freed inventory is always usable by re-explodes. The boundary stop
only fires when the buffer is still empty after netting. ✓

If re-explode fails on all three counts (no allocated, no scheduled receipts,
no processes created), the demand is permanently sacrificed (`unmetDemand`) and
a `source: 'unmet_demand'` deficit signal is emitted.

The `sacrificeDepth` context option caps the number of permanent sacrifices.

---

## §4 — Scope Hierarchy as Multi-Echelon Buffer Network

Each scope boundary is a demand decoupling point (spec-v2 local/global
inversion). The `replenishment-required` BFS stop prevents Pass 1 from reaching
upstream buffer specs that may be custodied by parent scopes.

Child scopes emit `ScopeDeficitSignal` for unmet demands; parent scopes inject
these as demand slots in their own Pass 1 and re-explode them against federation-
level recipes and inventory.

**Multi-echelon note:** DDMRP's prioritized-share protocol (fill all buffers to
TOR first → then TOY → proportional green) is not yet implemented in
`plan-federation.ts`.

---

## §5 — MRP Fallback for Non-Buffer Specs

Specs without `replenishment-required` receive full BFS in Pass 1 regardless of
`honorDecouplingPoints`. Decision 2 only fires when the tag is present.

This is correct for project/capital demand where there are no strategic buffer
positions — the full recipe chain is always explored.

---

## §6 — DDMRP Infrastructure Already Implemented (`ddmrp.ts`)

All of the following are implemented and ready to wire into the planning cycle:

- `computeADU`, `bootstrapADU`, `blendADU` — rolling Average Daily Usage
- `computeBufferZone` → TOR / TOY / TOG zone thresholds
- `netFlowPosition` — NFP = on-hand + on-order − qualified demand (signed)
- `qualifiedDemand`, `orderSpikeThreshold` — OST demand spike filter
- `aggregateAdjustmentFactors` — DAF / zone / lead-time adjustments
- `deriveVariabilityFactor`, `standardProfileTemplate`
- `BufferZone`, `BufferProfile`, `ReplenishmentSignal`, `DemandAdjustmentFactor`
  schemas

---

## §7 — Remaining Gaps

- **NFP replenishment trigger:** `netFlowPosition()` exists; not called from
  orchestrators. Currently Pass 2 is triggered by consumption, not NFP ≤ TOY.
- **Open-PO netting:** external purchase commitments not included in on-order
  for NFP computation.
- **ADU not wired:** `computeADU()` exists; not called from planning cycle.
- **Qualified demand OST filter:** `qualifiedDemand()` exists; not used in
  `PlanNetter`.
- **Prioritized share:** DDMRP Ch 9 sequential zone-fill not in
  `plan-federation.ts`.

### Wired in this pass

- **Buffer-level deficit signals** (gap #6 — now wired): boundary stops now
  emit buffer-level `ScopeDeficitSignal` (e.g. `specId='flour'`) in addition
  to the demand-level signal. Federation receives "flour buffer depleted" and
  can replenish flour directly without re-discovering the bread→flour dependency.
  `intentId` format: `boundary:<intentId>:<bufferSpecId>`.
- **`bufferZoneStore` wiring** (now wired): `BufferZoneStore` is now the
  preferred input to all planning orchestrators (`planForScope`,
  `planForRegion`, `planFederation`). `effectiveAlerts` is derived
  automatically via `bufferStatus(onhand, zone)` for each zone in the store.
  The explicit `bufferAlerts` map remains a manual override path when
  `bufferZoneStore` is absent.
