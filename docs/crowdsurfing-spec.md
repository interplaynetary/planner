# Crowdsurfing — Distributed Coordination Protocol Specification

TypeScript · ValueFlows · emergent happening coordination over a federated social graph

---

## Overview

Crowdsurfing is a distributed coordination protocol that enables agents to declare desired
happenings, gather commitments from the social graph, and self-organise into groups when
sufficient participation is secured. It is built entirely on the ValueFlows ontology.

The protocol has four phases:

1. **Declaration** — an agent publishes a `Proposal` expressing a desired happening as a bundle
   of `Intent`s
2. **Coordination** — other agents respond with `Commitment`s satisfying those intents
3. **Activation** — when the quorum condition is met, the `Proposal` graduates into a `Plan` and
   a `Holon` (`Agent[Organization]`) is instantiated
4. **Observation** — the happening runs as a `Process`; participation and contributions are
   recorded as `EconomicEvent`s; agents exchange `Appreciation` events that update the trust
   ledger

---

## 1. Agent Layer

### 1.1 Participant

Any human participant is an `Agent` with `type: 'Person'`.

```ts
Agent {
  id:              string           // stable identifier
  type:            'Person'
  name:            string
  image?:          string           // avatar URL
  primaryLocation?: string          // SpatialThing ID
  classifiedAs?:   string[]         // skill taxonomy URIs
                                    // e.g. ["tag:skill:facilitation", "tag:skill:welding"]
}
```

### 1.2 Holon

A Holon is a self-organising group that comes into existence when a `Proposal` reaches quorum.
It is an `Agent` with `type: 'Organization'`.

```ts
Agent {
  id:   string
  type: 'Organization'
  name: string                      // e.g. "Rooftop Solar Party — 2026-04-15"
  note: string                      // links back to the originating Proposal ID
  // Extension:
  blockchainPoolAddress?: string    // on-chain payment splitter address
}
```

Membership is expressed via `AgentRelationship` records (one per participant):

```ts
AgentRelationship {
  id:           string
  subject:      string              // Agent[Person].id  — the participant
  object:       string              // Agent[Organization].id — the Holon
  relationship: string              // AgentRelationshipRole.id for "member"
  inScopeOf?:   string              // Agent[Organization].id — the Holon itself (scope)
}
```

Roles within the Holon (e.g. "host", "organiser", "participant") are distinct
`AgentRelationshipRole` records whose `AgentRelationship.relationship` field selects them.

### 1.3 Trust Graph

The trust graph is a ledger, not a scalar. For every directed pair (A trusts B), there exists:

**A directed trust `EconomicResource`:**
```ts
EconomicResource {
  id:                  string        // e.g. "res:trust:agent-a→agent-b"
  conformsTo:          string        // ResourceSpecification.id for "trust"
  primaryAccountable:  string        // Agent[B].id — B holds the trust received from A
  accountingQuantity:  Measure       // accumulated appreciation count
}
```

**A cached `AgentRelationship` (updated after each Appreciation):**
```ts
AgentRelationship {
  id:           string
  subject:      string              // Agent[A].id — who trusts
  object:       string              // Agent[B].id — who is trusted
  relationship: string              // AgentRelationshipRole.id for "trusts"
  // Extension:
  weight:       number              // 0.0–1.0, derived from the trust EconomicResource ledger
}
```

The `weight` is a query-time cache. The authoritative value is always recomputable from the
sum of `EconomicEvent`(action=`raise`) records on the directed trust `EconomicResource`.

---

## 2. Knowledge Layer

### 2.1 Resource Specifications

Every named resource type (equipment, skill, venue, consumable, service) is a
`ResourceSpecification`. These form the shared vocabulary of the network — the commons catalogue.

```ts
ResourceSpecification {
  id:                    string
  name:                  string         // e.g. "Cargo Van", "Sound System", "Vegan Catering"
  note?:                 string
  resourceClassifiedAs?: string[]       // category tags (§4.1)
  defaultUnitOfResource: string         // e.g. "unit", "hour", "kg"
  substitutable?:        boolean        // true = any instance of this spec is acceptable
  mediumOfExchange?:     boolean        // true for CAV token specs (§2.2)
}
```

