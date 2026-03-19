/**
 * planForUnit — generic planning orchestrator parameterized by PlanningMode.
 *
 * Unifies the common algorithm from planForScope and planForRegion into a single
 * function. The 5 axes of difference (normalization, extraction, classification,
 * backtracking, Phase B observer) are delegated to a PlanningMode composed of
 * SpatialModel, ScopePolicy, and SacrificePolicy.
 *
 * Algorithm phases:
 *   Phase 0: Normalise location IDs (mode.spatial.normalize)
 *   Phase 1: Extract demand/supply slots (mode.spatial.extractSlots)
 *   Phase 2: Classify each demand slot (mode.spatial.classifySlot)
 *   Phase 3: Formulate
 *     Pass 0: Buffer pre-evaluation (opt-in: bufferZoneStore + bufferProfiles).
 *             Reserves capacity for red/yellow buffers on the main netter before Pass 1.
 *     Pass 1: Explode primary independent demands (class order → due date).
 *             Buffer guards defer demands that would push a stressed buffer below TOY.
 *     Derived: Compute replenishment demands from Pass 1 allocations
 *     Pass 2: Explode derived replenishment demands (composite tier×zone priority);
 *             collect metabolicDebt
 *     Pass 1b: Retry deferred demands after replenishment
 *     Backtrack: Retract demands to free capacity (mode.sacrifice.selectRetractCandidate);
 *               includes Pass 0 debts merged with Pass 2 debts
 *   Phase B: Forward-schedule unabsorbed supply (mode.spatial.observerForSupply)
 *   Phase 4: Collect result
 */

import { nanoid } from 'nanoid';

import type { Intent, BufferProfile } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import { PlanStore, PLAN_TAGS, PLANNING_PROCESS_SPEC, NON_CONSUMING_ACTIONS, type DeficitMeta, type ConservationMeta, type PlanningMeta } from './planning';
import { ProcessRegistry } from '../process-registry';
import { PlanNetter } from './netting';
import { dependentDemand, type DependentDemandResult } from '../algorithms/dependent-demand';
import { dependentSupply } from '../algorithms/dependent-supply';
import { bufferStatus, computeNFP, generateReplenishmentSignal, type NFPResult } from '../algorithms/ddmrp';
import { bufferTypeFromTags, compositeBufferPriority } from '../utils/buffer-type';
import type { BufferZoneStore } from '../knowledge/buffer-zones';
import type { DemandSlot } from '../indexes/independent-demand';
import type { IndependentDemandIndex } from '../indexes/independent-demand';
import type { IndependentSupplyIndex, SupplySlot } from '../indexes/independent-supply';
import type { Observer } from '../observation/observer';
import type {
    PlanningMode,
    SlotRecord,
    SurplusSignal,
    MetabolicDebt,
    Conflict,
    DemandSlotClass,
} from './location-strategy';

// =============================================================================
// CONTEXT AND RESULT TYPES
// =============================================================================

export interface UnitPlanContext {
    recipeStore: RecipeStore;
    observer: Observer;
    demandIndex: IndependentDemandIndex;
    supplyIndex: IndependentSupplyIndex;
    generateId?: () => string;
    agents?: { provider?: string; receiver?: string };
    config?: { insuranceFactor?: number };
    bufferAlerts?: Map<string, {
        onhand: number; tor: number; toy: number; tog: number;
        zone: 'red' | 'yellow' | 'green' | 'excess';
        tippingPointBreached?: boolean;
    }>;
    bufferZoneStore?: BufferZoneStore;
    bufferProfiles?: Map<string, BufferProfile>;
}

export interface UnitPlanResult {
    planStore: PlanStore;
    purchaseIntents: Intent[];
    unmetDemand: DemandSlot[];
    laborGaps: Intent[];
}

// =============================================================================
// PLANNING SESSION
// =============================================================================

