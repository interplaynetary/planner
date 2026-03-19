# Crowdsurfing GDD → ValueFlows Mapping

## 1. Purpose & Approach

This document maps every entity and field in the Crowdsurfing Game Design Document (GDD) onto the
ValueFlows (VF) ontology as codified in `src/lib/schemas.ts`. It is the authoritative terminological
bridge between the GDD's ad-hoc model and the specification that will be implemented on top of this
codebase.

The GDD introduces several concepts that sound VF-like but are subtly different, conflated, or
unnamed. This document resolves all such ambiguities before any code is written. Where VF has no
equivalent, extension fields are defined and justified.

All VF type names (e.g. `Proposal`, `Intent`) refer to types exported from `src/lib/schemas.ts`.
All VF actions (e.g. `work`, `transfer`) are values of the `VfAction` enum defined there.

---

## 2. Terminological Disambiguation

The GDD uses several terms that overlap with VF vocabulary but mean different things, or that
conflate multiple distinct VF concepts.

### 2.1 "Commitment" (GDD) ≠ `Commitment` (VF)

The GDD's "Commitment" means **"I am coming and/or I am bringing X"** — a single user action that
covers both attendance and resource contribution. VF splits these cleanly:

| GDD Commitment type | VF Equivalent |
|---|---|
| Attendance pledge ("I'm coming") | `Commitment`, action=`work` or `deliverService` |
| Resource contribution ("I'm bringing X") | `Commitment`, action=`transfer` or `produce` |

These are separate `Commitment` records in VF, each satisfying a distinct `Intent`.

### 2.2 "Possibility" conflates three VF concepts

A GDD Possibility is simultaneously:
- A **coordination card** displayed to potential participants → `Proposal`
- A **desired happening** (the event itself) → `Intent` (in the Proposal)
- An **activation artifact** (once quorum is reached) → `Plan`

The key lifecycle split: a Possibility is a `Proposal` (with child `Intent`s) until quorum is
reached, at which point it graduates into a `Plan` (with child `Commitment`s). The `Proposal` and
`Plan` records co-exist — the Plan refines the Proposal's scenario.

### 2.3 "Need" and "Resource" (GDD) are both `Intent`

Both are sides of a proposed exchange:
- **Need** (what the happening requires) → `Intent` with a request direction (no `provider` set)
- **Resource** (what the declarer offers to bring) → `Intent` with an offer direction (no `receiver` set)

VF `Proposal.publishes` holds the request intents; `Proposal.reciprocal` holds the offer intents.

### 2.4 "Trust score" is not a scalar

The GDD models trust as a `trust_score: number` on the User record. VF has no scalar reputation
field. The correct representation is:
- An `EconomicResource` representing the trust/reputation pool per agent
- `EconomicEvent` records (action=`raise` or `lower`) that modify it
- An `AgentRelationship` with a weight extension field for directed trust edges

The scalar score can be derived from the event ledger at query time. This gives a full audit trail
and avoids mutable scalar state.

### 2.5 "Quorum" has no VF equivalent

Quorum is a derived boolean: **all required `Intent`s (those with `minimumQuantity` set) have
total `Commitment` quantities ≥ their `minimumQuantity`**, AND the count of participation
`Commitment`s ≥ `Proposal.minimumParticipants` (extension field). There is no quorum type in
VF — it is computed, not stored.

---

## 3. Lifecycle: The Possibility Arc

```
[Draft] → [Active] → [Quorum] → [Happening] → [Completed]
                                    ↘ [Expired]
```

### State Machine → VF Transitions

| GDD Status | VF Representation | Trigger |
|---|---|---|
| `draft` | `Proposal` created, no `publishes` intents yet | Creator saves draft |
| `active` | `Proposal` published (`publishes` + `reciprocal` intents filled) | Creator activates |
| `quorum` | `Plan` created; `refinementOf` → Scenario; participation `Commitment`s exist | Quorum condition met (computed) |
| `happening` | `Process` created; `plannedWithin` → Plan | Event start time reached |
| `completed` | `Process.finished = true`; `EconomicEvent`s recorded | Event ends + events submitted |
| `expired` | `Proposal.hasEnd` (coordination deadline) passed without quorum | Time-based, no VF state change needed |

