Let us take, first of all, the words "proceeds of labor" in the sense of the product of labor; then the co-operative proceeds of labor are the total social product.

From this must now be deducted: First, cover for replacement of the means of production used up. Second, additional portion for expansion of production. Third, reserve or insurance funds to provide against accidents, dislocations caused by natural calamities, etc.

These deductions from the "undiminished" proceeds of labor are an economic necessity, and their magnitude is to be determined according to available means and forces, and partly by computation of probabilities, but they are in no way calculable by equity.

There remains the other part of the total product, intended to serve as means of consumption.

Before this is divided among the individuals, there has to be deducted again, from it: First, the general costs of administration not belonging to production. This part will, from the outset, be very considerably restricted in comparison with present-day society, and it diminishes in proportion as the new society develops. Second, that which is intended for the common satisfaction of needs, such as schools, health services, etc. From the outset, this part grows considerably in comparison with present-day society, and it grows in proportion as the new society develops. Third, funds for those unable to work, etc., in short, for what is included under so-called official poor relief today.

Only now do we come to the "distribution" which the program, under Lassallean influence, alone has in view in its narrow fashion – namely, to that part of the means of consumption which is divided among the individual producers of the co-operative society.

The "undiminished" proceeds of labor have already unnoticeably become converted into the "diminished" proceeds, although what the producer is deprived of in his capacity as a private individual benefits him directly or indirectly in his capacity as a member of society.

Just as the phrase of the "undiminished" proceeds of labor has disappeared, so now does the phrase of the "proceeds of labor" disappear altogether.

Within the co-operative society based on common ownership of the means of production, the producers do not exchange their products; just as little does the labor employed on the products appear here as the value of these products, as a material quality possessed by them, since now, in contrast to capitalist society, individual labor no longer exists in an indirect fashion but directly as a component part of total labor. The phrase "proceeds of labor", objectionable also today on account of its ambiguity, thus loses all meaning.

What we have to deal with here is a communist society, not as it has developed on its own foundations, but, on the contrary, just as it emerges from capitalist society; which is thus in every respect, economically, morally, and intellectually, still stamped with the birthmarks of the old society from whose womb it emerges. Accordingly, the individual producer receives back from society – after the deductions have been made – exactly what he gives to it. What he has given to it is his individual quantum of labor. For example, the social working day consists of the sum of the individual hours of work; the individual labor time of the individual producer is the part of the social working day contributed by him, his share in it. He receives a certificate from society that he has furnished such-and-such an amount of labor (after deducting his labor for the common funds); and with this certificate, he draws from the social stock of means of consumption as much as the same amount of labor cost. The same amount of labor which he has given to society in one form, he receives back in another.



----

What he has given to it is his individual quantum of labor. For example, the social working day consists of the sum of the individual hours of work; the individual labor time of the individual producer is the part of the social working day contributed by him, his share in it.

---

ok so now what im imagining, is that the goal of planning is to try to satisfy commonul consumption and individual consumption and so we formulate a plan, but various plans incur various other kinds of debts that expand the needs in the other categories, so plans can be explored and tested and this whole system acts as a constraint simulator on feasibility?

---

## The System as an Elastic Constraint Simulator

The goal of planning is to try to satisfy communal consumption and individual consumption. We formulate a plan, but various plans incur various other kinds of debts that expand the needs in other categories. The system we have built acts as a **continuous constraint simulator on feasibility**, exploring how these cascading debts interact with real physical and political limits.

### 1. The Core Paradigm: Decoupling Planning from Physics

This system models a planned economy where **needs** (orders) are expressed, **validation** commits resources to them, and **satisfaction** physically fulfils them. 

The genius of this specific implementation is that it decouples **The Plan** (what we intend to do) from **The Physics** (what actually happens day by day). It achieves this by shifting from an absolute SNLT budget to a **continuous daily rate model**, constrained by a normative `planning_day_snlt`.

