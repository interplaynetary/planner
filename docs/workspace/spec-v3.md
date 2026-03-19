# Buffer-First Revisions to Free Association

> **Living design document.** Implementation status is annotated per section:
> `✓` = implemented, `◐` = partially implemented, `✗` = not yet implemented.
>
> Last updated: 2026-03-19

---

## 1. Planner Objectives and Constraints `✓`

**Buffer-First Objectives (design target):**

```
- Objective: Maintain all buffers within their target zones (green preferred, yellow acceptable, red unacceptable)
- Objective: Maximise independent demand satisfaction (ranked by criticality) subject to buffer constraints
- Constraint: Never let any buffer fall below its Red Base (TOR) except in declared emergencies
- Constraint: Generate replenishment signals immediately when any buffer enters Yellow zone
- Constraint: Satisfy replenishment demands with priority over new independent demands
- Constraint: Respect max_individual_effort_time per day (with granular limits by age, health, caring responsibilities)
- Objective: Minimise total Socially Necessary Effort (SNE)
- Unit of effort: <Time>
```

> _Buffers are the fundamental planning primitive. Every resource that matters—soil nutrients, aquifer levels, strategic inventory, tool libraries, community skills—is managed as a buffer with three zones: Red (minimum viable), Yellow (replenishment trigger), Green (target range). Independent demands are satisfied only to the extent that doing so does not deplete buffers below their replenishment triggers. The planner's primary job is buffer maintenance; demand satisfaction is secondary, derived from buffer health._

**Implementation note:** The buffer-first inversion is implemented and opt-in: when both `bufferZoneStore` and `bufferProfiles` are provided in context, Pass 0 pre-evaluates buffer health and reserves capacity for red/yellow buffers on the main netter before Pass 1. Buffer guards in Pass 1 defer demands that would push a stressed buffer below TOY; deferred demands are retried after Pass 2 replenishment. Derived demands use composite tier×zone priority (ecological-yellow outranks metabolic-red). Without both flags, the planner falls back to the demand-first path.

---

## 2. Local/Global Inversion `✓`

> Planners try to satisfy all demands within their scope, then maintain buffers via derived replenishment. When a buffer enters Yellow, the scope generates a ReplenishmentSignal—a derived demand with priority over new independent demands within Pass 2. When a buffer enters Red, MetabolicDebt triggers backtracking into Pass 1 allocations via ProportionalSacrifice. Planner composition converts deficit and surplus signals into constraints at the next level, routing them upward until resolved or declared genuinely infeasible. Infeasibility results in a controlled local contraction: independent demands are pruned back via proportional sacrifice, distributing the load by sacrifice-per-member score across scopes.

**Implementation note:** The signal routing (DeficitSignal upward, SurplusSignal for lateral matching, ConservationSignal for ecological buffers) is fully implemented. With buffer-first active (`bufferZoneStore` + `bufferProfiles`), buffer health is now the primary constraint: Pass 0 reserves capacity before demand allocation, and buffer guards prevent demands from depleting stressed buffers below TOY. Demand satisfaction is secondary, derived from remaining capacity after buffer reservations.

---

## 3. Buffer Zones and Derived Demands `✓`

Every resource designated as strategic has three zones:

```
- Red Base (TOR): Absolute minimum. Never cross except in declared emergency.
- Yellow Base (TOY): Replenishment trigger. When NFP ≤ TOY, generate signal.
- Green Base (TOG): Target maximum. Replenish up to TOG when signal fires.
```

Buffer Replenishment Demands are generated automatically when:

- **NFP ≤ TOY** (standard replenishment) — `computeNFP()` computes `onhand + onorder − qualifiedDemand` where qualified demand is OST-filtered consuming demand within the `ostHorizonDays` horizon. This is forward-looking, not just on-hand.
- Any consumption event occurs while buffer is already in Yellow (accelerated replenishment)

**Ecological Buffers** (`tag:buffer:ecological`): Ecological systems (soil nutrients, aquifers, forests) are buffers with:

- Natural replenishment rates (included in lead time calculation)
- Tipping points (`bufferZone.tippingPoint`) below which recovery is impossible — when on-hand falls below this floor, a `ConservationSignal` is emitted instead of a ReplenishmentSignal, and the `PlanNetter` uses the tipping point as a conservation floor
- Intergenerational obligations encoded as minimum buffer targets

