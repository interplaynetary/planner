/**
 * Shared propagation building blocks — extracted from dependent-demand.ts and dependent-supply.ts.
 *
 * Eliminates ~120 lines of duplicated code across the two algorithm files.
 * Three functions:
 *   - rpDurationMs: recipe process duration in milliseconds
 *   - computeSnlt: socially necessary labour time per unit of output
 *   - createFlowRecord: create a Commitment or Intent from a RecipeFlow
 */

import type {
    Commitment,
    Intent,
    RecipeFlow,
} from '../schemas';
import { ACTION_DEFINITIONS } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { PlanStore } from '../planning/planning';

// =============================================================================
// rpDurationMs
// =============================================================================

/**
 * Convert a RecipeProcess duration to milliseconds.
 * Default: 1 hour if no duration specified.
 */
export function rpDurationMs(rp: { hasDuration?: { hasNumericalValue: number; hasUnit: string } }): number {
    if (!rp.hasDuration) return 3_600_000; // default: 1 hour
    const { hasNumericalValue: v, hasUnit: u } = rp.hasDuration;
    switch (u) {
        case 'days': return v * 86_400_000;
        case 'hours': return v * 3_600_000;
        case 'minutes': return v * 60_000;
        case 'seconds': return v * 1_000;
        default: return v * 3_600_000; // assume hours
    }
}

// =============================================================================
// computeSnlt
// =============================================================================

/**
 * Compute SNLT (Socially Necessary Labour Time) for one recipe execution,
 * expressed as total work-hours per unit of primary output.
 *
 * Lower SNLT = more labour-efficient. Recipes with zero work flows have SNLT=0
 * (pure material transformation, maximally efficient from a labour standpoint).
 * Returns Infinity for degenerate recipes that produce zero output.
 *
 * @param recipeStore - Knowledge layer
 * @param recipeId - Which recipe to evaluate
 * @param specId - Optional: the specific output spec to measure against.
 *                 When absent, falls back to recipe.primaryOutput.
 */
export function computeSnlt(recipeStore: RecipeStore, recipeId: string, specId?: string): number {
    const recipe = recipeStore.getRecipe(recipeId);
    const chain = recipeStore.getProcessChain(recipeId);

    let totalWorkHours = 0;
    for (const rp of chain) {
        const { inputs } = recipeStore.flowsForProcess(rp.id);
        for (const flow of inputs) {
            if (flow.action === 'work') {
                totalWorkHours += flow.effortQuantity?.hasNumericalValue ?? 0;
            }
        }
    }

    const primaryOutputSpec = specId ?? recipe?.primaryOutput;
    if (!primaryOutputSpec) return totalWorkHours;

    const lastProcess = chain[chain.length - 1];
    if (!lastProcess) return Infinity;
    const { outputs } = recipeStore.flowsForProcess(lastProcess.id);
    const primaryFlow = outputs.find(f => f.resourceConformsTo === primaryOutputSpec);
    const outputQty = primaryFlow?.resourceQuantity?.hasNumericalValue ?? 0;
    if (outputQty <= 0) return Infinity;

    return totalWorkHours / outputQty;
}

// =============================================================================
// createFlowRecord
// =============================================================================

/**
 * Create a Commitment (when both agents known) or Intent (when agents unknown)
 * from a RecipeFlow.
 *
 * Unified from dependent-demand and dependent-supply. When `transportLocations`
 * is provided, action-based location mapping is applied (demand-side behaviour).
 * When absent, `atLocation` is used directly (supply-side behaviour).
 */
export function createFlowRecord(
    flow: RecipeFlow,
    processId: string,
    direction: 'input' | 'output',
    scaleFactor: number,
    dueDate: Date,
    planId: string,
    agents: { provider?: string; receiver?: string } | undefined,
    planStore: PlanStore,
    atLocation?: string,
    transportLocations?: { from: string; to: string },
): Commitment | Intent {
    // Validate action direction against VF spec
    const def = ACTION_DEFINITIONS[flow.action];
    if (def && def.inputOutput !== 'outputInput' && def.inputOutput !== 'notApplicable') {
        if (direction === 'input' && def.inputOutput !== 'input') {
            throw new Error(
                `Action '${flow.action}' (inputOutput='${def.inputOutput}') ` +
                `cannot be used as a process input.`
            );
        }
        if (direction === 'output' && def.inputOutput !== 'output') {
            throw new Error(
                `Action '${flow.action}' (inputOutput='${def.inputOutput}') ` +
                `cannot be used as a process output.`
            );
        }
    }

    // For transport recipes, assign locations by action semantics
    let effectiveLocation = atLocation;
    if (transportLocations) {
        if (flow.action === 'pickup') {
            effectiveLocation = transportLocations.from;
        } else if (flow.action === 'dropoff') {
            effectiveLocation = transportLocations.to;
        } else if (flow.action === 'produce' || flow.action === 'lower') {
            effectiveLocation = undefined;  // byproducts: no specific location
        } else {
            effectiveLocation = transportLocations.from;  // use/consume/work → origin
        }
    }

    const scaledQty = flow.resourceQuantity
        ? { hasNumericalValue: flow.resourceQuantity.hasNumericalValue * scaleFactor, hasUnit: flow.resourceQuantity.hasUnit }
        : undefined;
    const scaledEffort = flow.effortQuantity
        ? { hasNumericalValue: flow.effortQuantity.hasNumericalValue * scaleFactor, hasUnit: flow.effortQuantity.hasUnit }
        : undefined;

    const provider = agents?.provider;
    const receiver = agents?.receiver;

    if (provider && receiver) {
        return planStore.addCommitment({
            action: flow.action,
            inputOf: direction === 'input' ? processId : undefined,
            outputOf: direction === 'output' ? processId : undefined,
            resourceConformsTo: flow.resourceConformsTo,
            resourceClassifiedAs: flow.resourceClassifiedAs,
            resourceQuantity: scaledQty,
            effortQuantity: scaledEffort,
            stage: flow.stage,
            state: flow.state,
            provider,
            receiver,
            due: dueDate.toISOString(),
            created: new Date().toISOString(),
            plannedWithin: planId,
            atLocation: effectiveLocation,
            finished: false,
        });
    }

    return planStore.addIntent({
        action: flow.action,
        inputOf: direction === 'input' ? processId : undefined,
        outputOf: direction === 'output' ? processId : undefined,
        resourceConformsTo: flow.resourceConformsTo,
        resourceClassifiedAs: flow.resourceClassifiedAs,
        resourceQuantity: scaledQty,
        effortQuantity: scaledEffort,
        stage: flow.stage,
        state: flow.state,
        provider,
        receiver,
        due: dueDate.toISOString(),
        plannedWithin: planId,
        atLocation: effectiveLocation,
        finished: false,
    });
}
