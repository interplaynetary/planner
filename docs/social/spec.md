# **![][image1]**

# **Free Association**

# **Planner Process**

# **Design Goals**

`We are designing a decentralized/distributed planner that enables global cooperation.`

`It aims to try to resolve all needs at the most local level, resolving conflicts and optimizing at higher-levels.`

`This is not because all needs can be satisfied locally (today many countries have transferred most conditions of production - industrial manufacture etc. to other countries, creating international division of labor, and decreasing local resilience) but because our planner should aim to construct plans that allow most needs to be satisfied locally, of course while also aiming to satisfy other objectives like, labor-time reduction etc.`

`This orientation is essential to dissolving the division between town and country, and therewith the division between mental and physical labor.`

`Our planner is not aiming to find a globally optimal solution to need satisfaction (an impossible, un-tractable, NP-hard problem) based on the currently-existing global division of labor and globally uneven distribution of the conditions of production.`

`Moreover, it should be noted that in capitalism, it often only seems more “efficient” to outsource production to other countries because labor-time is (and is forcefully maintained to be, internationally and domestically) cheaper in those countries - people’s lives are literally valued less, this doesn't mean that these global supply chains are actually more efficient in terms of resource-usage or in terms of the actual total expenditure of human-labor-time.`

`The aim is to formulate good-enough plans that satisfy all constraints (metabolic sustainability etc.), and maximize all objectives, in such a way that is:`

- _`Tractable`_
- `massively parallel (planners can operate completely independently and simultaneously)`
- _`mergable`_ `& composable (planners and their plans can be merged and (de)composed seamlessly with conflict resolution)`
- `Characterized by exponential residual reduction (meaning that at each level we try to only deal with the smallest possible scope we need to resolve conflicts).`

**`Planner Objectives/Constraints:`**  
**`Across space-time:`**

- **`Objective: Maximize Independent Demand satisfaction`** `(ranked by criticality)`
- **`Constraint: Satisfy derived demands`** `(ranked by criticality)`
- **`Satisfy Replenishment (metabolic) demands`** `(ranked by criticality)`
- **`Satisfy`** `Reserve/Buffers demands (ranked by criticality)`
  - **`Satisfy`** `Control Point demands (ranked by criticality)`
- **`Constraint: Respect Max-Individual-Effort-Time/Day`** `(individuals classifiedAs child etc. enable granular limitations)`
- **`Objective: Minimize Total Socially Necessary Effort (SNE)`**
- **`Unit of Effort:`** `<Time>`

**\*`Local/global inversion:`** `every global constraint is a local objective. Planners try to satisfy all demands and emit surplus/deficit signals. Planner composition converts local failures into global constraints by routing surplus/deficit upward until resolved or declared genuinely infeasible. Infeasibility results in a local contraction of those dependent demands leading into those independent demands that are relevant to freeing up capacity needed to satisfy those constraints (in doing so attempting to distribute the load of net-sacrifice evenly: sacrifice determined by independent demand priority).`\*

`Note: while local/global inversion guarantees that plans resolved to the global level will satisfy metabolic constraints, strain on planners for solving these problems can be drastically reduced when the recipes being composed are themselves metabolically sustainable. Much of the politics of planning (with its consequences on ecology, working conditions etc.) resides in effectively restricting/filtering what recipes are to be considered in planning (i.e. monoculture vs permaculture, syntropic agroforestry etc.).`

`Our planner should also handle edge-cases, such as rare-earth metals etc. whose independent supply is known (via aggregation/indexing) to only be available in very specific space-times. These global bottlenecks should receive special treatment as they constrain valid plans (however this is not to imply necessarily a global division of labor for rare raw materials, for example: recipes can be formulated and plans created that can recycle and extract rare-earth metals from electronic waste (what's referred to as land-fill mining).`

`Our planner should also classify resources by their mode of consumption (communal or individually-claimable).`

`Our planner will only propose plans from codified knowledge. All plans it produces will be materially feasible given codified knowledge. However, coordination-bodies will be required to select/prune/modify those plans and the codified knowledge used during planning, drawing on the tacit (uncodified) knowledge in those coordination-bodies.`

**`On Coordination-Bodies:`**  
`Coordination-bodies should be composed so as to harness all tacit knowledge relevant to a planning scope in the selection/pruning/modification of plans generated by planners.`

`The way these coordination bodies are composed should allow for global constraints to be satisfied and for planners to find solutions quickly and effectively, staying responsive to local information.`

`A federation structure with disjoint membership (no entity can be part of more than one other entity), ensures minimal conflict resolution requirement, and has the least stress on planners with local/global inversion. A strict disjoint federation is not the only possible structure, but is the most efficient structure for achieving planner objectives/constraints with local/global inversion. Generally speaking, spatial continuity of the members of a coordination-body aligns well with the aforementioned design goals for the planner.`

`Participants in these coordination-bodies must remain embedded in and responsible to their communities — they must feel in their own lives the consequences of the decisions they make during plan merging. Otherwise, we create a professional planning class, and with it, the division between mental and physical labor reasserts itself in a new form.`

- `For example, the merge planner coordination-body for a region could be composed of temporarily elected delegates - with binding mandates, immediately revocable by electors - from local coordination-bodies, each bringing their plans and their mandate.`

`Knowledge Infrastructure must support coordination-bodies in their planning and be properly indexed so as to inform their decisions.`

# **General Process**

# **Draft Specification**

**`Aggregators/Indexes/Filters:`**  
`- Resources`  
`- Plan (re)-classifies resources according to their mode-of-consumption < communal | individual-claimable >`  
``- Socially Necessary Effort (SNE) Tracking: Moving Average of historical effort/unit (which always includes historical SNE cost of inputs to processes). The actual effort worked is recorded at the Observation Layer by the EconomicEvent (`action: 'work'`, tracked in `effortQuantity`). actual-effort moving-average informs average expected effort. EconomicEvents are spatio-temporally indexed in order to avoid gross-generalizations in SNE estimations.``  
`- Recipes define how to create/transform resources`  
``- SNE Tracking: In Valueflows RecipeFlow.effortQuantity (for `action: 'work'`), relates to expected-effort on average for a recipe.``  
`- Independent supply: current resource quantities across space (present tense)`  
`- Dependent supply: emerge from composing recipes from independent supply into Plans (exploratory search-space of what is possible, given existing independent supply).`  
`- Independent demands: desired resource quantities across space-time (present-future)`  
**`- Derived Independent demands`**`: derived from network data.`  
 `- For example: food/nutritional demand in a region as a function of population density/age.`  
**`- Dependent demands:`** `emerge from composing recipes (this is production expansion) into Plans to satisfy independent demands.`  
**`- Derived Dependent demands`**`:`  
`- Replenishment demands (classifiedAs) restore net-losses created by a Plan, up to - if specified - desired ranges (min/max) across space-time. This is metabolic sustainability.`  
 `- For example replenishing the nutrients taken from the soil during harvest, or repairing machines.`  
`- Reserves/buffers demands (classifiedAs) are untouchable except in emergencies.`  
`- Administration demands (classifiedAs) for Plan coordination & enforcement of resource usage-rights & responsibilities in accordance with Plan.`

**`Derived demands`** `are computed from actual consumption records of the primary planning pass. They cannot be pre-sorted alongside independent demands — they are not definite until primary planning is complete.`

**`Planning proceeds in two passes over the same PlanStore:`** `(1) independent demands, (2) replenishment/buffer/admin demands derived from Pass 1 consumption. Failure in Pass 2 = metabolic debt, qualitatively worse than unmet independent demand satisfaction.`

**`Planner Objectives/Constraints:`**  
**`Across space-time:`**