**Strategic Buffers** (`tag:buffer:strategic`): Decoupling points in supply chains, managed via DDMRP logic. Sized via Ptak & Smith Ch 8 formula: `redBase = ADU × DLT × leadTimeFactor`, `tor = (redBase + redSafety) × redZoneAdjFactor`, etc.

**Reserve Buffers** (`tag:buffer:reserve`): Untouchable except in emergencies, with separate TOR.

---

## 4. Planning Passes `✓`

### Current Implementation (2-pass + backtracking)

Planning proceeds within Phase 3 (Formulate) of `planForUnit`:

**Pass 1 — Independent Demands:** Satisfy all pre-existing demands sorted by `CLASS_ORDER` (locally-satisfiable → transport-candidate → producible-with-imports → external-dependency) then due date. Each demand is exploded via `dependentDemand()` with netting against available inventory. Deficit signals are emitted for unresolved purchase intents.

**Derived — Effective Alerts + Replenishment Demands:**
After Pass 1 consumption is known:
- Compute `effectiveAlerts` from `BufferZoneStore`: for each buffer zone, call `computeNFP()` (if `bufferProfiles` provided) or fall back to `bufferStatus()` from raw on-hand
- For red/yellow non-ecological buffers with no open signal: generate `ReplenishmentSignal` (quantity = `TOG − NFP`, rounded up to MOQ)
- For ecological buffers in red/yellow: emit `ConservationSignal` instead
- Collect derived replenishment demands from consumed specs tagged `tag:plan:replenishment-required` and from alerts
- **Sort derived demands red-first** (`ZONE_PRIORITY`: red < yellow < green < excess)

**Pass 2 — Derived Replenishment:** Explode derived demands via `dependentDemand()` on a **forked netter** with no safety-stock observer. Unmet replenishment becomes MetabolicDebt.

**Backtracking — ProportionalSacrifice:**
While `replenDebts` remain and `sacrificeSteps < maxSacrificeSteps` (configurable via `ctx.sacrificeDepth`):
1. Select retraction candidates scored by `sacrificeScore = scopeSacrificeQty / memberCount` (proportional fairness)
2. Trial-retract top 3 candidates on forked netters, score each trial by `coverage − effort × 0.1`
3. Permanently retract the best candidate, re-explode on real netter
4. If re-explosion fails: record sacrifice, emit unmet deficit signal
5. If depth limit hit: remaining debts reported as residual MetabolicDebt

Failure in Pass 2 / backtracking = metabolic debt, qualitatively worse than unmet independent demand.

### Buffer-First Inversion `✓`

**Pass 0 — Buffer Health First:** Before any independent demands, evaluate all buffers within scope via `computeEffectiveAlerts`. Generate ReplenishmentSignals for any buffer already in Yellow or Red. Allocate capacity to these signals *before* independent demands on the main netter. Sort by composite tier×zone priority via `compositeBufferPriority(tier, zone)`.

**Pass 1 — Buffer Guards:** For each independent demand, `shouldDeferForBufferGuard` checks projected buffer impact before allocation. If consuming the demand would push available quantity below TOY for a stressed buffer, the demand is deferred to Pass 1b (after replenishment).

**Pass 1b — Deferred Demand Retry:** After Pass 2 replenishment, deferred demands are retried with the replenished netter state.

This inversion makes buffer health the *primary* constraint rather than a *secondary* reconciliation step. Opt-in via `bufferZoneStore` + `bufferProfiles` in context.

---

## 5. Technical Planner — planForScope / planForRegion `✓`

Both `planForScope` and `planForRegion` delegate to `planForUnit`, which implements the following phases:

```
Phase 0 — Normalize:
  planForScope: normalizeScopes(scopeIds, parentOf)
    — deduplicate, remove child if parent present
  planForRegion: normalizeCells(cells)
    — deduplicate H3 cells, filter dominated parents

Phase 1 — Extract:
  planForScope: queryDemandByScope() + querySupplyByScope()
  planForRegion: extractSlots() via H3 location keys
  Both: filter by horizon, check remaining_quantity > 0
  Child DEFICIT/SURPLUS signals injected as synthetic slots

Phase 2 — Classify: for each demand slot →
  'locally-satisfiable' | 'transport-candidate' |
  'producible-with-imports' | 'external-dependency'
  Sort by CLASS_ORDER (0–3) then due date

Phase 3 — Formulate:
  Pass 1 (primary): dependentDemand() with netting per sorted slot
    Transport candidates handled via FederationScopePolicy
  Derived: effectiveAlerts from BufferZoneStore + computeNFP()
    ReplenishmentSignals for non-ecological red/yellow buffers
    ConservationSignals for ecological red/yellow buffers
    Derived replenishment demands sorted red-first
  Pass 2 (derived): dependentDemand() on forked netter (no inventory)
    Unmet = MetabolicDebt
  Backtrack: ProportionalSacrifice retraction loop
    Scored trial-retraction of Pass 1 allocations
    sacrificeDepth limit; unmet → deficit signals

Phase B — Supply:
  dependentSupply() forward-scheduling of unabsorbed supply
  SurplusSignals emitted for remaining supply

Phase 4 — Collect:
  Merge conflict detection (if subStores from child scopes)
  Aggregate purchaseIntents, unmetDemand, conservationSignals
  Emit VF signal Intents (deficit/surplus tagged)
```

