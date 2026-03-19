/**
 * planForScope — scope-based planning orchestrator (thin wrapper over planForUnit).
 *
 * Uses VF Agent scopes (Sₖ ⊆ V) as the planning unit instead of H3 geohash cells.
 * All algorithm phases are implemented by planForUnit; this file provides the
 * ScopeStrategy that parameterizes the scope-specific behaviour.
 */

import type { Intent, BufferProfile, Commitment } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';
import { PlanStore, PLAN_TAGS, parseConservationNote } from './planning';
import type { ProcessRegistry } from '../process-registry';
import type { DependentDemandResult } from '../algorithms/dependent-demand';
import type { BufferZoneStore } from '../knowledge/buffer-zones';
import {
    type IndependentDemandIndex,
    type DemandSlot,
    queryDemandByScope,
} from '../indexes/independent-demand';
import {
    type IndependentSupplyIndex,
    type SupplySlot,
    querySupplyByScope,
    querySupplyBySpec,
} from '../indexes/independent-supply';
import { planForUnit, type UnitPlanContext, type UnitPlanResult } from './plan-for-unit';
import type {
    LocationStrategy,
    DemandSlotClass,
    SlotRecord,
    SurplusSignal,
} from './location-strategy';

// Re-export types for backward compatibility
export type { ConservationSignal } from './plan-for-region';
export type { DemandSlotClass } from './location-strategy';

// =============================================================================
// TYPES
// =============================================================================

export interface ScopePlanContext {
    recipeStore: RecipeStore;
    observer: Observer;
    demandIndex: IndependentDemandIndex;
    supplyIndex: IndependentSupplyIndex;
    parentOf?: Map<string, string>;
    generateId?: () => string;
    agents?: { provider?: string; receiver?: string };
    config?: { insuranceFactor?: number };
    bufferAlerts?: Map<string, { onhand: number; tor: number; toy: number; tog: number; zone: 'red' | 'yellow' | 'green' | 'excess'; tippingPointBreached?: boolean }>;
    bufferZoneStore?: BufferZoneStore;
    bufferProfiles?: Map<string, BufferProfile>;
    memberCounts?: Map<string, number>;
    sacrificeDepth?: number;
}

/** @deprecated Use child PlanStore.intentsForTag() directly instead of ferry types. */
export interface ScopePlanSignals {
    deficits: ScopeDeficitSignal[];
    surplus: import('./location-strategy').SurplusSignal[];
    conservationSignals: import('./plan-for-region').ConservationSignal[];
}

export interface ScopeDeficitSignal {
    plannedWithin: string;
    intentId: string;
    specId: string;
    action: string;
    shortfall: number;
    due?: string;
    scopeId?: string;
    source: 'unmet_demand' | 'metabolic_debt';
    originalShortfall?: number;
    resolvedAt?: string[];
}

export interface ScopePlanResult {
    planStore: PlanStore;
    purchaseIntents: Intent[];
    unmetDemand: DemandSlot[];
    laborGaps: Intent[];
}

// =============================================================================
// PHASE 0 — NORMALISE SCOPES (still exported for direct use)
// =============================================================================

export function normalizeScopes(scopeIds: string[], parentOf?: Map<string, string>): string[] {
    const unique = [...new Set(scopeIds)];
    if (!parentOf || parentOf.size === 0) return unique;
    const uniqueSet = new Set(unique);
    return unique.filter(scopeId => {
        let current = parentOf.get(scopeId);
        while (current) {
            if (uniqueSet.has(current)) return false;
            current = parentOf.get(current);
        }
        return true;
    });
}

// =============================================================================
// PHASE 1 — EXTRACT (still exported for direct use)
// =============================================================================