- **`Objective: Maximize Independent Demand satisfaction`** `(ranked by criticality)`
- **`Constraint: Satisfy derived demands`** `(ranked by criticality)`
- **`Satisfy Replenishment demands`** `(ranked by criticality)`
- **`Satisfy`** `Reserve/Buffers demands (ranked by criticality)`
- **`Constraint: Respect Max-Individual-Effort-Time/Day`** `(individuals classifiedAs child etc. enable granular limitations)`
- **`Objective: Minimize Total Socially Necessary Effort (SNE)`**
- **`Unit of Effort:`** `<Time>`

**\*`Local/global inversion:`** `every global constraint is a local objective. Planners try to satisfy all demands and emit surplus/deficit signals. Planner composition converts local failures into global constraints by routing surplus/deficit upward until resolved or declared genuinely infeasible, resulting in local contraction of those dependent demands leading into those independent demands that are relevant to freeing up capacity needed to satisfy those constraints (in doing so attempting to distribute the load of net-sacrifice evenly: sacrifice determined by independent demand priority).`\*

**`Social Recipient:`**
_`Any named entity within the social plan — a commune, a scope under Scope Committee management, a public works body, a school, a hospital, or a reserve — that receives outputs from a producing scope as part of a planned flow. A social recipient must be identified by name in the PlanStore; delivery to an unnamed entity is not social delivery and generates no validation. The social recipient's act of recording a confirmed receipt EconomicEvent in the PlanStore is the sole basis for social validation of the producing scope's labour. The social recipient may confirm partial quantity (e.g. accepting 80 of 100 units on quality grounds); only the confirmed quantity generates validation. Validation is bounded by the Planned Effort of the relevant work-intent.`_

**`Social Validation of Effort:`**

- **`The social recipient validates work-intent satisfaction`** `in a Process by recording a confirmed receipt EconomicEvent in the PlanStore. Validation is bounded by the Planned Effort of the work-intent: a recipient cannot validate more effort than the plan anticipated for that output.`
- **`recognition-of-contribution`** `is non-transferable and retractable by the recognizer (the social recipient).`
  - `A plan’s failure to produce desired outcomes is a risk shared by society. Process inputs/outputs are recorded and inform future plans. Reserves/buffers aim to limit the harm of failures.`

**`Capacity & Individual Claim Equations:`**

- **`Individual Claimable Resource Price = SNE/unit cost`**
- **`Total Socially Validated Contribution:`**  
  `total_social_svc = Σ(all socially-validated effort)`
- **`Total Pool Validated Contribution:`**  
  `<pool>_svc = Σ(SVC of all resources classified as <pool>)`  
  `Pool Examples: individual-claimable, replenishment, reserve/buffer, administration, unspecified, social-welfare. Recall, plans classify resources as belonging to these pools.`
- **`Individual Contribution Capacity Factor:`**
  `contribution_capacity_factor = f(age, health, caring responsibilities, etc.)`
  `*Ranges from 0 (unable to contribute) to 1 (full contribution capacity). Determined through participatory health and social assessment, not binary classification. This factor represents the degree to which a person is able to participate in socially-validated work, not a judgment on the value of their actual work.*`
- **`Social Welfare Fund:`**
  `sum_unmet_capacity    = Σ (1 − contribution_capacity_factor_i)`
  `sum_met_capacity      = Σ contribution_capacity_factor_i`
  `total_capacity_mass   = sum_met_capacity + sum_unmet_capacity`
  `welfare_allocation_rate = sum_unmet_capacity / total_capacity_mass`
  `social_welfare_fund   = individual_claimable_pool_svc × welfare_allocation_rate`
  `available_claimable_pool = individual_claimable_pool_svc − social_welfare_fund`
  _`The welfare allocation rate is self-computed from aggregate incapacity: the fraction of total capacity-mass that is unmet. No manual tuning — when all members are at full capacity the rate is 0%; when all are fully incapacitated it is 100%. The social welfare fund supplements the claim capacity of those with reduced capacity to contribute, without creating a separate track.`_
- **`Contribution-Based Claim (from actual work):`**  
  `contribution_claim = gross_contribution_credited × (available_claimable_pool / total_social_svc)`  
  _`This is what their actual work entitles them to from the contribution-based pool.`_
- **`Solidarity Supplement:`**  
  `solidarity_supplement = (1 - contribution_capacity_factor) × (social_welfare_fund / Σ(1 - contribution_capacity_factor))`  
  _`The welfare fund is distributed proportional to unmet capacity. This is a social dividend, not a wage adjustment. Everyone below full capacity receives a supplement scaled to their degree of incapacity; those at full capacity receive none.`_
- **`Total Claim Capacity:`**  
  `total_claim_capacity = contribution_claim + solidarity_supplement`
- **`Current Potential Claims:`** `Remaining capacity after claims are made.`  
  `current_potential_claim_capacity = total_claim_capacity - claimed_capacity`
- **`Social Share:`** `The individual's portion of total outstanding claims.`  
  `current_share_of_claims = current_potential_claim_capacity / social_total_potential_claims`
- **`Actual Claim Capacity:`** `The real-world purchasing power relative to the available individual-claimable pool.`  
  `current_actual_claim_capacity = current_share_of_claims × current_claimable_pool`

**`Resource Usage-Rights & Responsibilities:`**  
`Only Resources classified as Individual-Claimable can be transferred to agents classified as Person.`

`All other Resources are owned by the Universal Commune Federation, with usage-rights and responsibilities determined by recursive/compositional merging/resolution of Plans across the Universal Commune Federation according to Planner Process.`

`The plan is the complete record of who may do what, with what, and for whom. A responsibility is an obligation that appears in the plan: a derived demand for replenishment, a commitment to provide labor, a duty to deliver to another commune.`

`There is no right without a corresponding plan element. There is no responsibility that is not visible in the PlanStore.`

`When the plan changes, rights and responsibilities change with it. The planning process is the continuous renegotiation of all rights and responsibilities among the associated producers.`

# **Social Planning Process**

# **Draft Specification**

**`Citizen Index:`**  
`All persons residing within free-association. Managed by the Universal Commune as the guarantor of universal membership. The Citizen Index establishes the fundamental unit of political personality — the human being as such, prior to any particular association.`  
**`ID -> Citizen`**

**`Membership Index:`**  
_`All persons/communes residing within free-association. No double counting across communes. Records the actual associative choices of citizens — which communes they belong to, which federations those communes belong to.`_  
**`Citizen -> Commune`**  
**`Commune -> Commune`**

| `Federations form along whatever spatio-temporal attributes create actual metabolic interdependence. This could be: Spatial: Watersheds, climate zones, transport corridors, radiation belts (for space settlements) Temporal: Generational cohorts managing long-term waste, shift-based communities (24/7 infrastructure), seasonal migration patterns Functional: Supply chains (grain network federation), practice communities (agroecology schools), infrastructure grids (internet backbone) Cultural: Language areas, religious communities, indigenous nations (these have spatio-temporal dimensions too—territory, pilgrimage cycles, harvest festivals) Emergency Response: Fire seasons, flood plains, pandemic zones` |
| :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

**`Commune Citizen Shares:`**  
_`Derived from Membership Index by recursively counting citizens in commune (reducing commune hierarchy into citizens) Used to determine the weight of each citizen in commune-level decisions. Also, used for calculating equitable distribution of sacrifice and benefit across all individuals.`_  
**`Commune -> {`** \*`citizen: proportion ... }`

**`Commune Shares:`**  
_`Derived from Membership Index by recursively counting citizens in communes, from bottom-up, (retaining commune abstraction) Used for determining voting weights in federation assemblies where communes vote as units. Ensures that federations reflect the demographic weight of their constituent communities.`_  
**`Commune -> {`** \*`member-commune: proportion , member-citizen: proportion ... }`

**`Universal Commune:`**  
_`Membership List auto-generated from those entities that are in Membership Index and are not a member of any higher order structure. Membership List & Commune Shares for Synthetic Commune are stored separately from other Indexes.`_

