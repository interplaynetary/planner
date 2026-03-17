# Planner Algorithm Design Notes

This document captures the design decisions behind `planForScope` and its
relationship to DDMRP (Demand-Driven Material Requirements Planning).
Intended audience: contributors who need to extend or debug the two-pass
planning engine.

---

## 0. Architectural Identity

**This system is MRP-VF with an optional DDMRP overlay.**

"MRP-VF" means: standard Material Requirements Planning logic — demand
explosion through a BOM/recipe graph, inventory netting, purchase intents for
unresolvable remainder — expressed entirely in ValueFlows primitives
(Intents, Commitments, Processes, RecipeFlows, EconomicResources).

"Optional DDMRP overlay" means: when the caller supplies buffer zone data
(`ctx.bufferAlerts`), Pass 2 replenishment sizing and gating shifts to
DDMRP semantics (zone-gated, TOG − onhand sizing). When that data is absent,
the system falls back to the MRP default (replenish exactly what was consumed).

This is a deliberate, stable architectural choice. The alternative — building
DDMRP-VF scope composition from the start — would require a fundamentally
different information flow (§5). We are not building toward that. The
`bufferAlerts` interface is a clean integration seam, not a migration path.

---

## 1. Two-Pass Planning Overview

The planner runs in two sequential passes within a single scope invocation.

**Pass 1 — Independent demands**

Each demand slot (sourced from `IndependentDemandIndex`) is classified and
processed in priority order: locally-satisfiable → transport-candidate →
producible-with-imports → external-dependency, then by due date ascending.

For each slot the algorithm calls `dependentDemand()`, which:
- allocates existing inventory via the `PlanNetter`
- fires recipe explosions (BFS) to satisfy what inventory cannot cover
- emits `purchaseIntents` for anything still unresolvable

`transport-candidate` slots are short-circuited: a single transfer intent is
created and no recipe explosion occurs, since the supply physically exists
elsewhere and should be matched at the federation level, not consumed locally.

**Derived step — Replenishment demand computation**

After Pass 1 completes, the allocations are scanned to identify which
`ResourceSpec`s tagged `tag:plan:replenishment-required` were consumed.
These become the inputs to Pass 2.

Default (MRP) behavior: replenish exactly the quantity consumed.

When `ctx.bufferAlerts` is provided (DDMRP overlay), each consumed spec is
checked per-alert:
- `green` / `excess`: skip — buffer is healthy, no replenishment needed
- `red` / `yellow`: size the demand by `TOG − onhand` (fill-to-target),
  not by the consumption quantity

A P7 sub-step injects proactive buffer-fill demands for `red`/`yellow` specs
that were *not* consumed in Pass 1 (buffer eroded by prior periods, not this
run). This only fires when `bufferAlerts` is present — it is a DDMRP overlay
behaviour with no MRP equivalent.

**Pass 2 — Replenishment / metabolic demands**

Each derived demand is exploded via `dependentDemand()` against a forked
netter that does not see on-hand inventory (replenishment is about restocking,
not consuming what is already there).

Unresolvable replenishment demands accumulate as `MetabolicDebt` and are
emitted as `source: 'metabolic_debt'` deficit signals upward.

---

## 2. BFS Algorithm Properties

`dependentDemand()` runs an exhaustive BFS over the recipe graph:

- **Exhaustive** — all recipe branches are explored before the demand is
  declared unresolvable
- **Per-task lazy exit** — once a task (process node) is fully allocated,
  its subtree is not re-explored
- **Netting model** — `PlanNetter` tracks what has been allocated in this
  planning session; subsequent calls see a net-reduced inventory, preventing
  double-allocation across slots

The BFS produces:
- `processes` — process nodes created
- `commitments` — input commitments consuming inventory or labor
- `allocated` — concrete inventory allocations (physical resources from Observer)
- `allocatedScheduledIds` — IDs of scheduled receipts (future supply) absorbed
- `purchaseIntents` — unresolvable remainder emitted as purchase/transfer intents

---

## 3. Backtracking Semantics

When Pass 2 replenishment fails (metabolic debt remains), the backtracking
loop attempts to free capacity by retracting low-criticality Pass 1 demands.

**Retraction order:**
1. Lowest sacrifice score (sacrificed qty / member count) among remaining Pass 1 records
2. Highest demand class (external-dependency before locally-satisfiable)
3. Latest due date

**Steps for each candidate:**
1. `netter.retract(candidate.result)` — undo all allocations for this demand
2. Retry replenishment with the freed capacity
3. Attempt re-explode of the retracted demand with the now-available resources

**Re-explode success condition:**
A re-explode is considered successful if *any* of the following is true:
- `allocated.length > 0` — inventory was consumed
- `allocatedScheduledIds.size > 0` — a scheduled receipt was absorbed
- `processes.length > 0` — a production recipe was triggered (no inventory needed)

The third condition is the critical one: a recipe-only resolution creates
processes and commitments but leaves `allocated` empty. Without this check,
recipe-resolved re-explodes were falsely treated as failures and the demand
was permanently sacrificed.

If re-explode fails on all three counts, the demand is permanently sacrificed
(`unmetDemand`) and a `source: 'unmet_demand'` deficit signal is emitted.

The `sacrificeDepth` context option caps the number of permanent sacrifices,
preventing runaway backtracking on pathological inputs.

---

## 4. Scope Boundaries as Demand Decoupling Points

