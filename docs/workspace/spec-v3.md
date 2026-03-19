# Buffer-First Revisions to Free Association

Here are surgical edits to reframe the entire architecture from a **buffer-first perspective**. The key insight: **buffers are not a derived demand category—they are the fundamental planning primitive from which all demands derive.**

---

## 1. Revise "Planner Objectives and Constraints" Section

**Current:**

```
- Objective: Maximise independent demand satisfaction (ranked by criticality)
  - Constraint: Satisfy derived demands (ranked by criticality)
    - Constraint: Satisfy replenishment (metabolic) demands (ranked by criticality)
    - Constraint: Satisfy reserve/buffer demands (ranked by criticality)
    - Constraint: Satisfy control point demands (ranked by criticality)
```

**Buffer-First Revision:**

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

**Add new explanatory paragraph:**

> _Buffers are the fundamental planning primitive. Every resource that matters—soil nutrients, aquifer levels, strategic inventory, tool libraries, community skills—is managed as a buffer with three zones: Red (minimum viable), Yellow (replenishment trigger), Green (target range). Independent demands are satisfied only to the extent that doing so does not deplete buffers below their replenishment triggers. The planner's primary job is buffer maintenance; demand satisfaction is secondary, derived from buffer health._

---

## 2. Revise "Local/Global Inversion" Section

**Current:**

> Planners try to satisfy all demands within their scope and emit surplus/deficit signals. Planner composition converts local failures into constraints at the next level by routing surplus/deficit signals upward until resolved or declared genuinely infeasible. Infeasibility results in a controlled local contraction: dependent demands are pruned back to the independent demands that are consuming the capacity needed to satisfy the constraint.

**Buffer-First Revision:**

> Planners try to maintain all buffers within their target zones. When a buffer enters Yellow, the scope generates a replenishment signal—a derived demand with priority over new independent demands. When a buffer enters Red, the scope emits a **buffer failure signal** upward. Planner composition converts these signals into constraints at the next level, routing them upward until resolved or declared genuinely infeasible. Infeasibility results in a controlled local contraction: independent demands are pruned back in reverse priority order until the buffer can be replenished. The load of net-sacrifice is distributed by independent demand priority, but buffer health is never sacrificed—demands are, if necessary.

---

## 3. Revise "General Process" Section - Derived Demands

**Current:**

```
- Derived Dependent demands:
  - Replenishment demands (classifiedAs) restore net-losses created by a Plan, up to - if specified - desired ranges (min/max) across space-time. This is metabolic sustainability.
  - For example replenishing the nutrients taken from the soil during harvest, or repairing machines.
  - Reserves/buffers demands (classifiedAs) are untouchable except in emergencies.
```

**Buffer-First Revision:**

```
- Buffer Zones: Every resource designated as strategic has three zones:
  - Red Base (TOR): Absolute minimum. Never cross except in declared emergency.
  - Yellow Base (TOY): Replenishment trigger. When on-hand ≤ TOY, generate signal.
  - Green Base (TOG): Target maximum. Replenish up to TOG when signal fires.

- Buffer Replenishment Demands: Generated automatically when:
  - On-hand quantity ≤ TOY (standard replenishment)
  - Projected on-hand (after planned consumption) ≤ TOY (forward-looking replenishment)
  - Any consumption event occurs while buffer is already in Yellow (accelerated replenishment)

- Metabolic Buffers: Ecological systems (soil nutrients, aquifers, forests) are buffers with:
  - Natural replenishment rates (included in lead time calculation)
  - Tipping points below which recovery impossible (TOR_min_viable_ecosystem)
  - Intergenerational obligations encoded as minimum buffer targets

- Strategic Buffers: Decoupling points in supply chains, managed via DDMRP logic
- Reserve Buffers: Untouchable except in emergencies, with separate TOR_reserve
```

---

## 4. Revise "Two-Pass Planning" Description

**Current:**