function extractScopeSlots(
    canonical: string[],
    horizon: { from: Date; to: Date },
    demandIndex: IndependentDemandIndex,
    supplyIndex: IndependentSupplyIndex,
): { demands: DemandSlot[]; supply: SupplySlot[] } {
    const seenDemand = new Set<string>();
    const seenSupply = new Set<string>();
    const demands: DemandSlot[] = [];
    const supply: SupplySlot[] = [];

    for (const scopeId of canonical) {
        for (const s of queryDemandByScope(demandIndex, scopeId)) {
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
        for (const s of querySupplyByScope(supplyIndex, scopeId)) {
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

export function classifyScopeSlot(
    slot: DemandSlot,
    canonical: string[],
    supplyIndex: IndependentSupplyIndex,
    recipeStore: RecipeStore,
): DemandSlotClass {
    const specId = slot.spec_id ?? '';

    if (!slot.classifiedAs?.includes('individual-claimable')) {
        const localSupply = canonical.some(sid =>
            querySupplyByScope(supplyIndex, sid).some(s => s.spec_id === specId && s.quantity > 0)
        );
        if (localSupply) return 'locally-satisfiable';
    }

    const allSupply = querySupplyBySpec(supplyIndex, specId);
    if (allSupply.length > 0) return 'transport-candidate';

    const recipes = recipeStore.recipesForOutput(specId);
    if (recipes.length > 0) return 'producible-with-imports';

    return 'external-dependency';
}

// =============================================================================
// SCOPE STRATEGY
// =============================================================================

const CLASS_ORDER: Record<string, number> = {
    'locally-satisfiable':     0,
    'transport-candidate':     1,
    'producible-with-imports': 2,
    'external-dependency':     3,
};

class ScopeStrategy implements LocationStrategy {
    private parentOf?: Map<string, string>;
    private memberCounts?: Map<string, number>;
    private maxSacrificeSteps: number;
    private sacrificeSteps = 0;
    private scopeSacrificeQty = new Map<string, number>();

    constructor(
        parentOf?: Map<string, string>,
        memberCounts?: Map<string, number>,
        sacrificeDepth?: number,
    ) {
        this.parentOf = parentOf;
        this.memberCounts = memberCounts;
        this.maxSacrificeSteps = sacrificeDepth ?? Infinity;
    }

    normalize(ids: string[]): string[] {
        return normalizeScopes(ids, this.parentOf);
    }

    extractSlots(
        canonical: string[],
        horizon: { from: Date; to: Date },
        demandIndex: IndependentDemandIndex,
        supplyIndex: IndependentSupplyIndex,
    ) {
        return extractScopeSlots(canonical, horizon, demandIndex, supplyIndex);
    }

    classifySlot(
        slot: DemandSlot,
        canonical: string[],
        supplyIndex: IndependentSupplyIndex,
        recipeStore: RecipeStore,
    ): DemandSlotClass {
        return classifyScopeSlot(slot, canonical, supplyIndex, recipeStore);
    }

    locationOf(slot: DemandSlot): string | undefined {
        return slot.atLocation ?? slot.inScopeOf?.[0];
    }

    handleTransportCandidate(
        slot: DemandSlot,
        planStore: PlanStore,
        planId: string,
        recipeStore: RecipeStore,
        agents?: { provider?: string; receiver?: string },
    ): DependentDemandResult | null {
        const purchaseIntent = planStore.addIntent({
            action: 'transfer',
            receiver: agents?.receiver,
            resourceConformsTo: slot.spec_id,
            resourceQuantity: {
                hasNumericalValue: slot.remaining_quantity,
                hasUnit: recipeStore.getResourceSpec(slot.spec_id ?? '')?.defaultUnitOfResource ?? 'unit',
            },
            due: slot.due,
            plannedWithin: planId,
            note: `Transport required: ${slot.spec_id} (supply exists in another scope)`,
            finished: false,
        });
        return {
            plan: planStore.getPlan(planId)!,
            processes: [],
            commitments: [],
            intents: [],
            purchaseIntents: [purchaseIntent],
            allocated: [],
            allocatedScheduledIds: new Set(),
            boundaryStops: new Map(),
        };
    }

    injectFederationSeeds(planStore: PlanStore, supplyIndex: IndependentSupplyIndex): string[] {
        const seededIntentIds: string[] = [];
        for (const slot of supplyIndex.supply_slots.values()) {
            if (slot.slot_type !== 'scheduled_receipt' || !slot.spec_id || slot.quantity <= 0) continue;
            const syntheticId = `fed-seed:${slot.source_id}`;
            planStore.addIntent({
                id: syntheticId,
                action: 'produce',
                outputOf: syntheticId,
                resourceConformsTo: slot.spec_id,
                resourceQuantity: { hasNumericalValue: slot.quantity, hasUnit: 'unit' },
                finished: false,
            });
            seededIntentIds.push(syntheticId);
        }
        return seededIntentIds;
    }

    selectRetractCandidate(remaining: Set<SlotRecord>, canonical: string[]): SlotRecord | undefined {
        if (this.sacrificeSteps >= this.maxSacrificeSteps) return undefined;

        let candidate: SlotRecord | undefined;
        let bestKey = Infinity;
        for (const r of remaining) {
            const scopeId = r.slot.inScopeOf?.[0] ?? canonical[0];
            const score = this.sacrificeScore(scopeId);
            const classVal = CLASS_ORDER[r.slotClass] ?? 3;
            const dueVal = new Date(r.slot.due ?? 0).getTime();
            const key = score * 1e18 + (3 - classVal) * 1e9 + (Date.now() - dueVal);
            if (key < bestKey) { bestKey = key; candidate = r; }
        }
        return candidate;
    }

    recordSacrifice(slot: DemandSlot, canonical: string[]): boolean {
        const scopeId = slot.inScopeOf?.[0] ?? canonical[0];
        this.scopeSacrificeQty.set(scopeId,
            (this.scopeSacrificeQty.get(scopeId) ?? 0) + (slot.remaining_quantity ?? 0));
        this.sacrificeSteps++;
        return this.sacrificeSteps >= this.maxSacrificeSteps;
    }

    isReExplodeSuccess(result: DependentDemandResult): boolean {
        return result.allocated.length > 0 ||
            result.allocatedScheduledIds.size > 0 ||
            result.processes.length > 0;
    }

    observerForSupply(observer: Observer, canonical: string[]): Observer {
        const scopedObserver = new Observer();
        for (const r of observer.allResources()) {
            if (r.custodianScope && canonical.includes(r.custodianScope)) {
                scopedObserver.seedResource(r);
            }
        }
        return scopedObserver;
    }

    handleScheduledReceipt(
        supplySlot: SupplySlot,
        planStore: PlanStore,
        processes: ProcessRegistry,
        recipeStore: RecipeStore,
        generateId: () => string,
        supplyPlanId: string,
    ): SurplusSignal | null {
        if (supplySlot.slot_type !== 'scheduled_receipt') return null;

        const specName = recipeStore.getResourceSpec(supplySlot.spec_id!)?.name ?? supplySlot.spec_id!;
        const unit = recipeStore.getResourceSpec(supplySlot.spec_id!)?.defaultUnitOfResource ?? 'unit';
        const proc = processes.register({
            name: `Produce ${specName}`,
            plannedWithin: supplyPlanId,
            finished: false,
        });
        planStore.addIntent({
            action: 'produce',
            outputOf: proc.id,
            resourceConformsTo: supplySlot.spec_id,
            resourceQuantity: { hasNumericalValue: supplySlot.quantity, hasUnit: unit },
            plannedWithin: supplyPlanId,
            finished: false,
        });
        return {
            specId: supplySlot.spec_id!,
            quantity: supplySlot.quantity,
            plannedWithin: supplyPlanId,
            availableFrom: supplySlot.available_from,
            atLocation: supplySlot.h3_cell,
        };
    }

    deficitLocationFields(location: string | undefined, canonical: string[]) {
        const loc = location ?? canonical[0];
        return {
            atLocation: loc,
            inScopeOf: loc ? [loc] : undefined,
        };
    }

    annotateChildCommitments(commitments: Commitment[], originLocation: string): void {
        for (const commitment of commitments) {
            commitment.inScopeOf = [
                ...(commitment.inScopeOf ?? []),
                originLocation,
            ];
        }
    }

    private sacrificeScore(scopeId: string): number {
        const qty = this.scopeSacrificeQty.get(scopeId) ?? 0;
        const members = this.memberCounts?.get(scopeId) ?? 1;
        return qty / members;
    }
}

// =============================================================================
// PLAN FOR SCOPE (thin wrapper)
// =============================================================================

export function planForScope(
    scopeIds: string[],
    horizon: { from: Date; to: Date },
    ctx: ScopePlanContext,
    subStores?: PlanStore[],
): ScopePlanResult {
    const strategy = new ScopeStrategy(
        ctx.parentOf,
        ctx.memberCounts,
        ctx.sacrificeDepth,
    );
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
    return planForUnit(strategy, scopeIds, horizon, unitCtx, subStores);
}

// =============================================================================
// SIGNAL HELPERS (deprecated — kept for backward compatibility)
// =============================================================================

import { parseDeficitNote } from './planning';
import type { SurplusSignal as SurplusSignalType } from './location-strategy';

/** @deprecated Read child PlanStore.intentsForTag() directly. */
export function buildScopePlanSignals(result: ScopePlanResult): ScopePlanSignals {
    const deficits: ScopeDeficitSignal[] = result.planStore.intentsForTag(PLAN_TAGS.DEFICIT).map(i => {
        const { originalShortfall, resolvedAt } = parseDeficitNote(i);
        return {
            plannedWithin: i.plannedWithin ?? '',
            intentId: i.id,
            specId: i.resourceConformsTo ?? '',
            action: i.action,
            shortfall: i.resourceQuantity?.hasNumericalValue ?? 0,
            due: i.due,
            scopeId: i.inScopeOf?.[0],
            source: i.resourceClassifiedAs?.includes(PLAN_TAGS.METABOLIC_DEBT) ? 'metabolic_debt' : 'unmet_demand',
            originalShortfall,
            resolvedAt,
        };
    });
    const surplus: SurplusSignalType[] = result.planStore.intentsForTag(PLAN_TAGS.SURPLUS).map(i => ({
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
