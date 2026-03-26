// If recipes are indexed by output spec (hash map): O(1)



/**
 * Dependent Demand — Recursive demand explosion from the VF spec.
 *
 * From algorithms/dependent-demand.md:
 *   "Traverse a graph of Recipe Processes backwards from the last Recipe Output,
 *    connecting Recipe Inputs with Recipe Outputs that have matching Resource
 *    Categories, and backscheduling all the processes and resource requirements
 *    based on estimated process durations."
 *
 * Algorithm:
 *   1. Start with a demand: (specId, quantity, neededBy)
 *   2a. Check on-hand inventory for conforming resources
 *   2b. Check previously scheduled output Intents not yet allocated
 *   3. Allocate available inventory / Intents to satisfy demand (soft allocation)
 *   4. For remaining unfilled demand, find the most SNLT-efficient Recipe
 *   5. Back-schedule the Recipe Process(es), create Intents/Commitments in the plan
 *   6. For each input of those processes, recurse (step 1)
 *   7. If no recipe and no inventory, create a purchase Intent
 *
 * VF spec compliance:
 *   - Flows without both provider+receiver become Intents (not Commitments)
 *   - Durable inputs (use/cite — accountingEffect='noEffect') are existence gates only
 *   - Work inputs are labour commitments tracked via SNLT, not material sub-demands
 *   - Multiple recipes ranked by SNLT (most labour-efficient chosen first)
 *   - Previously scheduled output Intents netted against demand before recipe explosion
 *
 * Unlike instantiateRecipe(), this works at the demand level (single spec + qty)
 * and adds to an EXISTING plan rather than creating a new one.
 */

import type {
    Plan,
    Process,
    Commitment,
    Intent,
    Measure,
    Recipe,
    VfAction,
} from '../schemas';
import { ACTION_DEFINITIONS } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import { type EconomicContext } from '../planning/planning';
import { PlanNetter } from '../planning/netting';
import type { Observer } from '../observation/observer';
import type { ProcessRegistry } from '../process-registry';
import { computeSNEForRecipe, type SNEIndex } from './SNE';
import {
    rpDurationMs,
    computeSnlt,
    createFlowRecord,
} from './propagation';

/**
 * Tag applied to produce Intents/Commitments that target a container.
 * The netter skips these for non-container-mediated demands.
 */
export const CONTAINER_BOUND_TAG = 'tag:plan:container-bound';

// =============================================================================
// TYPES
// =============================================================================

export interface DemandAllocation {
    specId: string;
    resourceId: string;
    quantity: number;
}

export interface DependentDemandResult {
    plan: Plan;
    processes: Process[];
    /** Bilateral process flows (both provider and receiver known) */
    commitments: Commitment[];
    /** Unilateral process flows (one or both agents unknown) */
    intents: Intent[];
    /** Purchase intents — inputs with no recipe (need to source externally) */
    purchaseIntents: Intent[];
    allocated: DemandAllocation[];
    /**
     * IDs of pre-existing scheduled outputs (Intents OR Commitments with outputOf set,
     * plus any use:* time-slot keys) that were soft-allocated by THIS explosion via
     * netter.netDemand / netter.netUse. Computed as the delta of netter.allocated
     * before vs after the BFS — so it includes only what this call added, not
     * accumulations from prior calls on the same netter.
     *
     * Used during retraction: deleting these from netter.allocated releases claims
     * on flows owned by OTHER explosions (orphaned claims that pruneStale() cannot
     * detect, since those flows still exist in the planStore).
     */
    allocatedScheduledIds: Set<string>;
    /**
     * DDMRP buffer boundary stops: specId → qty remaining after netting
     * that was not satisfied because the spec is a decoupling point.
     * Feeds Pass 2 replenishment. Simplified ReplenishmentSignal.
     */
    boundaryStops: Map<string, number>;
}