Instances of resources owned or stewarded by agents are `EconomicResource` records:

```ts
EconomicResource {
  id:                  string
  conformsTo:          string           // ResourceSpecification.id
  primaryAccountable:  string           // Agent.id — who holds rights
  onhandQuantity:      Measure          // current physical availability
  currentLocation?:    string           // SpatialThing.id
}
```

### 2.2 Community Asset Vouchers (CAVs)

A CAV is a token representing a pre-committed good or service. Each distinct commitment type
gets its own `ResourceSpecification` with `mediumOfExchange: true`:

```ts
ResourceSpecification {
  id:                "spec:cav:vegan-catering-alice",
  name:              "CAV: Vegan Catering (Alice)",
  mediumOfExchange:  true,
  defaultUnitOfResource: "CAV"
}
```

Issued CAV tokens are `EconomicResource` records conforming to that spec. Transfer of a CAV is
an `EconomicEvent` with action=`transferAllRights`.

### 2.3 Trust Resource Specification

```ts
ResourceSpecification {
  id:                    "spec:trust",
  name:                  "Trust",
  defaultUnitOfResource: "appreciation",
  substitutable:         false
}
```

One directed `EconomicResource` per (subject→object) pair conforms to this spec.

### 2.4 Process Specification

All happenings share a common `ProcessSpecification`:

```ts
ProcessSpecification {
  id:   "procspec:happening",
  name: "Happening"
}
```

---

## 3. Planning Layer — Declaration Phase

### 3.1 The Proposal

A `Proposal` is the coordination card for a desired happening. It groups all `Intent`s that
describe what is needed and what is offered.

```ts
Proposal {
  id:               string
  name:             string             // display title
  note?:            string             // the "I want to…" description
  hasBeginning:     string             // ISO datetime — happening window start
  hasEnd:           string             // ISO datetime — happening window end
  eligibleLocation: string             // SpatialThing.id
  inScopeOf:        string[]           // [Agent[Person].id] — organiser(s)
  publishes:        string[]           // Intent.id[] — needs (requests)
  reciprocal:       string[]           // Intent.id[] — offers from organiser

  // Extensions (not in VF core):
  coordinationDeadline: string         // ISO datetime — demurrage deadline;
                                       // Proposal expires if quorum not reached by this date
  minimumParticipants:  number         // minimum attendance for quorum
  blockchainPoolAddress?: string       // coordination pool address (set at activation)
}
```

**Important:** `hasBeginning`/`hasEnd` describe **when the happening takes place**.
`coordinationDeadline` is the separate coordination window close — the point after which
uncommitted resources experience demurrage. These are always distinct dates.

### 3.2 Need Intents (requests)

Every resource or participation type the happening requires is an `Intent` in
`Proposal.publishes`.

```ts
Intent {
  id:                    string
  action:                VfAction       // see §4.2 for action selection rules
  name?:                 string
  note?:                 string
  resourceConformsTo?:   string         // ResourceSpecification.id
  resourceClassifiedAs?: string[]       // category tags (§4.1)
  minimumQuantity?:      Measure        // SET → required for quorum
                                        // ABSENT → nice-to-have
  resourceQuantity?:     Measure        // desired total quantity
  hasBeginning?:         string         // when the resource is needed
  hasEnd?:               string
  atLocation?:           string         // SpatialThing.id
  // provider intentionally absent — open request
}
```

The presence or absence of `minimumQuantity` is the sole distinction between a required need
and a nice-to-have. There is no separate boolean flag.

**Participation Intent** — every Proposal contains exactly one participation Intent representing
the attendance requirement itself:

```ts
Intent {
  id:               "intent:participate:<proposal-id>",
  action:           "work",
  name:             "Participate",
  resourceConformsTo: "spec:participation",    // a well-known ResourceSpecification
  effortQuantity:   { hasNumericalValue: 1, hasUnit: "attendance" },
  minimumQuantity:  { hasNumericalValue: <minimumParticipants>, hasUnit: "attendance" }
}
```

### 3.3 Offer Intents

