/**
 * planForRegion — H3-based planning orchestrator (thin wrapper over planForUnit).
 *
 * Uses H3 geohash cells as the planning unit. All algorithm phases are implemented
 * by planForUnit; this file provides the RegionStrategy that parameterizes the
 * region-specific behaviour.
 */

import * as h3 from 'h3-js';

import type { Intent } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { Observer } from '../observation/observer';
import { PlanStore } from './planning';
import type { DependentDemandResult } from '../algorithms/dependent-demand';
import {
    type IndependentDemandIndex,
    type DemandSlot,
    queryDemandByLocation,
} from '../indexes/independent-demand';
import {
    type IndependentSupplyIndex,
    type SupplySlot,
    querySupplyByLocation,
    querySupplyBySpec,
} from '../indexes/independent-supply';
import { planForUnit, detectConflicts as _detectConflicts, type PlanningContext, type UnitPlanResult } from './plan-for-unit';
import {
    NULL_SCOPE_POLICY,
    type DemandSlotClass,
    type SlotRecord,
    type SurplusSignal,
    type SpatialModel,
    type SacrificePolicy,
    type PlanningMode,
} from './location-strategy';

// Re-export shared types for backward compatibility
export type { DemandSlotClass, SurplusSignal, MetabolicDebt, Conflict } from './location-strategy';

// =============================================================================
// TYPES
// =============================================================================

export type RegionPlanContext = PlanningContext;

export interface ConservationSignal {
    plannedWithin: string;
    specId: string;
    onhand: number;
    tor: number;
    toy: number;
    tog: number;
    zone: 'red' | 'yellow';
    tippingPointBreached?: boolean;
    atLocation?: string;
}

export interface RegionPlanResult {
    planStore: PlanStore;
    purchaseIntents: Intent[];
    unmetDemand: DemandSlot[];
    laborGaps: Intent[];
}

// =============================================================================
// PHASE 0 — NORMALISE CELLS (still exported for direct use)
// =============================================================================

export function normalizeCells(cells: string[]): string[] {
    const unique = [...new Set(cells)];
    return unique.filter(cell => {
        const res = h3.getResolution(cell);
        for (let r = 0; r < res; r++) {
            if (unique.includes(h3.cellToParent(cell, r))) return false;
        }
        return true;
    });
}

// =============================================================================
// PHASE 1 — EXTRACT (still exported for direct use)
// =============================================================================

function extractSlots(
    canonical: string[],
    horizon: { from: Date; to: Date },
    demandIndex: IndependentDemandIndex,
    supplyIndex: IndependentSupplyIndex,
): { demands: DemandSlot[]; supply: SupplySlot[] } {
    const seenDemand = new Set<string>();
    const seenSupply = new Set<string>();
    const demands: DemandSlot[] = [];
    const supply: SupplySlot[] = [];

    for (const cell of canonical) {
        for (const s of queryDemandByLocation(demandIndex, { h3_index: cell })) {
            if (seenDemand.has(s.intent_id)) continue;
            seenDemand.add(s.intent_id);
            if (s.due) {
                const due = new Date(s.due);
                if (due < horizon.from || due > horizon.to) continue;
            }
            if (s.remaining_quantity > 0) {
                demands.push(s);
            }
        }
        for (const s of querySupplyByLocation(supplyIndex, { h3_index: cell })) {
            if (seenSupply.has(s.id)) continue;
            seenSupply.add(s.id);
            supply.push(s);
        }
    }

    return { demands, supply };
}

// =============================================================================
// PHASE 2 — CLASSIFY (still exported for direct use)
// =============================================================================

export function classifySlot(
    slot: DemandSlot,
    canonical: string[],
    supplyIndex: IndependentSupplyIndex,
    recipeStore: RecipeStore,
): DemandSlotClass {
    const specId = slot.spec_id ?? '';

    const localSupply = canonical.some(cell =>
        querySupplyByLocation(supplyIndex, { h3_index: cell })
            .some(s => s.spec_id === specId && s.quantity > 0)
    );
    if (localSupply) return 'locally-satisfiable';

    const allSupply = querySupplyBySpec(supplyIndex, specId);
    if (allSupply.length > 0) return 'transport-candidate';

    const recipes = recipeStore.recipesForOutput(specId);
    if (recipes.length > 0) return 'producible-with-imports';

    return 'external-dependency';
}

// =============================================================================
// CONFLICT DETECTION (re-exported for backward compatibility)
// =============================================================================

export const detectConflicts = _detectConflicts;

// =============================================================================
// REGION STRATEGY (decomposed)
// =============================================================================

const CLASS_ORDER: Record<string, number> = {
    'locally-satisfiable':     0,
    'transport-candidate':     1,
    'producible-with-imports': 2,
    'external-dependency':     3,
};

// --- SpatialModel: H3-based location handling ---
class RegionSpatial implements SpatialModel {
    normalize(ids: string[]): string[] {
        return normalizeCells(ids);
    }

    extractSlots(
        canonical: string[],
        horizon: { from: Date; to: Date },
        demandIndex: IndependentDemandIndex,
        supplyIndex: IndependentSupplyIndex,
    ) {
        return extractSlots(canonical, horizon, demandIndex, supplyIndex);
    }

    classifySlot(
        slot: DemandSlot,
        canonical: string[],
        supplyIndex: IndependentSupplyIndex,
        recipeStore: RecipeStore,
    ): DemandSlotClass {
        return classifySlot(slot, canonical, supplyIndex, recipeStore);
    }

    locationOf(slot: DemandSlot): string | undefined {
        return slot.h3_cell;
    }

    deficitLocationFields(location: string | undefined) {
        return { atLocation: location };
    }

    observerForSupply(observer: Observer): Observer {
        return observer;
    }
}

// --- SacrificePolicy: simple class-order + due-date ---
class SimpleSacrifice implements SacrificePolicy {
    selectRetractCandidate(remaining: Set<SlotRecord>): SlotRecord | undefined {
        const sorted = [...remaining].sort((a, b) => {
            const classDiff = (CLASS_ORDER[b.slotClass] ?? 3) - (CLASS_ORDER[a.slotClass] ?? 3);
            if (classDiff !== 0) return classDiff;
            return new Date(b.slot.due ?? 0).getTime() - new Date(a.slot.due ?? 0).getTime();
        });
        return sorted[0];
    }

    recordSacrifice(): boolean {
        return false;
    }

    isReExplodeSuccess(result: DependentDemandResult): boolean {
        return result.allocated.length > 0;
    }
}

// =============================================================================
// PLAN FOR REGION (thin wrapper)
// =============================================================================

export function planForRegion(
    cells: string[],
    horizon: { from: Date; to: Date },
    ctx: RegionPlanContext,
    subStores?: PlanStore[],
): RegionPlanResult {
    const mode: PlanningMode = {
        spatial: new RegionSpatial(),
        scope: NULL_SCOPE_POLICY,
        sacrifice: new SimpleSacrifice(),
    };
    return planForUnit(mode, cells, horizon, ctx, subStores);
}