- **`Responsibilities:`**
  - _`Management of the Citizen Index, guaranteeing that no person falls outside the human community regardless of their associative choices.`_
  - _`Coordination of matters that affect all humanity: atmospheric carbon, ocean health, outer space, management of the global commons, pandemic response, and other planetary-scale interdependencies.`_

`Unlike intermediate federations, withdrawal from the Universal Commune is impossible. It is the expression of our inescapable mutual interdependence as inhabitants of a single planet. Freedom of association operates within this frame, not against it.`

`The Universal Commune maintains no standing army, no permanent bureaucracy, and no power of taxation.`

**`Communes:`**

- **`Rights:`**
  - **`Decisions:`** `for all Commune Members on matters internal to the commune`
  - **`Immediately-Revoke:`**
    - **`Members`**
      - `Participants`
      - `Communes`
    - **`Commune-Agents`**
      - `Delegates with Imperative Mandates (Binding Instructions)`
      - `Observers of Social Planning Processes`
  - **`Communicate:`** `Publish all doings and shortcomings`
  - **`Withdraw:`** `The right to withdraw from any commune/intermediate federation. This right is the expression of freedom of association among communes. Withdrawal is subject to: (1) withdrawal does not dissolve obligations incurred during membership — these must be honored through the planning process until settled, or a new federation plan voids previous obligations; (2) withdrawal severs the federation's authority over the commune for all future matters; (3) the consequences of withdrawal become visible in the planning process, enabling the commune to make an informed decision; (4) withdrawal from all intermediate federations does not constitute withdrawal from the Universal Commune, which guarantees universal membership.`
- **`Responsibilities:`**
  - **`To electorate:`** `Publication of proceedings`
  - **`To federation:`** `Abide by federation decisions on matters within the federation's delegated authority. Where a federation decision conflicts with a commune's binding instructions on a matter outside the federation's authority, the commune may seek judicial review.`
  - **`To external-constituency:`** `Consider interests of affected non-members in decision-making. Where a commune's decision materially affects non-members, those affected have standing to participate in the deliberation through procedures defined by the relevant federation.`

**`Recall Procedure:`**

- `Any member may initiate a recall of commune agents. Recall vote triggered by petition threshold. Commune Agent suspended pending vote outcome.`
- `Threshold: 5% of electorate signature required`
- `Timing: Recall vote held within 30 days`
- `Outcome: Simple majority removes delegate`

**`Citizenship Procedure:`**

**`Citizen:`**

- **`Rights:`**
  - **`Request`**
    - **`Membership`**`: in a commune.`
  - **`Withdraw:`** `The right to withdraw from any intermediate federation. This right is the expression of freedom of association among communes. Withdrawal is subject to: (1) withdrawal does not dissolve obligations incurred during membership — these must be honored through the planning process until settled, or a new federation plan voids previous obligations; (2) withdrawal severs the federation's authority over the commune for all future matters; (3) the consequences of withdrawal become visible in the planning process, enabling the commune to make an informed decision; (4) withdrawal from all intermediate federations does not constitute withdrawal from the Universal Commune, which guarantees universal membership.`
- **`Responsibilities:`**

**`Delegates:`**

- **`Rights:`**
  - `Represent electors in Commune or Federation Assembly`
  - `Vote on decisions`
  - `Access to all planning tools, including the PlanNetter capability for their level of federation`
- **`Responsibilities:`**
  - `Abide by binding instructions (mandat impératif)`
  - `Accept immediate revocability`
  - `Perform legislative & executive work`
  - `Maximum term: 2 years before requiring re-election. No individual may serve more than 4 years in any 8-year period in the same federation level.`

**`Affected Interest Group:`**  
_`Any individual or commune materially affected by a decision under consideration has standing to participate in the deliberation. Material affect is determined by tracing the consequences through the planning network: who will bear costs, who will receive benefits, whose conditions of existence will be altered. Procedures for affected interest participation are defined by the relevant federation and must include: (1) notice to affected parties, (2) opportunity to present evidence and argument, (3) consideration in the final decision, with reasons given for acceptance or rejection of affected interests' positions.`_

**`Planning-Based Dispute Resolution:`**  
_`When a commune alleges that a federation decision exceeds proper authority, or when communes disagree on the terms of cooperation, the dispute shall be resolved through iterative planning, not adjudication.`_

_`The process:`_

1. **`Delegates convene`** `with their communes' PlanStores and binding instructions.`
2. **`They merge their PlanStores`** `and run the planner at the federation level, treating the disputed matter as an unmet demand to be satisfied.`
3. **`The planner produces one or more feasible resolutions`** `— plans that satisfy all constraints and respect priority rankings to the greatest extent possible.`
4. **`Delegates return to their communes`** `with the proposed resolutions, along with full planning data showing the consequences for each party.`
5. **`Communes deliberate`** `and either:`
   - `Reject all resolutions and propose modifications`
   - `Withdraw from the disputed aspect of cooperation, accepting the consequences of withdrawal`
6. **`If modifications are proposed, delegates reconvene`** `with updated instructions and PlanStores, and repeat from step 2.`
7. **`If withdrawal occurs, the planning process automatically adjusts`** `— the withdrawing commune's commitments are treated as unmet demands to be satisfied by other means, and its expected receipts are written off as supply to be redirected.`

_`There is no binding decision external to the planning process. There is no judge. There is only the logic of interdependence, made visible through the planner, and the free choice of associated producers to accept, modify, or withdraw from the terms of cooperation.`_

_`Convergence is not guaranteed, but it is strongly encouraged by the consequences of non-cooperation. A commune that consistently blocks mutually beneficial plans will find itself isolated, its PlanStore showing growing deficits, its members facing harder choices.`_

**`On the Settlement of Obligations Upon Withdrawal:`**  
_`When a commune withdraws from a federation, it remains responsible for obligations incurred during membership until those obligations are settled through the normal functioning of the planning system. The federation retains a record of outstanding commitments, which are treated as independent demands on the withdrawing commune. The withdrawing commune continues to receive resources it is owed until accounts are balanced within the existing plan, or a future plan voids (mutual) obligations. This is not punishment but the honoring of mutual commitments. The planning process itself—the two-pass system, the surgical retraction, the local/global inversion—handles the settlement without need for special enforcement mechanisms. Once all obligations are settled within a given plan, the commune's relationship to the federation ceases entirely, except for its continuing membership in the Universal Commune.`_

**`On Enforcement:`**  
_`There are no permanent enforcers. The primary enforcement mechanism of the Universal Commune Federation is the planning process itself: obligations that are not honored appear as unmet demands, deficits accumulate, and the consequences become visible to all. Communities that consistently fail to honor commitments will find cooperation difficult, and likely find their PlanStores showing growing imbalances.`_

_`In the rare cases where physical intervention is necessary to prevent imminent harm—violence, destruction of common resources, violation of bodily integrity—any citizen may act to prevent such harm. Such actions are immediately reviewable by the affected commune's assembly, which may confirm, modify, or repudiate them. Repeated need for physical intervention in a community indicates a failure of planning or of social relations, to be addressed through the planning process itself.`_

_`The Universal Commune maintains no standing army, no police force, no permanent enforcers. The only legitimate use of force is that which arises spontaneously from the associated producers in defense of their common life, and it returns immediately to the producers once the threat is past.`_

# **Planner Process**

# **Draft Technical Specification**

**`Dependent Demand:`** `Backward recursion from (specId, qty, neededBy). Explodes recipes toward present; back-schedules Processes by recipe duration; creates Commitments/Intents per I/O. purchaseIntents for specs with no recipe.`

**`Dependent Supply:`** `Forward recursion from (specId, qty, availableFrom). Propagates through recipes to terminal outputs; creates Processes and Commitments/Intents. surplus[] = supply no recipe absorbed.`