The `Proposal` record is never deleted — it persists as the coordination artifact. The `Plan`
is created at quorum and linked via `Plan.refinementOf → Scenario` (the Scenario groups the
coordination window). The `Process` represents the actual happening activity.

---

## 4. Agent Layer

### 4.1 User → `Agent` (type: Person)

Every GDD user is an `Agent` with `type: 'Person'`. No custom fields are needed beyond the
VF core. The user's profile URL (avatar, display name) fits in `Agent.note` or `Agent.image`.

### 4.2 Roles

GDD roles ("host", "participant", "organiser") are represented as `AgentRelationshipRole` records.
The role is expressed via an `AgentRelationship` between the user and the Holon (Organization)
that owns the happening's Plan.

### 4.3 Holon → `Agent` (type: Organization) + `AgentRelationship`

A Holon is a self-organising group that spawns when a Possibility reaches quorum. In VF:
- Create an `Agent` with `type: 'Organization'` whose `id` matches the on-chain payment splitter
  address (stored as an extension field `blockchainPoolAddress`)
- Create one `AgentRelationship` per member: `subject=userAgent`, `object=holonAgent`,
  `relationship=memberRoleId`
- The Holon is `inScopeOf` the parent Possibility's Plan

### 4.4 Trust → `AgentRelationship` (directed, weighted)

```
TrustEdge(from: User A, to: User B, weight: float)
  → AgentRelationship {
      subject: Agent[A].id,
      object:  Agent[B].id,
      relationship: trustRoleId,
      // extension:
      weight: float
    }
```

The `weight` field is a non-VF extension on `AgentRelationship` (see §9).

Trust is grown via Appreciation events (see §8.3). The `AgentRelationship` weight is recomputed
from the ledger of `EconomicEvent`(action=`raise`) records against the directed trust
`EconomicResource` for that pair.

---

## 5. Knowledge Layer

### 5.1 Resource Library → `ResourceSpecification` + `EconomicResource`

The GDD has a "Resource Library" — a catalogue of reusable capacities (e.g. "sound system",
"van", "vegan chef"). Each library entry is a `ResourceSpecification`. Instances of those
resources owned or stewarded by agents are `EconomicResource` records conforming to the spec.

```
ResourceSpecification {
  id: "spec:sound-system",
  name: "Sound System",
  resourceClassifiedAs: ["tag:equipment"],
  defaultUnitOfResource: "unit",
  substitutable: true
}

EconomicResource {
  id: "res:sound-system:alice",
  conformsTo: "spec:sound-system",
  primaryAccountable: "agent:alice",
  onhandQuantity: { hasNumericalValue: 1, hasUnit: "unit" }
}
```

`ResourceSpecification.substitutable = true` allows the matching layer to accept any instance of
that spec when fulfilling a Need Intent.

### 5.2 CAV Token → `ResourceSpecification` (mediumOfExchange=true) + `EconomicResource`

A Community Asset Voucher is a token representing a committed good or service:

```
ResourceSpecification {
  id: "spec:cav:vegan-catering",
  name: "CAV: Vegan Catering (Alice)",
  mediumOfExchange: true,  // marks this as a currency/voucher spec
  defaultUnitOfResource: "CAV"
}
```

The issued token is an `EconomicResource` conforming to this spec. Transfer of the CAV is an
`EconomicEvent` with action=`transfer`.

---

## 6. Planning Layer (Pre-Quorum)

This layer covers the lifecycle from draft through to the moment quorum is declared.

### 6.1 Possibility → `Proposal`