interface DemandTask {
    specId: string;
    quantity: number;
    neededBy: Date;
    /** The process that needs this input (for commitment linkage) */
    forProcessId?: string;
    /** Unit for quantities */
    unit: string;
    /**
     * If set, this is a durable input (use/cite — accountingEffect='noEffect').
     * Value is the VfAction so 'use' can be handled differently from 'cite'.
     *   'use'  → time-slot scheduling + use-Intent created in plan
     *   'cite' → existence gate only (no scheduling, no intent)
     */
    durableAction?: VfAction;
    /**
     * End time of the process requiring this durable input.
     * Present when durableAction='use' to enable time-slot scheduling via netUse.
     */
    processEnd?: Date;
    /**
     * Effort quantity from the RecipeFlow (how long the tool is used per process run).
     * Carried onto the use-Intent for SNE depreciation accounting.
     */
    useEffortQuantity?: Measure;
    /**
     * Required stage (ProcessSpecification ID) of a conforming resource.
     * VF spec (resources.md §Stage and state): dependent demand selects
     * only resources that fit the specified stage and state.
     */
    stage?: string;
    /** Required state string of a conforming resource. */
    state?: string;
    /** SpatialThing ID — where this input is needed. */
    atLocation?: string;
    /**
     * When set, resolve this demand from resources containedIn this specific
     * container resource instance. Bypasses the normal containment guard and
     * instead restricts netting to only resources inside the container.
     * Set by the input loop when a RecipeFlow has resolveFromFlow.
     */
    resolvedContainerId?: string;
}

// =============================================================================
// DEPENDENT DEMAND
// =============================================================================

/**
 * Perform a full recursive dependent demand explosion.
 *
 * @param planId - The plan to add processes/commitments to (must exist in planStore)
 * @param demandSpecId - The resource specification being demanded
 * @param demandQuantity - How many are needed
 * @param dueDate - When the final output is required
 * @param recipeStore - Knowledge layer
 * @param planStore - Planning layer (adds to this plan)
 * @param observer - Optional: check inventory for netting
 * @param agents - Optional: assign provider/receiver on commitments
 */