**`Both:`** `Share a PlanNetter per invocation. allocated Set bridges the two passes — demand claims sources first; supply routes around pre-claimed consumptions.`

---

**`Utilities:`**

- **`HexIndex:`** `H3-based hierarchical spatial index over Slots. Querying a cell returns items at that cell and all finer sub-cells within it. Resolution determines spatial granularity of demand/supply visibility.`
- **`Space-Time Keys:`** `(atLocation: SpatialThing ID, neededBy / availableFrom: ISO date). Propagate through BFS — location through sub-demands; time back-scheduled from due date by recipe duration.`
- **`H3 Utilities:`** `getCellsInRadius(cell, km) | cellsCompatible(cell1, cell2, km) | H3_EDGE_LENGTHS_KM[res]. Wrap h3.gridDisk / h3.gridDistance. Planner uses these — never raw H3 calls.`

**`IndependentDemandIndex:`** `Snapshot of open demand slots at t=0. Pre-planning — correct before any allocation. Answers: what demand exists, where, how much remains, when due.`

**`IndependentSupplyIndex:`** `Snapshot of available supply (inventory | scheduled receipts | labor) at t=0. Answers: what supply exists, where, how much, when available.`

- `Snapshot vs. live: IndependentSupplyIndex = supply landscape at t=0. PlanNetter = t=0 − allocated + new output flows from this run.`

**`PlanStore:`** `Per-invocation, region-scoped. Holds Plans | Processes | Commitments | Intents. No global store.`

- `Mergeable: planStore.merge(sub) imports another store's records. Coordination between regions emerges from merge planners only.`
- `Observer must also be mergeable across regions — the same compositionality that applies to PlanStore applies to the observation layer beneath it.`

**`PlanNetter:`** `Per-session soft-allocation ledger. Reads Observer + PlanStore; never mutates either.`

- **`netDemand(specId, qty, opts?):`** `Claims inventory + scheduled outputs. Marks source IDs in allocated.`
- **`netSupply(specId, qty, opts?):`** `Absorbs scheduled consumptions. Marks consumption IDs in allocated.`
- **`netAvailableQty(specId, opts?):`** `READ-ONLY — inventory + outputOf flows − inputOf flows.`
- `allocated: Set<id> — prevents double-claiming across all calls within one session.`

---

**`Planner — planForRegion(cells, horizon, ctx, subStores?)`**

- **`Phase 0 — Normalize:`** `Deduplicate input H3 cells. A cell is dominated if any ancestor appears in the set. Remove dominated. Result: non-overlapping canonical cover; no slot loaded twice.`
- **`Phase 1 — Extract:`** `queryDemandByRegion + querySupplyByRegion over canonical cells. Horizon filter (from, to) applied to slot.due. H3 cells used only here — not involved in planning.`
- **`Phase 2 — Classify:`** `Each open demand slot: locally-satisfiable | transport-candidate | producible-with-imports | external-dependency. Locally satisfiable planned first (cheapest, no transport overhead).`
- **`Phase 3 — Formulate:`** `One PlanNetter per invocation. Caller decides plan granularity — not grid-derived.`
  - `Pass 1 (primary): all pre-existing demands sorted by D-category then due date. dependentDemand per slot; netter.allocated grows from highest priority down.`
  - `Compute: endogenous replenishment demands from Pass 1's consumption records (consumed qty × replenishment rate per spec). These did not exist before Pass 1.`
  - `Pass 2 (derived): replenishment + buffer demands against remaining capacity. Same PlanStore, same netter — no merge step needed.`
  - `Backtrack (if metabolicDebt after Pass 2): walk Pass 1 allocations in reverse priority (lowest D-category first, latest due date first within category). Retract process subgraphs (by provenanceId) until freed capacity covers unmet replenishment qty. Re-explode retracted demands against newly freed capacity — their shortfall becomes unmetDemand[]. If metabolicDebt persists after exhausting all lower-priority retractable allocations, escalate to a merge hierarchy.`
  - `Phase B (Supply): unabsorbed supply (not in allocated) forward-scheduled via dependentSupply.`
- **`Phase 4 — Collect:`** `purchaseIntents[] | surplus[] | unmetDemand[] | laborGaps[]`

**`Merge Planner:`** `Same planForRegion with subStores provided. Merges sub-PlanStores; runs Phase 3 Formulate treating leaf unmetDemand[] + metabolicDebt[] signals as new demand inputs. dependentDemand at inter-region scope — can traverse into a neighbour region's capacity, discover transport or production recipes, and back-schedule their full dependency chain as sub-demands. The inter-region supply being routed may itself be the output of a dependent production chain, not just inventory — dependentSupply runs forward from unabsorbed inter-region capacity to discover what could be produced. PlanNetter initialised from merged PlanStore: netter.allocated contains all leaf allocations; inter-region processes claim only unallocated capacity. Surgical retraction can reach into any leaf's allocations to liberate capacity on the inter-regional dependency path. Leaf planner = subStores = [].`

- **`Conflict Detection:`** `Scan merged PlanStore after formulation. Types: inventory over-claim (Σ committed qty > onhandQuantity) | receipt over-claim | capacity contention (Σ committed effort > available labor capacity for agent/period). Transport process explosion may introduce capacity contention without any inventory over-claim — both must be detected.`
- **`Surgical Resolution:`**
  - `Identify contested resources: trace the inter-regional demand's dependency path (dependentDemand subgraph). Contention points = resources/capacities where that path conflicts with existing allocations. Retraction candidates = existing allocations competing for those specific contested resources — targeted to the dependency path, not a blind global priority walk.`
  - `Retraction unit = process subgraph (by provenanceId). Among candidates, retract in reverse priority (lowest D-category first, latest due date first within category). Stop retracting as soon as freed capacity resolves each contention — minimize net sacrifice.`
  - `Retract: planStore.removeWhere(provenanceId) on merged store. Rebuild PlanNetter from post-retraction state (vacated supply + freed capacity now visible again).`
  - `Re-explode at merge scope: dependentDemand on each retracted root demand at full inter-region resolution → fallback ladder: alt local inventory → transport recipe → scheduled receipt → production → purchaseIntent. Re-exploded demands gain visibility into inter-region supply routes unavailable at leaf level — net sacrifice is often less than gross retraction.`
  - `Cascade: detectConflicts() again. If new conflicts → extend retraction set, repeat. Termination: detectConflicts() = [].`
- **`Recursion:`** `Merge planner PlanStores may themselves conflict → planForRegion for their union. Depth bounded by region nesting (typically 1–2 levels). metabolicDebt[] signals routed with elevated priority over unmetDemand[] at every merge level.`

| `Key Properties: Three orthogonal axes: H3 cells, PlanStore, and Plans do not constrain each other. Cells scope what data gets loaded (Phases 0–2). PlanStore is owned by an invocation and corresponds to its region. Plans are organizational labels for logical work groupings — they can span many cells or many Plans can exist within one cell. The PlanNetter is the consistency boundary, not the Plan. PlanStore is region-scoped, not global: Each planForRegion invocation owns its own PlanStore corresponding to its region. There is no single global store. Coordination between planners happens only when a merge planner is created for a region that spans both. Parallelism is maximal at the leaf: Leaf planners share nothing — no coordination, no shared state, no locks. Conflicts between them are only visible (and only matter) when someone asks for a higher-order region that spans both. If no one ever asks for that larger region, the leaf PlanStores coexist independently. Merge = a planner for the union region: Resolving conflicts is not a special operation — it is a planForRegion call that happens to receive sub-PlanStores. The function is the same. The difference is the starting state of the PlanStore (merged vs. empty). Resolution is surgical, not global re-computation: The merge planner retracts only the specific commitments above the availability threshold and re-explodes only the demand fragments those commitments were serving. Sub-PlanStores are not modified. The rest of every Plan is preserved in the merged PlanStore. Substitution is emergent: When a retracted fragment is re-exploded, dependentDemand tries the next available option on its own fallback ladder — alt inventory → transport → scheduled receipt → production recipe → purchase intent. The merge planner provides no guidance on which substitute to use; it only ensures the retracted resource is no longer available in the netter. Recursion is shallow in practice: Most conflicts are between adjacent leaf regions and resolve in a single merge step. The hierarchy only recurses up when a merge planner's PlanStore itself conflicts with another region's — bounded by the nesting depth of overlapping regions, typically 2–3 levels. Indexes are the scoping filter; they are never mutated: The demand and supply indexes tell the planner what exists and where — before any allocation. After a planning cycle, rebuild the indexes from the updated PlanStore state(s) before the next horizon.` |