```
Proposal {
  id: "prop:123",
  name: "Rooftop Solar Install Party",
  note: "Let's get this done together — bring tools and enthusiasm",
  hasBeginning: "2026-04-15T10:00:00Z",   // happening window start
  hasEnd:       "2026-04-15T18:00:00Z",   // happening window end
  eligibleLocation: "spatial:rooftop-42", // SpatialThing ID
  inScopeOf: ["agent:alice"],             // organiser
  publishes: ["intent:need-van", "intent:need-chef"],    // required/nice-to-have needs
  reciprocal: ["intent:offer-tools"],     // what organiser brings
  // extensions (§9):
  coordinationDeadline: "2026-04-13T23:59:59Z",
  minimumParticipants: 5,
  blockchainPoolAddress: "0xABCD..."
}
```

Note: `Proposal.hasBeginning`/`hasEnd` describe **the happening window** (when the event takes
place). The **coordination deadline** (the GDD's demurrage deadline, after which the Possibility
expires if no quorum) is an extension field `coordinationDeadline`. Both are distinct dates.

### 6.2 Need (required) → `Intent` in `Proposal.publishes` with `minimumQuantity`

```
Intent {
  id: "intent:need-van",
  action: "use",                            // borrowing (non-consuming)
  name: "Cargo van needed",
  resourceConformsTo: "spec:cargo-van",
  resourceClassifiedAs: ["tag:equipment"],
  minimumQuantity: { hasNumericalValue: 1, hasUnit: "unit" },
  hasBeginning: "2026-04-15T08:00:00Z",    // pick-up window
  hasEnd:       "2026-04-15T20:00:00Z",
  // no provider set — open request
}
```

`minimumQuantity` set → this need is required for quorum. A Need without `minimumQuantity` is
"nice-to-have".

### 6.3 Need (nice-to-have) → `Intent` in `Proposal.publishes` without `minimumQuantity`

Same structure as above but `minimumQuantity` absent.

### 6.4 Need.category → `Intent.resourceClassifiedAs`

| GDD category | VF tag URI |
|---|---|
| equipment | `tag:category:equipment` |
| venue | `tag:category:venue` |
| skill | `tag:category:skill` |
| person | `tag:category:person` |
| consumable | `tag:category:consumable` |

### 6.5 Resource (offer) → `Intent` in `Proposal.reciprocal`

```
Intent {
  id: "intent:offer-tools",
  action: "transfer",                       // bringing to the event
  name: "Toolkit offered",
  resourceConformsTo: "spec:toolkit",
  resourceQuantity: { hasNumericalValue: 1, hasUnit: "set" },
  provider: "agent:alice",                 // who is offering
  // no receiver — open offer
}
```

---

## 7. Planning Layer (Post-Quorum)

### 7.1 Quorum Activation → `Plan` creation

When the quorum condition is satisfied (computed, not stored), the system:
1. Creates a `Plan` linked to the Possibility's `Proposal`
2. Creates a `Holon` `Agent` (Organization) with an `AgentRelationship` per participant
3. Transitions the Possibility status from `active` to `quorum` (derived from Plan existence)

```
Plan {
  id: "plan:123",
  name: "Rooftop Solar Install Party — Activated",
  due: "2026-04-15T18:00:00Z",
  // refinementOf: scenario:123   (optional — for scenario tracking)
}
```

### 7.2 Commitment (attendance) → `Commitment`, action=`work`

```
Commitment {
  id: "comm:alice-attends",
  action: "work",
  provider: "agent:alice",
  receiver: "agent:holon:123",    // the Holon
  effortQuantity: { hasNumericalValue: 8, hasUnit: "hour" },
  satisfies: "intent:participate", // the participation Intent on the Proposal
  plannedWithin: "plan:123",
  hasBeginning: "2026-04-15T10:00:00Z",
  hasEnd:       "2026-04-15T18:00:00Z"
}
```

For events that are more service-like (a DJ, a facilitator), use action=`deliverService` instead.

### 7.3 Commitment (resource contribution) → `Commitment`, action=`transfer` or `use`

