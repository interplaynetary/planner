# Transitional Custody Protocol

_Every valuable thing moving through the social plan has a custodian at every moment. Custody is not a special role — it is the accountability structure underlying all flows. This protocol applies uniformly to dollar cash, goods, medicine, equipment, and any external-currency obligation moving through social space._

---

## I. The Fundamental Equation

The PlanStore's `transferCustody` events already constitute the custody ledger. No new infrastructure is required. The protocol adds three things on top of the existing VF event graph:

1. **An entrustment limit** — the maximum value any custodian may hold, derived from claim capacity; applies uniformly to individuals, scopes, and federations
2. **Proportional draw-down** — when a collective holds custody, each member's individual limit is partially committed in proportion to their contribution share
3. **A penalty mechanism** — claim capacity is deducted on confirmed loss; loss flows through tranches up the hierarchy

Everything else follows from these three.

---

## II. Confirmation as the Atomic Event

```
custody_state(item) ∈ { held_by[A] | transferring[A→B] | held_by[B] | settled }

EconomicEvent(action = transferCustody):
  provider:          current custodian  — liability released on receiver's confirmation
  receiver:          new custodian      — liability assumed at confirmation
  resourceQuantity:  amount
  market_value:      dollar-denominated value  (for entrustment calculation only)
```

_Liability boundary: if an item goes missing after the receiver's confirmation, the receiver is accountable. If missing before, the sender retains responsibility. The chain always identifies exactly one responsible party at every instant. No second action from the sender is needed — the receiver's confirmation is the single atomic transfer._

_The `market_value` field is used only for limit enforcement during the transitional period. It is denominated in external currency because the theft risk is market-denominated: goods in transit can be sold or exchanged in the external economy regardless of the social plan's internal accounting._

---

## III. Custody as Socially-Validated Work

```
validated_custody_hours[i] = Σ(hours_per_transfer × confirmed_flag)
```

_Each transfer is validated individually at the moment the receiver confirms. Hours spent receiving, verifying, storing, transporting, distributing, and reconciling are all included. The confirmation is the validation event — exactly as it is for production labor._

```
total_social_svc          += Σ validated_custody_hours[i]
claim_capacity[i]          includes validated_custody_hours[i] at equal rate
```

_There is no separate custody rate. Handling collective goods is socially necessary work; moving medicine from port to clinic is no less socially valid than producing it. The claim pool makes no distinction._

---

## IV. Claim Capacity as Collateral — The Entrustment Limit

The bridge between the two value systems is derived from two quantities already present in the composition ratio:

```
svc_market_equivalent = claim_purchasing_power / dollar_purchasing_power   [$/SVC]
```

_This converts one unit of socialist claim capacity into its current market-value equivalent: the ratio of what 1 SVC buys in goods to what $1 buys in the same goods. It rises as the social economy matures — the collateral base strengthens as transition deepens._

The entrustment limit formula is uniform across all levels of the federation hierarchy:

```
entrustment_limit[X] = α × total_claim_capacity[X] × svc_market_equivalent

  α              ∈ (0, 1]   safety factor, democratically set; default 0.5
```

_X is any custodian node — an individual worker, a scope, an industrial federation, a regional federation. The formula is identical at every level; only `total_claim_capacity[X]` differs._

For **collective custodians** (any level above individual):

```
total_claim_capacity[L] = Σ total_claim_capacity[i]   for all i ∈ L
```

When level L takes custody of an item of value V, the liability is distributed proportionally across members:

```
contribution_share[i, L] = validated_hours_in_L[i] / Σ validated_hours_in_L[j]
liability_drawdown[i, L] = V × contribution_share[i, L]
```

A member's available capacity accounts for all levels they participate in simultaneously:

```
available_capacity[i] = entrustment_limit[i] − Σ_L liability_drawdown[i, L]
```

_If `available_capacity[i] < 0` for any member, that level cannot accept the assignment without first settling existing custody. No member can be committed beyond their individual limit; the collective capacity is the sum of what remains individually available._

_The safety factor α encodes the deterrence guarantee: at α = 0.5, stealing the maximum entrusted costs twice what was gained in foregone claim capacity._

---

## V. The Incentive Compatibility Condition

For custody to be self-enforcing, theft must be irrational. The required condition:

```
value_accessible_solo / n_colluders_required  <  entrustment_limit_value[i]
```

Rearranged as a **custody chain design constraint**:

```
value_accessible_solo  <  n_colluders_required × α × total_claim_capacity[i] × svc_market_equivalent
```

This gives the assembly three independent levers:

| Lever                   | Action                                            | Effect                                   |
| :---------------------- | :------------------------------------------------ | :--------------------------------------- |
| **Physical security**   | Sealed containers, GPS tracking, route monitoring | Reduces `value_accessible_solo` toward 0 |
| **Threshold custody**   | k-of-n signatures required to release             | Increases `n_colluders_required`         |
| **Grow claim capacity** | More validated custody work over time             | Increases `entrustment_limit_value[i]`   |

_No single lever is sufficient for high-value flows. The assembly combines all three until the condition holds. Physical security is fastest to deploy; threshold custody is structurally robust; growing claim capacity is the long-run answer that requires no ongoing enforcement._

_Collusion in a k-of-n scheme: each colluder gains `stolen_value / k` but loses `entrustment_limit_value[i]` individually. The condition becomes `stolen_value / k < entrustment_limit_value[i]`, or equivalently `stolen_value < k × entrustment_limit_value`. Adding custodians does not dilute deterrence — it multiplies it._

