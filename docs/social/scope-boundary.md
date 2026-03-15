# Scope Boundary Protocol

_A scope is the custodian and manager of a bounded set of economic resources. It is not a fixed administrative unit — it is the current best partition of the flow graph, carrying its own PlanStore, Planner, and Observer. These three tools compose as scopes federate: a federation is itself a scope at the next level, running the same tools over aggregated member data. The planning process continuously generates the data required to evaluate whether the current partition is correct, and to propose adjustments when it is not._

---

## I. A Scope as a Typed Unit

```
scope[k] = {
  resources:  Sₖ  ⊆  V           — the agents and resources under this scope's management
  PlanStore:  event graph over Sₖ — records intentions, commitments, and EconomicEvents
  Planner:    f(PlanStore[k], signal_from_federation) → Plan[k]
  Observer:   g(PlanStore[k]) → metrics[k]  (flow fractions, claim capacities, coherence, ...)
}
```

_A scope is the custodian of its resources in the sense of custody-protocol.md: it is the responsible entity for what happens within its boundary. `entrustment_capacity[scope[k]] = Σ entrustment_limit[i]` for all members i ∈ Sₖ — the scope's collective collateral is the sum of its members'._

---

## II. Composition — Federation as Scope

A federation F over member scopes {k₁, k₂, ..., kₙ} is itself a scope at the next level:

```
scope[F] = {
  resources:  ∪ Sₖᵢ
  PlanStore:  merge({ PlanStore[kᵢ] })  +  inter-scope EconomicEvents
  Planner:    coordinate({ Planner[kᵢ] })  — merge plans, detect conflicts, propose adjustments
  Observer:   aggregate({ Observer[kᵢ] })  +  cross-scope boundary metrics
}
```

The composition operator is recursive:

```
scope[F₂] = compose( scope[F₁],  scope[k],  ... )   — industrial federation over scopes
scope[F₃] = compose( scope[F₂],  scope[F₂'], ... )  — regional federation over industrial federations
```

_PlanStore, Planner, and Observer are closed under composition. There is no new protocol at any higher level — only the same three tools applied to a larger graph. The federation's Observer reads the same EconomicEvent stream as its member Observers; it simply has access to cross-scope flows that individual scope Observers do not see._

_This was a design choice. PlanStores are content-addressable and mergeable; Planners run on whatever graph they are given; Observer functions are pure and composable. The recursive federation structure is not an architectural coincidence — it is the intended consequence of designing the three tools to compose._

---

## III. The Flow Graph

The federation operates on a weighted directed graph:

```
G = (V, E, w)

  V    =  all agents and resources in the federation
  E    =  all material flows (EconomicEvents) between them
  w(e) =  resourceQuantity × market_price_index   [value-weighted]

A partition  S = {S₁, S₂, ..., Sₙ}  assigns every node in V to exactly one scope.
```

_All boundary metrics are derived from G and S. The Observer computes them from the existing EconomicEvent stream — no additional data collection required._

---

## IV. Flow Weights per Scope

```
internal_flow[k]  =  Σ w(e)  :  source(e) ∈ Sₖ  AND  target(e) ∈ Sₖ
external_flow[k]  =  Σ w(e)  :  source(e) ∈ Sₖ  XOR  target(e) ∈ Sₖ
total_flow[k]     =  internal_flow[k] + external_flow[k]
```

---

## V. Internal Coherence

```
coherence[k]  =  internal_flow[k] / total_flow[k]    ∈ [0, 1]
```

_The fraction of flows touching scope k that remain within it. Coherence = 1.0 means the scope is metabolically self-contained. Coherence → 0 means the boundary is drawn across dense flows — the scope is not a natural unit._

_This is the primary signal. A scope with low coherence is either too small (it keeps depending on neighbours for inputs/outputs) or its boundary is misaligned with the actual metabolic topology._

---

## VI. Bilateral Interdependence

