/**
 * planForRegion — H3-based planning orchestrator (thin wrapper over planForUnit).
 *
 * Uses H3 geohash cells as the planning unit. All algorithm phases are implemented
 * by planForUnit; this file provides the RegionStrategy that parameterizes the
 * region-specific behaviour.
 */

import * as h3 from 'h3-js';

import type { Intent, BufferProfile, Commitment } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { Observer } from '../observation/observer';
import { PlanStore, PLAN_TAGS, parseDeficitNote, parseConservationNote } from './planning';
import type { ProcessRegistry } from '../process-registry';
import type { DependentDemandResult } from '../algorithms/dependent-demand';
import type { BufferZoneStore } from '../knowledge/buffer-zones';
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
import { planForUnit, detectConflicts as _detectConflicts, type UnitPlanContext, type UnitPlanResult } from './plan-for-unit';
import type {
    LocationStrategy,
    DemandSlotClass,
    SlotRecord,
    SurplusSignal,
} from './location-strategy';

// Re-export shared types for backward compatibility
export type { DemandSlotClass, SurplusSignal, MetabolicDebt, Conflict } from './location-strategy';

// =============================================================================
// TYPES
// =============================================================================

export interface RegionPlanContext {
    recipeStore: RecipeStore;
    observer: Observer;
    demandIndex: IndependentDemandIndex;
    supplyIndex: IndependentSupplyIndex;
    generateId?: () => string;
    agents?: { provider?: string; receiver?: string };
    config?: { insuranceFactor?: number };
    bufferAlerts?: Map<string, { onhand: number; tor: number; toy: number; tog: number; zone: 'red' | 'yellow' | 'green' | 'excess'; tippingPointBreached?: boolean }>;
    bufferZoneStore?: BufferZoneStore;
    bufferProfiles?: Map<string, BufferProfile>;
}

export interface DeficitSignal {
    plannedWithin: string;
    intentId: string;
    specId: string;
    action: string;
    shortfall: number;
    due?: string;
    h3_cell?: string;
    source: 'unmet_demand' | 'metabolic_debt';
    originalShortfall?: number;
    resolvedAt?: string[];
}

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

/** @deprecated Use child PlanStore.intentsForTag() directly instead of ferry types. */
export interface PlanSignals {
    deficits: DeficitSignal[];
    surplus: SurplusSignal[];
    conservationSignals: ConservationSignal[];
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
// REGION STRATEGY
// =============================================================================

const CLASS_ORDER: Record<string, number> = {
    'locally-satisfiable':     0,
    'transport-candidate':     1,
    'producible-with-imports': 2,
    'external-dependency':     3,
};

class RegionStrategy implements LocationStrategy {
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

    handleTransportCandidate(): null {
        return null; // Region planner sends all slots through dependentDemand
    }

    injectFederationSeeds(): string[] {
        return []; // No federation seeding for region planner
    }

    selectRetractCandidate(remaining: Set<SlotRecord>): SlotRecord | undefined {
        // Simple class-order + due-date: sort and take the first
        const sorted = [...remaining].sort((a, b) => {
            const classDiff = (CLASS_ORDER[b.slotClass] ?? 3) - (CLASS_ORDER[a.slotClass] ?? 3);
            if (classDiff !== 0) return classDiff;
            return new Date(b.slot.due ?? 0).getTime() - new Date(a.slot.due ?? 0).getTime();
        });
        return sorted[0];
    }

    recordSacrifice(): boolean {
        return false; // No depth limit for region planner
    }

    isReExplodeSuccess(result: DependentDemandResult): boolean {
        return result.allocated.length > 0;
    }

    observerForSupply(observer: Observer): Observer {
        return observer; // Full observer for region planner
    }

    handleScheduledReceipt(): null {
        return null; // Region planner sends all supply through dependentSupply
    }

    deficitLocationFields(location: string | undefined) {
        return { atLocation: location };
    }

    annotateChildCommitments(): void {
        // No-op for region planner
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
    const strategy = new RegionStrategy();
    const unitCtx: UnitPlanContext = {
        recipeStore: ctx.recipeStore,
        observer: ctx.observer,
        demandIndex: ctx.demandIndex,
        supplyIndex: ctx.supplyIndex,
        generateId: ctx.generateId,
        agents: ctx.agents,
        config: ctx.config,
        bufferAlerts: ctx.bufferAlerts,
        bufferZoneStore: ctx.bufferZoneStore,
        bufferProfiles: ctx.bufferProfiles,
    };
    return planForUnit(strategy, cells, horizon, unitCtx, subStores);
}

// =============================================================================
// SIGNAL HELPERS (deprecated — kept for backward compatibility)
// =============================================================================

/** @deprecated Read child PlanStore.intentsForTag() directly. */
export function buildPlanSignals(result: RegionPlanResult): PlanSignals {
    const deficits: DeficitSignal[] = result.planStore.intentsForTag(PLAN_TAGS.DEFICIT).map(i => {
        const { originalShortfall, resolvedAt } = parseDeficitNote(i);
        return {
            plannedWithin: i.plannedWithin ?? '',
            intentId: i.id,
            specId: i.resourceConformsTo ?? '',
            action: i.action,
            shortfall: i.resourceQuantity?.hasNumericalValue ?? 0,
            due: i.due,
            h3_cell: i.atLocation,
            source: i.resourceClassifiedAs?.includes(PLAN_TAGS.METABOLIC_DEBT)
                ? 'metabolic_debt' as const
                : 'unmet_demand' as const,
            originalShortfall,
            resolvedAt,
        };
    });
    const surplus: SurplusSignal[] = result.planStore.intentsForTag(PLAN_TAGS.SURPLUS).map(i => ({
        plannedWithin: i.plannedWithin ?? '',
        specId: i.resourceConformsTo ?? '',
        quantity: i.resourceQuantity?.hasNumericalValue ?? 0,
        availableFrom: i.hasPointInTime,
        atLocation: i.atLocation,
    }));
    const conservationSignals = result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION).map(i => {
        const cn = parseConservationNote(i);
        return {
            plannedWithin: i.plannedWithin ?? `conservation:${i.resourceConformsTo}`,
            specId: i.resourceConformsTo ?? '',
            onhand: cn.onhand,
            tor: cn.tor,
            toy: cn.toy,
            tog: cn.tog,
            zone: cn.zone,
            tippingPointBreached: cn.tippingPointBreached,
        };
    });
    return { deficits, surplus, conservationSignals };
}