---

## VI. The Penalty Mechanism

```
When items are confirmed lost from an active custodian's custody:

  penalty_svc[i]          = min( missing_value / svc_market_equivalent,  total_claim_capacity[i] )
  total_claim_capacity[i] ← total_claim_capacity[i] − penalty_svc[i]
```

_The penalty is deducted from future claim capacity — the custodian cannot draw goods from the social pool until effectively repaid. Minimum communal provision remains untouched; discretionary consumption vanishes._

Loss coverage proceeds through tranches until fully absorbed:

```
Tranche 1:  individual penalties of directly responsible custodians
Tranche 2:  scope welfare pool
Tranche 3:  industrial federation pool
Tranche 4:  regional federation pool
Tranche ∞:  universal commune social welfare fund
```

_Each tranche is exhausted before the next is drawn. Investigation and assembly review trigger at tranche 2 and above — collective loss implies systemic failure, not just individual fault. The deterrence layer (individual penalty) and the insurance layer (welfare pools) are independent: the pools cover the collective's loss while the individual still faces their own deduction._

---

## VII. Custody Routing — Level Selection

Custody is assigned at the lowest level whose available capacity covers the full value:

```
custody_level(V) = min { L ∈ hierarchy : entrustment_limit[L] ≥ V }

  hierarchy (ordered):  individual  <  scope  <  industrial_federation
                                    <  regional_federation  <  universal_commune
```

Evaluated in order at assignment time:

```
1. individual:            if V ≤ available_capacity[i]
2. scope:                 else if V ≤ Σ available_capacity[i]  for i ∈ scope
3. industrial federation: else if V ≤ Σ available_capacity[i]  for i ∈ indfed
4. regional federation:   else if V ≤ Σ available_capacity[i]  for i ∈ regfed
5. special handling:      else — split shipment or escalate to joint multi-level custody
```

**Physical partition** — split a shipment into batches, each within the capacity of its assigned level:

```
n_batches         = ⌈ total_value / entrustment_limit[assigned_level] ⌉
value_per_batch   ≤ entrustment_limit[assigned_level]
```

**Joint multi-level custody** — when no single level suffices but combined levels do:

```
joint_custody = {
  levels:     [L₁, L₂, ...],
  threshold:  k-of-n level confirmations required to release,
  drawdown:   distributed proportionally across all members of all participating levels
}
```

_The routing decision is made by the Observer at assignment time and logged in the PlanStore. Higher-level custody is not a privilege — it is a last resort when value exceeds local capacity. The right design always tries to bring capacity to the asset (grow claim capacity through work, use physical partition) rather than escalating custody level._

---

## VIII. Integration with the Claim Equations

No new pools. No new SVC tracks. The protocol extends the per-worker state with four additional fields:

```
Per-worker additions (alongside existing claim_capacity, hours_worked, etc.):

  entrustment_limit_value[i]   — recomputed each period from current claim_capacity and svc_market_equivalent
  current_liability_value[i]   — updated by each transferCustody event; settles to 0 on chain completion
  pending_penalty_svc[i]       — deduction queue applied against future total_claim_capacity[i]
```

The `validated_custody_hours[i]` contribution flows directly into `total_social_svc` — already defined as "all socially-validated effort." The claim equation is unchanged:

```
claim_capacity[i] = validated_hours[i] × (available_claimable_pool / total_social_svc)
                    + solidarity_supplement[i]
```

_where `validated_hours[i]` now includes both production labor and custody labor._

---

## IX. Observer Metrics

**Per-worker:**

```
entrustment_limit[i], available_capacity[i]
Σ_L liability_drawdown[i, L]   (total committed across all levels)
validated_custody_hours[i]
pending_penalty_svc[i]         (if any)
```

**Per-level (scope / industrial federation / regional federation):**

```
entrustment_limit[L]    = α × total_claim_capacity[L] × svc_market_equivalent
current_liability[L]    = Σ market_value of all items in custody at level L
coverage_ratio[L]       = entrustment_limit[L] / current_liability[L]
custody_throughput[L]   = Σ settled_transfer_value  (period)
custody_incident_rate[L] = incidents / total_transfers
```

_If `coverage_ratio[L] < 1` at any level: that level is under-collateralized. The Observer flags this and the relevant assembly must act: grow member claim capacity, split shipments, or escalate to the next level._

---

## X. The Transitional Character

_The custody protocol is denominated in market terms because the threat it guards against — theft for external sale or exchange — is market-denominated. A medicine shipment stolen and smuggled across a border is worth its market price regardless of what the social plan says. The `svc_market_equivalent` bridge is therefore not a concession to capitalist accounting; it is the minimum necessary interface with the external world during transition._

_As `import_dependence_ratio → 0` and the federation's external fund becomes less critical, the volume of dollar-denominated flows in custody shrinks. As the social economy matures and `svc_market_equivalent` rises (SVC buys more relative to dollars), the collateral base strengthens even as the need for it diminishes. At full transition — when all essential goods are produced and allocated within the social plan — external-cash custody, external-markets, and the temptation to sell communal property become a marginal concern. The protocol retires gracefully. Until then, it is the operational interface between the two worlds: the precise mechanism by which collective ownership of external revenue is maintained through individual accountability._
