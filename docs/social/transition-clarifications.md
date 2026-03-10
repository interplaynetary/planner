# Transition — Open Questions & Clarifications

_Residual questions from synthesising `spec.md` and `old-transition.md`._

---

## 1. Scope Committees vs. Communes — exact distinction

These two organs are easy to conflate because both involve elected workers making
collective decisions over production. The distinction is structural and temporal.

**Scope Committee** — a _transitional organ inside capitalist property_.

- Exists inside a scope (factory, farm, mine) that is still legally owned and managed
  by a capitalist.
- Its authority is partial and contested: the right to inspect, expose, propose, and
  gradually intervene — not yet the right to manage.
- Defined by a _physical assemblage of means of production_ (the machines, land, and
  buildings that constitute the scope), not by the associative choices of its members.
  Workers are scope-participants because they work there, not because they chose to
  join.
- Operates in _dual power_: the capitalist's authority and the committee's authority
  coexist in the same physical space. This tension resolves — toward co-optation or
  expropriation.
- Terminates as a distinct form when the capitalist is gone and the committee steps
  into direct management. At that point the scope (and its workers) transitions into,
  or becomes part of, a Commune.

**Commune** — the basic _political-economic unit of the social plan_.

- Constituted by the _voluntary associative choices_ of citizens, not by the
  geography of a single workplace.
- Has full governance rights over internal matters: production, reproduction, care,
  housing, culture — whatever its members decide falls within its scope.
- Manages means of production that it _collectively owns_ (or has been entrusted
  with through federation planning), not property it must negotiate to access.
- Not limited to workers in a single workplace. A commune may contain multiple
  productive scopes, or a single scope may serve multiple communes, or workers from
  many workplaces may form one commune around a neighbourhood.
- Does not dissolve when a particular productive challenge is resolved. It is an
  ongoing political community.

**The relationship between the two:**

A Scope Committee is the embryo of associated production _inside_ the old order. The
Commune is associated production _as an established form_. When a scope is
expropriated, its Scope Committee either:

1. Becomes the governing body of a commune-owned productive unit within an existing
   commune; or
2. Constitutes a new commune (or joins a federation of communes) around that scope.

The Membership Index in spec.md tracks citizens → communes. The Scope Committee
produces no such index entries — its "members" are scope-participants defined by
employment, not by choice.

During transition, the two coexist. Workers in a capitalist scope may simultaneously
be members of a neighbourhood commune that receives outputs from their scope. The
Scope Committee manages the production transition; the Commune manages the
distribution and governance of what is received.

---

## 2. Social Recipient — definition

A **social recipient** is any entity within the social plan that accepts delivery of
outputs from a transitioning scope.

Concretely: when a scope redirects fraction `y` of its output away from market
customers toward the social plan, _something_ receives those outputs. That something
is the social recipient. It may be:

- Another scope in the federation (an intermediate input into their production)
- A commune (for direct social consumption: food, clothing, tools, etc.)
- A public works project (construction, infrastructure)
- A school, hospital, care centre
- A reserve or buffer stock maintained by a federation

The social recipient is not abstract. It is a named entity in the PlanStore. Its
receipt of outputs is what grounds the validation of the producing scope's social
labour (see §4 below). Without a named recipient, there is no social delivery — only
a claim.

---

## 3. H_total_i — definition

`H_total_i` is simply the **total hours worked by worker i in the measurement
period**, regardless of what portion of the output was directed to market or social
plan.

It is measured from time cards and direct observation. It is the raw labour-time
input before any social/market split is applied.

The split is applied downstream: `V_i = y × H_total_i` computes the
_socially-validated_ portion. But `H_total_i` itself is undivided — the worker
worked those hours, the production was joint, and it is only at the output destination
that the social/market fraction becomes meaningful.

The Observer measures `H_total_i` for every worker. `H_total = Σ H_total_i` across
all workers gives total scope labour-time for the period.

---

## 4. Social Validation — resolved position

**Validation originates with the social recipient, not the producing scope, and not
administration.**

The prior formulation (`V_i = y × H_total_i` driven by a self-declared scope output
fraction) was a self-serving automatic calculation with no external check. The note
that "validation is a social judgment" was correct in spirit but unspecified in
mechanism. `spec.md`'s attribution to "Administration" has been corrected.

**Corrected formula:**

```
Q_out_social_confirmed = quantity confirmed received by named social recipients
                         via EconomicEvent { action: 'receive' } in the PlanStore

y_confirmed = Q_out_social_confirmed / Q_out_total

V_i = y_confirmed × H_total_i
```