# **Infrastructure**

# **Draft Specification**

**`Infrastructure Operators:`**  
_`Infrastructure operators (Aggregators/Indexers/Planners etc.) are responsible for applying filters to constrain what demands/recipes are considered/propagated.`_

- _`They are wholly responsible for filtering so as to conform to technical, social, legal limitations.`_
- **\*`Labellers`** `can be deployed to aid in filtering/moderation.`\*
- **`PDS (Personal Data Server)`** `Hosts user accounts and personal data under <host/self-hosted> Terms of Service and Privacy Policy. Users hosted can migrate away at any time while keeping their identity and social graph. Promotes independence from others by giving users options in alternative hosting providers with their own governance and moderation policies.`
- **`Migration Tool`** `(@tektite.cc) Simplifies the process of migrating accounts from Bluesky's PDS to other hosts without losing data or identity. Promotes independence by making it easy for users to leave Bluesky's hosting while maintaining their social presence.`
- **`Exported Data Explorer Tool`** `(https://satnav.rsky.dev) for exploring CAR files (Content Addressable aRchives) - your exported AT Protocol data. Makes user data portable and human-readable. Promotes independence by ensuring users can access and understand their own data outside of any platform.`
- **`Relay & Moderation Relay`** `(atproto.africa) A full-network relay built from scratch in Rust that streams all network activity with a 3-day backfill window and PLC cache. Also hosts a moderation relay that replays all moderation labels network-wide that have ever been made, making it easy for developers to consume labels from multiple mod services. Promotes independence by enabling anyone to access the entire AT Protocol firehose and aggregated moderation data without relying on other’s infrastructure.`
- **`Indexes/Aggregators/Filters`** `(app-views) AppViews are a specialized service within the AT Protocol that processes and indexes network data to provide application-specific functionality. It sits at the top layer of the protocol's architecture, consuming relay firehoses and hydrating repository data into useful, queryable data tailored to specific social applications. The AT Protocol's architecture allows for multiple AppViews serving the same content to exist simultaneously, each potentially offering different features, moderation policies, or performance characteristics. The goal of this architecture is to provide a "credible exit" for users, allowing them to switch to alternative AppViews that better align with their preferences if they become unhappy with their AppView of choice. This flexibility extends to developers as well. Different social applications built on the AT Protocol can create their own specialized AppViews that interpret and index repository records according to their specific needs, while still leveraging the same underlying Personal Data Server (PDS) and relay infrastructure.`

# **Transitional Strategy**

# **Draft Specification**

**`Communization of Knowledge:`** `The goal is that no community, however isolated, should lack access to the sum total of human productive knowledge.`

- **`Open Recipe Libraries:`** `Indexed by SNE, metabolic impact, and bioregional suitability.`
- **`Key Components:`** `OpenSourceEcologies, Documentation, Translation, and other key recipes.`

**`Transition in Low-Income Regions:`** `Produce enormous wealth, but that wealth leaves. They work hard, but their own needs remain unsatisfied because what they produce is shipped elsewhere.`

- **`Strategic Priority: Reorienting production from export markets toward local need satisfaction by connecting existing producers, retaining surplus locally, and building missing capacity — starting with food, basic goods, and infrastructure.`**
- **`Effect: Withdraws from unequal exchange, builds alternative circuits of production and distribution, raises living standards through retained wealth, creates material pressure on high-income regions to restructure or face collapse of cheap imports, and transforms dependency into interdependence on equitable terms.`**

**`Transition in High-Income Regions:`** `High-income regions face a specific contradiction: they import most real goods but have idle labor and resources.`

- **`Strategic Priority:`** `Organizing the unemployed and precariously employed to meet local needs through local production using open recipes.`
- **`Effect:`** `Reduces import dependence, builds alternative institutions, demonstrates planner capability, creates material pressure on wages in the remaining market sector, and prepares the ground for deeper transition when crisis hits.`

**`Scope Committees:`** `Scopes are spatial assemblages of economic resources — factories, farms, mines, transport networks, research institutions. Scope Committees are elected by workers within a scope to steward the transition of production.`

- **`Rights:`**
  - **`Decisions:`** `for all scope-participants on matters internal to the scope's production process, subject to federation decisions on matters of broader interdependence`
  - **`Immediately-Revoke:`** `scope-participants (committee members), delegates to parent-scope assemblies, technical consultants`
  - **`Access:`** `Full visibility into all scope operations, including: business secrets, financial records, supply contracts, customer lists; technical specifications and recipes; maintenance schedules and equipment condition; labor processes and skill inventories; input sources and output destinations`
  - **`Communicate:`** `Publish all doings and shortcomings — to workers within the scope, to the parent federation, to the public`
  - **`Inspect:`** `Send observers to suppliers, customers, and related scopes to trace connections`
  - **`Propose:`** `Alternative production plans, repurposing of equipment, disassembly recipes`
  - **`Withdraw:`** `The right to initiate withdrawal from a federation, subject to settlement of obligations`
- **`Responsibilities:`**
  - **`To electors (scope-participants):`** `Faithful execution of binding mandates, regular reporting and open meetings, publication of all records obtained through access rights, economic literacy training — turning all workers into planners`
  - **`To federation:`** `Provide accurate capacity data, abide by delegated decisions, seek planning-based dispute resolution where federation authority is contested`
  - **`To external-constituency:`** `Grant standing to materially affected non-workers; consider interests of downstream communities, neighbors, future inhabitants`
  - **`To the movement as a whole:`** `Prepare for direct workers' management when conditions permit. Document all learning — create recipes for how other scopes can do the same.`

**`Scope Committee Tasks:`**

| `Phase`                  | `Activity`                                                                                                                                                                                                                                              |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Infiltration & Mapping` | `Workers use their access rights to document everything. Not passive observation — active investigation. Where do inputs come from? Where do outputs go? Who decides? What skills exist? What's hidden? Build the real PlanStore from below.`           |
| `Exposure`               | `Publish business secrets. Make visible to all workers — and to society — the actual accounts: what capitalists extract, what gets wasted, what's squandered through anarchy and profit-seeking.`                                                       |
| `Control`                | `Begin intervening. Not yet management, but oversight. Challenge decisions that harm workers or communities. Use visibility to show consequences. Build worker confidence and competence.`                                                              |
| `Planning`               | `Develop alternative plans from within the scope. Show what could be produced, how work could be organized, what would change if workers managed. Use the same planning tools — PlanNetters, indexes, recipes — but now with real data from inside.`    |
| `Management`             | `When conditions permit — when the old power is broken or withdrawn — transition from control to direct management. The committee becomes the managing body. The PlanStore becomes binding. The scope operates as a cooperative within the federation.` |

**`Scope Committee Composition:`**