### Future additions `✓`

- ~~Pass 0 (buffer-health-first pre-evaluation) before Phase 3~~ `✓`
- ~~`projectedBufferAfter` guard logic on Pass 1 demand allocation~~ `✓`
- ~~Priority routing of Phase B supply to Yellow/Red buffers~~ `✓`

---

## 6. Incremental Re-Planning `✓`

The federation planner supports incremental replanning to avoid recomputing unchanged scopes.

**FederationPlanCache** — returned by each `planFederation()` call:
```typescript
interface FederationPlanCache {
  byScope: ReadonlyMap<string, ScopePlanResult>;
}
```

**Dirty scope computation** — `computeEffectiveDirty(scopeIds, parentOf, cache?, dirtyScopes?)`:
- Scopes not in cache are automatically dirty
- Explicitly dirty scopes (inputs changed) added from caller-provided `dirtyScopes: Set<string>`
- Dirty set expanded **upward** through ancestors via `parentOf` — if a child is dirty, its parent must replan
- If no cache or no dirtyScopes provided, all scopes are dirty (full replan)

**Bottom-up pass** (Round 0):
- Scopes processed in topological order (leaves first)
- Clean scopes: reuse cached `ScopePlanResult` by reference, emit `scope-cached` event
- Dirty scopes: call `planForScope()` with children's planStores, emit `scope-planned` event

**Lateral matching** (Round 1) always re-runs regardless of cache state, since it depends on all scopes collectively. Offers (surplus) and requests (deficits) are scored and greedily assigned.

**Event log** distinguishes scope lifecycle:
```typescript
type FederationEventKind =
  | 'scope-planned'    // freshly computed
  | 'scope-cached'     // reused from cache
  | 'deficit-announced' | 'surplus-offered'
  | 'lateral-match' | 'deficit-propagated'
  | 'residual-unresolved' | 'sacrifice-rebalanced';
```

The returned `FederationPlanResult.cache` is passed to the next `planFederation()` call along with the new `dirtyScopes` set.

---

## 7. Buffer Types and Hierarchies `◐`

Not all buffers are equal. The code defines six buffer types via `tag:buffer:*` on ResourceSpecification (`src/lib/utils/buffer-type.ts`):

```typescript
type BufferType = 'ecological' | 'strategic' | 'reserve' | 'social' | 'consumption' | 'metabolic';
```

Untagged resources default to `'metabolic'`. Each type has an associated response time: ecological = SEASONS, strategic = MONTHS, reserve = EMERGENCY, social = ONGOING, consumption = DAYS, metabolic = DAYS.

### Tier 1: Ecological Buffers (Non-Negotiable) `✓ special treatment`

- **Examples:** Soil nutrients, aquifer levels, biodiversity indices, forest cover, carbon sinks
- **Properties:**
  - Have tipping points below which recovery is impossible or takes generations
  - Natural replenishment rates are part of lead time calculation
  - Cannot be "expedited" — ecological processes have minimum duration
  - Intergenerational justice requires maintaining at least historical baseline
- **Implemented:** `tag:buffer:ecological` triggers ConservationSignal (not ReplenishmentSignal) when in red/yellow. PlanNetter uses `tippingPoint` as conservation floor. `tippingPointBreached` flag triggers federation-level escalation.

### Tier 2: Strategic Supply Buffers (DDMRP Core)

- **Examples:** Critical medicine stockpiles, seed banks, tool libraries, fuel reserves
- **Properties:**
  - Positioned at decoupling points in the supply network
  - Sized based on ADU × DLT × variability factors (Ptak & Smith Ch 8)
  - Protect against supply disruptions and demand spikes
  - Can be expedited with additional effort

### Tier 3: Metabolic Replenishment Buffers