The formula is automatic — no manual judgment step. But it is triggered by an act of
the social recipient: recording a `receive` EconomicEvent in the shared PlanStore.
Until that event exists, the delivery is unconfirmed and generates no validation.
Recipients may confirm partial quantity (e.g. 80 of 100 units, with quality
dispute on the remainder); `Q_out_social_confirmed` reflects only what was attested.

Validation is bounded by the Planned Effort of the work-intent — the plan caps the
maximum; the recipient's confirmation determines the actual.

Validation is retractable by the social recipient (the recognizer), consistent with
`recognition-of-contribution is retractable by the recognizer`.

**substitution ratio:**

```
fairness_ratio = [claim_purchasing_power × y_confirmed] / [dollar_purchasing_power × (1-y)]
```

Claim side uses `y_confirmed`; dollar side uses `y` (the market dispatch fraction,
which drives market revenue and thus dollar wages). A gap between `y` and `y_confirmed`
— unconfirmed or partially disputed deliveries — depresses the ratio below workers'
expectation, creating immediate material pressure to resolve outstanding confirmations.

---

## 5. Input substitution — mechanisms not fully specified

`old-transition.md` describes output substitution (redirecting y fraction of outputs
to social plan) but leaves input substitution (`x` fraction) underspecified. It says
only: _"replace a portion of market-sourced inputs with socially-sourced inputs."_
There are at least three distinct mechanisms, each with different preconditions,
costs, and transition dynamics.

---

### 5a. New social provider

The social plan identifies or creates a new, socially-organized source for an input.

- Example: the federation funds conversion of a conventional farm to organic methods
  to supply a textile mill with organic fiber.
- Precondition: productive capacity for the input does not yet exist within the social
  plan. New capacity must be seeded.
- Cost: requires up-front social plan investment (resources, labour, time) before the
  input flow begins. This is `Social-Dependent` in the three-class plan typology — it
  cannot proceed until the federation acts.
- Transition dynamic: slower to establish, but once established it deepens the social
  plan's productive base. The new provider is itself a scope in transition, with its
  own `x`, `y` trajectory.
- PlanStore representation: the federation creates a new Plan covering the new
  provider scope. The input appears as a planned `EconomicEvent { action: 'transfer' }`
  from the new provider to the receiving scope, replacing the market purchase
  commitment.

---

### 5b. Partial conversion of an existing supplier

An existing capitalist supplier begins dedicating a fraction of their output to the
social plan, transitioning alongside the scope.

- Example: a petrochemical supplier has its own Scope Committee, which negotiates
  with the textile mill's Scope Committee to redirect 15% of their fiber output to
  the social plan at the same time the mill redirects 15% of its fabric output.
- Precondition: the supplier scope must have its own Scope Committee willing and able
  to negotiate. This is most likely when both scopes are in the same federation.
- Cost: lower up-front investment than creating a new provider. But the supplier
  remains partially capitalist, introducing instability — the capitalist owner may
  withdraw the arrangement.
- Transition dynamic: both scopes move along their substitution ladders
  simultaneously. Their `y` values are interdependent: the mill's social output
  validates the fiber supplier's social output, and vice versa. Progress is coupled.
- Coordination requirement: the federation planner must hold both transition
  trajectories in the same PlanStore to detect when one scope is moving faster than
  the other and route compensation accordingly.

---

### 5c. Dollar subsidy to maintain existing market purchase

The social plan provides dollar grants (`D_received`) so the scope can continue
purchasing inputs from market suppliers even as market revenue falls (because y
increases and market sales decrease).

- Example: as the mill ships more fabric to social recipients and less to fast-fashion
  brands, its dollar revenue falls. But its synthetic fiber contracts still require
  dollar payment. The federation provides dollar subsidies to bridge the gap until
  input substitution (5a or 5b) is established.
- Precondition: the federation must have access to dollars. In the transitional
  period, this could come from scopes that are still primarily market-facing, from
  solidarity funds, or from levies on market-side revenue of other scopes.
- Cost: does not build new productive capacity in the social plan. Dollar subsidies
  maintain market dependency; they do not dissolve it. As spec.md notes: _"Dollar
  subsidies without concurrently expanding the social claim pool creates dependency,
  not transition."_
- Transition dynamic: this mechanism is a _bridge_, not a destination. It buys time
  for 5a or 5b to become viable. If it becomes permanent, the scope becomes
  dependent on federation dollar transfers and the transition stalls.