```
Commitment {
  id: "comm:bob-brings-van",
  action: "use",                           // lending without transfer of rights
  provider: "agent:bob",
  receiver: "agent:holon:123",
  resourceConformsTo: "spec:cargo-van",
  resourceQuantity: { hasNumericalValue: 1, hasUnit: "unit" },
  satisfies: "intent:need-van",            // fulfils the specific Need Intent
  plannedWithin: "plan:123"
}
```

Use `transfer` when the resource changes hands permanently (e.g. donating consumables).
Use `use` when the resource is borrowed/lent for the event duration.

### 7.4 Quorum Condition (computed)

Quorum is met when **all** of the following hold:

1. For every `Intent` in `Proposal.publishes` where `minimumQuantity` is set:
   - `sum(Commitment.resourceQuantity where Commitment.satisfies == intent.id)` ≥ `intent.minimumQuantity`
2. `count(Commitment where action == 'work' or 'deliverService' and plannedWithin == plan.id)` ≥ `Proposal.minimumParticipants`

This is a query, not a stored flag.

---

## 8. Observation Layer

### 8.1 The Happening → `Process`

When the event begins, a `Process` is created to group all activity:

```
Process {
  id: "proc:123",
  name: "Rooftop Solar Install Party",
  basedOn: "procspec:happening",    // a ProcessSpecification for happenings
  plannedWithin: "plan:123",
  hasBeginning: "2026-04-15T10:00:00Z",
  hasEnd:       "2026-04-15T18:00:00Z",
  finished: false
}
```

When the event ends, `Process.finished` is set to `true`.

### 8.2 Participation → `EconomicEvent`, action=`work`

Each participant's actual attendance is recorded as an event:

```
EconomicEvent {
  id: "evt:alice-worked",
  action: "work",
  inputOf: "proc:123",
  provider: "agent:alice",
  receiver: "agent:holon:123",
  effortQuantity: { hasNumericalValue: 7.5, hasUnit: "hour" },
  fulfills: "comm:alice-attends",   // fulfils the attendance Commitment
  hasPointInTime: "2026-04-15T18:30:00Z"
}
```

### 8.3 Appreciation → `EconomicEvent`, action=`raise`

Post-event, participants send directed recognition to each other. Each Appreciation is:

```
EconomicEvent {
  id: "evt:alice-appreciates-bob",
  action: "raise",
  provider: "agent:alice",
  receiver: "agent:bob",
  resourceInventoriedAs: "res:trust:alice→bob",  // the directed trust EconomicResource
  resourceQuantity: { hasNumericalValue: 1, hasUnit: "appreciation" },
  note: "Bob's van made this possible",
  hasPointInTime: "2026-04-15T20:00:00Z",
  inputOf: "proc:123"                // scoped to the happening
}
```

The `EconomicResource` `res:trust:alice→bob` is a directed trust pool:

```
EconomicResource {
  id: "res:trust:alice→bob",
  conformsTo: "spec:trust",
  primaryAccountable: "agent:bob",   // Bob holds the trust received from Alice
  note: "Alice → Bob trust ledger"
}
```

`accountingQuantity` on this resource accumulates over all Appreciation events.

### 8.4 Need fulfillment tracking

When a Commitment is fulfilled by an event, the link is:
`EconomicEvent.fulfills → Commitment.id`

To find which Need (Intent) was covered:
`Commitment.satisfies → Intent.id`

---

## 9. Extension Fields

These fields are not in the VF core spec but are required by Crowdsurfing. They must be added as
extensions on the relevant VF types.