- **`Elected Delegates:`** `Workers from within the scope, chosen by their peers, immediately revocable, bound by imperative mandate`
- **`Technical Consultants:`** `Accountants, statisticians, engineers, scientists, and others called in as needed — as advisors, not decision-makers. Selected for sincere devotion to the people, not for technocratic authority.`
- **`Affected Interest Representatives:`** `Where scope operations materially affect non-workers (neighbors, downstream communities), those affected have standing to send observers or delegates with limited participation rights defined by the relevant federation.`
- **`Scope Hierarchy:`** `Workplace -> Enterprise -> Branch -> Regional -> National -> International.`

- **`Dual Power Within the Scope:`** `At first, the Scope Committee changes nothing about ownership or legal authority. The capitalist still owns; the manager still manages; the shareholder still extracts. But every decision can now be scrutinized, every secret exposed, every lie countered with visible truth. This cannot last. The committee either:`
  1. `Accumulates power (through production, worker loyalty, militia strength) until it displaces the capitalist.`
  2. `Is co-opted (incorporated into management, separated from workers) and becomes a new layer of control. Co-optation signal: if wage_rate_normalized for committee members diverges upward from workers', the committee is separating from those it represents.`

**`Gradual Transition Within the Scope:`** `A scope cannot sever market connections overnight without collapse. Its current operation depends on inputs bought on markets and outputs sold on markets. Transition from capitalist operation to associated production must be gradual, deliberate, and safe.`

**`Two Plans, One Scope:`**

| `Plan`         | `Description`                                                                                                                                                                                                                   |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Current Plan` | `The plan that actually governs production today. Inputs sourced from markets, outputs sold to markets, labor organized according to capitalist command. The Scope Committee maps it, exposes it, but does not yet control it.` |
| `Desired Plan` | `The plan the workers would implement if they managed. Inputs chosen for metabolic sustainability, outputs chosen for social need, labor organized cooperatively. Replenishment demands honored. Reserves maintained.`          |

_`The gap between Current Plan and Desired Plan is the measure of capitalist distortion. Closing that gap is the work of transition.`_

**`Three Classes of Plans:`**

| `Class`            | `Feasible Without Social Plan?` | `Feasible With Social Plan?` | `Transition Path`                                                                                                                     |
| :----------------- | :------------------------------ | :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `Autonomous`       | `Yes`                           | `Yes`                        | `Implementable immediately. First steps — low-hanging fruit requiring no federation coordination.`                                    |
| `Social-Dependent` | `No`                            | `Yes`                        | `Cannot be implemented until the federation provides inputs or absorbs outputs. These become demands on the social plan.`             |
| `Infeasible`       | `No`                            | `No`                         | `Cannot be implemented with current technology or resources. Set aside but not forgotten — may become feasible as conditions change.` |

_`Scope Committees prioritize Autonomous plans first — they build momentum and deepen worker commitment. Social-Dependent plans are brought to the federation. Infeasible plans are held as a horizon.`_

**`Social Plan as Enabler:`** `The federation of scopes exists to enable transitions that individual scopes cannot accomplish alone. Its role is not to command, but to supply and absorb.`

- **`Supply-Side Support:`** `When a scope's Desired Plan requires inputs not available through markets (sustainably grown cotton, non-toxic dyes, repairable components), the federation searches for scopes that can produce them. If none exist, it may seed new production.`
- **`Demand-Side Support:`** `When a scope's Desired Plan produces outputs that markets won't buy, the federation becomes a customer — distributing outputs to other scopes, social consumption (schools, hospitals, public works), or reserves. It provides labor, replenishment, resources that keeps the producing scope viable.`

_`The social plan's capacity grows as more scopes join, as more Autonomous plans succeed, as more Social-Dependent plans are attempted and validated.`_

**`Communal Satisfaction of Need:`** `The social plan does not only produce goods for individual claim — it also satisfies needs communally. Housing, healthcare, childcare, food security, public transport: when these are provided as collective goods by the social plan, workers no longer purchase them individually on the market.`

_`Communal satisfaction of need is distinguished from market satisfaction of need not by the goods themselves but by the social relation: market satisfaction binds need to dollar income, creating dependence on employment and wage-setting. Communal satisfaction dissolves that binding — need is met through collective production, validated by use, not priced.`_

_`This creates a positive feedback loop within the transition:`_

1. _`As communal provision expands, communal_need_coverage[i] rises and uncovered_essential_expenses[i] falls.`_
2. _`The minimum viable dollar wage falls — workers can tolerate a lower dollar wage without real hardship because survival needs are no longer market-dependent.`_
3. _`Lower minimum viable dollar wage reduces resistance to increasing social_output_fraction (which reduces market revenue and thus dollar wages).`_
4. _`Faster transition deepens the social plan's productive capacity, enabling further communal provision — closing the loop.`_

_`This feedback runs independently of the substitution ratio. A scope can have a balanced substitution ratio while communal_satisfaction_ratio rises steadily, signaling deepening transition even where individual compensation appears stable.`_

_`The effect is strongest in low-income regions, where a larger fraction of current market income covers bare essentials. A worker spending 60% of their wage on housing, healthcare, and childcare is far more sensitive to dollar wage reductions than one spending 10%. Communal provision of those three essentials alone can transform the political economy of transition without touching the individual claims pool.`_

_`The individual claims pool remains a distinct category — it is not diminished by communal provision. Its character changes: as communal coverage absorbs survival goods, the claims pool shifts from a survival instrument to a discretionary one. Workers use it for cultural goods, personal tools, travel, and non-essential consumption. This shift, visible in the Observer's data, marks one of the clearest signs that a scope's transition is deepening.`_

**`Gradual Substitution Ladder:`** `For each input or output targeted for substitution, the scope climbs a ladder of increasing social integration. The transition is not smooth:`

| `Rung`             | `Description`                                                                                                                                                         |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1. Observation`   | `Map flows, identify opportunities. Build the real PlanStore from below.`                                                                                             |
| `2. Partial Trial` | `Social plan supplies/absorbs ~10% on trial basis.`                                                                                                                   |
| `3. Evaluation`    | `Assess quality, reliability, metabolic cost. Fall back to market if the social plan fails to deliver.`                                                               |
| `4. Expansion`     | `Increase social fraction to 25%, then 50%, 75%, 90% over successive cycles.`                                                                                         |
| `5. [CONFLICT]`    | `The capitalist refuses further concessions, the state intervenes, or strikebreakers cross picket lines. Advance becomes blocked.`                                    |
| `6. Defense`       | `The workers' militia appears. The committee defends its right to exist and to transition. PlanStores and assemblies are protected.`                                  |
| `7. Consolidation` | `After conflict resolves — through capitalist flight, expropriation, or negotiated settlement — the committee secures management. The Desired Plan begins to govern.` |
| `8. Full Social`   | `Social plan supplies/absorbs 100%. The scope operates as a cooperative within the federation.`                                                                       |

_`At any rung before Conflict, if the social plan fails to deliver, the scope falls back to the market. This safety net is essential — it allows ambitious transition without catastrophic risk.`_

**`Conflict Between Current and Desired:`** `The scope operates two plans but has one set of machines, one workforce, one flow of inputs and outputs. When the plans compete for the same resources:`

- **`During Control Phase:`** `The capitalist's plan prevails. Conflict is pedagogical — it reveals the gap between what is and what could be.`
- **`During Transition Phase:`** `The scope begins implementing Autonomous plans alongside the capitalist's plan. Conflict is managed through negotiation and worker pressure.`
- **`During Management Phase:`** `The capitalist is gone. Conflict is internal — between worker preferences, technical possibilities, ecological constraints — resolved through democratic process.`

**`Scope Committee Observer Procedure:`** `The Observer measures the gap between Current and Desired plans. The Observer publishes all findings openly, making visible how much output goes to the social vs market and comparing expected compensation. The numbers serve as an organizing tool for assemblies and public meetings, not just a technical calculation.`

