# Containment and Ecological Buffers

## The Problem

Economic planning systems typically model resources as free-standing inventory: 100 kg of nitrogen is 100 kg of nitrogen, regardless of where it physically exists. But ecological resources don't work this way. Nitrogen in soil is not the same as nitrogen in a bag of fertilizer. The nitrogen is _contained in_ the soil, and accessing it requires interacting with the soil as a medium.

This has three planning implications:

1. **Contained resources are not free-standing supply.** Nitrogen in Field A's soil cannot satisfy a demand for nitrogen at Field B without first being extracted.
2. **Processes interact with containers, not contents directly.** Harvesting _uses_ the soil. The nutrient depletion is a side-effect of that use, not a direct consumption of free-standing stock.
3. **The container persists while contents deplete.** Soil endures across harvests; its nutrient levels fluctuate. This is fundamentally different from consuming a bag of flour.

## VF Primitives

ValueFlows already has the building blocks:

### `containedIn` on EconomicResource

A resource can point to another resource it's physically inside:

```
EconomicResource "Field A Nitrogen"
  conformsTo: spec:nitrogen
  accountingQuantity: 20 kg
  containedIn: "Field A Soil"        <-- physical containment
```

### `combine` / `separate` actions

- **combine**: packs a resource into a container (sets `containedIn`, decrements `onhandQuantity`)
- **separate**: unpacks from a container (clears `containedIn`, increments `onhandQuantity`)

### `use` action (durable)

`use` has `accountingEffect: 'noEffect'` -- the resource persists. This is the correct action for interacting with a container like soil: the soil is used, not consumed.

### `consume` action (depletive)

`consume` has `accountingEffect: 'decrement'` -- the resource quantity decreases. This is correct for the nutrients being drawn down.

## The Gap: Process-Level Coupling

The gap is that VF has no native way to express: "this process uses a container and simultaneously consumes/produces its contents." The actions exist independently, but the _coupling_ between them -- the fact that consuming nitrogen from _this specific soil_ is mediated by using _that soil_ -- has no representation.

This coupling belongs at the **process level**, not the spec level. Different processes interact with the same container differently:

| Process        | Container action | Content action           | Direction     |
| -------------- | ---------------- | ------------------------ | ------------- |
| Harvesting     | `use` soil       | `consume` nitrogen       | Depletion     |
| Cover cropping | `use` soil       | `produce` nitrogen       | Replenishment |
| Irrigation     | `use` aquifer    | `consume` water          | Withdrawal    |
| Composting     | `use` soil       | `produce` organic matter | Enrichment    |

The same soil participates in both depletion and replenishment processes. The direction is determined by the process, not the container.

## `resolveFromFlow` -- The Mechanism

A `RecipeFlow` can declare `resolveFromFlow: <flowId>`, pointing to a sibling `use` flow in the same process. This tells the planner:

> "Resolve this flow's resource from within the container instance that the anchor flow booked."

### Harvesting recipe (consume from container)

```
RecipeFlow: use soil          (id: rf:use-soil, anchor)
RecipeFlow: consume nitrogen  (resolveFromFlow: rf:use-soil)
RecipeFlow: produce food
```

The planner:

1. Resolves the `use` flow -- books a specific soil instance (e.g., "Field A Soil")
2. Sees the `consume` flow has `resolveFromFlow` pointing to the use flow
3. Resolves nitrogen demand against resources where `containedIn === "Field A Soil"`
4. Bypasses the normal containment guard (which hides contained resources from free-standing supply)

### Cover cropping recipe (produce into container)

```
RecipeFlow: use soil          (id: rf:use-soil, anchor)
RecipeFlow: consume biomass
RecipeFlow: produce nitrogen  (resolveFromFlow: rf:use-soil)
```

The planner:

1. Resolves the `use` flow -- books "Field A Soil"
2. Sees the `produce` flow has `resolveFromFlow`
3. Tags the produce Intent as `container-bound` so it's not absorbed as free-standing supply by other demands

## Containment and the Netter

The planning netter enforces a **containment guard**: resources with `containedIn` set are invisible to normal supply queries. This is correct -- you can't use nitrogen that's locked inside soil without going through the soil.

When `resolveFromFlow` is active, the netter inverts this guard:

| Mode                                         | Containment behavior                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| Normal (`containedIn` not specified)         | Skip all resources where `containedIn !== undefined`   |
| Container-mediated (`containedIn` specified) | Skip all resources where `containedIn !== containerId` |

Additionally, scheduled output netting (Steps 2-3 of `netDemand`) is skipped entirely for container-mediated demands. Contained resources are ecological stocks tracked by observation -- scheduled production doesn't produce "into" a specific container at the planning level.