- **Examples:** Compost piles, replacement parts, maintenance materials
- **Properties:**
  - Directly tied to production processes
  - Replenishment rate matches consumption rate
  - Failure means production stops but no ecological damage
- Default type for untagged resources

### Tier 4: Reserve Buffers (Emergency Only)

- **Examples:** Emergency food stores, disaster supplies, strategic reserves
- **Properties:**
  - Untouchable except in declared emergencies
  - Emergency declaration requires assembly vote

### Tier 5: Consumption Buffers

- **Examples:** Finished goods for direct use, daily consumables
- **Properties:**
  - Short response time (DAYS)
  - Standard replenishment cycle

### Tier 6: Social Buffers

- **Examples:** Community skill inventories, mutual aid capacity, childcare availability
- **Properties:**
  - Not physical resources but social capacities
  - Depleted by use, replenished by training/relationship-building
  - Measured via validated hours and social recognition

### Buffer Priority Hierarchy `✓`

**Implemented:** `compositeBufferPriority(tier, zone)` combines both dimensions into a single numeric score used to sort derived demands in the formulation phase. The function maps buffer type (ecological > strategic > metabolic > ...) and zone color (red > yellow > green > excess) into a composite priority where ecological-yellow outranks metabolic-red.

The two hierarchies are orthogonal:
- **Zone-color** = urgency within a single buffer (how depleted is it?)
- **Type-tier** = importance across buffer types (which buffer matters more?)

Combined priority ordering:

1. Ecological buffers below TOR (existential threat)
2. Strategic buffers below TOR (supply chain collapse risk)
3. Ecological buffers in Yellow (preventative maintenance)
4. Reserve buffers below TOR (emergency capacity depleted)
5. Strategic buffers in Yellow (standard replenishment)
6. Metabolic buffers below TOR (production at risk)
7. Social buffers below target (community resilience)
8. Independent demands (consumption)

---

## 8. Buffer Custody `✗`

> _This section is aspirational. No buffer custody model exists in code. The Observer tracks `onhandQuantity` (custody-based) vs `accountingQuantity` per resource, but there is no collective-custody or scope-assembly-responsibility layer._

**Buffer Custody is Collective:** While individual resources have individual custodians, **buffers as aggregates** have collective custody. The scope assembly is collectively responsible for maintaining the buffer within its target zones. This means:

- No single individual can deplete a buffer below TOY without assembly approval
- Buffer status is a public dashboard, visible to all scope members
- Buffer failure triggers collective review, not just individual penalties
- The assembly sets buffer policy; individuals execute custody of specific items within the buffer

This creates a **nested custody model**:

```
Buffer (scope collective responsibility)
  ├── Item A (individual custodian Maria)
  ├── Item B (individual custodian Javier)
  └── Item C (individual custodian collective k-of-n)
```

---

## 9. Planner Objectives/Constraints Summary `✓`

```
PRIMARY OBJECTIVE (Constrained):                                    ✓
- Maintain all buffers within target zones
  (Green preferred, Yellow tolerable, Red forbidden)
  Status: Pass 0 pre-evaluates buffer health and reserves capacity
          before independent demands. Buffer guards defer demands
          that would breach TOY on stressed buffers.

SECONDARY OBJECTIVE (Optimize subject to primary):                  ✓
- Maximize Independent Demand satisfaction (ranked by criticality)
  Status: Pass 1 sorts by CLASS_ORDER then due date.

TERTIARY OBJECTIVE (Minimize effort subject to above):              ✓
- Minimize total Socially Necessary Effort (SNE)
  Status: SNE index built per planning run; all dependentDemand calls
          use SNE-based recipe ranking when sneIndex is provided.

CONSTRAINTS (in priority order):
1. Never let any ecological buffer fall below TOR_ecological        ✓
   (ConservationSignal + tipping point floor + buffer guard deferral)
2. Never let any strategic buffer fall below TOR_strategic          ✓
   (Buffer guard proactively prevents breach; backtracking restores)
3. Satisfy all buffer replenishment signals (Red > Yellow)          ✓
   (red-first sorting of derived demands in Pass 2)
4. Respect max_individual_effort_time per day                       ◐
   (detectConflicts checks agent capacity ceiling when agentIndex provided;
    per-day granular limits not yet enforced)
5. Satisfy independent demands to extent possible after 1-4        ✓
```

---

## 10. BufferHealthReport `✓`