- **`Physical Flow Fractions:`**
  - `social_input_fraction = social_inputs / total_inputs (fraction of inputs sourced from the social plan)`
  - `social_output_fraction = social_outputs / total_outputs (fraction of outputs dispatched to named social recipients)`
  - `confirmed_output_fraction = confirmed_social_outputs / total_outputs (fraction confirmed received via EconomicEvent in the PlanStore)`
- **`Input Substitution Mechanisms:`** `(three ways social_input_fraction increases)`
  - **`New social provider:`** `The federation creates or seeds a new socially-organised source for this input. Slow to establish; deepens the social plan's productive base permanently.`
  - **`Supplier partial transition:`** `An existing supplier's own Scope Committee redirects a fraction of their output to the social plan. Both scopes advance their fractions together; their trajectories are coupled.`
  - **`Dollar bridge:`** `subsidy_received from the federation covers market input costs while input substitution capacity is being built. Does not increase social_input_fraction — inputs still come from market. A bridge, not a destination: dollar subsidies without concurrently expanding the social claim pool creates dependency, not transition.`
- **`External Solvency Constraint (Generalized):`**
  - `(market_revenue + social_cash_revenue + subsidy_received + other_external_inflow) ≥ (market_input_cost + social_input_cash_cost + dollar_wage_bill + other_costs + contribution_sent)`
  - _`Where other_external_inflow includes barter, foreign currency other than dollars, etc.`_
- **`Labor Validation:`**
  - `hours_worked[i] — pre-split total: the worker's full hours for the period before any social/market fraction is applied. All splits are derived calculations on top of this number.`
  - `validated_hours[i] = confirmed_output_fraction × hours_worked[i] (automatic once the recipient records receipt; bounded by the Planned Effort of the work-intent)`
  - _`Validation is based on plan fulfillment, not revenue. The recipient confirms that the planned quantity was delivered — not that a particular price was obtained. Price outcomes affect collective funds, not individual validation.`_
  - _`For exports, the federation (or appropriate collective body) acts as social recipient. It confirms: (1) that planned export quantities were delivered, (2) that external payment was received in whatever form. The resulting dollar or barter revenue enters the collective import fund, not individual wages. This mechanism works identically whether the recipient is a market customer (current-state), a commune (transition), or the federation managing exports (advanced transition) — the recipient becomes more collective over time, but the validation mechanism is unchanged.`_
  - _`Validation originates with the recipient, not the producing scope. Unconfirmed deliveries — due to quality failures, delivery shortfalls, or disputes — generate no claim. If confirmed_output_fraction lags social_output_fraction, workers' claim capacity falls below expectation, creating material pressure to resolve the gap.`_
- **`Compensation Equations — Revised:`**
  - **`Dollar Wages (Transitional, Phase-Out Model):`** `dollar_wage_phase_out_factor = max(0, 1 − (communal_satisfaction_ratio / target_ratio)) total_dollar_wages = (1 − social_output_fraction) × total_output_market_value × labor_share_of_revenue × dollar_wage_phase_out_factor wage_rate_normalized[i] = hourly_rate[i] / average_hourly_rate dollar_wage[i] = total_dollar_wages × (hours_worked[i] × wage_rate_normalized[i]) / Σ(hours_worked[j] × wage_rate_normalized[j])` _`When communal_satisfaction_ratio reaches target_ratio (democratically determined), dollar_wage_phase_out_factor → 0 and dollar wages cease entirely. Workers have agreed: social provision now meets all essential needs; all external revenue becomes collective. The target_ratio is not a technical parameter — it is the democratic assertion that the social plan is sufficient.`_
  - **`Claim Capacity (Unified — applies to ALL validated work):`** `total_social_svc = Σ validated_hours[i]   # includes export work validated by federation claim_capacity[i] = validated_hours[i] × (available_claimable_pool / total_social_svc) + solidarity_supplement[i]` _`Every hour of socially-validated work, regardless of destination (local social recipient or federation-validated export), generates the same claim capacity. This is the core: the social plan does not distinguish between producing for a neighbouring commune and producing for export — both are socially necessary, both are validated, both are compensated equally.`_
  - **`Communal Need Coverage:`** `communal_need_coverage[i] — the market cost equivalent of essential goods and services (housing, healthcare, childcare, food security, public transport) that the social plan provides communally to worker i, at no individual cost. These are collectively-provisioned through the social plan, not drawn from the individual claims pool. uncovered_essential_expenses[i] — remaining market cost of essentials not yet communally covered; falls as communal provision expands. effective_net_market_wage[i] = dollar_wage[i] − uncovered_essential_expenses[i] As communal_need_coverage[i] grows, uncovered_essential_expenses[i] falls and effective_net_market_wage[i] approaches dollar_wage[i] in discretionary character — the dollar wage increasingly covers preference, not survival. The minimum viable dollar wage falls with it, reducing resistance to social_output_fraction increases.`
- **`Federation External Fund:`**
  - `scope_net_external_contribution = scope_external_revenue − (scope_external_subsidies_received + scope_allocated_share_of_common_external_costs)` _`Positive means the scope contributes net external currency to the federation fund. Negative means the scope draws subsidies. The fund is allocated by the federation according to democratically-determined priorities — not returned to the exporting scope.`_
  - `federation_external_fund = Σ(scope_net_external_contribution) + federation_level_external_inflows + prior_period_surplus`
  - `federation_import_capacity = federation_external_fund × import_purchasing_power`
  - _`Import allocations are determined by need, not by which scope generated the revenue. The federation assembly sets priorities: medicine before spare parts, food before solar panels. A scope that exports heavily does not receive more imports — it contributes to the common fund, which covers collective needs.`_
- **`Local Provision Value:`** `local_provision_value_per_worker = (average_claim_capacity × claim_purchasing_power) + average_communal_need_coverage` _`This answers: "What does the social plan provide to each worker from local production?" It is the primary measure of how much the transition has improved material conditions within the scope.`_
- **`Scope Decision Metrics (for assembly deliberation):`**
  - `if_shift_to_exports(Δlabor): estimated_net_external_contribution = Δexport_revenue − Δexternal_input_costs; federation_priority_impact = which current highest-priority import need this could fund`
  - `if_shift_to_local(Δlabor): estimated_claim_pool_addition = Δlocal_claimable_output; estimated_communal_addition = Δcommunal_output`
  - _`The assembly deliberation is not a ratio — it is a political question. "The federation reports medicine is critically underfunded. Our export shift could cover X% of that need. Our local claim pool is currently stable. Do we shift labor to exports this quarter?" This requires federation priority data, published each cycle by the federation Observer.`_
- **`The Composition Ratio (Real Purchasing Power) — Modified for Phase-Out:`**
  - `claim_purchasing_power  = goods per 1 SVC unit in the local claim pool`
  - `dollar_purchasing_power = goods per $1 in local markets`
  - `social_real_wage_per_hour = average_claim_per_validated_hour × claim_purchasing_power`
  - `market_real_wage_per_hour = average_dollar_wage_per_hour     × dollar_purchasing_power`
  - `composition_ratio = [social_real_wage_per_hour × confirmed_output_fraction] / [market_real_wage_per_hour × (1 - social_output_fraction)]`
  - _`As dollar wages phase out, market_real_wage_per_hour → 0, and the composition ratio becomes effectively infinite. At that point the relevant comparison shifts: the democratic question is no longer "are social wages matching market wages?" but "does the social plan generate sufficient value for all workers, and how should we allocate labor to best serve collective priorities?" The communal satisfaction ratio and scope net external contribution become the primary metrics.`_
  - _`Workers compare real goods received per hour of work on each side of the transition. Neither the per-hour rates alone (which omit purchasing power differences between SVC and dollars) nor the purchasing power terms alone (which omit the per-hour compensation rates) are sufficient — the correct ratio requires both. A gap between confirmed_output_fraction and social_output_fraction — unconfirmed deliveries — depresses the social side and creates material pressure to resolve outstanding confirmations.`_
  - _`Political usage:`_ `The substitution ratio is published for every scope. Workers can see whether their social compensation matches their market compensation, whether the gap is growing or shrinking, and how their scope compares to others. Transparency turns compensation into a democratic question: "Why is our substitution ratio 0.7 when the neighboring scope's is 1.1?" Assemblies debate, federations adjust, and the Observer recalculates.`