> Planning proceeds in two passes over the same PlanStore: (1) independent demands, (2) replenishment/buffer/admin demands derived from Pass 1 consumption. Failure in Pass 2 = metabolic debt, qualitatively worse than unmet independent demand satisfaction.

**Buffer-First Revision:**

> Planning proceeds in three passes over the same PlanStore:
>
> **Pass 0 - Buffer Health Check:** Evaluate all buffers within scope. Generate replenishment signals for any buffer already in Yellow or Red. These have highest priority—they represent existing metabolic debt.
>
> **Pass 1 - Independent Demands:** Satisfy independent demands, but only to the extent that doing so does not:
>
> - Deplete any buffer below TOY (if doing so would prevent timely replenishment)
> - Exceed available capacity after Pass 0 replenishment is scheduled
> - Violate ecological buffer constraints (soil, water, etc.)
>
> **Pass 2 - Derived Buffer Replenishment:** After Pass 1 consumption is known, compute new buffer depletion and generate replenishment demands. These are satisfied against remaining capacity.
>
> **Pass 3 - Metabolic Reconciliation:** If any buffer remains below TOR after Pass 2, this is **metabolic debt**—qualitatively worse than unmet independent demand. Trigger backtracking into Pass 1 allocations, retracting independent demands in reverse priority until buffers can be restored to at least TOR.

---

## 5. Revise "Technical Planner - planForScope" Section

**Current Phase 3:**

```
- Phase 3 — Formulate:
  - Pass 1 (primary): all pre-existing demands sorted by D-category then due date.
  - Compute: endogenous replenishment demands from Pass 1's consumption records
  - Pass 2 (derived): replenishment + buffer demands against remaining capacity
  - Backtrack (if metabolicDebt after Pass 2): walk Pass 1 allocations in reverse priority
```

**Buffer-First Revision:**

```
- Phase 3 — Formulate with Buffer Priority:

  - Pass 0 — Buffer Replenishment First:
    - Load all BufferZone configurations for resources in scope
    - For each buffer, compute current NFP = onhand + onorder − qualifiedDemand
    - If NFP ≤ TOY, generate immediate ReplenishmentSignal with quantity = TOG − NFP
    - Sort signals by (zone: Red > Yellow) then (NFP/TOY ratio ascending)
    - Allocate capacity to signals in this order BEFORE any independent demands

  - Pass 1 — Independent Demands with Buffer Guards:
    - Sort independent demands by criticality
    - For each demand, check projected buffer impact:
        projectedBufferAfter = currentNFP − (demandQuantity × depletionRate)
    - If projectedBufferAfter ≤ TOY for any critical buffer, demand is:
        a) Rejected if buffer is ecological/strategic (cannot deplete further)
        b) Partially satisfied if buffer can be replenished before next consumption
    - Allocate demands that pass buffer guards

  - Pass 2 — Replenishment from Consumption:
    - Track actual consumption from Pass 1
    - Update buffer levels based on consumption events
    - Generate replenishment demands for all buffers now in Yellow/Red
    - Allocate against remaining capacity

  - Pass 3 — Metabolic Debt Resolution:
    - If any buffer < TOR after Pass 2:
        Identify which independent demands consumed from that buffer
        Retract lowest-priority demands until buffer can be restored to ≥ TOR
        Mark retracted demands as "deferred due to metabolic debt"
        Emit buffer failure signal to parent scope

  - Phase B — Supply Forward:
    - Unabsorbed supply forward-scheduled via dependentSupply
    - Any supply that could replenish Yellow/Red buffers gets priority routing
```

---

## 6. Add New Section: "Buffer Types and Hierarchies"

Insert after "Scope Boundaries as Data" section:

---

## Buffer Types and Hierarchies

Not all buffers are equal. The architecture recognizes a hierarchy of buffer criticality:

### Tier 1: Ecological Buffers (Non-Negotiable)

- **Examples:** Soil nutrients, aquifer levels, biodiversity indices, forest cover, carbon sinks
- **Properties:**
  - Have tipping points below which recovery is impossible or takes generations
  - Natural replenishment rates are part of lead time calculation
  - Cannot be "expedited" — ecological processes have minimum duration
  - Intergenerational justice requires maintaining at least historical baseline