> _`BufferHealthReport` is implemented in `src/lib/algorithms/ddmrp.ts` via `buildBufferHealthReport()`. Aggregates per-buffer zone status and summary counts. Uses `computeNFP` when BufferProfile is available, falls back to raw `bufferStatus`._

```typescript
interface BufferHealthReport {
  scope: string;
  timestamp: Date;
  buffers: {
    [bufferId: string]: {
      type: "ecological" | "strategic" | "metabolic" | "reserve" | "social" | "consumption";
      currentLevel: number;
      tor: number;
      toy: number;
      tog: number;
      zone: "RED" | "YELLOW" | "GREEN" | "EXCESS";
      trend: "improving" | "stable" | "declining" | "critical";
      daysUntilTOR: number;
      replenishmentSignals: ReplenishmentSignal[];
      custody: {
        responsibleScope: string;
        individualCustodians: number;
        collectiveLiability: boolean;
      };
    };
  };
  aggregateHealth: {
    percentBuffersInGreen: number;
    percentBuffersInYellow: number;
    percentBuffersInRed: number;
    ecologicalHealthIndex: number;
    strategicHealthIndex: number;
  };
  metabolicDebt: {
    hasDebt: boolean;
    buffersInRed: string[];
    requiredAction: string;
  };
}
```

This would become the **primary dashboard** for scope assemblies. Before discussing new projects or consumption, they check buffer health. Red buffers mean **emergency session**. Yellow buffers mean **replenishment planning** before new initiatives.

---

## 11. The Goal

> The orientation toward local satisfaction is essential to dissolving the division between town and country, and with it the division between mental and physical labor. A scope that produces what it consumes and consumes what it produces is a community governing its own material life — not a node in a supply chain it does not control.

> But local satisfaction is not enough. A community that consumes its ecological inheritance—depleting soil, drawing down aquifers, cutting forests without regeneration—is governing only for the present, stealing from its children. The buffer-first orientation makes this visible and actionable. When soil nitrogen enters Yellow, the assembly sees it. When the aquifer drops toward Red, the federation intervenes. When a forest buffer is drawn down for timber, a replenishment signal appears automatically, requiring replanting before new timber can be planned.

> **Buffer health is intergenerational justice made computable.** The planner cannot optimize away the needs of future people because their claims are encoded in buffer targets set by previous generations. Each assembly, in setting buffer policies, negotiates with the unborn. The architecture ensures that negotiation is explicit, transparent, and binding.

---

## Summary of Buffer-First Reorientation

| Aspect            | Original Framing                           | Buffer-First Framing                          | Status |
| ----------------- | ------------------------------------------ | --------------------------------------------- | ------ |
| Primary objective | Satisfy independent demands                | Maintain buffer health                        | `✓`    |
| Demands           | Independent (primary), Derived (secondary) | All demands are derived from buffer status    | `◐`    |
| Replenishment     | One of several derived demand types        | The fundamental planning activity             | `✓`    |
| Failure mode      | Unmet demand                               | Metabolic debt (buffer below TOR)             | `✓`    |
| Priority          | Independent demand criticality             | Buffer zone (Red > Yellow > Green)            | `✓`    |
| Ecology           | External constraint                        | Just another buffer type (with special rules) | `✓`    |
| Intergenerational | Implicit in sustainability                 | Explicit in buffer targets                    | `✓`    |
| Planning passes   | Two (independent, derived)                 | Four passes implemented: Pass 0 (buffer-first), Pass 1 (guarded demands), Pass 2 (replenishment), backtracking (reconciliation) | `✓` |
| Incremental replan | Not described                             | FederationPlanCache + dirty scope expansion   | `✓`    |

The buffer-first perspective transforms the planner from a **demand satisfaction engine** into a **buffer maintenance system that satisfies demands when possible**. This is the difference between:

- **Extractive planning:** "What do people want? How do we get it?"
- **Regenerative planning:** "What buffers must we maintain? What demands can we satisfy given that constraint?"

The architecture implements the full buffer-first inversion: Pass 0 pre-evaluates buffer health before demand allocation, buffer guards on Pass 1 defer demands threatening critical buffers, composite tier×zone priority ordering across buffer types, SNE-based recipe ranking throughout the pipeline, agent capacity ceiling detection, Phase B surplus routing to stressed buffers, aggregated `BufferHealthReport`, and automatic DLT segmentation at buffer boundaries via `computeDecoupledLeadTime()`. Remaining: per-day granular labor limits (constraint 4), OTIF tracker, S&OP aggregation.