- **`The Communal Satisfaction Ratio:`**
  - `total_social_value[i] = (claim_capacity[i] × claim_purchasing_power) + communal_need_coverage[i]`
  - `communal_satisfaction_ratio = total_social_value[i] / effective_net_market_wage[i]`
  - _`Where the substitution ratio compares compensation streams per hour of work, the communal satisfaction ratio compares total social plan value — claim pool access plus communal provision — against what the market wage must actually cover. As communal_need_coverage[i] grows, effective_net_market_wage[i] shrinks even without any change in dollar_wage[i]: the communal satisfaction ratio rises from expansion of provision alone, without any change in social_output_fraction.`_
  - _`The individual claims pool is not diminished by communal provision — it is a separate category. But its character changes: as communal coverage absorbs survival goods (housing, healthcare, childcare), the claims pool shifts from a survival instrument to a discretionary one. Workers use it for cultural goods, personal tools, travel, non-essential consumption. This shift in the character of the claims pool, visible in the Observer's data, is one of the clearest signs that a scope's transition is deepening.`_
- **`Federation Role in Transition Composition:`**
  - `For proposed (social_input_fraction_next, social_output_fraction_next, export_plan_next), the Observer computes required subsidy_received to balance external accounts and projected composition ratio (if still relevant), projected collective trade-off ratio, and projected communal satisfaction ratio.`
  - `If composition_ratio_next << 1 or subsidy_received exceeds federation capacity, the federation must:`
    1. `Increase available claimable pool (reclassify goods to individual-claimable)`
    2. `Accept more confirmed outputs (if currently under-confirming)`
    3. `Provide temporary external subsidies (bridge, not destination)`
    4. `Negotiate a slower social_output_fraction increase.`
    5. `Facilitate import substitution — seed new social providers, coordinate supplier transitions`
    6. `Manage export validation as social recipient — confirm delivery and validate labor accordingly`
  - _`Note: Dollar subsidies without concurrently expanding the social claim pool creates dependency, not transition.`_

**`Observer's Report — Federation Level:`** `The federation Observer publishes each planning cycle: federation_external_fund balance; allocation_priorities (democratically set, ranked by need); per-scope scope_net_external_contribution (positive = contributing, negative = drawing subsidies); per-scope receipts from import allocation (by need, not by contribution); federation-wide communal_satisfaction_ratio, dollar_wage_phase_out_factor, claim_purchasing_power, import_dependence_ratio.`

**`Observer's Report — Scope Level:`** `The scope Observer produces a report each planning cycle covering:`

- **`Current State Snapshot:`** `social_input_fraction, social_output_fraction, confirmed_output_fraction; scope_net_external_contribution (net contribution to federation fund); total_dollar_wages (if any) + dollar_wage_phase_out_factor; composition_ratio (if still relevant); communal_satisfaction_ratio; local_provision_value_per_worker; per-worker: hours_worked[i], dollar_wage[i] (if any), total_claim_capacity[i], communal_need_coverage[i], effective_net_market_wage[i]`
- **`Federation Priority Context:`** `Current highest unfunded priorities from federation Observer; estimated federation_priority_impact if scope shifts Δlabor to exports; estimated local_provision_change if scope shifts Δlabor to local production.`
- **`Transition Feasibility:`** `For each proposed (social_input_fraction_next, social_output_fraction_next, export_plan_next), compute projected communal_satisfaction_ratio, projected scope_net_external_contribution, and import substitution progress required.`
- **`Recommendation:`** `Proposed targets, subsidy_request, projected ratios, resistance risk, import substitution priorities, solidarity assessment.`

**`Scope Assembly Decision:`** `The elected workers review the Observer's report and deliberate:`

1. **`Understand federation priorities:`** `What does the whole federation need most urgently? (from federation Observer report)`
2. **`Assess local conditions:`** `Is our claim pool stressed? Communal provision adequate? What does communal_satisfaction_ratio show?`
3. **`Decide labor allocation:`** `export_labor_target, local_social_labor_target — based on collective priorities, not local benefit-capture`
4. **`Set targets:`** `social_input_fraction_target, social_output_fraction_target, export_plan_target for next period`
5. **`Requests:`** `subsidy_request from federation (if needed)`
6. **`Communication:`** `Send to federation: "We commit to export_plan_target, generating estimated scope_net_external_contribution. We request subsidy_request support and confirm these outputs for federation validation."`
7. **`Import substitution priorities:`** `Which inputs to target for replacement next period`

**`Federation Assembly Decision:`** `Federation delegates review all scope reports and decide:`

1. **`Set import priorities:`** `ranked by need, not by which scope contributed most`
2. **`Allocate external fund:`** `according to priorities — medicine first, infrastructure second, etc.`
3. **`Coordinate import substitution:`** `seed new social providers, couple supplier transitions across scopes`
4. **`Validate exports:`** `confirm delivery as social recipient for all scopes, enabling labor validation`
5. **`Publish federation metrics:`** `priorities, allocations, import_dependence_ratio, communal_satisfaction_ratio for next planning cycle`

**`Key Insight:`** `The transition is constrained by four things simultaneously: (1) Federation external balance — can collective external revenue cover priority imports? (2) Import substitution progress — is external dependence falling fast enough to withstand potential blockade? (3) Communal satisfaction ratio — does social plan value exceed what dollars must still cover? (4) Solidarity coherence — are scopes allocating labor based on collective priorities, not local capture? The substitution ratio manages individual compensation resistance during phase-out. The communal satisfaction ratio builds political sustainability. Scope net external contribution determines each scope's solidarity position — contributing to or drawing from the common fund. Import substitution progress determines strategic survival. As dollar wages phase out completely, the relevant question is no longer "are workers compensated adequately?" (answered by CSR) but "are we building the material base for genuine federation?" — answered by import substitution progress and solidarity coherence together.`

**`Global Claim Pool & Political Sustainability:`** `One hour of socially-validated labor anywhere yields the same baseline claim capacity. The claim pool makes visible what capitalist prices hide: that an hour producing food in Mozambique and an hour producing financial instruments in Luxembourg are not inherently unequal. Their apparent inequality under capitalism reflects not real value but the power to extract.`

_`The global pool inverts this: value is determined by social validation of useful output.`_

_`Whether this massive reorientation is politically sustainable depends on material interdependence:`_

- `Do high-income regions produce anything low-income regions actually need?`
- `If yes, the relationship is mutual—each needs what the other produces.`
- `If no, their claim on the global pool rests on convincing others that their labor deserves equal recognition despite producing little of use.`
- _`The transition's political sustainability rests on this material truth, not on moral appeals. Regions that produce real goods hold material power. Regions that produce only claims on future production hold only persuasion.`_

**`Inspirations:`**  
_`Critique of the Gotha Program`_`, Karl Marx`  
_`Grundrisse`_`, Karl Marx`  
_`Capital Vol. 1`_`, Karl Marx`  
_`Capital Vol. 2`_`, Karl Marx`  
_`Capital Vol. 3`_`, Karl Marx`  
_`The Paris Commune`_`, Karl Marx`  
_`Negotiated Coordination`_`, Pat Devine`  
_`Towards a New Socialism`_`, Paul Cockshott`  
_`People's Republic of Walmart,`_ `Leigh Phillips and Michael Rozworski`  
_`Project Cybersyn, Revolutionary Chile`_
_`OGAS, Soviet Union`_