At every simulation tick (a day), the system attempts to distribute incoming material production (the `pool`) according to the socially validated plan. When reality diverges from the plan — due to material shortages or sudden crises — the system elastically adapts instead of breaking.

### 2. The Commune (Social Constraints & Prioritization)

The `Commune` class governs the social aggregate. It enforces Marx's deduction cascade—the principle that social reproduction and communal overhead must be funded *before* any individual distribution can occur.

#### A. Placing is Validation (Communal Level)
For communal projects (a bridge, hospital supplies, metabolic soil maintenance), placing an order *is* the act of social validation. There is zero manual intervention:
1. An order is placed with a total `snlt` and an expected `duration_days`.
2. The `orderRate` (SNLT/day) is derived.
3. The order is automatically ranked against all other communal orders according to the rigid Marxist deduction cascade (Tier 1: Reproduction → Tier 2: Social Services).

#### B. Rate-Based Preemption (The Political Limit)
The Commune has a normative cap (`planning_day_snlt`), representing the maximum aggregate social labor dedicated to communal projects per day. 
Because higher-priority orders are evaluated first, if a Tier 1 metabolic crisis requires massive daily labor, lower-priority Tier 2 projects are **preempted**. Their daily rate drops to zero, and they are frozen. This represents a political/social decision: *"We must pause the bridge to fix the soil."*

#### C. The Tick & Pool-Starvation (The Material Limit)
Every day, `commune.tick(production)` runs:
* **Entitlement Accrual:** Running (non-preempted) orders accrue their daily rate as "unspent credit" (`accumulated_snlt`).
* **Distribution:** The real material production in the pool is distributed to satisfy these orders.
* **Pool Starvation:** If the pool is empty, the order still accrues its credit but cannot draw. The workers are scheduled, but the concrete hasn't arrived. 
* **Elastic Catch-Up:** When production recovers, the order spends its accrued credit to "catch up"—but it is bounded by `capacity_day_snlt` and an optional physical `max_rate_per_day` constraint. 

This creates a perfect diagnostic trace (`DayReport.order_outcomes`) highlighting exactly where the plan was bottlenecked by politics (preemption) versus materials (pool starvation).

### 3. The Individual (Subjective Preference)

While communal needs are validated automatically by structural priority, the `Account` represents the individual producer, whose choices are subjective and equitable.

#### A. The Labor Certificate
When an individual works, they receive `gross_labor_credited`. This is an immutable, additive record of their total contribution to society. 

#### B. Individual Validation is Explicit
Unlike the Commune, an individual is free to place any number of personal orders without committing to them. Placing an individual order simply expresses a desire. To advance the order, the individual must explicitly `validate()` it, locking a portion of their elastic purchasing power.

#### C. No Hard Deduction
Crucially, the individual's raw labor certificate is never *literally* taxed or reduced. Instead of taking coins out of an account to pay for the bridge, the system elastically dilutes the purchasing power of the individual's certificate based on the current communal load.

### 4. Elasticity (The Dance Between Individual and Commune)

This is where the mathematical elegance of the system shines. Individual purchasing power is completely elastic, calculated dynamically on the fly based on the current state of the Commune's commitments.

#### A. The Communal Deduction Rate
If the Commune has a `planning_day_snlt` of 1,000, and is currently running communal projects requiring 400 SNLT/day, the `communal_deduction_rate` is **40%**.
This represents the fraction of societal capacity currently tied up in collective obligations.

#### B. Net Claim Capacity
An individual's actual purchasing power is their raw labor certificate scaled by this elastic deduction rate:
`net_claim_capacity = gross_labor_credited × (1 - communal_deduction_rate)`

If Alice has worked 1,000 hours, and the communal deduction is 40%, her `net_claim_capacity` is 600 hours. 
* **If a crisis hits** and communal commitments spike to 90%, Alice's net claim capacity instantly shrinks to 100 hours. She may find her validated orders suddenly un-validatable.
* **If projects finish** and communal commitments drop to 10%, Alice's net claim capacity expands to 900 hours, unlocking new purchasing power retroactively.