- PlanStore representation: `D_received` is tracked by the Observer as a transfer
  from the federation to the scope. It appears in the dollar solvency constraint but
  not in the physical flow fractions `x`, `y`.

---

### Relationship between mechanisms

The three mechanisms are not mutually exclusive. A scope may use all three
simultaneously for different inputs:

| Input                   | Mechanism                                                             |
| :---------------------- | :-------------------------------------------------------------------- |
| Organic fiber (primary) | 5a — new social provider being built                                  |
| Packaging material      | 5b — existing supplier partly converting                              |
| Energy / utilities      | 5c — dollar subsidy while social energy infrastructure is constructed |

The Observer tracks `x` per input category, not just an aggregate `x`. Each input
substitution path has its own ladder (see the 6-rung ladder in `old-transition.md`)
and its own feasibility class (Autonomous / Social-Dependent / Infeasible).

The federation planner sees the sum of all `D_received` requests across transitioning
scopes and must balance them against its dollar reserves and the pace at which new
social providers (5a, 5b) are coming online. This is itself a planning problem: the
federation must plan its own transition support capacity alongside the scopes it is
supporting.

---

## Summary

**All items resolved and applied to both spec.md and old-transition.md:**

1. Validation grounded in social recipient's `receive` EconomicEvent. Formula:
   `validated_hours[i] = confirmed_output_fraction × hours_worked[i]`.
2. "Administration validates" replaced with "Social Recipient validates" throughout.
   Social Recipient defined explicitly in spec.md.
3. substitution ratio: `[claim_purchasing_power × confirmed_output_fraction] / [dollar_purchasing_power × (1 - social_output_fraction)]`.
4. All variables renamed to human-readable throughout both files:
   `x` → `social_input_fraction`, `y` → `social_output_fraction`,
   `y_confirmed` → `confirmed_output_fraction`, `H_total_i` → `hours_worked[i]`,
   `V_i` → `validated_hours[i]`, `R_market` → `market_revenue`, etc.
5. `hours_worked[i]` documented as pre-split total; all social/market splits are
   derived calculations applied on top.
6. Input substitution broken into three mechanisms (A: new social provider,
   B: supplier partial transition, C: dollar bridge) with summary table.
   Output substitution modes (direct social consumption, intermediate supply, reserve)
   defined separately. Added to both spec.md and old-transition.md.

**Equation fixes applied to both files:**

8. `fairness_ratio` corrected to full form: `[social_real_wage_per_hour × confirmed_output_fraction] / [market_real_wage_per_hour × (1 - social_output_fraction)]`, where `social_real_wage_per_hour = average_claim_per_validated_hour × claim_purchasing_power` and `market_real_wage_per_hour = average_dollar_wage_per_hour × dollar_purchasing_power`. Neither the per-hour-only formula nor the purchasing-power-only formula was dimensionally correct alone.
9. `equity_factor` replaced with `wage_rate_normalized[i] = hourly_rate[i] / average_hourly_rate` (= 1 when rates are equal; co-optation signal when committee members' value diverges upward).

**Structural gaps now in spec.md:**

10. Scope Committee: untransportability in definition, full Access rights list, Withdraw right, "To the movement as a whole" responsibility, Tasks table (5 phases), Composition.
11. On Public Works and Unemployment, On the Relation to Capitalist Authority, On the School of Planning.
12. Gradual Transition: Two Plans table, Three Classes of Plans table, Social Plan as Enabler, Conflict Between Current and Desired.
13. Ladder: 8-rung table with each rung defined (including CONFLICT/Defense/Consolidation).
14. Observer Report, Committee Decision, and Key Insight subsections.
15. Social Plan Defense expanded to full treatment.
16. Communal satisfaction of need vs market satisfaction of need added to both files:
    - `communal_need_coverage[i]` (market cost equivalent of collectively-provisioned essentials)
    - `uncovered_essential_expenses[i]`, `effective_net_market_wage[i]`
    - `communal_satisfaction_ratio = total_social_value[i] / effective_net_market_wage[i]`
    - Positive feedback loop articulated (more coverage → lower minimum viable wage → less transition resistance → more capacity → more coverage)
    - Role shift of individual claims pool: survival → discretionary as communal coverage grows
    - "Welfare" language avoided throughout; framing is communal-satisfaction-of-need vs market-satisfaction-of-need

**Deferred:**

16. Scope Committee → Commune transition: to be investigated separately.
17. Transition in Low-Income Regions: section remains empty — content to be developed.
