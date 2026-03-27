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
 *     Pass 0: Buffer reservation (opt-in: bufferZoneStore + bufferProfiles).
 *             Reserves scheduled output capacity for red/yellow buffers via PlanNetter.reserve().
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

import { VfAction } from '../schemas';
import type { Intent, BufferProfile } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import { PlanStore, PLAN_TAGS, PLANNING_PROCESS_SPEC, NON_CONSUMING_ACTIONS, type ConservationMeta, type PlanningMeta, type EconomicContext } from './planning';
import { ProcessRegistry } from '../process-registry';
import { PlanNetter } from './netting';
import { dependentDemand, type DependentDemandResult } from '../algorithms/dependent-demand';
import { dependentSupply } from '../algorithms/dependent-supply';
import { bufferStatus, computeNFP, generateReplenishmentSignal, type NFPResult } from '../algorithms/ddmrp';
import { bufferTypeFromTags, compositeBufferPriority } from '../utils/buffer-type';
import { buildSNEIndex, type SNEIndex } from '../algorithms/SNE';
import type { AgentIndex } from '../indexes/agents';
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

export interface PlanningContext {
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
    sneIndex?: SNEIndex;
    agentIndex?: AgentIndex;
}
export type UnitPlanContext = PlanningContext;

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
    ctx: PlanningContext;
    planStore: PlanStore;
    netter: PlanNetter;
    generateId: () => string;
    sneIndex: SNEIndex;
    /** Spec IDs with active BufferZones — drives decoupling point detection. */
    bufferedSpecs: ReadonlySet<string>;
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

const ECOLOGICAL_BUFFER_TAG = 'tag:buffer:ecological';
const RESERVATION_GAP_TAG = 'tag:plan:reservation-gap';
const EPSILON = 1e-9;

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
    effectiveAlerts?: AlertMap;
    childProvenanceByIntentId: Map<string, { originalShortfall: number; resolvedAt: string[]; originLocation: string }>;
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

export function detectConflicts(planStore: PlanStore, observer: Observer, agentIndex?: AgentIndex): Conflict[] {
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
    if (agentIndex) {
        for (const [agentId, { total, candidates }] of workByAgent) {
            const capacityNodes = [...agentIndex.agent_capacities.values()]
                .filter(c => c.agent_id === agentId);
            const totalCapacity = capacityNodes.reduce((s, c) => s + c.total_hours, 0);
            if (totalCapacity > 0 && total > totalCapacity) {
                conflicts.push({
                    type: 'capacity-contention',
                    resourceOrAgentId: agentId,
                    overclaimed: total,
                    candidates,
                });
            }
        }
    }

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
                    const deficitMeta = childStore.getMetaOfKind(i.id, 'deficit');
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

export type AlertMap = Map<string, {
    onhand: number; tor: number; toy: number; tog: number;
    zone: 'red' | 'yellow' | 'green' | 'excess';
    tippingPointBreached?: boolean;
    nfpResult?: NFPResult;
}>;

/** Evaluate buffer zone status without side effects (used by Block A). */
function evaluateBufferAlerts(
    bufferZoneStore: BufferZoneStore,
    bufferProfiles: Map<string, BufferProfile> | undefined,
    observer: Observer,
    planStore: PlanStore,
    recipeStore: RecipeStore,
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
            nfpResult,
        });
    }
    return alerts;
}