What the organiser (and any co-declarers) commit to bring are `Intent`s in `Proposal.reciprocal`:

```ts
Intent {
  id:                  string
  action:              VfAction         // transfer (donating) or use (lending)
  resourceConformsTo?: string           // ResourceSpecification.id
  resourceQuantity?:   Measure
  provider:            string           // Agent[Person].id — who is offering
  // receiver intentionally absent — open offer
}
```

---

## 4. Planning Layer — Coordination Phase

### 4.1 Resource Classification Tags

| Category | Tag URI |
|---|---|
| Equipment | `tag:category:equipment` |
| Venue | `tag:category:venue` |
| Skill | `tag:category:skill` |
| Person/attendance | `tag:category:person` |
| Consumable | `tag:category:consumable` |
| Service | `tag:category:service` |

### 4.2 Action Selection Rules

| Resource type | Intent/Commitment action | Rationale |
|---|---|---|
| Physical equipment (borrowed) | `use` | Non-consuming; no rights transfer |
| Physical equipment (donated) | `transfer` | Full rights transfer |
| Venue (access) | `use` | Non-consuming; no rights transfer |
| Consumables | `consume` (need) / `transfer` (pledge) | Consumed in use |
| Labour / attendance | `work` | Effort-based, non-consuming |
| Professional service | `deliverService` | Service-based, non-consuming |
| CAV token | `transferAllRights` | Token changes hands permanently |
| Appreciation | `raise` | Increments trust EconomicResource |

### 4.3 Attendance Commitment

Each agent who pledges to attend creates a `Commitment` satisfying the participation `Intent`:

```ts
Commitment {
  id:             string
  action:         'work'                 // or 'deliverService' for professional roles
  provider:       string                 // Agent[Person].id
  receiver:       string                 // Agent[Organization].id — Holon (set at activation)
  effortQuantity: Measure                // { hasNumericalValue: 1, hasUnit: "attendance" }
  satisfies:      string                 // Intent[participate:<proposal-id>].id
  hasBeginning:   string                 // happening window start
  hasEnd:         string                 // happening window end
  created:        string                 // ISO datetime — when pledge was made
  // plannedWithin set at activation
}
```

### 4.4 Resource Contribution Commitment

Each agent who pledges to bring a specific resource creates a `Commitment` satisfying a need `Intent`:

```ts
Commitment {
  id:                  string
  action:              VfAction            // per §4.2
  provider:            string              // Agent[Person].id
  receiver:            string              // Agent[Organization].id — Holon (set at activation)
  resourceConformsTo?: string              // ResourceSpecification.id
  resourceQuantity?:   Measure
  satisfies:           string              // Intent[need].id — the specific need being covered
  hasBeginning?:       string
  hasEnd?:             string
  created:             string
  // plannedWithin set at activation
}
```

---

## 5. Quorum Condition

Quorum is a computed predicate, not a stored state. It is evaluated after every new `Commitment`
is recorded.

**Quorum is reached when all of the following hold:**

### Condition 1: All required needs are covered

For every `Intent` `i` in `Proposal.publishes` where `i.minimumQuantity` is set:

```
sum(c.resourceQuantity for c in Commitments where c.satisfies == i.id)
  ≥ i.minimumQuantity
```

### Condition 2: Minimum attendance is met

```
count(c in Commitments where c.satisfies == intent:participate:<proposal-id>)
  ≥ Proposal.minimumParticipants
```

### Condition 3: Coordination deadline has not passed

```
now() < Proposal.coordinationDeadline
```

If conditions 1 and 2 are met but condition 3 is not, the `Proposal` is expired (no `Plan`
is created). If conditions 1 and 2 are met and condition 3 holds, activation proceeds.

---

## 6. Planning Layer — Activation Phase

When the quorum condition is satisfied, the following records are created atomically:

### 6.1 Plan

```ts
Plan {
  id:   string
  name: string                          // mirrors Proposal.name
  due:  string                          // = Proposal.hasEnd (happening window close)
}
```

All existing `Commitment`s for this Proposal have `plannedWithin` set to `Plan.id`.

### 6.2 Holon instantiation