| Field | On Type | Type | Justification |
|---|---|---|---|
| `coordinationDeadline` | `Proposal` | `string` (ISO datetime) | The demurrage/coordination deadline, distinct from `hasEnd` (happening window end). VF `hasEnd` on a Proposal means the proposal validity window; Crowdsurfing needs two distinct dates. |
| `minimumParticipants` | `Proposal` | `number` | Part of quorum condition; VF has no participant count threshold. |
| `blockchainPoolAddress` | `Proposal` + `Agent` (Organization/Holon) | `string` | On-chain payment splitter address for the coordination pool. Domain-specific; not in VF. |
| `weight` | `AgentRelationship` | `number` (0.0–1.0) | Directed trust edge weight, derived from Appreciation events. Stored for fast query; authoritative value computed from ledger. |
| `demurrageRate` | `Proposal` | `number` | Rate of time-value decay applied to uncommitted CAVs in the pool. Domain-specific. |

All extension fields should be namespaced (e.g., `cs:coordinationDeadline`) in any serialisation
format to avoid collision with future VF spec additions.

---

## 10. Field-by-Field Tables

### 10.1 GDD: Possibility

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `Proposal` | `id` | Same identifier carried forward |
| `title` | `Proposal` | `name` | The display title |
| `description` | `Proposal` + `Intent` | `Proposal.note` + `Intent.note` | The "I want to…" text lives on the Proposal note; the participation Intent carries the activity description |
| `time_start` | `Proposal` | `hasBeginning` | Happening window start |
| `time_end` | `Proposal` | `hasEnd` | Happening window end |
| `deadline` | `Proposal` | `coordinationDeadline` (ext) | Demurrage deadline for coordination phase |
| `location` | `Proposal` | `eligibleLocation` → `SpatialThing.id` | |
| `min_participants` | `Proposal` | `minimumParticipants` (ext) | |
| `status` | Derived | — | Derived from Proposal/Plan/Process state; not stored |
| `pool_address` | `Proposal` | `blockchainPoolAddress` (ext) | |
| `organiser` | `Proposal` | `inScopeOf[0]` → `Agent.id` | |
| `needs[]` | `Proposal` | `publishes[]` → `Intent.id` | See Intent table (§10.3) |
| `resources[]` | `Proposal` | `reciprocal[]` → `Intent.id` | See Intent table (§10.4) |

### 10.2 GDD: User

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `Agent` | `id` | |
| `name` | `Agent` | `name` | |
| `avatar` | `Agent` | `image` | |
| `location` | `Agent` | `primaryLocation` → `SpatialThing.id` | |
| `trust_score` | Derived | — | Computed from `EconomicEvent`(action=`raise`/`lower`) ledger against trust `EconomicResource`; not stored as scalar |
| `skills[]` | `Agent` | `classifiedAs[]` | Skill taxonomy URIs |
| `resources[]` | `EconomicResource` | `primaryAccountable` | Resources the user owns/stewards |

### 10.3 GDD: Need

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `Intent` | `id` | |
| `title` | `Intent` | `name` | |
| `description` | `Intent` | `note` | |
| `category` | `Intent` | `resourceClassifiedAs[]` | Tag URI (§6.4) |
| `is_required` | `Intent` | `minimumQuantity` present/absent | Required if `minimumQuantity` set |
| `quantity` | `Intent` | `minimumQuantity` or `resourceQuantity` | `minimumQuantity` for required; `resourceQuantity` for nice-to-have |
| `resource_spec` | `Intent` | `resourceConformsTo` → `ResourceSpecification.id` | |
| `fulfilled_by[]` | `Commitment` | `Commitment.satisfies == intent.id` | Inverse query |
| `action` | `Intent` | `action` | `use` (equipment/venue), `work` (person/skill), `consume` (consumables) |

### 10.4 GDD: Resource (offer, on Possibility)

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `Intent` | `id` | |
| `title` | `Intent` | `name` | |
| `resource_spec` | `Intent` | `resourceConformsTo` → `ResourceSpecification.id` | |
| `quantity` | `Intent` | `resourceQuantity` | |
| `provider` | `Intent` | `provider` → `Agent.id` | The offering agent |
| `action` | `Intent` | `action` | `transfer` (gives away) or `use` (lends) |