#### C. The Share of the Material Pool
`net_claim_capacity` determines what Alice is *entitled* to. But what she can *actually withdraw today* depends on her share of the physical goods available right now.
Her `current_share_of_claims` is her net capacity divided by the sum of *everyone's* net capacity. Her `current_actual_claim` is that share multiplied by the physical `current_pool`.

### 5. Discontinuous Time & The Physical Envelope

Real material processes are rarely a continuous drip (like reactor cooling). Usually, they are discontinuous windows: "This harvest must be completed sometime in the next 10 days." 

To model this, we don't try to cram an entire Gantt-chart timeline into a single order. Instead:
1. **The Scenario** (the simulation layer) sequences events, projecting them into the future based on recipe dependencies.
2. **The Order** defines an exact temporal window and physical limits via three constraints:
   * `start_tick`: The simulation day on which it becomes physically possible to start work (the Availability Window).
   * `max_rate_per_day`: The physical limit on how fast work can be done (e.g., concrete curing time, combine harvester limits).
   * `deadline_tick`: The absolute final day by which `remaining_snlt` must hit 0.

#### The Waiting State
If a planner schedules an order on Day 1, but its `start_tick` is Day 30 (because it's waiting for earlier stages), the order is `'waiting'`. It does not draw from the material pool, nor does it maliciously accrue "catch-up" credit that would immediately drain the commune on Day 30. It lies dormant until physically available.

#### The Terrifying Material Reality

Combining these features creates a rigid **Physical Envelope**. 

If an order requires 50 SNLT, has a `max_rate` of 10 SNLT/day, and a deadline 5 days away from its start... it *must* run at max capacity every single day of its active window.
If the Commune's attention is pulled away by a metabolic crisis on Day 1, the order is paused.
On Day 2, there are 4 days left to deadline. 4 days * 10 SNLT/day = 40 possible SNLT. 
But 50 SNLT is required.

**The order is doomed.** It is physically impossible to complete it before the deadline, even if infinite daily capacity suddenly freed up.

When an order is doomed, the simulator fails it immediately and auto-spawns a **`consequence_on_fail`** order—usually a massive, Tier 1 emergency replacement order (e.g., "Famine Relief") that violently spikes the `communal_deduction_rate` and bankrupts individual purchasing power.

This forces planners to recognize that **some labor cannot be paused**. The system evaluates priority in two bands: 
1. **Crisis Prevention:** Orders with deadlines that must run *today* to avoid mathematical doom.
2. **Elastic Progress:** Orders that can safely pause and catch up later.

#### Quantifying Crisis Severity
What happens when a metabolic crisis occurs, but two critical harvests are *both* going to fail today unless they receive labor? 

Within the Crisis Prevention band, the qualitative Marxist deduction cascade (e.g., Replacement > Expansion) is abandoned. Instead, the simulator sorts by objective **Mathematical Severity**.

Severity is calculated as:
`Cost = [SNLT of the consequence order] + [SNLT progress already invested]`

The disaster that will cost society 10,000 SNLT to fix preempts the disaster that costs 100 SNLT to fix. The system mathematically optimizes survival.

### Summary of Elastic Adaptation

In this system, nothing is rigidly broken when crises occur or constraints are hit:
1. **Material Shortages (Pool Drops):** Communal projects accrue catch-up credit; individual physical withdrawals are proportionally squeezed, but their underlying entitlements remain intact.
2. **Social Crises (Communal Load Spikes):** Lower-priority communal projects are cleanly *preempted*; individual purchasing power *elastically contracts*.
3. **Recovery:** As the crisis passes, preempted projects resume, starved projects catch up (within physical limits), and individual purchasing power *elastically expands* back to its normal state.

The system acts as a perfectly resilient constraint simulator. It does not crash when the economy fails to meet the plan; it simply models the exact political and material compromises required to survive the day. By exposing the gap between what was planned (`planned_snlt`) and what actually happened (`actual_snlt`), we can test the true feasibility of any proposed economic plan.