- **TOR_ecological** is set by federation assembly with supermajority, cannot be overridden by local scope
- **Buffer failure** at this tier triggers automatic federation-level intervention

### Tier 2: Strategic Supply Buffers (DDMRP Core)

- **Examples:** Critical medicine stockpiles, seed banks, tool libraries, fuel reserves
- **Properties:**
  - Positioned at decoupling points in the supply network
  - Sized based on ADU × DLT × variability factors
  - Protect against supply disruptions and demand spikes
  - Can be expedited with additional effort (air freight, overtime)
- **Buffer parameters** set by scope assembly based on risk tolerance
- **Buffer failure** triggers merge planner resolution

### Tier 3: Metabolic Replenishment Buffers

- **Examples:** Compost piles, replacement parts, maintenance materials
- **Properties:**
  - Directly tied to production processes
  - Replenishment rate matches consumption rate
  - Failure means production stops but no ecological damage
- **Buffer parameters** derived from recipe requirements

### Tier 4: Reserve Buffers (Emergency Only)

- **Examples:** Emergency food stores, disaster supplies, strategic reserves
- **Properties:**
  - Untouchable except in declared emergencies
  - Emergency declaration requires assembly vote
  - Unauthorized consumption is custody violation
- **TOR_reserve** is absolute — violation triggers automatic custody penalty

### Tier 5: Social Buffers

- **Examples:** Community skill inventories, mutual aid capacity, childcare availability
- **Properties:**
  - Not physical resources but social capacities
  - Depleted by use, replenished by training/relationship-building
  - Measured via validated hours and social recognition
- **Buffer parameters** set democratically based on community resilience goals

---

## Buffer Priority Hierarchy

When allocating scarce capacity, buffers are served in this order:

1. **Ecological buffers below TOR** (existential threat)
2. **Strategic buffers below TOR** (supply chain collapse risk)
3. **Ecological buffers in Yellow** (preventative maintenance)
4. **Reserve buffers below TOR** (emergency capacity depleted)
5. **Strategic buffers in Yellow** (standard replenishment)
6. **Metabolic buffers below TOR** (production at risk)
7. **Social buffers below target** (community resilience)
8. **Independent demands** (consumption)

This hierarchy ensures that **ecological health precedes supply chain health precedes production capacity precedes consumption**.

---

## 7. Revise "Custody Protocol" to Include Buffer Custody

**Add after "Custodians are always individuals":**

> **Buffer Custody is Collective:** While individual resources have individual custodians, **buffers as aggregates** have collective custody. The scope assembly is collectively responsible for maintaining the buffer within its target zones. This means:
>
> - No single individual can deplete a buffer below TOY without assembly approval
> - Buffer status is a public dashboard, visible to all scope members
> - Buffer failure triggers collective review, not just individual penalties
> - The assembly sets buffer policy; individuals execute custody of specific items within the buffer
>
> This creates a **nested custody model**:
>
> ```
> Buffer (scope collective responsibility)
>   ├── Item A (individual custodian Maria)
>   ├── Item B (individual custodian Javier)
>   └── Item C (individual custodian collective k-of-n)
> ```
>
> The collective is liable for buffer health; individuals are liable for the specific items they hold. A depleted buffer triggers collective investigation—did individuals fail to safeguard? Was policy wrong? Was demand miscalculated?

---

## 8. Revise "Planner Objectives/Constraints" Summary Table

**Current:**

```
- Objective: Maximize Independent Demand satisfaction
- Constraint: Satisfy derived demands
- Satisfy Replenishment demands
- Satisfy Reserve/Buffers demands
```

**Buffer-First Revision:**