### 10.5 GDD: Commitment (attendance)

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `Commitment` | `id` | |
| `user` | `Commitment` | `provider` → `Agent.id` | |
| `possibility` | `Commitment` | `plannedWithin` → `Plan.id` | Links to the activated Plan |
| `created_at` | `Commitment` | `created` | |
| `action` | `Commitment` | `action` | `work` or `deliverService` |
| `satisfies` | `Commitment` | `satisfies` → `Intent.id` | The participation Intent |

### 10.6 GDD: Commitment (resource contribution)

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `Commitment` | `id` | |
| `user` | `Commitment` | `provider` → `Agent.id` | |
| `resource` | `Commitment` | `resourceConformsTo` → `ResourceSpecification.id` | |
| `quantity` | `Commitment` | `resourceQuantity` | |
| `need_id` | `Commitment` | `satisfies` → `Intent.id` | The specific Need this covers |
| `action` | `Commitment` | `action` | `use` (lending) or `transfer` (donating) |
| `plannedWithin` | `Commitment` | `plannedWithin` → `Plan.id` | |

### 10.7 GDD: Appreciation

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `EconomicEvent` | `id` | |
| `from_user` | `EconomicEvent` | `provider` → `Agent.id` | Who gave the appreciation |
| `to_user` | `EconomicEvent` | `receiver` → `Agent.id` | Who received it |
| `possibility` | `EconomicEvent` | `inputOf` → `Process.id` | Scoped to the happening |
| `message` | `EconomicEvent` | `note` | |
| `created_at` | `EconomicEvent` | `hasPointInTime` | |
| `action` | `EconomicEvent` | `action` | `raise` |
| `resource` | `EconomicEvent` | `resourceInventoriedAs` → directed trust `EconomicResource` | |

### 10.8 GDD: TrustEdge

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `from_user` | `AgentRelationship` | `subject` → `Agent.id` | |
| `to_user` | `AgentRelationship` | `object` → `Agent.id` | |
| `weight` | `AgentRelationship` | `weight` (ext) | Derived from Appreciation ledger; cached for query performance |
| `relationship` | `AgentRelationship` | `relationship` → `AgentRelationshipRole.id` | Role label: "trusts" |

### 10.9 GDD: Holon

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `Agent` | `id` | |
| `name` | `Agent` | `name` | |
| `possibility` | `Plan` | `Plan.id` + `Agent.note` | Back-reference to activated Possibility |
| `pool_address` | `Agent` | `blockchainPoolAddress` (ext) | On-chain splitter |
| `members[]` | `AgentRelationship` | `subject=member`, `object=holon`, `relationship=memberRole` | One record per member |

### 10.10 GDD: Resource (library entry)

| GDD Field | VF Type | VF Field | Notes |
|---|---|---|---|
| `id` | `ResourceSpecification` | `id` | |
| `name` | `ResourceSpecification` | `name` | |
| `description` | `ResourceSpecification` | `note` | |
| `category` | `ResourceSpecification` | `resourceClassifiedAs[]` | Tag URI |
| `unit` | `ResourceSpecification` | `defaultUnitOfResource` | |
| `substitutable` | `ResourceSpecification` | `substitutable` | |
| `instances[]` | `EconomicResource` | `conformsTo == spec.id` | Query, not embedded |

---

## Appendix: VF Actions Used in Crowdsurfing

| Action | Used for |
|---|---|
| `work` | Attendance commitments and events; labour input to the happening Process |
| `deliverService` | Service-type attendance (DJ, facilitator, facilitator) |
| `use` | Lending equipment/venue for the event without transferring rights |
| `transfer` | Donating consumables or permanently contributing a resource |
| `produce` | Creating a new output from the happening (e.g., a built asset) |
| `consume` | Using up consumables during the happening |
| `raise` | Appreciation events that increase trust EconomicResource balance |
| `lower` | Negative feedback or trust decay events |
| `transferAllRights` | Full ownership transfer of a CAV token |