```ts
Agent {
  id:   string
  type: 'Organization'
  name: string
  note: string                          // "Activated from Proposal:<id>"
  blockchainPoolAddress?: string        // on-chain splitter, if used
}
```

One `AgentRelationship` per committed participant (subject=participant, object=Holon,
relationship=memberRole).

### 6.3 Proposal status derivation

After activation, the Proposal's effective status is derived from queried facts:

| Derived status | Condition |
|---|---|
| `draft` | `Proposal` exists, `publishes` is empty |
| `active` | `Proposal` exists, `publishes` non-empty, no `Plan` linked, `coordinationDeadline` in future |
| `quorum` | `Plan` linked to this Proposal, `Process` not yet created |
| `happening` | `Process` exists with `plannedWithin == Plan.id`, `finished == false` |
| `completed` | `Process.finished == true` |
| `expired` | No `Plan`, `coordinationDeadline` in past |

No status field is stored; status is always recomputed on read.

---

## 7. Observation Layer

### 7.1 Process (the Happening)

When the happening begins:

```ts
Process {
  id:           string
  name:         string                  // mirrors Plan.name
  basedOn:      'procspec:happening'
  plannedWithin: string                 // Plan.id
  inScopeOf:    string[]               // [Agent[Organization].id] — the Holon
  hasBeginning: string                  // actual start time
  hasEnd?:      string                  // actual end time (set on completion)
  finished:     boolean                 // false until completed
}
```

### 7.2 Participation Events

Each participant's actual attendance is an `EconomicEvent`:

```ts
EconomicEvent {
  id:             string
  action:         'work'                // or 'deliverService'
  inputOf:        string                // Process.id
  provider:       string                // Agent[Person].id
  receiver:       string                // Agent[Organization].id — Holon
  effortQuantity: Measure               // actual hours/attendance
  fulfills:       string                // Commitment[attendance].id
  hasPointInTime: string                // or hasBeginning + hasEnd for duration
}
```

### 7.3 Resource Contribution Events

When a committed resource is physically delivered/used at the happening:

```ts
EconomicEvent {
  id:                  string
  action:              VfAction         // per §4.2
  inputOf:             string           // Process.id
  provider:            string           // Agent[Person].id
  receiver:            string           // Agent[Organization].id — Holon
  resourceConformsTo?: string           // ResourceSpecification.id
  resourceQuantity?:   Measure
  fulfills:            string           // Commitment[resource].id
  hasPointInTime:      string
}
```

### 7.4 Appreciation Events

Post-happening, each participant may send directed appreciation to any other participant.
Each Appreciation is a single `EconomicEvent`:

```ts
EconomicEvent {
  id:                     string
  action:                 'raise'
  inputOf:                string        // Process.id — scoped to this happening
  provider:               string        // Agent[Person].id — who gives appreciation
  receiver:               string        // Agent[Person].id — who receives it
  resourceInventoriedAs:  string        // EconomicResource[trust:A→B].id
  resourceQuantity:       Measure       // { hasNumericalValue: 1, hasUnit: "appreciation" }
  note?:                  string        // optional message
  hasPointInTime:         string
}
```

Each `raise` event increments the `accountingQuantity` of the directed trust `EconomicResource`.
The `AgentRelationship.weight` cache is recomputed after each event.

---

## 8. Fulfillment Chains

The complete accountability chain for any resource need is:

```
Proposal.publishes
  → Intent (need)
      → Commitment.satisfies (pledge)
          → EconomicEvent.fulfills (delivery)
```

To determine whether a need has been met post-happening:

1. Find all `Commitment`s where `satisfies == intent.id` and `fulfills != null` (an event
   exists that fulfils the commitment)
2. Sum the `resourceQuantity` of those fulfilling events
3. Compare against `intent.minimumQuantity`

---

## 9. Demurrage

Demurrage is a time-decay mechanism applied to uncommitted CAVs in the coordination pool.
It is enforced by a periodic background process, not a VF type.

**Behavioral rule:** At each tick between `Proposal` activation and `coordinationDeadline`,
the `Proposal.demurrageRate` (extension field) is applied to the pool. Concretely:

```
undecayed_balance = sum(CAV EconomicResources in pool)
decay_amount = undecayed_balance × demurrageRate × elapsed_fraction
```

Decay is recorded as an `EconomicEvent` with action=`lower` on the pool's `EconomicResource`.

```ts
Proposal {
  // Extension:
  demurrageRate: number               // fraction per coordination period, e.g. 0.01 = 1%/day
}
```

---

## 10. Extension Fields Summary

All extension fields are outside the VF core spec. They should be namespaced `cs:` in any
serialisation format.

| Field | On Type | TS type | Description |
|---|---|---|---|
| `coordinationDeadline` | `Proposal` | `string` (ISO datetime) | Demurrage deadline; distinct from `hasEnd` (happening window end) |
| `minimumParticipants` | `Proposal` | `number` | Minimum number of attendance `Commitment`s required for quorum |
| `demurrageRate` | `Proposal` | `number` | Fractional CAV decay per coordination period |
| `blockchainPoolAddress` | `Proposal`, `Agent[Organization]` | `string` | On-chain payment splitter address |
| `weight` | `AgentRelationship` | `number` (0.0–1.0) | Cached directed trust weight, derived from trust `EconomicResource` ledger |

---

## 11. Invariants

The following must hold at all times and should be enforced at write time:

1. **Provider/receiver exclusivity on Intent**: an `Intent` in `Proposal.publishes` (a need)
   must not have `provider` set. An `Intent` in `Proposal.reciprocal` (an offer) must not have
   `receiver` set.

2. **Commitment direction**: every `Commitment` satisfying a need `Intent` must have
   `provider` set to the committing agent and `receiver` set to the Holon (or left unset
   pre-activation).

3. **Single participation Intent per Proposal**: each `Proposal` has exactly one `Intent`
   with `resourceConformsTo == "spec:participation"` in its `publishes` list.

4. **Trust EconomicResource uniqueness**: for any ordered pair (A, B) of agents, at most one
   `EconomicResource` exists with `conformsTo == "spec:trust"` and `primaryAccountable == B`
   scoped to A. Appreciation events always target this specific resource; never create a second.

5. **Quorum is monotone**: once a `Plan` is created for a `Proposal`, it is never deleted
   even if participants later withdraw `Commitment`s. Withdrawal is recorded as a new
   `EconomicEvent` that corrects the original (via `corrects` field), not by deletion.

6. **Process lifecycle**: a `Process` is only created after a `Plan` exists for the Proposal.
   `Process.finished` transitions from `false` to `true` exactly once and is never reversed.

---

## 12. VF Types Used

| VF Type | Role in Crowdsurfing |
|---|---|
| `Agent[Person]` | Participant |
| `Agent[Organization]` | Holon |
| `AgentRelationshipRole` | "member", "host", "trusts", etc. |
| `AgentRelationship` | Holon membership; directed trust edge |
| `ResourceSpecification` | Resource catalogue; CAV token type; trust spec |
| `EconomicResource` | Resource instance; CAV token; directed trust ledger |
| `Proposal` | Coordination card (pre-activation) |
| `Intent` | Need (request) or offer; participation requirement |
| `Plan` | Activated happening |
| `Commitment` | Attendance pledge or resource contribution pledge |
| `ProcessSpecification` | "Happening" template |
| `Process` | The happening in execution |
| `EconomicEvent` | Participation record; resource delivery; Appreciation; demurrage decay |
| `SpatialThing` | Location of happening |

## 13. VF Actions Used

| Action | Where |
|---|---|
| `work` | Attendance Intent/Commitment/Event |
| `deliverService` | Service-type attendance Intent/Commitment/Event |
| `use` | Borrowed equipment/venue Intent/Commitment/Event |
| `consume` | Consumable need Intent; consumption Event |
| `transfer` | Donated resource Commitment/Event |
| `transferAllRights` | CAV token transfer Event |
| `produce` | Created output (e.g. a built artefact) Event |
| `raise` | Appreciation Event; trust EconomicResource increment |
| `lower` | Demurrage decay Event; negative feedback |
