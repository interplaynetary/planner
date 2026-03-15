/**
 * Metabolic Balance — scope-level input/output accounting over a time horizon.
 *
 * metabolicBalance(events, horizon) = Σ outputs − Σ inputs (value-weighted).
 * Positive = net producer; negative = net consumer.
 *
 * Resource class breakdown is returned alongside the scalar for dashboards.
 */

import { z } from 'zod';
import type { EconomicEvent } from '../schemas';

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

export const MetabolicBreakdownSchema = z.object({
    /** Total input value over the horizon (consume + use + work + accept). */
    totalInput: z.number(),
    /** Total output value over the horizon (produce + modify + deliverService). */
    totalOutput: z.number(),
    /**
     * Net balance: totalOutput − totalInput.
     * Positive = net producer / surplus; negative = net consumer / deficit.
     */
    netBalance: z.number(),
    /** Per resource-spec breakdown: specId → net balance for that spec. */
    bySpec: z.map(z.string(), z.number()),
    /** Per resource class: classifiedAs tag → net balance for that class. */
    byClass: z.map(z.string(), z.number()),
});
export type MetabolicBreakdown = z.infer<typeof MetabolicBreakdownSchema>;

// =============================================================================
// HELPERS
// =============================================================================

const INPUT_ACTIONS = new Set(['consume', 'use', 'work', 'accept', 'pickup']);
const OUTPUT_ACTIONS = new Set(['produce', 'modify', 'deliverService', 'dropoff']);

// =============================================================================
// metabolicBalance
// =============================================================================

/**
 * Compute the metabolic balance for a set of EconomicEvents within a time horizon.
 *
 * @param events         Events to analyse; filtered by horizon inside.
 * @param horizon        Inclusive ISO date range [from, to].
 * @param marketPrices   Optional ResourceSpec ID → price per unit (defaults to 1.0).
 * @param resourceClasses Optional ResourceSpec ID → list of classifiedAs tags.
 */
export function metabolicBalance(
    events: EconomicEvent[],
    horizon: { from: Date; to: Date },
    marketPrices: Map<string, number> = new Map(),
    resourceClasses: Map<string, string[]> = new Map(),
): MetabolicBreakdown {
    let totalInput = 0;
    let totalOutput = 0;
    const bySpec = new Map<string, number>();
    const byClass = new Map<string, number>();

    function addToSpec(specId: string, delta: number): void {
        bySpec.set(specId, (bySpec.get(specId) ?? 0) + delta);
    }

    function addToClass(classes: string[], delta: number): void {
        for (const cls of classes) {
            byClass.set(cls, (byClass.get(cls) ?? 0) + delta);
        }
    }

    for (const event of events) {
        // Apply horizon filter
        const ts = event.hasPointInTime ?? event.created;
        if (ts) {
            const t = new Date(ts).getTime();
            if (t < horizon.from.getTime() || t > horizon.to.getTime()) continue;
        }

        const specId = event.resourceConformsTo;
        const qty = event.resourceQuantity?.hasNumericalValue
            ?? event.effortQuantity?.hasNumericalValue
            ?? 0;
        const price = specId ? (marketPrices.get(specId) ?? 1) : 1;
        const value = qty * price;
        if (value <= 0) continue;

        const classes = specId ? (resourceClasses.get(specId) ?? []) : [];

        if (INPUT_ACTIONS.has(event.action)) {
            totalInput += value;
            if (specId) addToSpec(specId, -value);
            addToClass(classes, -value);
        } else if (OUTPUT_ACTIONS.has(event.action)) {
            totalOutput += value;
            if (specId) addToSpec(specId, +value);
            addToClass(classes, +value);
        }
        // Other actions (transfer, cite, etc.) are not metabolic flows
    }

    return {
        totalInput,
        totalOutput,
        netBalance: totalOutput - totalInput,
        bySpec,
        byClass,
    };
}
