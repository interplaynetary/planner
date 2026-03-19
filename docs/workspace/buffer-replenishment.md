# Buffer Replenishment: End-to-End Walkthrough

This document traces exactly how the federation's buffer replenishment works — from
deriving zone boundaries through the per-scope planning passes to lateral trade
resolution between peers.

---

## 1. What Is a Buffer?

A **BufferZone** is the three-zone inventory model for one `specId` (optionally scoped
to an `atLocation`). The three cumulative boundaries are:

| Boundary                | Meaning                                                 |
| ----------------------- | ------------------------------------------------------- |
| **TOR** (Top of Red)    | Below this → critical shortage; immediate replenishment |
| **TOY** (Top of Yellow) | Below this → replenishment order needed                 |
| **TOG** (Top of Green)  | At or above this → healthy; no action                   |

The policy knobs live in a **`BufferProfile`**:

| Field                    | Description                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `leadTimeFactor` (LTF)   | Red-zone multiplier for lead-time demand coverage                                                 |
| `variabilityFactor` (VF) | Safety factor layered on top of red base                                                          |
| `orderCycleDays` (DOC)   | Desired/Imposed Order Cycle — minimum replenishment frequency                                     |
| `ostMultiplier`          | Order Spike Threshold multiplier; demand spikes above `ADU × ostMultiplier` are excluded from NFP |

---

## 2. Deriving the Zones — `computeBufferZone()`

> `src/lib/algorithms/ddmrp.ts:694–746`

Zone boundaries are derived from ADU (average daily usage) and DLT (decoupled lead time)
using the Ptak & Smith Ch 8 formulas:

```
effectiveADU = ADU × demandAdjFactor
effectiveDLT = dltDays × leadTimeAdjFactor

redBase    = effectiveADU × effectiveDLT × LTF
redSafety  = redBase × VF
TOR        = (redBase + redSafety) × redZoneAdjFactor

TOY        = TOR + effectiveADU × effectiveDLT × yellowZoneAdjFactor

greenBase  = max(effectiveADU × DOC, redBase, MOQ) × greenZoneAdjFactor
TOG        = TOY + greenBase
```

Key implementation notes:

- **`effectiveADU`** is computed by `computeADU()` over an 84-day rolling window of
  `EconomicEvent`s, optionally blended with `computeForwardADU()` (demand from
  recurring Intents). For new items with no history, `estimatedADU` is blended until
  accumulated event days ≥ the window size.

- **`greenBase`** uses a three-way max: `orderCycle × ADU`, `redBase` (minimum DLT
  coverage), and `MOQ` (minimum batch size). The `redBase` floor ensures that even
  when no `orderCycleDays` is set and MOQ is tiny, the green zone always covers at
  least one DLT of ADU × LTF.

- **Zone Adjustment Factors (ZAF)** are time-bounded `DemandAdjustmentFactor` records
  that are aggregated multiplicatively per type and applied independently per zone
  (`redZoneAdjFactor`, `yellowZoneAdjFactor`, `greenZoneAdjFactor`). This allows
  temporary volatility signals or promotional changes to widen specific zones
  without distorting others.