```
PRIMARY OBJECTIVE (Constrained):
- Maintain all buffers within target zones (Green preferred, Yellow tolerable, Red forbidden)

SECONDARY OBJECTIVE (Optimize subject to primary):
- Maximize Independent Demand satisfaction (ranked by criticality)

THIRDARY OBJECTIVE (Minimize effort subject to above):
- Minimize total Socially Necessary Effort (SNE)

CONSTRAINTS (in priority order):
1. Never let any ecological buffer fall below TOR_ecological
2. Never let any strategic buffer fall below TOR_strategic
3. Satisfy all buffer replenishment signals (in priority order: Red > Yellow)
4. Respect max_individual_effort_time per day
5. Satisfy independent demands to extent possible after 1-4
```

---

## 9. Add Buffer Visualization to Observer Metrics

**Add to Observer output:**

```typescript
interface BufferHealthReport {
  scope: string;
  timestamp: Date;
  buffers: {
    [bufferId: string]: {
      type: "ecological" | "strategic" | "metabolic" | "reserve" | "social";
      currentLevel: number;
      tor: number; // Red base (minimum)
      toy: number; // Yellow base (replenish trigger)
      tog: number; // Green base (target)
      zone: "RED" | "YELLOW" | "GREEN" | "EXCESS";
      trend: "improving" | "stable" | "declining" | "critical";
      daysUntilTOR: number; // At current depletion rate
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
    ecologicalHealthIndex: number; // Weighted average of ecological buffers
    strategicHealthIndex: number; // Weighted average of strategic buffers
  };
  metabolicDebt: {
    hasDebt: boolean;
    buffersInRed: string[];
    requiredAction: string;
  };
}
```

This becomes the **primary dashboard** for scope assemblies. Before discussing new projects or consumption, they check buffer health. Red buffers mean **emergency session**. Yellow buffers mean **replenishment planning** before new initiatives.

---

## 10. Revise "The Goal" Section to Emphasize Buffer Health

**Current ending:**

> The orientation toward local satisfaction is essential to dissolving the division between town and country, and with it the division between mental and physical labor. A scope that produces what it consumes and consumes what it produces is a community governing its own material life — not a node in a supply chain it does not control.

**Buffer-First Addition:**

> But local satisfaction is not enough. A community that consumes its ecological inheritance—depleting soil, drawing down aquifers, cutting forests without regeneration—is governing only for the present, stealing from its children. The buffer-first orientation makes this visible and actionable. When soil nitrogen enters Yellow, the assembly sees it. When the aquifer drops toward Red, the federation intervenes. When a forest buffer is drawn down for timber, a replenishment signal appears automatically, requiring replanting before new timber can be planned.
>
> **Buffer health is intergenerational justice made computable.** The planner cannot optimize away the needs of future people because their claims are encoded in buffer targets set by previous generations. Each assembly, in setting buffer policies, negotiates with the unborn. The architecture ensures that negotiation is explicit, transparent, and binding.

---

## Summary of Buffer-First Reorientation

| Aspect            | Original Framing                           | Buffer-First Framing                          |
| ----------------- | ------------------------------------------ | --------------------------------------------- |
| Primary objective | Satisfy independent demands                | Maintain buffer health                        |
| Demands           | Independent (primary), Derived (secondary) | All demands are derived from buffer status    |
| Replenishment     | One of several derived demand types        | The fundamental planning activity             |
| Failure mode      | Unmet demand                               | Metabolic debt (buffer below TOR)             |
| Priority          | Independent demand criticality             | Buffer zone (Red > Yellow > Green)            |
| Ecology           | External constraint                        | Just another buffer type                      |
| Intergenerational | Implicit in sustainability                 | Explicit in buffer targets                    |
| Planning passes   | Two (independent, derived)                 | Three (buffer-first, demands, reconciliation) |

The buffer-first perspective transforms the planner from a **demand satisfaction engine** into a **buffer maintenance system that satisfies demands when possible**. This is the difference between:

- **Extractive planning:** "What do people want? How do we get it?"
- **Regenerative planning:** "What buffers must we maintain? What demands can we satisfy given that constraint?"

Your architecture already has all the pieces. These edits simply make the buffer-first logic **explicit, prioritized, and inescapable**.
