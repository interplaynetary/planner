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
import { PlanStore } from './planning';
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
    DemandSlotClass,
    SlotRecord,
    SurplusSignal,
    SpatialModel,
    ScopePolicy,
    SacrificePolicy,
    PlanningMode,
} from './location-strategy';

// Re-export types for backward compatibility
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
    sneIndex?: import('../algorithms/SNE').SNEIndex;
    agentIndex?: import('../indexes/agents').AgentIndex;
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

// --- SpatialModel: scope-based location handling ---
class ScopeSpatial implements SpatialModel {
    constructor(private parentOf?: Map<string, string>) {}

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

    deficitLocationFields(location: string | undefined, canonical: string[]) {
        const loc = location ?? canonical[0];
        return {
            atLocation: loc,
            inScopeOf: loc ? [loc] : undefined,
        };
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
}

// --- ScopePolicy: federation-specific behaviour ---
class FederationScopePolicy implements ScopePolicy {
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

    annotateChildCommitments(commitments: Commitment[], originLocation: string): void {
        for (const commitment of commitments) {
            commitment.inScopeOf = [
                ...(commitment.inScopeOf ?? []),
                originLocation,
            ];
        }
    }
}

// --- SacrificePolicy: proportional sacrifice ---
class ProportionalSacrifice implements SacrificePolicy {
    private sacrificeSteps = 0;
    private scopeSacrificeQty = new Map<string, number>();

    constructor(
        private memberCounts?: Map<string, number>,
        private maxSacrificeSteps: number = Infinity,
    ) {}

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

    selectRetractCandidates(remaining: Set<SlotRecord>, canonical: string[], limit: number): SlotRecord[] {
        const sorted = [...remaining].sort((a, b) => {
            const scopeA = a.slot.inScopeOf?.[0] ?? canonical[0];
            const scopeB = b.slot.inScopeOf?.[0] ?? canonical[0];
            return this.sacrificeScore(scopeA) - this.sacrificeScore(scopeB);
        });
        return sorted.slice(0, limit);
    }

    scoreCandidate(result: DependentDemandResult, slot: DemandSlot): number {
        const coverage = result.allocated.length + result.allocatedScheduledIds.size + result.processes.length;
        const effort = result.purchaseIntents.reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        return coverage - effort * 0.1;
    }

    isReExplodeSuccess(result: DependentDemandResult): boolean {
        return result.allocated.length > 0 ||
            result.allocatedScheduledIds.size > 0 ||
            result.processes.length > 0;
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
    const mode: PlanningMode = {
        spatial: new ScopeSpatial(ctx.parentOf),
        scope: new FederationScopePolicy(),
        sacrifice: new ProportionalSacrifice(ctx.memberCounts, ctx.sacrificeDepth ?? Infinity),
    };
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
        sneIndex: ctx.sneIndex,
        agentIndex: ctx.agentIndex,
    };
    return planForUnit(mode, scopeIds, horizon, unitCtx, subStores);
}