`planForScope` uses VF Agent scope boundaries as demand information barriers:

- Each scope runs an independent planning pass and emits deficit/surplus signals
- Parent scopes consume child deficit signals as demand slots, injecting them
  into their own Pass 1 (upward composition via `childSignals`)
- Surplus signals are matched laterally at the federation level

A child commune does not propagate raw recipe explosions upward — it propagates
a clean shortfall quantity, which the parent resolves with its own recipe and
inventory knowledge. This is the MRP-VF decoupling mechanism: structural
(scope boundary), not signal-based (NFP threshold).

This is similar in effect to a DDMRP decoupling point — both break the demand
amplification chain — but the trigger and sizing logic are different (see §5).

---

## 5. MRP-VF vs DDMRP-VF: What We Are and What We Are Not

This section exists to prevent future contributors from inadvertently pushing
the system toward DDMRP-VF semantics and creating hybrid behaviour.

### What MRP-VF does

1. **Demand explosion crosses replenishment boundaries.** Pass 1 BFS allocates
   inventory from a `replenishment-required` spec. The spec boundary is not a
   stop point — the explosion passes through it and consumes stock.
2. **Pass 2 is triggered by consumption.** If nothing consumed a
   `replenishment-required` spec in Pass 1, Pass 2 does not fire for it
   (unless `bufferAlerts` is present and the zone is red/yellow — DDMRP overlay).
3. **Replenishment is sized by consumption** (MRP default) or by
   `TOG − onhand` (DDMRP overlay when `bufferAlerts` supplied).
4. **Scope boundaries decouple structurally.** Child scopes emit shortfall
   quantities. Parents treat them as ordinary demand slots and re-explode.

### What DDMRP-VF would do instead

1. **Demand explosion stops at a decoupling point.** When BFS reaches a
   `replenishment-required` spec, it would short-circuit instead of consuming
   inventory, and instead generate a replenishment signal for that spec's
   buffer. Downstream demand never directly causes upstream replenishment.
2. **Replenishment is triggered by NFP, not consumption.**
   `NFP = on-hand + on-order − qualified_demand`. An order fires when
   `NFP ≤ TOY`, sized as `TOG − NFP`. This fires even in periods with zero
   consumption if on-order quantities don't cover projected demand.
3. **On-order is part of the netting equation.** Open purchase intents/
   commitments for a spec reduce the replenishment quantity. Currently
   `PlanNetter` does not include external open POs.
4. **Demand spike qualification.** Large one-off spikes are separated from
   average demand before computing NFP, preventing over-ordering.
5. **Buffers are self-managing.** Each decoupled spec monitors its own NFP
   independently of whatever demand flows triggered the draw-down.
6. **Scope boundaries decouple by signal.** Instead of re-exploding a child
   shortfall at the parent, each scope's buffer emits its own NFP-derived
   replenishment signal. The parent never sees raw demand; it only sees buffer
   replenishment requests.

### The seam: `bufferAlerts`

`ctx.bufferAlerts` is the integration point between the two models. When
present, Pass 2 sizing and gating use DDMRP zone semantics. When absent,
pure MRP behaviour applies. The seam is intentionally narrow:

- `bufferAlerts` changes **how much** to replenish and **whether** to replenish
- It does not change **when** replenishment is triggered (still consumption-based)
- It does not change **whether** the BFS explosion crosses the spec boundary (it still does)

A true DDMRP-VF implementation would require the BFS itself to be
decoupling-point-aware, and would require NFP + on-order data to be available
at plan time. Those are architectural changes, not additions to the
`bufferAlerts` interface.

### Summary table

| Dimension | MRP-VF (this system) | DDMRP-VF (not this system) |
|---|---|---|
| BFS crosses replenishment boundary | Yes — consumes inventory | No — short-circuits, emits buffer signal |
| Replenishment trigger | Consumption in Pass 1 | NFP ≤ TOY |
| Replenishment sizing (no overlay) | Qty consumed | TOG − NFP |
| Replenishment sizing (with `bufferAlerts`) | TOG − onhand | TOG − NFP |
| On-order in netting | Scheduled receipts only | All open supply commitments |
| Demand spike handling | None | Qualified spike filter |
| Scope decoupling mechanism | Structural (scope boundary, re-explode at parent) | Signal (NFP-derived buffer request, no re-explode) |
| Buffer zone computation | External input (`bufferAlerts`) | Internally derived from ADU × DLT × LTF × VF |

---

## 6. Known Gaps Within MRP-VF

These are gaps in the MRP-VF implementation itself, not steps toward DDMRP-VF.

- **Open-PO netting** — externally-sourced purchase orders should reduce
  `netAvailableQty` in Pass 2 to avoid double-ordering
- **DLT in lead time scheduling** — `criticalPath()` gives total CLT; per-leg
  lead time is needed for accurate due-date back-scheduling
- **OTIF tracker** — actual vs. planned delivery performance per spec/scope;
  feeds buffer profile tuning when `bufferAlerts` is in use
- **S&OP aggregation** — roll-up of scope plans to federation-level capacity
  review; a reporting layer over existing `ScopePlanResult` data

Items that would only matter for DDMRP-VF (NFP calculator, qualified demand
spike filter, ADU, buffer zone formula, self-managing buffers) are out of
scope and should not be added to this planner without a deliberate decision
to change the architectural identity in §0.