export function dependentDemand(params: EconomicContext & {
    planId: string;
    demandSpecId: string;
    demandQuantity: number;
    dueDate: Date;
    agents?: { provider?: string; receiver?: string };
    generateId?: () => string;
    /** Optional shared netter — pass to share allocated state across algorithm calls (Mode C). */
    netter?: PlanNetter;
    /**
     * Optional pre-built SNE index (specId → effort hours/unit).
     * When provided, recipes are ranked by SNE (embodied labor) instead of SNLT
     * (direct labor only). Build via buildSNEIndex() from SNE.ts.
     * When absent, falls back to the existing SNLT ranking.
     */
    sneIndex?: SNEIndex;
    /** SpatialThing ID — where the final output is needed. */
    atLocation?: string;
    /**
     * DDMRP-VF decoupling mode. When true AND bufferedSpecs is provided,
     * specs with active BufferZones are treated as buffer boundaries:
     * inventory is allocated as normal, but if remaining > 0 after netting,
     * the BFS stops and records the remainder in result.boundaryStops.
     * Default false (backward-compatible full BFS).
     * Pass 1 sets this true; Pass 2 leaves it false/unset.
     */
    honorDecouplingPoints?: boolean;
    /** Spec IDs with active BufferZones — derived from bufferZoneStore at session start. */
    bufferedSpecs?: ReadonlySet<string>;
}): DependentDemandResult {
    const {
        planId,
        demandSpecId,
        demandQuantity,
        dueDate,
        recipeStore,
        planStore,
    } = params;

    const plan = planStore.getPlan(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    // Use the provided netter or create a fresh one (backward compatible).
    const netter = params.netter ?? new PlanNetter(planStore, params.observer);

    const result: DependentDemandResult = {
        plan,
        processes: [],
        commitments: [],
        intents: [],
        purchaseIntents: [],
        allocated: [],
        allocatedScheduledIds: new Set(), // populated after BFS
        boundaryStops: new Map(),
    };

    // Prevent infinite recursion (circular recipes)
    const visited = new Set<string>();

    // Work queue: demands to satisfy
    const queue: DemandTask[] = [{
        specId: demandSpecId,
        quantity: demandQuantity,
        neededBy: dueDate,
        unit: recipeStore.getResourceSpec(demandSpecId)?.defaultUnitOfResource ?? 'each',
        atLocation: params.atLocation,
    }];

    while (queue.length > 0) {
        const demand = queue.shift()!;
        processDemand(demand, visited, queue, result, params, netter);
    }

    // Populate from netter's per-plan attribution (filled during BFS via planId).
    result.allocatedScheduledIds = netter.claimedForPlan(planId);

    return result;
}

// =============================================================================
// INTERNAL
// =============================================================================

/**
 * Process a single demand task. Returns the resolved resource instance ID
 * when the demand was for a `use` action (needed by resolveFromFlow to
 * scope dependent flows to that container). All other paths return undefined.
 */
function processDemand(
    demand: DemandTask,
    visited: Set<string>,
    queue: DemandTask[],
    result: DependentDemandResult,
    params: Parameters<typeof dependentDemand>[0],
    netter: PlanNetter,
): string | undefined {
    const { recipeStore, planStore, processes, observer, agents, planId } = params;

    // --- Container-resolved demands (resolveFromFlow) ---
    // When resolvedContainerId is set, bypass the normal durable-action and
    // netting paths: instead net against resources inside the specific container.
    if (demand.resolvedContainerId) {
        const { remaining: afterNetting, inventoryAllocated } = netter.netDemand(
            demand.specId,
            demand.quantity,
            { stage: demand.stage, state: demand.state, neededBy: demand.neededBy,
              atLocation: demand.atLocation, containedIn: demand.resolvedContainerId },
            planId,
        );
        for (const alloc of inventoryAllocated) {
            result.allocated.push({ specId: demand.specId, resourceId: alloc.resourceId, quantity: alloc.quantity });
        }
        if (afterNetting > 0) {
            // Insufficient contained quantity — create purchase intent for the gap.
            // NOTE: We intentionally skip recipe explosion here. Container-mediated
            // demands resolve only against actual contained inventory, not via
            // production recipes. Recipe-based replenishment of contained resources
            // (e.g., produce-into-container) is a Phase 2 concern.
            const intent = planStore.addIntent({
                action: 'transfer',
                receiver: agents?.receiver,
                resourceConformsTo: demand.specId,
                resourceQuantity: { hasNumericalValue: afterNetting, hasUnit: demand.unit },
                due: demand.neededBy.toISOString(),
                plannedWithin: planId,
                inputOf: demand.forProcessId,
                atLocation: demand.atLocation,
                note: `Contained resource shortfall: ${afterNetting} ${demand.unit} of ${demand.specId} missing from container ${demand.resolvedContainerId}`,
                finished: false,
            });
            result.purchaseIntents.push(intent);
        }
        return undefined;
    }

    // --- Durable inputs (use / cite) ---
    if (demand.durableAction) {
        if (demand.durableAction === 'use') {
            // 'use': schedule a time-slot reservation and create a use-Intent in the plan.
            // Checks onhandQuantity (physical presence) rather than accountingQuantity (rights).
            if (observer) {
                const slotFrom = demand.neededBy;
                const slotTo = demand.processEnd ?? demand.neededBy;
                const candidates = observer.conformingResources(demand.specId)
                    .filter(r => {
                        if ((r.onhandQuantity?.hasNumericalValue ?? 0) <= 0) return false;
                        if (demand.stage && r.stage !== demand.stage) return false;
                        if (demand.state && r.state !== demand.state) return false;
                        if (r.containedIn !== undefined) return false;
                        return true;
                    });
                for (const r of candidates) {
                    if (netter.netUse(r.id, slotFrom, slotTo, planId)) {
                        const intent = planStore.addIntent({
                            action: 'use',
                            resourceInventoriedAs: r.id,
                            resourceConformsTo: demand.specId,
                            hasBeginning: slotFrom.toISOString(),
                            hasEnd: slotTo.toISOString(),
                            inputOf: demand.forProcessId,
                            effortQuantity: demand.useEffortQuantity,
                            resourceQuantity: { hasNumericalValue: demand.quantity, hasUnit: demand.unit },
                            plannedWithin: planId,
                            atLocation: demand.atLocation,
                            finished: false,
                        });
                        result.intents.push(intent);
                        return r.id; // Return resolved instance for resolveFromFlow dependents
                    }
                }
            }
            // No available / uncontested unit — signal sourcing gap
            const intent = planStore.addIntent({
                action: 'transfer',
                receiver: agents?.receiver,
                resourceConformsTo: demand.specId,
                resourceQuantity: { hasNumericalValue: demand.quantity, hasUnit: demand.unit },
                due: demand.neededBy.toISOString(),
                plannedWithin: planId,
                inputOf: demand.forProcessId,
                atLocation: demand.atLocation,
                note: `Use-slot conflict: no available unit of ${demand.specId} during scheduled process window`,
                finished: false,
            });
            result.purchaseIntents.push(intent);
            return undefined;
        }

        // 'cite' and any other durable actions: existence gate only.
        if (observer) {
            const exists = observer.conformingResources(demand.specId)
                .some(r => {
                    if ((r.accountingQuantity?.hasNumericalValue ?? 0) <= 0) return false;
                    if (demand.stage && r.stage !== demand.stage) return false;
                    if (demand.state && r.state !== demand.state) return false;
                    return true;
                });
            if (exists) return undefined;
        }
        const intent = planStore.addIntent({
            action: 'transfer',
            receiver: agents?.receiver,
            resourceConformsTo: demand.specId,
            resourceQuantity: { hasNumericalValue: demand.quantity, hasUnit: demand.unit },
            due: demand.neededBy.toISOString(),
            plannedWithin: planId,
            inputOf: demand.forProcessId,
            atLocation: demand.atLocation,
            note: `Durable resource required (must be present): ${demand.quantity} ${demand.unit} of ${demand.specId}`,
            finished: false,
        });
        result.purchaseIntents.push(intent);
        return undefined;
    }

    // --- Net against inventory + scheduled outputs via PlanNetter ---
    // VF spec: "on-hand inventory OR previously scheduled output Intents not yet allocated"
    // Extends to Commitments: when agents are known, planned outputs are Commitments,
    // not Intents — both represent WIP that should count against demand.
    const { remaining: afterNetting, inventoryAllocated } = netter.netDemand(
        demand.specId,
        demand.quantity,
        { stage: demand.stage, state: demand.state, neededBy: demand.neededBy, atLocation: demand.atLocation },
        planId,
    );
    for (const alloc of inventoryAllocated) {
        result.allocated.push({ specId: demand.specId, resourceId: alloc.resourceId, quantity: alloc.quantity });
    }

    let remaining = afterNetting;

    if (remaining <= 0) return undefined; // Fully covered by inventory / scheduled Intents

    // DDMRP-VF: buffer boundary stop — Pass 2 handles replenishment.
    // Decoupling is derived from BufferZone existence, not a spec-level tag.
    if (params.honorDecouplingPoints && params.bufferedSpecs?.has(demand.specId)) {
        result.boundaryStops.set(
            demand.specId,
            (result.boundaryStops.get(demand.specId) ?? 0) + remaining,
        );
        return undefined;
    }

    // --- Step 1.5: location mismatch → try transport before production ---
    // When a resource is needed at location B but only exists at location A,
    // find a transport recipe (pickup/dropoff pair) and generate a transport
    // sub-task with split atLocation values rather than falling back to purchase.
    let transportLocations: { from: string; to: string } | undefined;
    let transportRecipe: Recipe | undefined;

    // Shared recipe scoring: SNE (embodied labor) when index provided, else SNLT (direct labor).
    const recipeScore = (r: Recipe) => params.sneIndex
        ? computeSNEForRecipe(r.id, demand.specId, recipeStore, params.sneIndex)
        : computeSnlt(recipeStore, r.id, demand.specId);

    if (demand.atLocation && params.observer) {
        const candidateLocations = new Map<string, number>();
        for (const r of params.observer.allResources()) {
            if (r.conformsTo !== demand.specId) continue;
            if (r.containedIn) continue;                         // not free to transport
            if (!r.currentLocation || r.currentLocation === demand.atLocation) continue;
            const avail = netter.netAvailableQty(demand.specId, { atLocation: r.currentLocation });
            if (avail > 0) candidateLocations.set(r.currentLocation, avail);
        }
        if (candidateLocations.size > 0) {
            const tCandidates = recipeStore.recipesForTransport(demand.specId);
            if (tCandidates.length > 0) {
                // Prefer origin with most available quantity
                const [fromLocation] = [...candidateLocations.entries()]
                    .sort((a, b) => b[1] - a[1])[0];
                transportRecipe = tCandidates
                    .map(r => ({ recipe: r, score: recipeScore(r) }))
                    .sort((a, b) => a.score - b.score)[0].recipe;
                transportLocations = { from: fromLocation, to: demand.atLocation };
            }
        }
    }

    // --- Step 2: Find most efficient recipe that produces this spec ---
    // Transport takes priority over production when a location mismatch is detected.
    const recipe: Recipe | undefined = transportRecipe ?? (() => {
        const candidates = recipeStore.recipesForOutput(demand.specId);
        if (candidates.length === 0) return undefined;
        return candidates
            .map(r => ({ recipe: r, score: recipeScore(r) }))
            .sort((a, b) => a.score - b.score)[0].recipe;
    })();

    if (!recipe) {
        // No recipe — create a purchase Intent for external sourcing
        const intent = planStore.addIntent({
            action: 'transfer',
            receiver: agents?.receiver,
            resourceConformsTo: demand.specId,
            resourceQuantity: { hasNumericalValue: remaining, hasUnit: demand.unit },
            due: demand.neededBy.toISOString(),
            plannedWithin: planId,
            inputOf: demand.forProcessId,
            atLocation: demand.atLocation,
            note: `External purchase required: ${remaining} ${demand.unit} of ${demand.specId}`,
            finished: false,
        });
        result.purchaseIntents.push(intent);
        return undefined;
    }

    // Avoid re-exploding the same recipe (cycle protection)
    if (visited.has(recipe.id)) return undefined;
    visited.add(recipe.id);

    // --- Step 3: Scale recipe to demanded quantity ---
    const chain = recipeStore.getProcessChain(recipe.id);
    if (chain.length === 0) return undefined;

    const lastProcess = chain[chain.length - 1];
    const { outputs: lastOutputs } = recipeStore.flowsForProcess(lastProcess.id);
    const primaryOutputFlow = lastOutputs.find(f => f.resourceConformsTo === demand.specId);
    const recipeOutputQty = primaryOutputFlow?.resourceQuantity?.hasNumericalValue ?? 1;
    let scaleFactor = remaining / recipeOutputQty;

    // Minimum batch: take the maximum minScaleFactor across all chain processes.
    // A process with minimumBatchQuantity forces at least that many output units per run.
    // Excess beyond `remaining` becomes surplus inventory visible to the caller.
    for (const rp of chain) {
        if (rp.minimumBatchQuantity) {
            const minScaleFactor = rp.minimumBatchQuantity.hasNumericalValue / recipeOutputQty;
            if (minScaleFactor > scaleFactor) {
                scaleFactor = minScaleFactor;
            }
        }
    }

    // --- Step 4: Back-schedule processes and create flow records ---
    // Collect specs produced internally by this chain (intermediate outputs).
    // Sub-demands for these specs are satisfied by other processes in the chain
    // and must not be enqueued as external demands or purchase intents.
    // Key = "specId|stage" so workflow processes with the same spec but different
    // stages are not conflated. Manufacturing recipes with no stage use "specId|".
    const internallyProduced = new Set<string>();
    for (const rp of chain) {
        const { outputs } = recipeStore.flowsForProcess(rp.id);
        for (const outFlow of outputs) {
            if (outFlow.resourceConformsTo) {
                internallyProduced.add(`${outFlow.resourceConformsTo}|${outFlow.stage ?? ''}`);
            }
        }
    }
    internallyProduced.delete(`${demand.specId}|${demand.stage ?? ''}`);

    let cursor = demand.neededBy;
    const orderedChain = [...chain].reverse(); // back-schedule: from due date towards past

    // If both agents are known, flows become Commitments; otherwise Intents.
    const hasAgents = !!(agents?.provider && agents?.receiver);

    for (const rp of orderedChain) {
        const durationMs = rpDurationMs(rp);
        const processEnd = new Date(cursor);
        const processBegin = new Date(cursor.getTime() - durationMs);
        cursor = processBegin;

        const process = processes.register({
            name: rp.name,
            note: rp.note,
            basedOn: rp.processConformsTo,
            classifiedAs: rp.processClassifiedAs,
            plannedWithin: planId,
            hasBeginning: processBegin.toISOString(),
            hasEnd: processEnd.toISOString(),
            finished: false,
        });
        result.processes.push(process);

        const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);

        // --- Phase 0: Resolve use-anchor flows that have dependents ---
        // Both input and output flows can have resolveFromFlow, so we must
        // resolve anchors before processing either loop.
        const allFlows = [...inputs, ...outputs];
        const dependentFlowIds = new Set(
            allFlows.filter(f => f.resolveFromFlow).map(f => f.resolveFromFlow!),
        );
        const anchorResolved = new Map<string, string | undefined>();

        for (const flow of inputs) {
            if (flow.resolveFromFlow) continue;
            if (!flow.resourceConformsTo) continue;

            const actionDef = ACTION_DEFINITIONS[flow.action];
            const isDurable = actionDef?.accountingEffect === 'noEffect';

            if (isDurable && flow.action === 'use' && dependentFlowIds.has(flow.id)) {
                const inputQty = (flow.resourceQuantity?.hasNumericalValue ?? 0) * scaleFactor;
                const useDemand: DemandTask = {
                    specId: flow.resourceConformsTo,
                    quantity: inputQty,
                    neededBy: processBegin,
                    forProcessId: process.id,
                    unit: flow.resourceQuantity?.hasUnit ?? 'each',
                    durableAction: 'use',
                    processEnd: processEnd,
                    useEffortQuantity: flow.effortQuantity,
                    stage: flow.stage,
                    state: flow.state,
                    atLocation: transportLocations?.from ?? demand.atLocation,
                };
                const resolvedId = processDemand(useDemand, visited, queue, result, params, netter);
                anchorResolved.set(flow.id, resolvedId);
            }
        }

        // --- Outputs ---
        for (const flow of outputs) {
            const record = createFlowRecord(flow, process.id, 'output', scaleFactor, processEnd, planId, agents, planStore, demand.atLocation, transportLocations);

            // Produce-into-container: tag the record so the netter knows it's
            // container-bound and won't offer it as free-standing supply.
            if (flow.resolveFromFlow) {
                const containerId = anchorResolved.get(flow.resolveFromFlow);
                if (containerId) {
                    record.resourceClassifiedAs = [
                        ...(record.resourceClassifiedAs ?? []),
                        CONTAINER_BOUND_TAG,
                    ];
                    record.note = `${record.note ? record.note + '; ' : ''}Produces into container ${containerId}`;
                }
            }

            if (hasAgents) {
                result.commitments.push(record as Commitment);
            } else {
                result.intents.push(record as Intent);
            }
        }

        // --- Inputs Phase A: anchor flows (those without resolveFromFlow) ---
        for (const flow of inputs) {
            if (flow.resolveFromFlow) continue; // handled in Phase B

            const actionDef = ACTION_DEFINITIONS[flow.action];
            const isDurable = actionDef?.accountingEffect === 'noEffect';
            const isResolvedAnchor = anchorResolved.has(flow.id);

            // Skip createFlowRecord for use-anchors resolved in Phase 0 —
            // processDemand already created the specific use-Intent with resourceInventoriedAs.
            if (!isResolvedAnchor) {
                const record = createFlowRecord(flow, process.id, 'input', scaleFactor, processBegin, planId, agents, planStore, demand.atLocation, transportLocations);
                if (hasAgents) {
                    result.commitments.push(record as Commitment);
                } else {
                    result.intents.push(record as Intent);
                }
            }

            if (!flow.resourceConformsTo || internallyProduced.has(`${flow.resourceConformsTo}|${flow.stage ?? ''}`)) continue;
            if (flow.action === 'work') continue;
            if (isResolvedAnchor) continue; // already resolved in Phase 0

            const inputQty = (flow.resourceQuantity?.hasNumericalValue ?? 0) * scaleFactor;

            // Normal enqueue for all other anchor flows
            if (inputQty > 0 || isDurable) {
                queue.push({
                    specId: flow.resourceConformsTo,
                    quantity: inputQty,
                    neededBy: processBegin,
                    forProcessId: process.id,
                    unit: flow.resourceQuantity?.hasUnit ?? 'each',
                    durableAction: isDurable ? flow.action : undefined,
                    processEnd: flow.action === 'use' ? processEnd : undefined,
                    useEffortQuantity: flow.action === 'use' ? flow.effortQuantity : undefined,
                    stage: flow.stage,
                    state: flow.state,
                    atLocation: transportLocations?.from ?? demand.atLocation,
                });
            }
        }

        // --- Inputs Phase B: dependent flows (those with resolveFromFlow) ---
        for (const flow of inputs) {
            if (!flow.resolveFromFlow) continue;

            // Create the plan record
            const record = createFlowRecord(flow, process.id, 'input', scaleFactor, processBegin, planId, agents, planStore, demand.atLocation, transportLocations);
            if (hasAgents) {
                result.commitments.push(record as Commitment);
            } else {
                result.intents.push(record as Intent);
            }

            if (!flow.resourceConformsTo || internallyProduced.has(`${flow.resourceConformsTo}|${flow.stage ?? ''}`)) continue;
            if (flow.action === 'work') continue;

            const containerId = anchorResolved.get(flow.resolveFromFlow);
            const inputQty = (flow.resourceQuantity?.hasNumericalValue ?? 0) * scaleFactor;

            if (!containerId) {
                // Anchor failed to resolve — emit purchase intent for the dependent
                if (inputQty > 0) {
                    const intent = planStore.addIntent({
                        action: 'transfer',
                        receiver: agents?.receiver,
                        resourceConformsTo: flow.resourceConformsTo,
                        resourceQuantity: { hasNumericalValue: inputQty, hasUnit: flow.resourceQuantity?.hasUnit ?? 'each' },
                        due: processBegin.toISOString(),
                        plannedWithin: planId,
                        inputOf: process.id,
                        atLocation: transportLocations?.from ?? demand.atLocation,
                        note: `Container-mediated resource unavailable: anchor flow ${flow.resolveFromFlow} did not resolve`,
                        finished: false,
                    });
                    result.purchaseIntents.push(intent);
                }
                continue;
            }

            if (inputQty > 0) {
                queue.push({
                    specId: flow.resourceConformsTo,
                    quantity: inputQty,
                    neededBy: processBegin,
                    forProcessId: process.id,
                    unit: flow.resourceQuantity?.hasUnit ?? 'each',
                    stage: flow.stage,
                    state: flow.state,
                    atLocation: transportLocations?.from ?? demand.atLocation,
                    resolvedContainerId: containerId,
                });
            }
        }
    }

    // Allow this recipe to be used again for different demand items
    visited.delete(recipe.id);
    return undefined;
}