```
bilateral_flow[k, l]    =  Σ w(e)  :  { source(e), target(e) } = { Sₖ, Sₗ }

interdependence[k, l] =  bilateral_flow[k, l]  /  (external_flow[k] + external_flow[l])
```

_The share of k and l's combined external flow that flows specifically between them. High interdependence means k and l's external economies are mostly each other — they are already planning together informally._

---

## VII. Boundary Optimality

The optimal partition maximises flow-weighted average coherence subject to democratic viability:

```
maximise:   Σₖ coherence[k] × total_flow[k]  /  Σₖ total_flow[k]
subject to: assembly_size[k]  ∈  [min_assembly, max_assembly]   for all k
```

_This is the objective the federation moves toward through successive boundary proposals. It is never directly solved — it is approached iteratively as each cycle's data reveals deviations from optimality._

---

## VIII. Update Signals

Each planning cycle the Observer computes two boundary signals:

**Merge signal** — scope k and scope l are candidates to merge when:

```
interdependence[k, l]  >  θ_merge
AND  assembly_size[k] + assembly_size[l]  ≤  max_assembly
```

**Split signal** — scope k is a candidate to split when:

```
coherence[k]  <  θ_split
AND  assembly_size[k]  >  2 × min_assembly
AND  a bipartition  (k₁, k₂)  of Sₖ  exists  such that  interdependence[k₁, k₂]  <  θ_split
```

_The split condition requires not just low coherence but an identifiable natural seam — two subsets with weak mutual flows. The Observer identifies candidate bipartitions by clustering the internal flow sub-graph of Sₖ._

_θ_merge and θ_split are democratic thresholds, not technical constants. The federation assembly sets them each cycle based on current priorities: a federation under coordination pressure lowers θ_merge; one prioritising local autonomy raises θ_split._

---

## IX. Democratic Constraint

Boundary changes require:

```
approve_merge(k, l):   assembly[k] approves  AND  assembly[l] approves  AND  federation approves
approve_split(k):      assembly[k] approves  AND  federation approves
```

_Approval is not a formality — it is the mechanism by which social logic (community bonds, shared history, political preferences) modifies what metabolic logic alone would suggest. The equations identify candidates; assemblies decide._

---

## X. Convergence

The partition S is **stable** when no merge or split proposal clears both the signal threshold and democratic approval in the same cycle. Stability means the current boundaries are close enough to optimal that no constituency sees sufficient gain to reorganise.

_Stability is not permanence. A new infrastructure investment, a new supply relationship, or an ecological shock can disrupt the flow graph and restart the process. The Observer detects this as a sudden drop in coherence[k] for affected scopes._

---

## XI. Integration with Existing Scope Metrics

The boundary metrics use the same EconomicEvent stream as all existing scope calculations:

```
social_input_fraction  and  social_output_fraction   →   contribute to external_flow[k]
scope_net_external_contribution                      →   component of external_flow[k]
confirmed_output_fraction                            →   weights internal_flow[k] (only confirmed flows count)
custody_incident_rate                                →   degrades effective w(e) for affected edges
```

_A custody incident on a flow reduces that flow's effective weight in the coherence calculation — a disrupted flow is less metabolically reliable. Persistent incidents on inter-scope flows are a weak merge signal: two scopes whose shared flows keep failing may need tighter coordination._

_The boundary metrics require only that the event stream records source and target scope membership — already implicit in provider/receiver agent IDs._

---

## XII. Boundaries as Containers, Not Walls

_Boundaries are not walls — they are containers for democratic planning. Their purpose is not to isolate but to localize what can be localized, so that what must be coordinated can be coordinated cleanly._

_The federation is not a backup planner. It is the institutional form of chosen interdependence: scopes coordinate because they choose to, over flows that genuinely require it. When boundaries track metabolic reality, the federation's workload shrinks to what is irreducibly global — and what remains is no longer conflict-ridden but chosen._

_This is why boundary evolution is continuous and democratic rather than fixed by constitution. As the metabolism of the associated producers shifts — through new infrastructure, new supply relationships, ecological change — the right partition shifts with it. The system never stops learning what it is._