export interface PlanningSession {
    mode: PlanningMode;
    canonical: string[];
    horizon: { from: Date; to: Date };
    ctx: UnitPlanContext;
    planStore: PlanStore;
    netter: PlanNetter;
    generateId: () => string;
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

const CLASS_ORDER: Record<string, number> = {
    'locally-satisfiable':     0,
    'transport-candidate':     1,
    'producible-with-imports': 2,
    'external-dependency':     3,
};

interface InternalDeficit {
    plannedWithin: string;
    intentId: string;
    specId: string;
    action: string;
    shortfall: number;
    due?: string;
    location?: string;
    source: 'unmet_demand' | 'metabolic_debt';
    originalShortfall?: number;
    resolvedAt?: string[];
}

export interface ExtractResult {
    rawDemands: DemandSlot[];
    extractedSupply: SupplySlot[];
    childProvenance: Map<string, { originalShortfall: number; resolvedAt: string[]; originLocation: string }>;
}

export interface FormulateResult {
    pass1Records: SlotRecord[];
    allPurchaseIntents: Intent[];
    unmetDemand: DemandSlot[];
    allDeficits: InternalDeficit[];
    allConservationData: Array<{
        specId: string; onhand: number; tor: number; toy: number; tog: number;
        zone: 'red' | 'yellow'; tippingPointBreached?: boolean;
    }>;
}

export interface SupplyResult {
    allSurplus: SurplusSignal[];
    supplyPurchaseIntents: Intent[];
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

export function mergePlanStores(subStores: PlanStore[], generateId?: () => string): PlanStore {
    const gen = generateId ?? (() => nanoid());
    const processes = new ProcessRegistry(gen);
    const merged = new PlanStore(processes, gen);
    for (const sub of subStores) {
        merged.merge(sub);
    }
    return merged;
}

export function detectConflicts(planStore: PlanStore, observer: Observer): Conflict[] {
    const conflicts: Conflict[] = [];

    const committedByResource = new Map<string, { total: number; candidates: string[] }>();
    for (const c of planStore.allCommitments()) {
        if (!c.resourceInventoriedAs) continue;
        if (NON_CONSUMING_ACTIONS.has(c.action)) continue;
        const rid = c.resourceInventoriedAs;
        const qty = c.resourceQuantity?.hasNumericalValue ?? 0;
        const entry = committedByResource.get(rid) ?? { total: 0, candidates: [] };
        entry.total += qty;
        entry.candidates.push(c.inputOf ?? c.id);
        committedByResource.set(rid, entry);
    }
    for (const [rid, { total, candidates }] of committedByResource) {
        const res = observer.getResource(rid);
        const onhand = res?.onhandQuantity?.hasNumericalValue ?? 0;
        if (total > onhand) {
            conflicts.push({
                type: 'inventory-overclaim',
                resourceOrAgentId: rid,
                overclaimed: total,
                candidates,
            });
        }
    }

    const workByAgent = new Map<string, { total: number; candidates: string[] }>();
    for (const c of planStore.allCommitments()) {
        if (c.action !== 'work') continue;
        if (!c.provider) continue;
        const agentId = c.provider;
        const hrs = c.effortQuantity?.hasNumericalValue ?? 0;
        const entry = workByAgent.get(agentId) ?? { total: 0, candidates: [] };
        entry.total += hrs;
        entry.candidates.push(c.inputOf ?? c.id);
        workByAgent.set(agentId, entry);
    }
    for (const i of planStore.allIntents()) {
        if (i.action !== 'work') continue;
        if (!i.provider) continue;
        const agentId = i.provider;
        const hrs = i.effortQuantity?.hasNumericalValue ?? 0;
        const entry = workByAgent.get(agentId) ?? { total: 0, candidates: [] };
        entry.total += hrs;
        entry.candidates.push(i.inputOf ?? i.id);
        workByAgent.set(agentId, entry);
    }
    // Capacity contention requires AgentIndex — deferred.
    void workByAgent;

    return conflicts;
}

// =============================================================================
// PLAN FOR UNIT
// =============================================================================

// =============================================================================
// PHASE FUNCTIONS
// =============================================================================

/** Phase 0: Normalize location IDs. */
export function normalizePhase(mode: PlanningMode, ids: string[]): string[] {
    return mode.spatial.normalize(ids);
}

/** Phase 1: Extract demand/supply slots and child signals. */
export function extractPhase(
    session: PlanningSession,
    subStores?: PlanStore[],
): ExtractResult {
    const { demands: rawDemands, supply: extractedSupply } = session.mode.spatial.extractSlots(
        session.canonical, session.horizon, session.ctx.demandIndex, session.ctx.supplyIndex,
    );

    const childProvenance = new Map<string, {
        originalShortfall: number; resolvedAt: string[]; originLocation: string;
    }>();
    if (subStores && subStores.length > 0) {
        const seenIntentId = new Set<string>();
        for (const isDebt of [true, false]) {
            for (const childStore of subStores) {
                for (const i of childStore.intentsForTag(PLAN_TAGS.DEFICIT)) {
                    const hasDebtTag = i.resourceClassifiedAs?.includes(PLAN_TAGS.METABOLIC_DEBT) ?? false;
                    if (hasDebtTag !== isDebt) continue;
                    if (seenIntentId.has(i.id)) continue;
                    seenIntentId.add(i.id);
                    const deficitMeta = childStore.getMeta(i.id) as DeficitMeta | undefined;
                    const originalShortfall = deficitMeta?.originalShortfall ?? i.resourceQuantity?.hasNumericalValue ?? 0;
                    const resolvedAt = deficitMeta?.resolvedAt ?? [];
                    const shortfall = i.resourceQuantity?.hasNumericalValue ?? 0;
                    const originLocation = i.inScopeOf?.[0] ?? i.atLocation ?? '';
                    childProvenance.set(i.id, {
                        originalShortfall,
                        resolvedAt: resolvedAt.length > 0 ? resolvedAt : (originLocation ? [originLocation] : []),
                        originLocation,
                    });
                    rawDemands.push({
                        intent_id: i.id,
                        spec_id: i.resourceConformsTo ?? '',
                        action: i.action,
                        fulfilled_quantity: 0,
                        fulfilled_hours: 0,
                        required_quantity: shortfall,
                        required_hours: 0,
                        remaining_quantity: shortfall,
                        remaining_hours: 0,
                        due: i.due,
                        h3_cell: i.atLocation,
                    });
                }
            }
        }

        const seenSurplus = new Set<string>();
        for (const childStore of subStores) {
            for (const i of childStore.intentsForTag(PLAN_TAGS.SURPLUS)) {
                const key = `${i.plannedWithin}:${i.resourceConformsTo}`;
                if (seenSurplus.has(key)) continue;
                seenSurplus.add(key);
                extractedSupply.push({
                    id: `surplus:${key}`,
                    slot_type: 'inventory' as const,
                    spec_id: i.resourceConformsTo ?? '',
                    quantity: i.resourceQuantity?.hasNumericalValue ?? 0,
                    hours: 0,
                    h3_cell: i.atLocation,
                    available_from: i.hasPointInTime,
                    source_id: i.plannedWithin ?? '',
                });
            }
        }
    }

    return { rawDemands, extractedSupply, childProvenance };
}

/** Phase 2: Classify each demand slot. */
export function classifyPhase(
    session: PlanningSession,
    demands: DemandSlot[],
): Array<{ slot: DemandSlot; slotClass: DemandSlotClass }> {
    return demands.map(slot => ({
        slot,
        slotClass: session.mode.spatial.classifySlot(slot, session.canonical, session.ctx.supplyIndex, session.ctx.recipeStore),
    }));
}

type AlertMap = Map<string, {
    onhand: number; tor: number; toy: number; tog: number;
    zone: 'red' | 'yellow' | 'green' | 'excess';
    tippingPointBreached?: boolean;
}>;

function computeEffectiveAlerts(
    bufferZoneStore: BufferZoneStore,
    bufferProfiles: Map<string, BufferProfile> | undefined,
    recipeStore: RecipeStore,
    planStore: PlanStore,
    observer: Observer,
    generateId: () => string,
    agents?: { provider?: string; receiver?: string },
): AlertMap {
    const alerts: AlertMap = new Map();
    const today = new Date();
    for (const bz of bufferZoneStore.allBufferZones()) {
        const profile = bufferProfiles?.get(bz.profileId);
        let onhand: number;
        let zoneStatus: 'red' | 'yellow' | 'green' | 'excess';
        let nfpResult: NFPResult | undefined;
        if (profile) {
            nfpResult = computeNFP(bz.specId, bz, profile, planStore, observer, today);
            zoneStatus = nfpResult.zone;
            onhand = nfpResult.onhand;
        } else {
            onhand = observer.conformingResources(bz.specId)
                .reduce((s, r) => s + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
            const status = bufferStatus(onhand, bz);
            zoneStatus = status.zone;
        }
        const tippingPointBreached = bz.tippingPoint !== undefined ? onhand < bz.tippingPoint : undefined;
        alerts.set(bz.specId, {
            onhand, tor: bz.tor, toy: bz.toy, tog: bz.tog,
            zone: zoneStatus,
            tippingPointBreached,
        });
        if (zoneStatus === 'red' || zoneStatus === 'yellow') {
            const spec = recipeStore.getResourceSpec(bz.specId);
            if (!spec?.resourceClassifiedAs?.includes('tag:buffer:ecological')) {
                const noOpenSignal = !planStore.intentsForTag(PLAN_TAGS.REPLENISHMENT)
                    .some(i => i.resourceConformsTo === bz.specId && !i.finished);
                if (noOpenSignal) {
                    const nfpForSignal: NFPResult = nfpResult ?? {
                        onhand, onorder: 0, qualifiedDemand: 0, nfp: onhand,
                        zone: zoneStatus, priority: bz.tog > 0 ? onhand / bz.tog : 0,
                    };
                    const sig = generateReplenishmentSignal(bz.specId, bz.atLocation, bz, nfpForSignal, today, generateId);
                    const replenMeta = {
                        onhand: sig.onhand, onorder: sig.onorder,
                        qualifiedDemand: sig.qualifiedDemand, nfp: sig.nfp,
                        priority: sig.priority, zone: sig.zone,
                        recommendedQty: sig.recommendedQty, dueDate: sig.dueDate,
                        bufferZoneId: sig.bufferZoneId, createdAt: sig.createdAt,
                        status: 'open' as const,
                    };
                    planStore.addIntent({
                        id: sig.id, action: 'produce', receiver: agents?.receiver,
                        resourceConformsTo: sig.specId,
                        resourceQuantity: { hasNumericalValue: sig.recommendedQty, hasUnit: bz.aduUnit },
                        due: `${sig.dueDate}T00:00:00.000Z`,
                        ...(sig.atLocation ? { atLocation: sig.atLocation } : {}),
                        resourceClassifiedAs: [PLAN_TAGS.REPLENISHMENT],
                        finished: false,
                    });
                    planStore.setMeta(sig.id, { kind: 'replenishment', ...replenMeta });
                }
            }
        }
    }
    return alerts;
}

/** Phase 3: Formulate — Pass 1, derived demands, Pass 2, backtracking. */
export function formulatePhase(
    session: PlanningSession,
    classified: Array<{ slot: DemandSlot; slotClass: DemandSlotClass }>,
    extractedSupply: SupplySlot[],
    subStores?: PlanStore[],
    childProvenance?: Map<string, { originalShortfall: number; resolvedAt: string[]; originLocation: string }>,
): FormulateResult {
    const { mode, canonical, horizon, ctx, planStore, netter, generateId } = session;
    const childProvenanceByIntentId = childProvenance ?? new Map();
    const processes = planStore.processes;
    const econ: import('./planning').EconomicContext = {
        recipeStore: ctx.recipeStore, planStore, processes, observer: ctx.observer,
    };

    const seededIntentIds = mode.scope.injectFederationSeeds(planStore, ctx.supplyIndex);

    const pass1Records: SlotRecord[] = [];
    const allPurchaseIntents: Intent[] = [];
    const unmetDemand: DemandSlot[] = [];
    const replenDebts: MetabolicDebt[] = [];
    const allDeficits: InternalDeficit[] = [];
    const allConservationData: Array<{
        specId: string; onhand: number; tor: number; toy: number; tog: number;
        zone: 'red' | 'yellow'; tippingPointBreached?: boolean;
    }> = [];

    const sortedSlots = [...classified].sort((a, b) => {
        const classDiff = (CLASS_ORDER[a.slotClass] ?? 3) - (CLASS_ORDER[b.slotClass] ?? 3);
        if (classDiff !== 0) return classDiff;
        const dueA = new Date(a.slot.due ?? 0).getTime();
        const dueB = new Date(b.slot.due ?? 0).getTime();
        return dueA - dueB;
    });

    // --- Pass 0: Buffer pre-evaluation (opt-in) ---
    const bufferFirstActive = !!(ctx.bufferZoneStore && ctx.bufferProfiles);
    let precomputedAlerts: AlertMap | undefined;
    const pass0Debts: MetabolicDebt[] = [];
    const pass0HandledSpecs = new Set<string>();
    const deferredDemands: Array<{ slot: DemandSlot; slotClass: DemandSlotClass }> = [];

    if (bufferFirstActive) {
        precomputedAlerts = computeEffectiveAlerts(
            ctx.bufferZoneStore!, ctx.bufferProfiles, ctx.recipeStore, planStore, ctx.observer, generateId, ctx.agents,
        );

        // Build Pass 0 replenishment demands for red/yellow non-ecological buffers
        const pass0Demands: Array<{ specId: string; qty: number; priority: number }> = [];
        for (const [specId, alert] of precomputedAlerts) {
            if (alert.zone !== 'red' && alert.zone !== 'yellow') continue;
            const spec = ctx.recipeStore.getResourceSpec(specId);
            if (spec?.resourceClassifiedAs?.includes('tag:buffer:ecological')) continue;
            const qty = Math.max(0, alert.tog - alert.onhand);
            if (qty <= 1e-9) continue;
            const bType = bufferTypeFromTags(spec?.resourceClassifiedAs ?? []);
            const priority = compositeBufferPriority(bType, alert.zone);
            pass0Demands.push({ specId, qty, priority });
        }
        pass0Demands.sort((a, b) => a.priority - b.priority);

        // Explode Pass 0 demands on main netter (reserves capacity before Pass 1)
        for (const { specId, qty } of pass0Demands) {
            const pass0PlanId = `pass0-replenish-${generateId()}`;
            planStore.addPlan({ id: pass0PlanId, name: `Buffer-first replenishment for ${specId}` });
            const result = dependentDemand({
                ...econ, observer: undefined,
                planId: pass0PlanId, demandSpecId: specId, demandQuantity: qty,
                dueDate: horizon.to, netter, agents: ctx.agents, generateId,
            });
            allPurchaseIntents.push(...result.purchaseIntents);
            const purchasedQty = result.purchaseIntents
                .filter(i => i.resourceConformsTo === specId)
                .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
            if (purchasedQty > 1e-9) {
                pass0Debts.push({ specId, shortfall: purchasedQty, plannedWithin: pass0PlanId });
            }
            pass0HandledSpecs.add(specId);
        }
    }

    // Buffer guard helper — defers demands that would push a stressed buffer below TOY
    function shouldDeferForBufferGuard(
        specId: string,
        quantity: number,
        alerts: AlertMap | undefined,
    ): boolean {
        if (!alerts) return false;
        const alert = alerts.get(specId);
        if (!alert || (alert.zone !== 'red' && alert.zone !== 'yellow')) return false;
        const available = netter.netAvailableQty(specId);
        return (available - quantity) < alert.toy;
    }

    // --- Pass 1: primary independent demands ---
    for (const { slot, slotClass } of sortedSlots) {
        if (!slot.spec_id) continue;

        if (bufferFirstActive && shouldDeferForBufferGuard(slot.spec_id, slot.remaining_quantity, precomputedAlerts)) {
            deferredDemands.push({ slot, slotClass });
            continue;
        }

        const planId = `plan-${generateId()}`;
        planStore.addPlan({ id: planId, name: `Demand plan for ${slot.spec_id}` });

        const transportResult = mode.scope.handleTransportCandidate(
            slot, planStore, planId, ctx.recipeStore, ctx.agents,
        );
        if (transportResult && slotClass === 'transport-candidate') {
            pass1Records.push({ slot, result: transportResult, slotClass });
            allPurchaseIntents.push(...transportResult.purchaseIntents);
            continue;
        }

        const result = dependentDemand({
            ...econ,
            planId,
            demandSpecId: slot.spec_id,
            demandQuantity: slot.remaining_quantity,
            dueDate: slot.due ? new Date(slot.due) : horizon.to,
            netter,
            atLocation: mode.spatial.locationOf(slot),
            agents: ctx.agents,
            generateId,
            honorDecouplingPoints: true,
        });

        pass1Records.push({ slot, result, slotClass });
        allPurchaseIntents.push(...result.purchaseIntents);

        const childProvPass1 = childProvenanceByIntentId.get(slot.intent_id);
        if (childProvPass1?.originLocation) {
            mode.scope.annotateChildCommitments(result.commitments, childProvPass1.originLocation);
        }
    }

    // Emit deficit signals for Pass 1
    for (const record of pass1Records) {
        const unresolved = record.result.purchaseIntents
            .filter(i => i.resourceConformsTo === record.slot.spec_id)
            .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        if (unresolved > 1e-9) {
            const childProv = childProvenanceByIntentId.get(record.slot.intent_id);
            const resolvedHere = childProv
                ? (childProv.originalShortfall ?? unresolved) - unresolved > 1e-9
                : false;
            const location = mode.spatial.locationOf(record.slot) ?? canonical[0];
            allDeficits.push({
                plannedWithin: record.result.plan.id,
                intentId: record.slot.intent_id,
                specId: record.slot.spec_id ?? '',
                action: record.slot.action,
                shortfall: unresolved,
                due: record.slot.due,
                location,
                source: 'unmet_demand',
                originalShortfall: childProv?.originalShortfall ?? unresolved,
                resolvedAt: resolvedHere
                    ? [...(childProv?.resolvedAt ?? []), canonical[0]]
                    : childProv?.resolvedAt,
            });
        }
    }

    // Emit boundary stop deficit signals
    for (const record of pass1Records) {
        for (const [bufferSpecId, qty] of record.result.boundaryStops) {
            if (qty <= 1e-9) continue;
            const location = mode.spatial.locationOf(record.slot) ?? canonical[0];
            allDeficits.push({
                plannedWithin: record.result.plan.id,
                intentId: `boundary:${record.slot.intent_id}:${bufferSpecId}`,
                specId: bufferSpecId,
                action: 'produce',
                shortfall: qty,
                due: record.slot.due,
                location,
                source: 'unmet_demand',
            });
        }
    }

    // --- Derive effectiveAlerts ---
    const effectiveAlerts = bufferFirstActive
        ? precomputedAlerts
        : (ctx.bufferZoneStore
            ? computeEffectiveAlerts(ctx.bufferZoneStore, ctx.bufferProfiles, ctx.recipeStore, planStore, ctx.observer, generateId, ctx.agents)
            : ctx.bufferAlerts);

    // --- Compute derived replenishment demands ---
    const consumedBySpec = new Map<string, number>();
    const boundaryBySpec = new Map<string, number>();
    for (const { result } of pass1Records) {
        for (const alloc of result.allocated) {
            consumedBySpec.set(alloc.specId, (consumedBySpec.get(alloc.specId) ?? 0) + alloc.quantity);
        }
        for (const [specId, qty] of result.boundaryStops) {
            boundaryBySpec.set(specId, (boundaryBySpec.get(specId) ?? 0) + qty);
        }
    }
    const derivedDemands: Array<{ specId: string; qty: number; zone?: 'red' | 'yellow' | 'green' | 'excess' }> = [];
    const allBufferSpecs = new Set([...consumedBySpec.keys(), ...boundaryBySpec.keys()]);
    for (const specId of allBufferSpecs) {
        if (pass0HandledSpecs.has(specId)) continue;
        const qty = (consumedBySpec.get(specId) ?? 0) + (boundaryBySpec.get(specId) ?? 0);
        const spec = ctx.recipeStore.getResourceSpec(specId);
        if (!spec?.resourceClassifiedAs?.includes(PLAN_TAGS.REPLENISHMENT_REQUIRED)) continue;
        if (spec.resourceClassifiedAs?.includes('tag:buffer:ecological')) continue;

        if (effectiveAlerts) {
            const alert = effectiveAlerts.get(specId);
            if (alert) {
                if (alert.zone === 'green' || alert.zone === 'excess') continue;
                const replenQty = Math.max(0, alert.tog - alert.onhand);
                if (replenQty > 1e-9) derivedDemands.push({ specId, qty: replenQty, zone: alert.zone });
                continue;
            }
        }
        derivedDemands.push({ specId, qty });
    }

    if (effectiveAlerts) {
        for (const [specId, alert] of effectiveAlerts) {
            if (pass0HandledSpecs.has(specId)) continue;
            if (alert.zone === 'red' || alert.zone === 'yellow') {
                const spec = ctx.recipeStore.getResourceSpec(specId);
                if (spec?.resourceClassifiedAs?.includes('tag:buffer:ecological')) {
                    if (!allConservationData.some(c => c.specId === specId)) {
                        allConservationData.push({
                            specId,
                            onhand: alert.onhand, tor: alert.tor, toy: alert.toy, tog: alert.tog,
                            zone: alert.zone, tippingPointBreached: alert.tippingPointBreached,
                        });
                    }
                    continue;
                }
                const replenQty = Math.max(0, alert.tog - alert.onhand);
                if (replenQty > 1e-9 && !derivedDemands.some(d => d.specId === specId)) {
                    derivedDemands.push({ specId, qty: replenQty, zone: alert.zone });
                }
            }
        }
    }

    derivedDemands.sort((a, b) => {
        const specA = ctx.recipeStore.getResourceSpec(a.specId);
        const specB = ctx.recipeStore.getResourceSpec(b.specId);
        const tierA = bufferTypeFromTags(specA?.resourceClassifiedAs ?? []);
        const tierB = bufferTypeFromTags(specB?.resourceClassifiedAs ?? []);
        return compositeBufferPriority(tierA, a.zone ?? 'green')
             - compositeBufferPriority(tierB, b.zone ?? 'green');
    });

    // --- Pass 2: derived replenishment demands ---
    const replenNetter = netter.fork({ observer: undefined });
    for (const { specId, qty } of derivedDemands) {
        const replenPlanId = `replenish-${generateId()}`;
        planStore.addPlan({ id: replenPlanId, name: `Replenishment for ${specId}` });
        const result = dependentDemand({
            ...econ, observer: undefined,
            planId: replenPlanId, demandSpecId: specId, demandQuantity: qty,
            dueDate: horizon.to, netter: replenNetter, agents: ctx.agents, generateId,
        });
        allPurchaseIntents.push(...result.purchaseIntents);
        const purchasedQty = result.purchaseIntents
            .filter(i => i.resourceConformsTo === specId)
            .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        if (purchasedQty > 1e-9) {
            replenDebts.push({ specId, shortfall: purchasedQty, plannedWithin: replenPlanId });
        }
    }

    // --- Pass 1b: retry deferred demands after replenishment ---
    for (const { slot, slotClass } of deferredDemands) {
        if (!slot.spec_id) continue;
        const planId = `plan-deferred-${generateId()}`;
        planStore.addPlan({ id: planId, name: `Deferred demand for ${slot.spec_id}` });
        const result = dependentDemand({
            ...econ, planId,
            demandSpecId: slot.spec_id, demandQuantity: slot.remaining_quantity,
            dueDate: slot.due ? new Date(slot.due) : horizon.to,
            netter, atLocation: mode.spatial.locationOf(slot),
            agents: ctx.agents, generateId, honorDecouplingPoints: true,
        });
        pass1Records.push({ slot, result, slotClass });
        allPurchaseIntents.push(...result.purchaseIntents);
        const childProv = childProvenanceByIntentId.get(slot.intent_id);
        if (childProv?.originLocation) {
            mode.scope.annotateChildCommitments(result.commitments, childProv.originLocation);
        }
    }

    // Merge Pass 0 debts into backtracking
    replenDebts.push(...pass0Debts);

    // --- Backtracking ---
    if (replenDebts.length > 0) {
        const remaining = new Set(pass1Records);
        while (replenDebts.length > 0 && remaining.size > 0) {
            if (mode.sacrifice.recordSacrifice === undefined) break;

            // Scored backtracking: when optional multi-candidate methods are present
            if (mode.sacrifice.selectRetractCandidates && mode.sacrifice.scoreCandidate) {
                const candidates = mode.sacrifice.selectRetractCandidates(remaining, canonical, 3);
                let best: { score: number; candidate: SlotRecord | undefined; result: import('../algorithms/dependent-demand').DependentDemandResult | null } =
                    { score: -Infinity, candidate: undefined, result: null };
                for (const c of candidates) {
                    const trialNetter = netter.fork({});
                    trialNetter.retract(c.result);
                    const trialPlanId = `trial-${generateId()}`;
                    planStore.addPlan({ id: trialPlanId, name: `Trial for ${c.slot.spec_id}` });
                    const trialResult = c.slot.spec_id ? dependentDemand({
                        ...econ, planId: trialPlanId,
                        demandSpecId: c.slot.spec_id, demandQuantity: c.slot.remaining_quantity,
                        dueDate: c.slot.due ? new Date(c.slot.due) : horizon.to,
                        netter: trialNetter, atLocation: mode.spatial.locationOf(c.slot),
                        agents: ctx.agents, generateId, honorDecouplingPoints: true,
                    }) : null;
                    if (trialResult) {
                        const score = mode.sacrifice.scoreCandidate(trialResult, c.slot);
                        if (score > best.score) best = { score, candidate: c, result: trialResult };
                    }
                    // Clean up trial plan records
                    planStore.removeRecordsForPlan(trialPlanId);
                }
                if (best.candidate) {
                    remaining.delete(best.candidate);
                    netter.retract(best.candidate.result);
                    // Re-explode on real netter
                    const reExplodePlanId = `reexplode-${generateId()}`;
                    planStore.addPlan({ id: reExplodePlanId, name: `Re-explode for ${best.candidate.slot.spec_id}` });
                    const reResult = best.candidate.slot.spec_id ? dependentDemand({
                        ...econ, planId: reExplodePlanId,
                        demandSpecId: best.candidate.slot.spec_id, demandQuantity: best.candidate.slot.remaining_quantity,
                        dueDate: best.candidate.slot.due ? new Date(best.candidate.slot.due) : horizon.to,
                        netter, atLocation: mode.spatial.locationOf(best.candidate.slot),
                        agents: ctx.agents, generateId, honorDecouplingPoints: true,
                    }) : null;
                    if (reResult && mode.sacrifice.isReExplodeSuccess(reResult)) {
                        const backtrackChildProv = childProvenanceByIntentId.get(best.candidate.slot.intent_id);
                        if (backtrackChildProv?.originLocation) {
                            mode.scope.annotateChildCommitments(reResult.commitments, backtrackChildProv.originLocation);
                        }
                        pass1Records.push({ slot: best.candidate.slot, slotClass: best.candidate.slotClass, result: reResult });
                    } else {
                        const candidateLocation = mode.spatial.locationOf(best.candidate.slot) ?? canonical[0];
                        mode.sacrifice.recordSacrifice(best.candidate.slot, canonical);
                        unmetDemand.push(best.candidate.slot);
                        allDeficits.push({
                            plannedWithin: best.candidate.result.plan.id,
                            intentId: best.candidate.slot.intent_id,
                            specId: best.candidate.slot.spec_id ?? '',
                            action: best.candidate.slot.action,
                            shortfall: best.candidate.slot.remaining_quantity,
                            due: best.candidate.slot.due,
                            location: candidateLocation,
                            source: 'unmet_demand',
                        });
                    }
                    const idx = pass1Records.indexOf(best.candidate);
                    if (idx >= 0) pass1Records.splice(idx, 1);
                    continue;
                }
            }

            // Existing greedy path
            const candidate = mode.sacrifice.selectRetractCandidate(remaining, canonical);
            if (!candidate) break;
            remaining.delete(candidate);

            netter.retract(candidate.result);

            const retryReplenNetter = netter.fork({ observer: undefined });
            const resolvedDebt: string[] = [];
            for (const debt of replenDebts) {
                const retryPlanId = `replenish-retry-${generateId()}`;
                planStore.addPlan({ id: retryPlanId, name: `Retry replenishment for ${debt.specId}` });
                const reResult = dependentDemand({
                    ...econ, observer: undefined,
                    planId: retryPlanId, demandSpecId: debt.specId, demandQuantity: debt.shortfall,
                    dueDate: horizon.to, netter: retryReplenNetter, agents: ctx.agents, generateId,
                });
                allPurchaseIntents.push(...reResult.purchaseIntents);
                const newPurchasedQty = reResult.purchaseIntents
                    .filter(i => i.resourceConformsTo === debt.specId)
                    .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
                if (newPurchasedQty < debt.shortfall - 1e-9) debt.shortfall = newPurchasedQty;
                if (newPurchasedQty <= 1e-9) resolvedDebt.push(debt.specId);
            }
            replenDebts.splice(0, replenDebts.length, ...replenDebts.filter(d => !resolvedDebt.includes(d.specId)));

            const reExplodePlanId = `reexplode-${generateId()}`;
            planStore.addPlan({ id: reExplodePlanId, name: `Re-explode for ${candidate.slot.spec_id}` });
            const reResult = candidate.slot.spec_id ? dependentDemand({
                ...econ, planId: reExplodePlanId,
                demandSpecId: candidate.slot.spec_id, demandQuantity: candidate.slot.remaining_quantity,
                dueDate: candidate.slot.due ? new Date(candidate.slot.due) : horizon.to,
                netter, atLocation: mode.spatial.locationOf(candidate.slot),
                agents: ctx.agents, generateId, honorDecouplingPoints: true,
            }) : null;

            if (reResult && mode.sacrifice.isReExplodeSuccess(reResult)) {
                const backtrackChildProv = childProvenanceByIntentId.get(candidate.slot.intent_id);
                if (backtrackChildProv?.originLocation) {
                    mode.scope.annotateChildCommitments(reResult.commitments, backtrackChildProv.originLocation);
                }
                pass1Records.push({ slot: candidate.slot, slotClass: candidate.slotClass, result: reResult });
            } else {
                const candidateLocation = mode.spatial.locationOf(candidate.slot) ?? canonical[0];
                const limitReached = mode.sacrifice.recordSacrifice(candidate.slot, canonical);
                unmetDemand.push(candidate.slot);
                const backtrackProv = childProvenanceByIntentId.get(candidate.slot.intent_id);
                allDeficits.push({
                    plannedWithin: candidate.result.plan.id,
                    intentId: candidate.slot.intent_id,
                    specId: candidate.slot.spec_id ?? '',
                    action: candidate.slot.action,
                    shortfall: candidate.slot.remaining_quantity,
                    due: candidate.slot.due,
                    location: candidateLocation,
                    source: 'unmet_demand',
                    originalShortfall: backtrackProv?.originalShortfall ?? candidate.slot.remaining_quantity,
                    resolvedAt: backtrackProv?.resolvedAt,
                });
                if (limitReached) break;
            }

            const idx = pass1Records.indexOf(candidate);
            if (idx >= 0) pass1Records.splice(idx, 1);
        }
    }

    // Emit deficit signals for unresolved replenDebts
    for (const debt of replenDebts) {
        allDeficits.push({
            plannedWithin: debt.plannedWithin,
            intentId: `synthetic:debt:${debt.plannedWithin}:${debt.specId}`,
            specId: debt.specId,
            action: 'produce',
            shortfall: debt.shortfall,
            location: canonical[0],
            source: 'metabolic_debt',
        });
    }

    // Remove federation boundary seeds
    if (seededIntentIds.length > 0) {
        planStore.removeRecords({ intentIds: seededIntentIds });
        netter.pruneStale();
    }

    return { pass1Records, allPurchaseIntents, unmetDemand, allDeficits, allConservationData };
}

/** Phase B: Forward-schedule unabsorbed supply. */
export function supplyPhase(
    session: PlanningSession,
    extractedSupply: SupplySlot[],
): SupplyResult {
    const { mode, horizon, ctx, planStore, netter, generateId } = session;
    const processes = planStore.processes;
    const econ: import('./planning').EconomicContext = {
        recipeStore: ctx.recipeStore, planStore, processes, observer: ctx.observer,
    };
    const allSurplus: SurplusSignal[] = [];
    const supplyPurchaseIntents: Intent[] = [];

    for (const supplySlot of extractedSupply) {
        if (!supplySlot.spec_id) continue;
        if (supplySlot.slot_type === 'labor') continue;

        const supplyPlanId = `supply-${generateId()}`;
        planStore.addPlan({ id: supplyPlanId, name: `Supply plan for ${supplySlot.spec_id}` });

        const directSurplus = mode.scope.handleScheduledReceipt(
            supplySlot, planStore, processes, ctx.recipeStore, generateId, supplyPlanId,
        );
        if (directSurplus) {
            allSurplus.push(directSurplus);
            continue;
        }

        const supplyObserver = mode.spatial.observerForSupply(ctx.observer, session.canonical);
        const result = dependentSupply({
            ...econ,
            observer: supplyObserver,
            planId: supplyPlanId,
            supplySpecId: supplySlot.spec_id,
            supplyQuantity: supplySlot.quantity,
            availableFrom: supplySlot.available_from
                ? new Date(supplySlot.available_from)
                : horizon.from,
            netter,
            agents: ctx.agents,
            generateId,
        });

        for (const s of result.surplus) {
            allSurplus.push({
                specId: s.specId,
                quantity: s.quantity,
                plannedWithin: supplyPlanId,
                availableFrom: supplySlot.available_from,
                atLocation: supplySlot.h3_cell,
            });
        }
        supplyPurchaseIntents.push(...result.purchaseIntents);
    }

    return { allSurplus, supplyPurchaseIntents };
}

/** Phase 4: Collect — merge conflicts, emit signals, return result. */
export function collectPhase(
    session: PlanningSession,
    formulate: FormulateResult,
    supply: SupplyResult,
    subStores?: PlanStore[],
): UnitPlanResult {
    const { mode, canonical, horizon, ctx, planStore, netter, generateId } = session;
    const childProvenanceByIntentId = new Map<string, { originalShortfall: number; resolvedAt: string[]; originLocation: string }>();
    if (subStores && subStores.length > 0) {
        for (const childStore of subStores) {
            for (const i of childStore.intentsForTag(PLAN_TAGS.DEFICIT)) {
                const deficitMeta = childStore.getMeta(i.id) as DeficitMeta | undefined;
                const originalShortfall = deficitMeta?.originalShortfall ?? i.resourceQuantity?.hasNumericalValue ?? 0;
                const resolvedAt = deficitMeta?.resolvedAt ?? [];
                const originLocation = i.inScopeOf?.[0] ?? i.atLocation ?? '';
                childProvenanceByIntentId.set(i.id, {
                    originalShortfall,
                    resolvedAt: resolvedAt.length > 0 ? resolvedAt : (originLocation ? [originLocation] : []),
                    originLocation,
                });
            }
        }
    }

    const econ: import('./planning').EconomicContext = {
        recipeStore: ctx.recipeStore, planStore, processes: planStore.processes, observer: ctx.observer,
    };

    const { pass1Records, allPurchaseIntents, unmetDemand, allDeficits, allConservationData } = formulate;
    allPurchaseIntents.push(...supply.supplyPurchaseIntents);
    const { allSurplus } = supply;

    // Merge planner: conflict detection and surgical resolution
    if (subStores && subStores.length > 0) {
        let conflicts = detectConflicts(planStore, ctx.observer);
        let iterations = 0;
        const MAX_ITERATIONS = 10;
        while (conflicts.length > 0 && iterations < MAX_ITERATIONS) {
            iterations++;
            for (const conflict of conflicts) {
                if (conflict.type !== 'inventory-overclaim') continue;
                const competingProcessIds = conflict.candidates.filter(Boolean);
                const scored = competingProcessIds.map(procId => {
                    const record = pass1Records.find(r => r.result.processes.some(p => p.id === procId));
                    const due = record?.slot.due ? new Date(record.slot.due).getTime() : 0;
                    return { procId, due, record };
                });
                scored.sort((a, b) => {
                    const aClass = CLASS_ORDER[a.record?.slotClass ?? 'external-dependency'] ?? 3;
                    const bClass = CLASS_ORDER[b.record?.slotClass ?? 'external-dependency'] ?? 3;
                    const classDiff = bClass - aClass;
                    if (classDiff !== 0) return classDiff;
                    return b.due - a.due;
                });
                for (const { record } of scored) {
                    if (!record) continue;
                    netter.retract(record.result);
                    unmetDemand.push(record.slot);
                    const mergeProv = childProvenanceByIntentId.get(record.slot.intent_id);
                    const mergeLocation = mode.spatial.locationOf(record.slot) ?? canonical[0];
                    allDeficits.push({
                        plannedWithin: record.result.plan.id,
                        intentId: record.slot.intent_id,
                        specId: record.slot.spec_id ?? '',
                        action: record.slot.action,
                        shortfall: record.slot.remaining_quantity,
                        due: record.slot.due,
                        location: mergeLocation,
                        source: 'unmet_demand',
                        originalShortfall: mergeProv?.originalShortfall ?? record.slot.remaining_quantity,
                        resolvedAt: mergeProv?.resolvedAt,
                    });
                    const { slot } = record;
                    if (slot.spec_id) {
                        const mergeReplanId = `merge-replan-${generateId()}`;
                        planStore.addPlan({ id: mergeReplanId, name: `Merge replan for ${slot.spec_id}` });
                        const reResult = dependentDemand({
                            ...econ, planId: mergeReplanId,
                            demandSpecId: slot.spec_id, demandQuantity: slot.remaining_quantity,
                            dueDate: slot.due ? new Date(slot.due) : horizon.to,
                            netter, agents: ctx.agents, generateId, honorDecouplingPoints: true,
                        });
                        allPurchaseIntents.push(...reResult.purchaseIntents);
                        const mergeChildProv = childProvenanceByIntentId.get(slot.intent_id);
                        if (mergeChildProv?.originLocation) {
                            mode.scope.annotateChildCommitments(reResult.commitments, mergeChildProv.originLocation);
                        }
                    }
                    const newConflicts = detectConflicts(planStore, ctx.observer);
                    const stillConflicted = newConflicts.some(nc => nc.resourceOrAgentId === conflict.resourceOrAgentId);
                    if (!stillConflicted) break;
                }
            }
            conflicts = detectConflicts(planStore, ctx.observer);
        }
    }

    // Collect
    const laborGaps = planStore.allIntents().filter(i => i.action === 'work' && i.provider === undefined);

    planStore.removeRecords({
        intentIds: [
            ...planStore.intentsForTag(PLAN_TAGS.DEFICIT),
            ...planStore.intentsForTag(PLAN_TAGS.SURPLUS),
            ...planStore.intentsForTag(PLAN_TAGS.CONSERVATION),
        ].map(i => i.id),
    });

    for (const d of allDeficits) {
        const unit = planStore.getIntent(d.intentId)?.resourceQuantity?.hasUnit ?? 'unit';
        const locFields = mode.spatial.deficitLocationFields(d.location, canonical);
        const deficitMeta = { originalShortfall: d.originalShortfall ?? d.shortfall, resolvedAt: d.resolvedAt ?? [] };
        const intent = planStore.addIntent({
            id: d.intentId,
            action: d.action as import('../schemas').VfAction,
            resourceConformsTo: d.specId,
            resourceQuantity: { hasNumericalValue: d.shortfall, hasUnit: unit },
            due: d.due, atLocation: locFields.atLocation,
            plannedWithin: d.plannedWithin, inScopeOf: locFields.inScopeOf,
            resourceClassifiedAs: [PLAN_TAGS.DEFICIT, ...(d.source === 'metabolic_debt' ? [PLAN_TAGS.METABOLIC_DEBT] : [])],
            finished: false,
        });
        planStore.setMeta(intent.id, { kind: 'deficit', ...deficitMeta });
    }

    for (const s of allSurplus) {
        const unit = ctx.recipeStore.getResourceSpec(s.specId)?.defaultUnitOfResource ?? 'unit';
        planStore.addIntent({
            action: 'transfer', provider: canonical[0],
            resourceConformsTo: s.specId,
            resourceQuantity: { hasNumericalValue: s.quantity, hasUnit: unit },
            hasPointInTime: s.availableFrom, atLocation: s.atLocation,
            plannedWithin: s.plannedWithin,
            resourceClassifiedAs: [PLAN_TAGS.SURPLUS], finished: false,
        });
    }

    {
        const emittedConservationSpecs = new Set<string>();
        for (const c of allConservationData) {
            emittedConservationSpecs.add(c.specId);
            const conservationMeta = { onhand: c.onhand, tor: c.tor, toy: c.toy, tog: c.tog, zone: c.zone, tippingPointBreached: c.tippingPointBreached };
            const intent = planStore.addIntent({
                action: 'cite', resourceConformsTo: c.specId,
                resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
                plannedWithin: `conservation:${c.specId}`, finished: false,
            });
            planStore.setMeta(intent.id, { kind: 'conservation', ...conservationMeta } as ConservationMeta);
        }
        if (subStores && subStores.length > 0) {
            const mergedChild = new Map<string, { onhand: number; tor: number; toy: number; tog: number; zone: 'red' | 'yellow'; tippingPointBreached?: boolean }>();
            for (const childStore of subStores) {
                for (const ci of childStore.intentsForTag(PLAN_TAGS.CONSERVATION)) {
                    const cn = childStore.getMeta(ci.id) as ConservationMeta | undefined;
                    if (!cn) continue;
                    const cSpecId = ci.resourceConformsTo ?? '';
                    const existing = mergedChild.get(cSpecId);
                    if (!existing) {
                        mergedChild.set(cSpecId, { onhand: cn.onhand, tor: cn.tor, toy: cn.toy, tog: cn.tog, zone: cn.zone, tippingPointBreached: cn.tippingPointBreached });
                    } else if (cn.tippingPointBreached) {
                        existing.tippingPointBreached = true;
                    }
                }
            }
            for (const [specId, data] of mergedChild) {
                if (emittedConservationSpecs.has(specId)) {
                    if (data.tippingPointBreached) {
                        const existing = planStore.intentsForTag(PLAN_TAGS.CONSERVATION).find(i => i.resourceConformsTo === specId);
                        if (existing) {
                            const existingMeta = planStore.getMeta(existing.id) as ConservationMeta;
                            const updatedMeta: ConservationMeta = { ...existingMeta, tippingPointBreached: true };
                            planStore.removeRecords({ intentIds: [existing.id] });
                            const reEmitted = planStore.addIntent({ ...existing });
                            planStore.setMeta(reEmitted.id, updatedMeta);
                        }
                    }
                } else {
                    emittedConservationSpecs.add(specId);
                    const intent = planStore.addIntent({
                        action: 'cite', resourceConformsTo: specId,
                        resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
                        plannedWithin: `conservation:${specId}`, finished: false,
                    });
                    planStore.setMeta(intent.id, { kind: 'conservation', ...data } as ConservationMeta);
                }
            }
        }
    }

    // Planning-as-VF-Process: create a traceable planning Process
    const planningProcessId = generateId();
    const now = new Date().toISOString();

    // Set outputOf on all signal Intents before registering the Process
    for (const si of [
        ...planStore.intentsForTag(PLAN_TAGS.DEFICIT),
        ...planStore.intentsForTag(PLAN_TAGS.SURPLUS),
        ...planStore.intentsForTag(PLAN_TAGS.CONSERVATION),
    ]) {
        si.outputOf = planningProcessId;
    }
    // Retroactively stamp replenishment Intents that lack an outputOf
    for (const ri of planStore.intentsForTag(PLAN_TAGS.REPLENISHMENT)) {
        if (!ri.outputOf) ri.outputOf = planningProcessId;
    }

    const planningProcess = planStore.processes.register({
        id: planningProcessId,
        name: `Planning: ${session.canonical.join(', ')}`,
        basedOn: PLANNING_PROCESS_SPEC,
        plannedWithin: planStore.allPlans()[0]?.id,
        hasBeginning: now, hasEnd: now, finished: true,
    });
    const demandInputIds = pass1Records.map(r => r.slot.intent_id).filter(Boolean);
    const planningMeta: PlanningMeta = {
        kind: 'planning',
        processId: planningProcessId,
        demandInputIds,
    };
    planStore.setMeta(planningProcess.id, planningMeta);

    return { planStore, purchaseIntents: allPurchaseIntents, unmetDemand, laborGaps };
}

// =============================================================================
// PLAN FOR UNIT — ORCHESTRATOR
// =============================================================================

export function planForUnit(
    mode: PlanningMode,
    ids: string[],
    horizon: { from: Date; to: Date },
    ctx: UnitPlanContext,
    subStores?: PlanStore[],
): UnitPlanResult {
    const generateId = ctx.generateId ?? (() => nanoid());
    const canonical = normalizePhase(mode, ids);

    let planStore: PlanStore;
    if (subStores && subStores.length > 0) {
        planStore = mergePlanStores(subStores, generateId);
    } else {
        planStore = new PlanStore(new ProcessRegistry(generateId), generateId);
    }

    // Build conservation floors from ecological buffer tipping points
    let conservationFloors: Map<string, number> | undefined;
    if (ctx.bufferZoneStore) {
        conservationFloors = new Map();
        for (const bz of ctx.bufferZoneStore.allBufferZones()) {
            if (bz.tippingPoint !== undefined) {
                const spec = ctx.recipeStore.getResourceSpec(bz.specId);
                if (spec?.resourceClassifiedAs?.includes('tag:buffer:ecological')) {
                    conservationFloors.set(bz.specId, bz.tippingPoint);
                }
            }
        }
        if (conservationFloors.size === 0) conservationFloors = undefined;
    }

    const netter = new PlanNetter(planStore, ctx.observer, undefined, conservationFloors);

    const session: PlanningSession = { mode, canonical, horizon, ctx, planStore, netter, generateId };

    const extracted = extractPhase(session, subStores);
    const classified = classifyPhase(session, extracted.rawDemands);
    const formulated = formulatePhase(session, classified, extracted.extractedSupply, subStores, extracted.childProvenance);
    const supply = supplyPhase(session, extracted.extractedSupply);
    return collectPhase(session, formulated, supply, subStores);
}
