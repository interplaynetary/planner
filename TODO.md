What it wants to be

The system is reaching toward a model where
the planning hierarchy itself is a VF
process chain. Each scope takes demand
Intents as input, runs an algorithm, and
produces a mix of Commitments (what it
resolved), surplus Intents (what it
overproduced), and deficit Intents (what it
couldn't resolve). The deficits flow
upward to the parent scope, which treats
them as its own demand inputs. The
surpluses flow to lateral matching.
Conservation signals flow upward as
ecological constraints. This is a recursive
economic transformation — uncertainty in,
coordination out, residual uncertainty
propagated — and it maps perfectly to VF's
Process model: inputs (demands), outputs
(commitments + residual signals), nested
within a Plan.

But the architecture doesn't make this
framing explicit. The planning activity is
invisible in the VF object graph. You can
see the results of planning (Intents,
Commitments, Processes), but you can't see
planning itself as a traceable VF activity.
If you asked "why does this deficit
exist?" you'd have to reconstruct the
answer from the algorithm's internal logic
rather than following a chain of VF
references.

---

● Let me re-read the current state of the key
files to have a fresh picture before
reflecting.

Read 3 files (ctrl+o to expand)

● Now let me look at the netting and
algorithm layer to understand the full
picture:

Read 1 file (ctrl+o to expand)

● Good. Now I have the full picture. Here's
my reflection:

---

There are three levels to think about: what
the architecture is, what it wants to be,
and what's keeping it from getting there.

What it is now

After the refactoring, the architecture has
a clean five-layer stack: knowledge
(RecipeStore, BufferZoneStore), plan
(PlanStore with all signals as tagged
Intents), observation (Observer), algorithm
(dependentDemand, dependentSupply,
PlanNetter), and orchestration (planForUnit
with LocationStrategy, planFederation).
All planning signals — deficit, surplus,
conservation, replenishment, lateral
transfer, metabolic debt — are VF Intents
living in the PlanStore, queryable through
intentsForTag(). The duplication between
scope and region planners is gone. The
hierarchy reads child PlanStores directly
instead of ferrying bespoke structs. This
is a significant improvement.

What it wants to be

The system is reaching toward a model where
the planning hierarchy itself is a VF
process chain. Each scope takes demand
Intents as input, runs an algorithm, and
produces a mix of Commitments (what it
resolved), surplus Intents (what it
overproduced), and deficit Intents (what it
couldn't resolve). The deficits flow
upward to the parent scope, which treats
them as its own demand inputs. The
surpluses flow to lateral matching.
Conservation signals flow upward as
ecological constraints. This is a recursive
economic transformation — uncertainty in,
coordination out, residual uncertainty
propagated — and it maps perfectly to VF's
Process model: inputs (demands), outputs
(commitments + residual signals), nested
within a Plan.

But the architecture doesn't make this
framing explicit. The planning activity is
invisible in the VF object graph. You can
see the results of planning (Intents,
Commitments, Processes), but you can't see
planning itself as a traceable VF activity.
If you asked "why does this deficit
exist?" you'd have to reconstruct the
answer from the algorithm's internal logic
rather than following a chain of VF
references.

The deep tensions

1. The note field as a type system.

This is the most structural concern. We now
have six different JSON schemas living
inside Intent.note:

- Deficit notes carry originalShortfall and
  resolvedAt
- Conservation notes carry onhand, tor,
  toy, tog, zone, tippingPointBreached
- Replenishment notes carry the full NFP
  breakdown plus approval status

These are stringly-typed domain objects
masquerading as free-text annotations.
Every consumer does JSON.parse(i.note) and
hopes the fields are there. The
parseDeficitNote() /
parseConservationNote() /
parseReplenishmentNote() functions paper
over this, but they're runtime validation,
not compile-time safety.

The deeper question is whether this data
belongs in the Intent at all, or whether it
belongs in a typed companion record linked
by Intent ID. The VF spec's note field is
genuinely intended for supplementary
information, and using it for structured
data isn't wrong per se — it's how most VF
implementations carry domain-specific
metadata. But the volume and criticality of
data we're packing in there suggests we've
outgrown the pattern. A deficit's
originalShortfall isn't supplementary —
it's load-bearing data that the parent
planner uses to make allocation decisions.

One direction: a SignalMeta map alongside
the PlanStore, keyed by Intent ID, holding
typed records. The Intent stays VF-pure
(action, spec, quantity, due), the meta
carries the planning-specific extensions.
intentsForTag() gives you the Intents;
meta.get(i.id) gives you the typed payload.
No JSON parsing, full type safety, clean
separation between the VF signal and its
planning context.

2. The LocationStrategy is actually three
   orthogonal policies stapled together.

The 12-method interface conflates three
independent concerns:

- Spatial model: normalize, extractSlots,
  classifySlot, locationOf,
  deficitLocationFields — how location
  identifiers work
- Scope policy: handleTransportCandidate,
  injectFederationSeeds,
  handleScheduledReceipt,
  annotateChildCommitments, observerForSupply
  — whether the planner is aware of other
  planning units
- Sacrifice policy: selectRetractCandidate,
  recordSacrifice, isReExplodeSuccess — how
  to choose what to retract

The region planner has three methods that
return null or empty arrays —
handleTransportCandidate,
injectFederationSeeds,
handleScheduledReceipt. These aren't
"region-specific behaviour"; they're "the
absence of scope-specific behaviour." The
interface was drawn around the scope
planner's feature set and the region
planner opts out.

If you decomposed into SpatialModel,
ScopePolicy, and SacrificePolicy, each
would have 3-4 methods, none would have
no-op implementations, and you could mix
them independently. A scope planner with
simple backtracking, or a region planner
with scope awareness, would just be a
different policy combination.

3. The index layer is a frozen snapshot
   that the algorithm mutates around.

The IndependentDemandIndex and
IndependentSupplyIndex are computed before
planning starts and never updated. But
planning changes the supply/demand picture
— every Commitment the planner creates
reduces available supply, every deficit
signal creates new demand. The algorithm
works around this by tracking allocations
in the PlanNetter's allocated set, which is
essentially a delta layer over the frozen
index.

This means there are two sources of truth
for "what's available": the index (static,
pre-planning) and the netter (dynamic,
mid-planning). The netter is correct, but
it's not queryable the way the index is —
you can't ask the netter "what supply
exists for spec X at location Y." You can
only ask it to net a specific demand
against available supply.

A more elegant model would have the netter
be the index — a live, mutable view that
starts from the pre-planning snapshot and
updates as the algorithm makes allocations.
querySupplyByScope(netter, scopeId) would
return current available supply, not
pre-planning supply. Classification (Phase 2) could be re-evaluated mid-backtracking
rather than being fixed at the start.

But this introduces complexity: the netter
would need spatial query capabilities, and
backtracking would need to undo index
mutations. The current split (frozen index

- delta set) is simpler to reason about,
  even if it's less elegant.

4. The federation's lateral matching is a
   parallel algorithm, not part of the VF
   lifecycle.

planFederation builds mutable
surplus/deficit pools as plain arrays,
matches them by mutating quantity fields,
and emits lateral-transfer Intents. This
works, but it's the one place in the system
where a planning decision isn't mediated
through the VF Intent → Commitment
lifecycle.

When a lateral match happens, it should
conceptually be: the surplus scope
publishes an offer Intent ("I have flour"),
the deficit scope publishes a request
Intent ("I need flour"), and the federation
matches them into a bilateral Commitment
via acceptProposal(). We already have the
Proposal/Agreement machinery in PlanStore
for exactly this pattern. The deficit
Intent is already there. The surplus Intent
is already there. The lateral match is
precisely what Proposals were designed to
model — matching offers against requests.

If lateral matching used the Proposal path,
the federation's event log would be
traceable through VF's standard provenance
chain: surplus Intent → Proposal →
Agreement → transfer Commitment. Instead,
it's currently a lateral-transfer Intent
with ad-hoc provider/receiver fields. The
data is equivalent but the provenance is
custom rather than VF-native.

5. The planning process is invisible in the
   object graph.

This is the philosophical tension. Every
other economic activity — production,
consumption, transfer — is a VF Process
with inputs, outputs, and a containing
Plan. But the planning activity itself has
no Process node. You can't point at an
object in the PlanStore and say "this is
where scope X planned its response to these
demands." The planning is the act of
creating the PlanStore contents, not
something represented in those contents.

If planning were a VF Process, you'd have:
Process: "Plan for commune-A"
inputOf: [deficit Intents from children,
demand slots from index]
outputOf: [commitments, new deficit
Intents, surplus Intents, conservation
Intents]
plannedWithin: "federation-plan-round-1"

The entire planning hierarchy would be a
process chain visible in the object graph.
Auditing ("why was this commitment
created?") would follow standard VF
references rather than requiring knowledge
of the algorithm's internal logic.

What I think matters most

Not all of these tensions are equal. The
note-field typing is a real usability and
safety issue that will bite as more code
parses those JSON blobs. The
LocationStrategy decomposition would make
the system easier to extend with new
planning modes. The lateral-matching VF
alignment would close the last gap in
provenance tracing.

The index-as-live-view and
planning-as-VF-Process ideas are
architecturally beautiful but high-effort
and not yet motivated by a concrete pain
point. They're directions to keep in mind
rather than changes to make now.

If I were to prioritise one thing for
elegance-per-effort, it would be the typed
signal metadata — replacing the JSON notes
with a typed companion structure. It would
touch every parse site but eliminate an
entire class of runtime errors, and it
would clarify the boundary between "what VF
cares about" (the Intent fields) and "what
the planning algorithm cares about" (the
domain metadata).

✻ Sautéed for 3m 21s