- **Min-max variant** (`computeMinMaxBuffer()`): TOY is set equal to TOR ("Not
  Applicable"), collapsing the yellow zone for items with stable demand.

---

## 3. Net Flow Position — `computeNFP()`

> `src/lib/algorithms/ddmrp.ts:625–666`

```
NFP = onhand + onorder − qualifiedDemand
```

### Components

| Component           | Source                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| **onhand**          | `Observer.conformingResources(specId)` — physical custody only            |
| **onorder**         | Supply-side `Commitment`s (`outputOf` set, not finished, non-service action) |
| **qualifiedDemand** | OST-filtered Commitments + Intents within OST horizon                     |

### OST filtering (`qualifyDemand()`, line 562)

The Order Spike Threshold removes anomalous demand from NFP:

- Only demands with `inputOf` set (i.e., consuming flows), non-finished, consuming
  action (`NON_CONSUMING_ACTIONS` excluded: `use`, `work`, `cite`, `deliverService`)
- Due date must be within `ostHorizonDays` (defaults to `⌈DLT × 0.5⌉` days)
- Quantity must be ≤ `ADU × ostMultiplier`; spikes above the threshold are excluded

### Zone classification

```
NFP ≤ TOR            → red    (critical; immediate action)
NFP ≤ TOY            → yellow (order needed)
NFP ≤ TOG            → green  (healthy)
NFP > TOG            → excess
```

The `priority` field is `nfp / tog` — lower values indicate higher urgency and are
used to sort competing replenishment demands.

---

## 4. Replenishment Signal — `generateReplenishmentSignal()`

> `src/lib/algorithms/ddmrp.ts:1208–1242`

Triggered whenever zone ∈ {red, yellow}:

```
raw            = TOG − NFP
recommendedQty = raw ≤ 0  ? MOQ
               : ⌈raw / MOQ⌉ × MOQ

dueDate        = today + (dltDays + supplyOffsetDays) days
```

When `raw ≤ 0` the buffer is technically not short, but a minimum order (`MOQ`) is
still recommended to avoid a future shortage before the next planning cycle.

The returned `ReplenishmentSignal` is stored in **`BufferZoneStore`** with
`status: 'open'` pending human approval. Once approved, the signal is promoted to a
`Commitment` via `promoteToCommitment()` (the ATP mechanism), which decrements
`availableQty` and validates against `minimumQty`.

---

## 5. Buffer Recalibration — `orchestrateBufferRecalibration()`

> `src/lib/algorithms/ddmrp.ts:2484–2500`

Run as a pre-step before each planning cycle:

```typescript
for (const zone of bufferZoneStore.allBufferZones()) {
  const { adu } = computeADU(events, zone.specId, windowDays, asOf);
  const updated = recalibrateBufferZone(
    zone,
    adu,
    zone.dltDays,
    profile,
    adjustments,
    asOf,
  );
  bufferZoneStore.replaceZone(updated);
}
```

Recalibration:

1. Aggregates all active `DemandAdjustmentFactor` records for the spec/location
2. Recomputes TOR/TOY/TOG via `computeBufferZone()`
3. Stamps `lastComputedAt` and `activeAdjustmentIds`

**Exception**: zones with `bufferClassification === 'replenished_override'` are
skipped — their boundaries are contractual or space-constrained. ADU and DLT are
updated for drift monitoring only (Ch 7: contract renegotiation signals).

> **Gap 6 (pending)**: recalibration currently uses the stored `dltDays`. Full
> DDMRP would derive per-buffer DLT via `criticalPath()` to compute Decoupled Lead
> Time segments. This segmentation is not yet implemented.

---

## 6. Federation Planning Flow

### 6.1 Topological Sort

> `src/lib/planning/plan-federation.ts:221–288`

`planFederation()` builds a `childrenOf` map from the `parentOf` relationship
(restricted to scopes included in the planning run), then performs a **post-order
DFS** (`topoSort`) so that **leaf scopes always plan before their parents**. This
ensures child signals are available when a parent scope runs.

### 6.2 Per-Scope Pass (leaf → root)

> `src/lib/planning/plan-for-scope.ts:370–1142`

For each scope in topological order, `planFederation` gathers the already-computed
`ScopePlanSignals` from each child and passes them into `planForScope()`.

#### Child signal injection (before Pass 1)

> `src/lib/planning/plan-for-scope.ts:394–458`

Before planning begins the child signals are wired in:

1. **Child deficits → demand slots** (metabolic_debt first, then unmet_demand):
   Each child deficit is translated into a raw demand slot with `required_quantity =
deficit.shortfall`. The ordering ensures that metabolic debts (supply-chain
   constraints) sort earlier within the same classification bucket, per spec §565.
   A `childProvenanceByIntentId` map carries `originalShortfall` and `resolvedAt[]`
   so provenance chains are preserved as deficits bubble up.

2. **Child surpluses → synthetic supply slots** (Gap 2):
   Child surplus signals are pushed into `extractedSupply` as `slot_type: 'inventory'`
   entries. Without this, a parent would fire purchase intents for specs already
   overproduced downstream.

#### Step A — Buffer zone scan (before Pass 1)

> `src/lib/planning/plan-for-scope.ts:644–697`

Before Pass 1 runs, all buffer zones are scanned to produce `effectiveAlerts`:

- Iterates `bufferZoneStore.allBufferZones()`
- If `bufferProfiles` available → `computeNFP()` per zone (Gap 1); else →
  `bufferStatus(onhand, zone)` fallback
- For red/yellow non-ecological zones: `generateReplenishmentSignal()` is called and
  stored in `BufferZoneStore` with `status: 'open'` (Gap 4)
- Result stored in `effectiveAlerts: Map<specId, { onhand, tor, toy, tog, zone }>`

The replenishment computation step (lines 700–772) only **reads** this pre-computed
map — it does not call `computeNFP()` or `generateReplenishmentSignal()` again.

#### Step B — Federation boundary seeding (before Pass 1)

> `src/lib/planning/plan-for-scope.ts:480–499`

Synthetic produce intents are injected from `supplyIndex.supply_slots` entries with
`slot_type: 'scheduled_receipt'` before Pass 1 runs. These act as "already resolved"
markers so `dependentDemand()` stops recursing at scope boundaries instead of
exploding cross-scope recipes. They are removed before Phase B via
`planStore.removeRecords()` + `netter.pruneStale()`.

#### Pass 1 — Primary independent demands

> `src/lib/planning/plan-for-scope.ts:~540–700`

Each demand slot is processed in slot-class order then by due date:

- `locally-satisfiable` → `transport-candidate` → `producible-with-imports` → `external-dependency`

**`transport-candidate` slots** skip `dependentDemand()` entirely and instead create
a `transfer` intent directly (`plan-for-scope.ts:540–566`), reflecting that the good
moves between locations rather than being produced.

All other slots call `dependentDemand()`, which fires recipes against the netter.

Deficit signals are **collected after the entire Pass 1 loop completes**
(`plan-for-scope.ts:599–624`) by scanning `pass1Records` for unresolved purchase
intents against each slot's `specId` — they are not emitted inline during the loop.

#### Replenishment derivation (after Pass 1)

> `src/lib/planning/plan-for-scope.ts:700–772`

After Pass 1, the planner builds `derivedDemands` from the pre-computed `effectiveAlerts`:

- Tallies `consumedBySpec` + `boundaryBySpec` from `pass1Records`
- Queries `effectiveAlerts` to gate on zone and size:
  `replenQty = max(0, TOG − onhand)`
- Also adds proactive fill (P7): red/yellow specs not consumed in Pass 1
- Ecological buffers emit `ConservationSignal` instead of a replenishment demand
- `derivedDemands` sorted red-first (Gap 3) before Pass 2

#### Pass 2 — Replenishment explosion

> `src/lib/planning/plan-for-scope.ts:774–802`

Pass 2 runs on a forked netter with `observer: undefined` — no on-hand inventory
is available to satisfy replenishment; only production recipes and purchase intents.

For each `{ specId, qty }` in the sorted `derivedDemands`:

- A new Plan is created (`replenish-<id>`)
- `dependentDemand()` is called with `observer: undefined` → forces purchase intents
  for any unresolvable requirements
- Purchase intents for the `specId` itself are collected; quantities that require
  external procurement are recorded as `replenDebts`

#### Backtracking (proportional sacrifice)

> `src/lib/planning/plan-for-scope.ts:804–918`

If `replenDebts` remain after Pass 2, the planner attempts to free capacity by
sacrificing low-criticality Pass 1 demands:

```
sacrificeScore(scopeId) = accumulatedSacrificeQty[scopeId] / memberCount[scopeId]
```

Each iteration:

1. Pick the Pass 1 candidate with the **lowest sacrifice score** (ties broken by
   highest D-class → latest due date)
2. `netter.retract(candidate.result)` — free its allocated resources
3. Retry all `replenDebts` against the now-freed netter
4. Attempt to re-explode the sacrificed demand; if it succeeds with freed capacity,
   keep it (no permanent sacrifice)
5. If re-explode fails → demand is permanently sacrificed; `unmetDemand` gains the
   slot and a `ScopeDeficitSignal { source: 'unmet_demand' }` is emitted; the scope's
   sacrifice counter is incremented
6. Each permanent sacrifice counts against `sacrificeDepth` (from context); when the
   limit is hit, backtracking stops — remaining `replenDebts` are emitted as
   `ScopeDeficitSignal { source: 'metabolic_debt' }`

#### Phase B — Forward-schedule unabsorbed supply

> `src/lib/planning/plan-for-scope.ts:941–~1080`

After Passes 1 and 2, unabsorbed supply slots (own production + injected child
surpluses) are forward-scheduled via `dependentSupply()`. Any quantity still
unabsorbed becomes a `SurplusSignal` for upward propagation and lateral matching.

### 6.3 Signal Propagation (upward composition)

> `src/lib/planning/plan-federation.ts:267–288`

`buildScopePlanSignals(result)` extracts `{ deficits, surplus, conservationSignals }`
from a scope's result. When the parent scope plans:

- Child deficits → injected as demand slots (see §6.2, child signal injection above)
- `originalShortfall` + `resolvedAt[]` form a provenance chain: if the same demand
  is re-emitted as a deficit at the parent level, it carries the full history of
  where resolution was attempted

### 6.4 Lateral Matching (after hierarchy pass)

> `src/lib/planning/plan-federation.ts:319–396`

After the bottom-up hierarchy pass completes, deficits that couldn't be resolved
within any sub-tree are matched against surplus in **non-hierarchical** (peer) scopes:

1. **Build surplus pool**: `surplusPool: specId → [{ scopeId, qty }]` from all scope
   surplus signals

2. **Collect unresolved deficits**: deduplicated by `intentId` across all scopes

3. **Match loop** — for each deficit:
   - Candidates: entries in `surplusPool[specId]`
   - Skip same-scope; skip ancestor/descendant pairs (hierarchy already handles those)
   - Allocate `qty = min(deficit.shortfall, entry.qty)` and emit:
     ```
     TradeProposal {
         fromScopeId, toScopeId, specId, quantity, status: 'proposed'
     }
     ```
   - Emit `lateral-match` federation event
   - Remaining unresolved quantity emits `deficit-propagated`

4. **Sacrifice rebalancing** — if `memberCounts` is provided, compute per-scope
   deficit relative to the proportional target and emit `sacrifice-rebalanced` events
   where the imbalance exceeds 10% of the per-member target.

---

## 7. How One Scope's Buffer Is Filled by Another

There are three distinct paths:

| Path              | Mechanism                                                                    | Where it appears                                                           |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Hierarchy**     | Child surplus injected as synthetic supply slot → absorbed in parent Phase B | Hierarchy edges in federation graph                                        |
| **Lateral trade** | `TradeProposal` from surplus pool matching (peer scopes)                     | Trade arc — solid and zone-colored when `specId ∈ buffersByScope[toScope]` |
| **Self-supply**   | Scope's own Phase B produce intent absorbed by Pass 1/2 consuming demand     | No arc; "self-supplied" in scope panel                                     |

### Buffer-filling via lateral trade

When a `TradeProposal.specId` matches a `BufferEntry` in the receiving scope,
`FederationGraphView` renders the arc **solid and zone-colored** (red / yellow /
green depending on the buffer's NFP zone at plan time) instead of the usual dashed
rainbow style. The color communicates urgency: a red arc means the trade is
resolving a critical buffer shortage.

---

## 8. Key Source Locations

| Concept                                    | File                                  | Lines     |
| ------------------------------------------ | ------------------------------------- | --------- |
| `computeBufferZone()`                      | `src/lib/algorithms/ddmrp.ts`         | 694–746   |
| `computeMinMaxBuffer()`                    | `src/lib/algorithms/ddmrp.ts`         | 760–780   |
| `qualifyDemand()`                          | `src/lib/algorithms/ddmrp.ts`         | 562–605   |
| `computeNFP()`                             | `src/lib/algorithms/ddmrp.ts`         | 625–666   |
| `generateReplenishmentSignal()`            | `src/lib/algorithms/ddmrp.ts`         | 1208–1242 |
| `recalibrateBufferZone()`                  | `src/lib/algorithms/ddmrp.ts`         | 802–860   |
| `orchestrateBufferRecalibration()`         | `src/lib/algorithms/ddmrp.ts`         | 2484–2500 |
| Child signal injection                     | `src/lib/planning/plan-for-scope.ts`  | 394–458   |
| `effectiveAlerts` initialization (Gap 1/4) | `src/lib/planning/plan-for-scope.ts`  | 644–697   |
| Federation boundary seeding                | `src/lib/planning/plan-for-scope.ts`  | 480–499   |
| Replenishment derivation (Gap 1/3/4)       | `src/lib/planning/plan-for-scope.ts`  | 700–772   |
| Pass 2 replenishment                       | `src/lib/planning/plan-for-scope.ts`  | 774–802   |
| Backtracking loop                          | `src/lib/planning/plan-for-scope.ts`  | 804–918   |
| Phase B (forward-schedule supply)          | `src/lib/planning/plan-for-scope.ts`  | 941–~1080 |
| `planFederation()` (topo sort + bottom-up) | `src/lib/planning/plan-federation.ts` | 221–288   |
| Lateral matching                           | `src/lib/planning/plan-federation.ts` | 319–396   |
| `BufferZoneStore`                          | `src/lib/knowledge/buffer-zones.ts`   | —         |

---

## 9. DDMRP Gap Status

| Gap       | Description                                                                              | Status         |
| --------- | ---------------------------------------------------------------------------------------- | -------------- |
| **Gap 1** | NFP wiring: `computeNFP()` used in `effectiveAlerts` loop when `bufferProfiles` provided | ✅ Implemented |
| **Gap 2** | Child surplus injected as synthetic supply slots in Phase 1 extraction                   | ✅ Implemented |
| **Gap 3** | `derivedDemands` sorted red-first before Pass 2                                          | ✅ Implemented |
| **Gap 4** | `ReplenishmentSignal` lifecycle: signals generated and stored in `BufferZoneStore`       | ✅ Implemented |
| **Gap 5** | Buffer recalibration via `orchestrateBufferRecalibration()`                              | ✅ Implemented |
| **Gap 6** | DLT segmentation: `criticalPath()` gives total CLT, not per-buffer DLT                   | ⏳ Pending     |