/** Emit REPLENISHMENT Intents for red/yellow non-ecological buffers with no open signal (used by Block A). */
function emitReplenishmentSignals(
    alerts: AlertMap,
    bufferZoneStore: BufferZoneStore,
    recipeStore: RecipeStore,
    planStore: PlanStore,
    generateId: () => string,
    agents?: { provider?: string; receiver?: string },
): void {
    const today = new Date();
    for (const [specId, alert] of alerts) {
        if (alert.zone !== 'red' && alert.zone !== 'yellow') continue;
        const spec = recipeStore.getResourceSpec(specId);
        if (spec?.resourceClassifiedAs?.includes(ECOLOGICAL_BUFFER_TAG)) continue;
        const hasOpenSignal = planStore.intentsForTag(PLAN_TAGS.REPLENISHMENT)
            .some(i => i.resourceConformsTo === specId && !i.finished);
        if (hasOpenSignal) continue;

        const bz = bufferZoneStore.findZone(specId);
        if (!bz) continue;

        const nfpForSignal: NFPResult = alert.nfpResult ?? {
            onhand: alert.onhand, onorder: 0, qualifiedDemand: 0, nfp: alert.onhand,
            zone: alert.zone, priority: alert.tog > 0 ? alert.onhand / alert.tog : 0,
        };
        const sig = generateReplenishmentSignal(specId, bz.atLocation, bz, nfpForSignal, today, generateId);
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

// =============================================================================
// RESERVED CAPACITY
// =============================================================================

export interface ReservedCapacity {
    readonly reservations: ReadonlyMap<string, number>;
    getReserved(specId: string): number;
    /** Returns the TOY threshold for this spec if it's reserved, else undefined. */
    getToy(specId: string): number | undefined;
}

interface ReservationEntry {
    qty: number;
    toy: number;
}

class ReservedCapacityImpl implements ReservedCapacity {
    constructor(private readonly entries: ReadonlyMap<string, ReservationEntry>) {}
    get reservations(): ReadonlyMap<string, number> {
        return new Map([...this.entries.entries()].map(([k, v]) => [k, v.qty]));
    }
    getReserved(specId: string): number {
        return this.entries.get(specId)?.qty ?? 0;
    }
    getToy(specId: string): number | undefined {
        return this.entries.get(specId)?.toy;
    }
}

export function buildReservedCapacity(alerts: AlertMap, recipeStore: RecipeStore): ReservedCapacity {
    const map = new Map<string, ReservationEntry>();
    for (const [specId, alert] of alerts) {
        if (alert.zone !== 'red' && alert.zone !== 'yellow') continue;
        const spec = recipeStore.getResourceSpec(specId);
        if (spec?.resourceClassifiedAs?.includes(ECOLOGICAL_BUFFER_TAG)) continue;
        const qty = Math.max(0, alert.tog - alert.onhand);
        if (qty > EPSILON) map.set(specId, { qty, toy: alert.toy });
    }
    return new ReservedCapacityImpl(map);
}

// =============================================================================
// BLOCK RESULT TYPES
// =============================================================================

export interface BlockAResult {
    reservations: ReservedCapacity;
    effectiveAlerts: AlertMap | undefined;
}

export interface BlockBResult {
    pass1Records: SlotRecord[];
    pass1PurchaseIntents: Intent[];
    deferred: Array<{ slot: DemandSlot; slotClass: DemandSlotClass }>;
}

export interface BlockCResult {
    replenishmentDebts: MetabolicDebt[];
    replenPurchaseIntents: Intent[];
    conservationData: Array<{
        specId: string; onhand: number; tor: number; toy: number; tog: number;
        zone: 'red' | 'yellow'; tippingPointBreached?: boolean;
    }>;
}

// =============================================================================
// DEMAND PROCESSING OPTIONS
// =============================================================================

interface DemandProcessOpts {
    planPrefix: string;
    planLabel: string;
    honorDecouplingPoints?: boolean;
    suppressObserver?: boolean;
}

// =============================================================================
// PIPELINE HELPERS
// =============================================================================

/** Process a single demand item through dependentDemand. */
function processSingleDemand(
    input: { specId: string; qty: number; slot?: DemandSlot; slotClass?: DemandSlotClass; due?: Date; atLocation?: string },
    opts: DemandProcessOpts,
    session: PlanningSession,
    econ: EconomicContext,
    effectiveNetter: PlanNetter,
): { result: DependentDemandResult; planId: string } {
    const { planStore, generateId, sneIndex, horizon, ctx, mode } = session;
    const planId = `${opts.planPrefix}-${generateId()}`;
    const specId = input.specId;

    planStore.addPlan({ id: planId, name: `${opts.planLabel} ${specId}` });

    // For slot-based demands, handle transport candidates first
    if (input.slot && input.slotClass === 'transport-candidate') {
        const transportResult = mode.scope.handleTransportCandidate(
            input.slot, planStore, planId, ctx.recipeStore, ctx.agents,
        );
        if (transportResult) {
            return { result: transportResult, planId };
        }
    }

    const dueDate = input.due ?? (input.slot?.due ? new Date(input.slot.due) : horizon.to);
    const atLocation = input.slot ? mode.spatial.locationOf(input.slot) : input.atLocation;

    const result = dependentDemand({
        ...econ,
        observer: opts.suppressObserver ? undefined : econ.observer,
        sneIndex,
        planId,
        demandSpecId: specId,
        demandQuantity: input.qty,
        dueDate,
        netter: effectiveNetter,
        atLocation,
        agents: ctx.agents,
        generateId,
        honorDecouplingPoints: opts.honorDecouplingPoints,
        bufferedSpecs: session.bufferedSpecs,
    });

    return { result, planId };
}

/** Compute derived replenishment demands from pass 1 records. */
function computeDerivedDemands(
    pass1Records: SlotRecord[],
    reservations: ReservedCapacity,
    effectiveAlerts: AlertMap | undefined,
    session: PlanningSession,
    allConservationData: Array<{
        specId: string; onhand: number; tor: number; toy: number; tog: number;
        zone: 'red' | 'yellow'; tippingPointBreached?: boolean;
    }>,
): Array<{ specId: string; qty: number; zone?: 'red' | 'yellow' | 'green' | 'excess' }> {
    const { ctx } = session;
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
        if (reservations.reservations.has(specId)) continue;
        const qty = (consumedBySpec.get(specId) ?? 0) + (boundaryBySpec.get(specId) ?? 0);
        if (!session.bufferedSpecs.has(specId)) continue;
        const spec = ctx.recipeStore.getResourceSpec(specId);
        if (spec?.resourceClassifiedAs?.includes(ECOLOGICAL_BUFFER_TAG)) continue;

        if (effectiveAlerts) {
            const alert = effectiveAlerts.get(specId);
            if (alert) {
                if (alert.zone === 'green' || alert.zone === 'excess') continue;
                const replenQty = Math.max(0, alert.tog - alert.onhand);
                if (replenQty > EPSILON) derivedDemands.push({ specId, qty: replenQty, zone: alert.zone });
                continue;
            }
        }
        derivedDemands.push({ specId, qty });
    }

    if (effectiveAlerts) {
        for (const [specId, alert] of effectiveAlerts) {
            if (reservations.reservations.has(specId)) continue;
            if (alert.zone === 'red' || alert.zone === 'yellow') {
                const spec = ctx.recipeStore.getResourceSpec(specId);
                if (spec?.resourceClassifiedAs?.includes(ECOLOGICAL_BUFFER_TAG)) {
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
                if (replenQty > EPSILON && !derivedDemands.some(d => d.specId === specId)) {
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

    return derivedDemands;
}

// =============================================================================
// BLOCK A — Pass 0: Buffer alert evaluation + capacity reservation
// =============================================================================

function runBlockA(
    session: PlanningSession,
    planStore: PlanStore,
    netter: PlanNetter,
    generateId: () => string,
): BlockAResult {
    const { ctx } = session;
    const { bufferZoneStore, bufferProfiles } = ctx;

    const effectiveAlerts: AlertMap | undefined = bufferZoneStore
        ? evaluateBufferAlerts(bufferZoneStore, bufferProfiles, ctx.observer, planStore, ctx.recipeStore)
        : ctx.bufferAlerts;

    if (!(bufferZoneStore && bufferProfiles && effectiveAlerts)) {
        return { reservations: new ReservedCapacityImpl(new Map()), effectiveAlerts };
    }

    // Buffer-first active path: emit signals, build reservations, reserve capacity
    emitReplenishmentSignals(effectiveAlerts, bufferZoneStore, ctx.recipeStore, planStore, generateId, ctx.agents);
    const reservations = buildReservedCapacity(effectiveAlerts, ctx.recipeStore);

    const pass0List: Array<{ specId: string; qty: number; priority: number }> = [];
    for (const [specId, qty] of reservations.reservations) {
        const spec = ctx.recipeStore.getResourceSpec(specId);
        const bType = bufferTypeFromTags(spec?.resourceClassifiedAs ?? []);
        const alert = effectiveAlerts.get(specId);
        if (!alert) continue;
        pass0List.push({ specId, qty, priority: compositeBufferPriority(bType, alert.zone) });
    }
    pass0List.sort((a, b) => a.priority - b.priority);
    for (const { specId, qty } of pass0List) {
        const actuallyReserved = netter.reserve(specId, qty);
        if (actuallyReserved < qty - EPSILON) {
            planStore.addIntent({
                action: 'cite',
                resourceConformsTo: specId,
                resourceQuantity: { hasNumericalValue: qty - actuallyReserved, hasUnit: 'unit' },
                resourceClassifiedAs: [RESERVATION_GAP_TAG],
                plannedWithin: `reservation-gap:${specId}`,
                finished: true,
            });
        }
    }

    return { reservations, effectiveAlerts };
}

// =============================================================================
// BLOCK B — Pass 1: Process primary independent demands
// =============================================================================

function runBlockB(
    session: PlanningSession,
    sortedSlots: Array<{ slot: DemandSlot; slotClass: DemandSlotClass }>,
    blockA: BlockAResult,
    econ: EconomicContext,
    childProvenanceByIntentId: Map<string, { originalShortfall: number; resolvedAt: string[]; originLocation: string }>,
): BlockBResult {
    const { ctx, netter, mode } = session;
    const bufferFirstActive = !!(ctx.bufferZoneStore && ctx.bufferProfiles);
    const pass1Records: SlotRecord[] = [];
    const pass1PurchaseIntents: Intent[] = [];
    const deferred: Array<{ slot: DemandSlot; slotClass: DemandSlotClass }> = [];

    const primaryOpts: DemandProcessOpts = {
        planPrefix: 'plan',
        planLabel: 'Demand plan for',
        honorDecouplingPoints: true,
    };

    for (const { slot, slotClass } of sortedSlots) {
        if (!slot.spec_id) continue;
        const specId = slot.spec_id;
        const qty = slot.remaining_quantity;

        // Guard: defer if consuming from a stressed buffer would breach TOY
        if (bufferFirstActive) {
            const toy = blockA.reservations.getToy(specId);
            if (toy !== undefined) {
                const available = netter.netAvailableQty(specId);
                if ((available - qty) < toy) {
                    deferred.push({ slot, slotClass });
                    continue;
                }
            }
        }

        const input = { specId, qty, slot, slotClass, due: slot.due ? new Date(slot.due) : undefined };
        const { result } = processSingleDemand(input, primaryOpts, session, econ, netter);
        pass1Records.push({ slot, result, slotClass });
        pass1PurchaseIntents.push(...result.purchaseIntents);

        const childProv = childProvenanceByIntentId.get(slot.intent_id);
        if (childProv?.originLocation) {
            mode.scope.annotateChildCommitments(result.commitments, childProv.originLocation);
        }
    }

    return { pass1Records, pass1PurchaseIntents, deferred };
}

// =============================================================================
// BLOCK C — Pass 2: Replenishment (derived demands from Pass 1 allocations)
// =============================================================================

function runBlockC(
    session: PlanningSession,
    blockA: BlockAResult,
    blockB: BlockBResult,
    econ: EconomicContext,
): BlockCResult {
    const { netter } = session;
    const conservationData: BlockCResult['conservationData'] = [];

    const derivedDemands = computeDerivedDemands(
        blockB.pass1Records, blockA.reservations, blockA.effectiveAlerts, session, conservationData,
    );
    const replenNetter = netter.fork({ observer: undefined });
    const replenOpts: DemandProcessOpts = {
        planPrefix: 'replenish',
        planLabel: 'Replenishment for',
        suppressObserver: true,
    };

    const replenishmentDebts: MetabolicDebt[] = [];
    const replenPurchaseIntents: Intent[] = [];

    for (const d of derivedDemands) {
        const input = { specId: d.specId, qty: d.qty };
        const { result, planId } = processSingleDemand(input, replenOpts, session, econ, replenNetter);
        replenPurchaseIntents.push(...result.purchaseIntents);
        const purchasedQty = result.purchaseIntents
            .filter(i => i.resourceConformsTo === d.specId)
            .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        if (purchasedQty > EPSILON) {
            replenishmentDebts.push({ specId: d.specId, shortfall: purchasedQty, plannedWithin: planId });
        }
    }

    return { replenishmentDebts, replenPurchaseIntents, conservationData };
}

// =============================================================================
// BACKTRACKING
// =============================================================================

export interface BacktrackResult {
    additionalDeficits: InternalDeficit[];
    additionalUnmet: DemandSlot[];
    additionalPurchaseIntents: Intent[];
}

/** Select the next candidate to retract: scored multi-candidate path if available, else greedy. */
function selectNextCandidate(
    session: PlanningSession,
    remaining: Set<SlotRecord>,
    econ: EconomicContext,
): SlotRecord | undefined {
    const { mode, canonical, netter, planStore, generateId, sneIndex, horizon, ctx } = session;

    if (mode.sacrifice.selectRetractCandidates && mode.sacrifice.scoreCandidate) {
        const candidates = mode.sacrifice.selectRetractCandidates(remaining, canonical, 3);
        let best: { score: number; candidate: SlotRecord | undefined } = { score: -Infinity, candidate: undefined };
        for (const c of candidates) {
            const trialNetter = netter.fork({});
            trialNetter.retract(c.result);
            const trialPlanId = `trial-${generateId()}`;
            planStore.addPlan({ id: trialPlanId, name: `Trial for ${c.slot.spec_id}` });
            const trialResult = c.slot.spec_id ? dependentDemand({
                ...econ, sneIndex, planId: trialPlanId,
                demandSpecId: c.slot.spec_id, demandQuantity: c.slot.remaining_quantity,
                dueDate: c.slot.due ? new Date(c.slot.due) : horizon.to,
                netter: trialNetter, atLocation: mode.spatial.locationOf(c.slot),
                agents: ctx.agents, generateId, honorDecouplingPoints: true, bufferedSpecs: session.bufferedSpecs,
            }) : null;
            if (trialResult) {
                const score = mode.sacrifice.scoreCandidate(trialResult, c.slot);
                if (score > best.score) best = { score, candidate: c };
            }
            planStore.removeRecordsForPlan(trialPlanId);
        }
        return best.candidate;
    }

    return mode.sacrifice.selectRetractCandidate(remaining, canonical);
}

/** Backtracking loop: retract demands to free capacity for replenishment debts. */
function runBacktracking(
    session: PlanningSession,
    pass1Records: SlotRecord[],
    replenDebts: MetabolicDebt[],
    econ: EconomicContext,
    childProvenanceByIntentId: Map<string, { originalShortfall: number; resolvedAt: string[]; originLocation: string }>,
): BacktrackResult {
    const additionalDeficits: InternalDeficit[] = [];
    const additionalUnmet: DemandSlot[] = [];
    const additionalPurchaseIntents: Intent[] = [];

    if (replenDebts.length > 0) {
        const { mode, canonical, netter, planStore, generateId, sneIndex, horizon, ctx } = session;
        const remaining = new Set(pass1Records);

        while (replenDebts.length > 0 && remaining.size > 0) {
            if (mode.sacrifice.recordSacrifice === undefined) break;

            const candidate = selectNextCandidate(session, remaining, econ);
            if (!candidate) break;
            remaining.delete(candidate);

            netter.retract(candidate.result);

            // Retry replenishment debts with freed capacity
            const retryReplenNetter = netter.fork({ observer: undefined });
            const resolvedDebt: string[] = [];
            for (const debt of replenDebts) {
                const retryPlanId = `replenish-retry-${generateId()}`;
                planStore.addPlan({ id: retryPlanId, name: `Retry replenishment for ${debt.specId}` });
                const reResult = dependentDemand({
                    ...econ, observer: undefined, sneIndex,
                    planId: retryPlanId, demandSpecId: debt.specId, demandQuantity: debt.shortfall,
                    dueDate: horizon.to, netter: retryReplenNetter, agents: ctx.agents, generateId,
                });
                additionalPurchaseIntents.push(...reResult.purchaseIntents);
                const newPurchasedQty = reResult.purchaseIntents
                    .filter(i => i.resourceConformsTo === debt.specId)
                    .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
                if (newPurchasedQty < debt.shortfall - EPSILON) debt.shortfall = newPurchasedQty;
                if (newPurchasedQty <= EPSILON) resolvedDebt.push(debt.specId);
            }
            replenDebts.splice(0, replenDebts.length, ...replenDebts.filter(d => !resolvedDebt.includes(d.specId)));

            // Re-explode the retracted candidate
            const reExplodePlanId = `reexplode-${generateId()}`;
            planStore.addPlan({ id: reExplodePlanId, name: `Re-explode for ${candidate.slot.spec_id}` });
            const reResult = candidate.slot.spec_id ? dependentDemand({
                ...econ, sneIndex, planId: reExplodePlanId,
                demandSpecId: candidate.slot.spec_id, demandQuantity: candidate.slot.remaining_quantity,
                dueDate: candidate.slot.due ? new Date(candidate.slot.due) : horizon.to,
                netter, atLocation: mode.spatial.locationOf(candidate.slot),
                agents: ctx.agents, generateId, honorDecouplingPoints: true, bufferedSpecs: session.bufferedSpecs,
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
                additionalUnmet.push(candidate.slot);
                const backtrackProv = childProvenanceByIntentId.get(candidate.slot.intent_id);
                additionalDeficits.push({
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
        additionalDeficits.push({
            plannedWithin: debt.plannedWithin,
            intentId: `synthetic:debt:${debt.plannedWithin}:${debt.specId}`,
            specId: debt.specId,
            action: 'produce',
            shortfall: debt.shortfall,
            location: session.canonical[0],
            source: 'metabolic_debt',
        });
    }

    return { additionalDeficits, additionalUnmet, additionalPurchaseIntents };
}

// =============================================================================
// FORMULATE PHASE — threads Block A → B → C → retry → backtrack
// =============================================================================

/** Phase 3: Formulate — Pass 0 reservation, Pass 1, derived demands, Pass 2, backtracking. */
export function formulatePhase(
    session: PlanningSession,
    classified: Array<{ slot: DemandSlot; slotClass: DemandSlotClass }>,
    extractedSupply: SupplySlot[],
    subStores?: PlanStore[],
    childProvenance?: Map<string, { originalShortfall: number; resolvedAt: string[]; originLocation: string }>,
): FormulateResult {
    const { mode, canonical, horizon, ctx, planStore, netter, generateId, sneIndex } = session;
    const childProvenanceByIntentId = childProvenance ?? new Map();
    const processes = planStore.processes;
    const econ: EconomicContext = {
        recipeStore: ctx.recipeStore, planStore, processes, observer: ctx.observer,
    };

    const seededIntentIds = mode.scope.injectFederationSeeds(planStore, ctx.supplyIndex, session.canonical);

    const sortedSlots = [...classified].sort((a, b) => {
        const classDiff = (CLASS_ORDER[a.slotClass] ?? 3) - (CLASS_ORDER[b.slotClass] ?? 3);
        if (classDiff !== 0) return classDiff;
        const dueA = new Date(a.slot.due ?? 0).getTime();
        const dueB = new Date(b.slot.due ?? 0).getTime();
        return dueA - dueB;
    });

    // --- Pipeline: Block A → Block B → Block C ---
    const blockA = runBlockA(session, planStore, netter, generateId);
    const blockB = runBlockB(session, sortedSlots, blockA, econ, childProvenanceByIntentId);
    const blockC = runBlockC(session, blockA, blockB, econ);

    // Merge block outputs into accumulators
    const pass1Records: SlotRecord[] = [...blockB.pass1Records];
    const allPurchaseIntents: Intent[] = [...blockB.pass1PurchaseIntents, ...blockC.replenPurchaseIntents];
    const unmetDemand: DemandSlot[] = [];
    const replenDebts: MetabolicDebt[] = [...blockC.replenishmentDebts];
    const allDeficits: InternalDeficit[] = [];
    const allConservationData = blockC.conservationData;

    // =====================================================================
    // Pass 1b: Retry deferred demands after replenishment
    // =====================================================================
    const deferredOpts: DemandProcessOpts = {
        planPrefix: 'plan-deferred',
        planLabel: 'Deferred demand for',
        honorDecouplingPoints: true,
    };
    for (const { slot, slotClass } of blockB.deferred) {
        if (!slot.spec_id) continue;
        const input = {
            specId: slot.spec_id,
            qty: slot.remaining_quantity,
            slot,
            slotClass,
            due: slot.due ? new Date(slot.due) : undefined,
        };
        const { result } = processSingleDemand(input, deferredOpts, session, econ, netter);
        pass1Records.push({ slot, result, slotClass });
        allPurchaseIntents.push(...result.purchaseIntents);
        const childProv = childProvenanceByIntentId.get(slot.intent_id);
        if (childProv?.originLocation) {
            mode.scope.annotateChildCommitments(result.commitments, childProv.originLocation);
        }
    }

    // --- Emit deficit signals for Pass 1 (post-pipeline) ---
    for (const record of pass1Records) {
        const unresolved = record.result.purchaseIntents
            .filter(i => i.resourceConformsTo === record.slot.spec_id)
            .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        if (unresolved > EPSILON) {
            const childProv = childProvenanceByIntentId.get(record.slot.intent_id);
            const resolvedHere = childProv
                ? (childProv.originalShortfall ?? unresolved) - unresolved > EPSILON
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
            if (qty <= EPSILON) continue;
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

    // --- Backtracking ---
    const backtrack = runBacktracking(session, pass1Records, replenDebts, econ, childProvenanceByIntentId);
    allDeficits.push(...backtrack.additionalDeficits);
    unmetDemand.push(...backtrack.additionalUnmet);
    allPurchaseIntents.push(...backtrack.additionalPurchaseIntents);

    // Remove federation boundary seeds
    if (seededIntentIds.length > 0) {
        planStore.removeRecords({ intentIds: seededIntentIds });
        netter.pruneStale();
    }

    return { pass1Records, allPurchaseIntents, unmetDemand, allDeficits, allConservationData, effectiveAlerts: blockA.effectiveAlerts, childProvenanceByIntentId };
}

/** Phase B: Forward-schedule unabsorbed supply. */
export function supplyPhase(
    session: PlanningSession,
    extractedSupply: SupplySlot[],
    effectiveAlerts?: AlertMap,
): SupplyResult {
    const { mode, horizon, ctx, planStore, netter, generateId } = session;
    const processes = planStore.processes;
    const econ: EconomicContext = {
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
            let remaining = s.quantity;

            // Phase B routing: route surplus to stressed buffers before emitting SurplusSignal
            const alert = effectiveAlerts?.get(s.specId);
            if (alert && (alert.zone === 'red' || alert.zone === 'yellow')) {
                const bufferNeed = Math.max(0, alert.tog - alert.onhand);
                const routeQty = Math.min(remaining, bufferNeed);
                if (routeQty > EPSILON) {
                    const routePlanId = `buffer-route-${generateId()}`;
                    planStore.addPlan({ id: routePlanId, name: `Route surplus to buffer ${s.specId}` });
                    planStore.addIntent({
                        id: generateId(), action: 'transfer',
                        resourceConformsTo: s.specId,
                        resourceQuantity: { hasNumericalValue: routeQty, hasUnit: 'unit' },
                        resourceClassifiedAs: [PLAN_TAGS.REPLENISHMENT],
                        plannedWithin: routePlanId, finished: false,
                    });
                    remaining -= routeQty;
                }
            }

            if (remaining > EPSILON) {
                allSurplus.push({
                    specId: s.specId,
                    quantity: remaining,
                    plannedWithin: supplyPlanId,
                    availableFrom: supplySlot.available_from,
                    atLocation: supplySlot.h3_cell,
                });
            }
        }
        supplyPurchaseIntents.push(...result.purchaseIntents);
    }

    return { allSurplus, supplyPurchaseIntents };
}

/** Merge conflict detection and surgical resolution. Mutates arrays in place. */
function resolveConflicts(
    session: PlanningSession,
    pass1Records: SlotRecord[],
    allDeficits: InternalDeficit[],
    unmetDemand: DemandSlot[],
    allPurchaseIntents: Intent[],
    subStores: PlanStore[] | undefined,
    childProvenanceByIntentId: Map<string, { originalShortfall: number; resolvedAt: string[]; originLocation: string }>,
    econ: EconomicContext,
): void {
    if (!subStores || subStores.length === 0) return;

    const { mode, canonical, horizon, ctx, planStore, netter, generateId } = session;
    let conflicts = detectConflicts(planStore, ctx.observer, ctx.agentIndex);
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
                        ...econ, sneIndex: session.sneIndex, planId: mergeReplanId,
                        demandSpecId: slot.spec_id, demandQuantity: slot.remaining_quantity,
                        dueDate: slot.due ? new Date(slot.due) : horizon.to,
                        netter, agents: ctx.agents, generateId, honorDecouplingPoints: true, bufferedSpecs: session.bufferedSpecs,
                    });
                    allPurchaseIntents.push(...reResult.purchaseIntents);
                    const mergeChildProv = childProvenanceByIntentId.get(slot.intent_id);
                    if (mergeChildProv?.originLocation) {
                        mode.scope.annotateChildCommitments(reResult.commitments, mergeChildProv.originLocation);
                    }
                }
                const newConflicts = detectConflicts(planStore, ctx.observer, ctx.agentIndex);
                const stillConflicted = newConflicts.some(nc => nc.resourceOrAgentId === conflict.resourceOrAgentId);
                if (!stillConflicted) break;
            }
        }
        conflicts = detectConflicts(planStore, ctx.observer, ctx.agentIndex);
    }
}

/** Clear old signal Intents and emit new DEFICIT/SURPLUS/CONSERVATION Intents from collected arrays. */
function emitPlanSignals(
    session: PlanningSession,
    allDeficits: InternalDeficit[],
    allSurplus: SurplusSignal[],
    allConservationData: Array<{
        specId: string; onhand: number; tor: number; toy: number; tog: number;
        zone: 'red' | 'yellow'; tippingPointBreached?: boolean;
    }>,
    subStores: PlanStore[] | undefined,
): void {
    const { mode, canonical, ctx, planStore } = session;

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
            action: VfAction.parse(d.action),
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

    const emittedConservationSpecs = new Set<string>();
    for (const c of allConservationData) {
        emittedConservationSpecs.add(c.specId);
        const conservationMeta = { onhand: c.onhand, tor: c.tor, toy: c.toy, tog: c.tog, zone: c.zone, tippingPointBreached: c.tippingPointBreached };
        const intent = planStore.addIntent({
            action: 'cite', resourceConformsTo: c.specId,
            resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
            plannedWithin: `conservation:${c.specId}`, finished: false,
        });
        planStore.setMeta(intent.id, { kind: 'conservation' as const, ...conservationMeta });
    }
    if (subStores && subStores.length > 0) {
        const mergedChild = new Map<string, { onhand: number; tor: number; toy: number; tog: number; zone: 'red' | 'yellow'; tippingPointBreached?: boolean }>();
        for (const childStore of subStores) {
            for (const ci of childStore.intentsForTag(PLAN_TAGS.CONSERVATION)) {
                const cn = childStore.getMetaOfKind(ci.id, 'conservation');
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
                        const existingMeta = planStore.getMetaOfKind(existing.id, 'conservation');
                        if (!existingMeta) continue;
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
                planStore.setMeta(intent.id, { kind: 'conservation' as const, ...data });
            }
        }
    }
}

/** Create the planning VF Process, stamp outputOf on signal Intents, return the process ID. */
function registerPlanningProcess(
    session: PlanningSession,
    pass1Records: SlotRecord[],
): string {
    const { planStore, generateId } = session;
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

    return planningProcessId;
}

/** Phase 4: Collect — merge conflicts, emit signals, return result. */
export function collectPhase(
    session: PlanningSession,
    formulate: FormulateResult,
    supply: SupplyResult,
    subStores?: PlanStore[],
): UnitPlanResult {
    const { planStore } = session;

    const econ: EconomicContext = {
        recipeStore: session.ctx.recipeStore, planStore, processes: planStore.processes, observer: session.ctx.observer,
    };

    const { pass1Records, allPurchaseIntents, unmetDemand, allDeficits, allConservationData, childProvenanceByIntentId } = formulate;
    allPurchaseIntents.push(...supply.supplyPurchaseIntents);

    resolveConflicts(session, pass1Records, allDeficits, unmetDemand, allPurchaseIntents, subStores, childProvenanceByIntentId, econ);
    emitPlanSignals(session, allDeficits, supply.allSurplus, allConservationData, subStores);
    registerPlanningProcess(session, pass1Records);

    const laborGaps = planStore.allIntents().filter(i => i.action === 'work' && i.provider === undefined);
    return { planStore, purchaseIntents: allPurchaseIntents, unmetDemand, laborGaps };
}

// =============================================================================
// PLAN FOR UNIT — ORCHESTRATOR
// =============================================================================

export function planForUnit(
    mode: PlanningMode,
    ids: string[],
    horizon: { from: Date; to: Date },
    ctx: PlanningContext,
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
                if (spec?.resourceClassifiedAs?.includes(ECOLOGICAL_BUFFER_TAG)) {
                    conservationFloors.set(bz.specId, bz.tippingPoint);
                }
            }
        }
        if (conservationFloors.size === 0) conservationFloors = undefined;
    }

    const netter = new PlanNetter(planStore, ctx.observer, undefined, conservationFloors);

    const sneIndex = ctx.sneIndex ?? buildSNEIndex(ctx.recipeStore);
    const bufferedSpecs: ReadonlySet<string> = ctx.bufferZoneStore
        ? new Set(ctx.bufferZoneStore.allBufferZones().map(bz => bz.specId))
        : new Set<string>();
    const session: PlanningSession = { mode, canonical, horizon, ctx, planStore, netter, generateId, sneIndex, bufferedSpecs };

    const extracted = extractPhase(session, subStores);
    const classified = classifyPhase(session, extracted.rawDemands);
    const formulated = formulatePhase(session, classified, extracted.extractedSupply, subStores, extracted.childProvenance);
    const supply = supplyPhase(session, extracted.extractedSupply, formulated.effectiveAlerts);
    return collectPhase(session, formulated, supply, subStores);
}