## Ecological Buffers

Ecological buffers are DDMRP buffer zones applied to ecological resources. They use the same zone math (TOR/TOY/TOG) but differ in three critical ways:

### 1. Tipping points

Ecological buffers have an optional `tippingPoint` field on `BufferZone` -- a threshold below which the resource faces irreversible collapse. Unlike the red zone floor (which triggers replenishment), a tipping point breach is an emergency signal.

```
BufferZone for soil nitrogen:
  tor: 10 kg/ha     (red zone ceiling)
  toy: 20 kg/ha     (yellow zone ceiling)
  tog: 30 kg/ha     (green zone ceiling)
  tippingPoint: 5 kg/ha   (irreversible collapse threshold)
```

`bufferStatus()` computes `tippingPointBreached: boolean` when the field is present.

### 2. Conservation signals, not replenishment signals

When an ecological buffer enters red or yellow zone, the planner emits a **ConservationSignal** (not a ReplenishmentSignal). The distinction matters:

- **ReplenishmentSignal**: "We need to produce/purchase more of this." Triggers recipe explosion.
- **ConservationSignal**: "We are depleting a natural stock." Triggers governance visibility and potential demand reduction.

Conservation signals propagate upward through the planning hierarchy:

- Scope level: emitted by `planForScope`
- Federation level: aggregated by `planFederation`, deduplicated by specId
- Tipping point breach: OR'd across all scopes (if _any_ scope is breached, the federation sees it)

### 3. Replenishment is on ecological time

Ecological buffers are tagged `tag:buffer:ecological` on their ResourceSpecification. Their lead time is set by nature (soil regeneration, aquifer recharge), not by production capacity. They _cannot be expedited_.

This means DDMRP's standard replenishment logic (find a recipe, explode demand, back-schedule) doesn't apply. Instead:

- Conservation signals inform governance decisions (reduce harvest intensity, start cover cropping)
- Buffer zones track the ecological state over observation cycles
- Tipping point proximity drives urgency

## How Containment Connects to Buffers

The `containedIn` relationship and DDMRP buffer zones are complementary mechanisms:

| Concern                           | Mechanism                                        |
| --------------------------------- | ------------------------------------------------ |
| **Where is the resource?**        | `containedIn` on EconomicResource                |
| **How much is safe to use?**      | Buffer zones (TOR/TOY/TOG) on the contained spec |
| **When is collapse imminent?**    | `tippingPoint` on BufferZone                     |
| **How does a process access it?** | `resolveFromFlow` on RecipeFlow                  |
| **Who needs to know?**            | ConservationSignal propagation through hierarchy |

A concrete example:

1. Field A's soil has 8 kg/ha nitrogen (contained resource)
2. The nitrogen spec has a buffer zone: TOR=10, TOY=20, TOG=30, tippingPoint=5
3. `bufferStatus(8, zone)` returns `{ zone: 'red', tippingPointBreached: false }`
4. `planForScope` emits a ConservationSignal: "nitrogen in red zone, not yet at tipping point"
5. A harvest recipe with `resolveFromFlow` consumes 3 kg from this soil
6. Now at 5 kg -- tipping point breached
7. Next planning cycle: ConservationSignal escalates upward with `tippingPointBreached: true`
8. Federation sees the breach and can coordinate response (redirect cover crop biomass, reduce harvest quotas)

## Conservation Floors

The netter also supports `conservationFloors` -- a per-spec minimum quantity below which inventory cannot be allocated. When a contained resource's spec has a conservation floor, the netter respects it even during container-mediated resolution:

```
netter.netDemand('spec:nitrogen', 5, { containedIn: 'field-a-soil' })
// If field-a-nitrogen has 8 kg and conservationFloor is 5 kg,
// only 3 kg is allocatable
```

This provides a hard planning constraint that complements the soft ConservationSignal. The signal informs governance; the floor prevents the planner from over-drawing.

## Summary

Containment and ecological buffers together give the planner a coherent model for natural resource stocks:

- **Containment** structures _where_ resources physically exist and _how_ processes access them
- **Buffer zones** quantify _how much_ is safe to use and _when_ collapse is near
- **Conservation signals** propagate _who needs to know_ through the planning hierarchy
- **`resolveFromFlow`** expresses the process-level coupling between container interaction and content flow

The direction of flow -- depletion vs. replenishment -- is determined by the process, not the container. The same soil participates in both harvesting (consume nitrogen) and cover cropping (produce nitrogen). The planner handles both through the same `resolveFromFlow` mechanism, with the action on the dependent flow determining the direction.
