/**
 * planForUnit — generic planning orchestrator parameterized by LocationStrategy.
 *
 * Unifies the common algorithm from planForScope and planForRegion into a single
 * function. The 5 axes of difference (normalization, extraction, classification,
 * backtracking, Phase B observer) are delegated to a LocationStrategy.
 *
 * Algorithm phases:
 *   Phase 0: Normalise location IDs (strategy.normalize)
 *   Phase 1: Extract demand/supply slots (strategy.extractSlots)
 *   Phase 2: Classify each demand slot (strategy.classifySlot)
 *   Phase 3: Formulate
 *     Pass 1: Explode primary independent demands (class order → due date)
 *     Derived: Compute replenishment demands from Pass 1 allocations
 *     Pass 2: Explode derived replenishment demands; collect metabolicDebt
 *     Backtrack: Retract demands to free capacity (strategy.selectRetractCandidate)
 *   Phase B: Forward-schedule unabsorbed supply (strategy.observerForSupply)
 *   Phase 4: Collect result
 */

import { nanoid } from 'nanoid';

import type { Intent, BufferProfile } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import { PlanStore, PLAN_TAGS, NON_CONSUMING_ACTIONS, parseDeficitNote, parseConservationNote } from './planning';
import { ProcessRegistry } from '../process-registry';
import { PlanNetter } from './netting';
import { dependentDemand } from '../algorithms/dependent-demand';
import { dependentSupply } from '../algorithms/dependent-supply';
import { bufferStatus, computeNFP, generateReplenishmentSignal, type NFPResult } from '../algorithms/ddmrp';
import type { BufferZoneStore } from '../knowledge/buffer-zones';
import type { DemandSlot } from '../indexes/independent-demand';
import type { IndependentDemandIndex } from '../indexes/independent-demand';
import type { IndependentSupplyIndex, SupplySlot } from '../indexes/independent-supply';
import type { Observer } from '../observation/observer';
import type {
    LocationStrategy,
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

export function planForUnit(
    strategy: LocationStrategy,
    ids: string[],
    horizon: { from: Date; to: Date },
    ctx: UnitPlanContext,
    subStores?: PlanStore[],
): UnitPlanResult {
    const generateId = ctx.generateId ?? (() => nanoid());

    // -------------------------------------------------------------------------
    // Phase 0 — Normalise
    // -------------------------------------------------------------------------
    const canonical = strategy.normalize(ids);

    // -------------------------------------------------------------------------
    // Phase 1 — Extract demand and supply slots
    // -------------------------------------------------------------------------
    const { demands: rawDemands, supply: extractedSupply } = strategy.extractSlots(
        canonical, horizon, ctx.demandIndex, ctx.supplyIndex,
    );

    // Inject child signals directly from child PlanStores
    const childProvenanceByIntentId = new Map<string, {
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
                    const { originalShortfall, resolvedAt } = parseDeficitNote(i);
                    const shortfall = i.resourceQuantity?.hasNumericalValue ?? 0;
                    const originLocation = i.inScopeOf?.[0] ?? i.atLocation ?? '';
                    childProvenanceByIntentId.set(i.id, {
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

        // Inject child surplus as synthetic supply slots
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

    // -------------------------------------------------------------------------
    // Phase 2 — Classify demand slots
    // -------------------------------------------------------------------------
    const classified = rawDemands.map(slot => ({
        slot,
        slotClass: strategy.classifySlot(slot, canonical, ctx.supplyIndex, ctx.recipeStore),
    }));

    // -------------------------------------------------------------------------
    // Phase 3 — Formulate
    // -------------------------------------------------------------------------

    let planStore: PlanStore;
    if (subStores && subStores.length > 0) {
        planStore = mergePlanStores(subStores, generateId);
    } else {
        planStore = new PlanStore(new ProcessRegistry(generateId), generateId);
    }

    const processes = planStore.processes;
    const netter = new PlanNetter(planStore, ctx.observer);

    // Federation boundary seeding
    const seededIntentIds = strategy.injectFederationSeeds(planStore, ctx.supplyIndex);

    const pass1Records: SlotRecord[] = [];
    const allPurchaseIntents: Intent[] = [];
    const unmetDemand: DemandSlot[] = [];
    const replenDebts: MetabolicDebt[] = [];
    const allDeficits: InternalDeficit[] = [];
    const allConservationData: Array<{
        specId: string; onhand: number; tor: number; toy: number; tog: number;
        zone: 'red' | 'yellow'; tippingPointBreached?: boolean;
    }> = [];

    // Sort: classification order → due date ascending
    const sortedSlots = [...classified].sort((a, b) => {
        const classDiff = (CLASS_ORDER[a.slotClass] ?? 3) - (CLASS_ORDER[b.slotClass] ?? 3);
        if (classDiff !== 0) return classDiff;
        const dueA = new Date(a.slot.due ?? 0).getTime();
        const dueB = new Date(b.slot.due ?? 0).getTime();
        return dueA - dueB;
    });

    // --- Pass 1: primary independent demands ---
    for (const { slot, slotClass } of sortedSlots) {
        if (!slot.spec_id) continue;

        const planId = `plan-${generateId()}`;
        planStore.addPlan({ id: planId, name: `Demand plan for ${slot.spec_id}` });

        // Strategy-specific transport-candidate handling
        const transportResult = strategy.handleTransportCandidate(
            slot, planStore, planId, ctx.recipeStore, ctx.agents,
        );
        if (transportResult && slotClass === 'transport-candidate') {
            pass1Records.push({ slot, result: transportResult, slotClass });
            allPurchaseIntents.push(...transportResult.purchaseIntents);
            continue;
        }

        const result = dependentDemand({
            planId,
            demandSpecId: slot.spec_id,
            demandQuantity: slot.remaining_quantity,
            dueDate: slot.due ? new Date(slot.due) : horizon.to,
            recipeStore: ctx.recipeStore,
            planStore,
            processes,
            observer: ctx.observer,
            netter,
            atLocation: strategy.locationOf(slot),
            agents: ctx.agents,
            generateId,
            honorDecouplingPoints: true,
        });

        pass1Records.push({ slot, result, slotClass });
        allPurchaseIntents.push(...result.purchaseIntents);

        const childProvPass1 = childProvenanceByIntentId.get(slot.intent_id);
        if (childProvPass1?.originLocation) {
            strategy.annotateChildCommitments(result.commitments, childProvPass1.originLocation);
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
            const location = strategy.locationOf(record.slot) ?? canonical[0];
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
            const location = strategy.locationOf(record.slot) ?? canonical[0];
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
    const effectiveAlerts = ctx.bufferZoneStore
        ? (() => {
            const alerts = new Map<string, {
                onhand: number; tor: number; toy: number; tog: number;
                zone: 'red' | 'yellow' | 'green' | 'excess';
                tippingPointBreached?: boolean;
            }>();
            const today = new Date();
            for (const bz of ctx.bufferZoneStore!.allBufferZones()) {
                const profile = ctx.bufferProfiles?.get(bz.profileId);
                let onhand: number;
                let zoneStatus: 'red' | 'yellow' | 'green' | 'excess';
                let nfpResult: NFPResult | undefined;
                if (profile) {
                    nfpResult = computeNFP(bz.specId, bz, profile, planStore, ctx.observer, today);
                    zoneStatus = nfpResult.zone;
                    onhand = nfpResult.onhand;
                } else {
                    onhand = ctx.observer.conformingResources(bz.specId)
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
                if ((zoneStatus === 'red' || zoneStatus === 'yellow') && ctx.bufferZoneStore) {
                    const spec = ctx.recipeStore.getResourceSpec(bz.specId);
                    if (!spec?.resourceClassifiedAs?.includes('tag:buffer:ecological')) {
                        // Check for existing open replenishment Intent (no duplicates)
                        const noOpenSignal = !planStore.intentsForTag(PLAN_TAGS.REPLENISHMENT)
                            .some(i => i.resourceConformsTo === bz.specId && !i.finished);
                        if (noOpenSignal) {
                            const nfpForSignal: NFPResult = nfpResult ?? {
                                onhand, onorder: 0, qualifiedDemand: 0, nfp: onhand,
                                zone: zoneStatus, priority: bz.tog > 0 ? onhand / bz.tog : 0,
                            };
                            const sig = generateReplenishmentSignal(bz.specId, bz.atLocation, bz, nfpForSignal, today, generateId);
                            // Emit as tagged VF Intent (receiver-side request: "refill this buffer")
                            planStore.addIntent({
                                id: sig.id,
                                action: 'produce',
                                receiver: ctx.agents?.receiver,
                                resourceConformsTo: sig.specId,
                                resourceQuantity: {
                                    hasNumericalValue: sig.recommendedQty,
                                    hasUnit: bz.aduUnit,
                                },
                                due: `${sig.dueDate}T00:00:00.000Z`,
                                ...(sig.atLocation ? { atLocation: sig.atLocation } : {}),
                                resourceClassifiedAs: [PLAN_TAGS.REPLENISHMENT],
                                note: JSON.stringify({
                                    onhand: sig.onhand, onorder: sig.onorder,
                                    qualifiedDemand: sig.qualifiedDemand, nfp: sig.nfp,
                                    priority: sig.priority, zone: sig.zone,
                                    recommendedQty: sig.recommendedQty, dueDate: sig.dueDate,
                                    bufferZoneId: sig.bufferZoneId, createdAt: sig.createdAt,
                                    status: 'open',
                                }),
                                finished: false,
                            });
                        }
                    }
                }
            }
            return alerts;
        })()
        : ctx.bufferAlerts;

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

    // Inject buffer-zone alert demands for specs not already in derivedDemands
    if (effectiveAlerts) {
        for (const [specId, alert] of effectiveAlerts) {
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

    // Sort red-first
    {
        const ZONE_PRIORITY: Record<string, number> = { red: 0, yellow: 1, green: 2, excess: 3 };
        derivedDemands.sort((a, b) =>
            (ZONE_PRIORITY[a.zone ?? 'green'] ?? 2) - (ZONE_PRIORITY[b.zone ?? 'green'] ?? 2),
        );
    }

    // --- Pass 2: derived replenishment demands ---
    const replenNetter = netter.fork({ observer: undefined });

    for (const { specId, qty } of derivedDemands) {
        const replenPlanId = `replenish-${generateId()}`;
        planStore.addPlan({ id: replenPlanId, name: `Replenishment for ${specId}` });
        const result = dependentDemand({
            planId: replenPlanId,
            demandSpecId: specId,
            demandQuantity: qty,
            dueDate: horizon.to,
            recipeStore: ctx.recipeStore,
            planStore,
            processes,
            observer: undefined,
            netter: replenNetter,
            agents: ctx.agents,
            generateId,
        });

        allPurchaseIntents.push(...result.purchaseIntents);

        const purchasedQty = result.purchaseIntents
            .filter(i => i.resourceConformsTo === specId)
            .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        if (purchasedQty > 1e-9) {
            replenDebts.push({ specId, shortfall: purchasedQty, plannedWithin: replenPlanId });
        }
    }

    // --- Backtracking ---
    if (replenDebts.length > 0) {
        const remaining = new Set(pass1Records);

        while (replenDebts.length > 0 && remaining.size > 0) {
            if (strategy.recordSacrifice === undefined) break;

            const candidate = strategy.selectRetractCandidate(remaining, canonical);
            if (!candidate) break;
            remaining.delete(candidate);

            netter.retract(candidate.result);

            const retryReplenNetter = netter.fork({ observer: undefined });
            const resolvedDebt: string[] = [];
            for (const debt of replenDebts) {
                const retryPlanId = `replenish-retry-${generateId()}`;
                planStore.addPlan({ id: retryPlanId, name: `Retry replenishment for ${debt.specId}` });
                const reResult = dependentDemand({
                    planId: retryPlanId, demandSpecId: debt.specId, demandQuantity: debt.shortfall,
                    dueDate: horizon.to, recipeStore: ctx.recipeStore, planStore, processes,
                    observer: undefined, netter: retryReplenNetter, agents: ctx.agents, generateId,
                });
                allPurchaseIntents.push(...reResult.purchaseIntents);
                const newPurchasedQty = reResult.purchaseIntents
                    .filter(i => i.resourceConformsTo === debt.specId)
                    .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
                if (newPurchasedQty < debt.shortfall - 1e-9) debt.shortfall = newPurchasedQty;
                if (newPurchasedQty <= 1e-9) resolvedDebt.push(debt.specId);
            }
            replenDebts.splice(0, replenDebts.length, ...replenDebts.filter(d => !resolvedDebt.includes(d.specId)));

            // Re-explode with freed capacity
            const reExplodePlanId = `reexplode-${generateId()}`;
            planStore.addPlan({ id: reExplodePlanId, name: `Re-explode for ${candidate.slot.spec_id}` });
            const reResult = candidate.slot.spec_id ? dependentDemand({
                planId: reExplodePlanId,
                demandSpecId: candidate.slot.spec_id,
                demandQuantity: candidate.slot.remaining_quantity,
                dueDate: candidate.slot.due ? new Date(candidate.slot.due) : horizon.to,
                recipeStore: ctx.recipeStore, planStore, processes,
                observer: ctx.observer, netter, atLocation: strategy.locationOf(candidate.slot),
                agents: ctx.agents, generateId,
                honorDecouplingPoints: true,
            }) : null;

            if (reResult && strategy.isReExplodeSuccess(reResult)) {
                const backtrackChildProv = childProvenanceByIntentId.get(candidate.slot.intent_id);
                if (backtrackChildProv?.originLocation) {
                    strategy.annotateChildCommitments(reResult.commitments, backtrackChildProv.originLocation);
                }
                pass1Records.push({ slot: candidate.slot, slotClass: candidate.slotClass, result: reResult });
            } else {
                const candidateLocation = strategy.locationOf(candidate.slot) ?? canonical[0];
                const limitReached = strategy.recordSacrifice(candidate.slot, canonical);

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

    // -------------------------------------------------------------------------
    // Phase B — Forward-schedule unabsorbed supply
    // -------------------------------------------------------------------------
    const allSurplus: SurplusSignal[] = [];

    for (const supplySlot of extractedSupply) {
        if (!supplySlot.spec_id) continue;
        if (supplySlot.slot_type === 'labor') continue;

        const supplyPlanId = `supply-${generateId()}`;
        planStore.addPlan({ id: supplyPlanId, name: `Supply plan for ${supplySlot.spec_id}` });

        // Strategy-specific scheduled_receipt handling
        const directSurplus = strategy.handleScheduledReceipt(
            supplySlot, planStore, processes, ctx.recipeStore, generateId, supplyPlanId,
        );
        if (directSurplus) {
            allSurplus.push(directSurplus);
            continue;
        }

        const supplyObserver = strategy.observerForSupply(ctx.observer, canonical);

        const result = dependentSupply({
            planId: supplyPlanId,
            supplySpecId: supplySlot.spec_id,
            supplyQuantity: supplySlot.quantity,
            availableFrom: supplySlot.available_from
                ? new Date(supplySlot.available_from)
                : horizon.from,
            recipeStore: ctx.recipeStore,
            planStore,
            processes,
            observer: supplyObserver,
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
        allPurchaseIntents.push(...result.purchaseIntents);
    }

    // -------------------------------------------------------------------------
    // Merge planner: conflict detection and surgical resolution
    // -------------------------------------------------------------------------
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
                    const record = pass1Records.find(r =>
                        r.result.processes.some(p => p.id === procId),
                    );
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
                    const mergeLocation = strategy.locationOf(record.slot) ?? canonical[0];
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
                            planId: mergeReplanId,
                            demandSpecId: slot.spec_id,
                            demandQuantity: slot.remaining_quantity,
                            dueDate: slot.due ? new Date(slot.due) : horizon.to,
                            recipeStore: ctx.recipeStore,
                            planStore,
                            processes,
                            observer: ctx.observer,
                            netter,
                            agents: ctx.agents,
                            generateId,
                            honorDecouplingPoints: true,
                        });
                        allPurchaseIntents.push(...reResult.purchaseIntents);
                        const mergeChildProv = childProvenanceByIntentId.get(slot.intent_id);
                        if (mergeChildProv?.originLocation) {
                            strategy.annotateChildCommitments(reResult.commitments, mergeChildProv.originLocation);
                        }
                    }

                    const newConflicts = detectConflicts(planStore, ctx.observer);
                    const stillConflicted = newConflicts.some(
                        nc => nc.resourceOrAgentId === conflict.resourceOrAgentId,
                    );
                    if (!stillConflicted) break;
                }
            }

            conflicts = detectConflicts(planStore, ctx.observer);
        }
    }

    // -------------------------------------------------------------------------
    // Phase 4 — Collect
    // -------------------------------------------------------------------------
    const laborGaps = planStore.allIntents().filter(
        i => i.action === 'work' && i.provider === undefined,
    );

    // Remove child-level signal Intents merged from subStores
    planStore.removeRecords({
        intentIds: [
            ...planStore.intentsForTag(PLAN_TAGS.DEFICIT),
            ...planStore.intentsForTag(PLAN_TAGS.SURPLUS),
            ...planStore.intentsForTag(PLAN_TAGS.CONSERVATION),
        ].map(i => i.id),
    });

    // Emit deficit Intents
    for (const d of allDeficits) {
        const unit = planStore.getIntent(d.intentId)?.resourceQuantity?.hasUnit ?? 'unit';
        const locFields = strategy.deficitLocationFields(d.location, canonical);
        planStore.addIntent({
            id: d.intentId,
            action: d.action as import('../schemas').VfAction,
            resourceConformsTo: d.specId,
            resourceQuantity: { hasNumericalValue: d.shortfall, hasUnit: unit },
            due: d.due,
            atLocation: locFields.atLocation,
            plannedWithin: d.plannedWithin,
            inScopeOf: locFields.inScopeOf,
            resourceClassifiedAs: [
                PLAN_TAGS.DEFICIT,
                ...(d.source === 'metabolic_debt' ? [PLAN_TAGS.METABOLIC_DEBT] : []),
            ],
            note: JSON.stringify({
                originalShortfall: d.originalShortfall ?? d.shortfall,
                resolvedAt: d.resolvedAt ?? [],
            }),
            finished: false,
        });
    }

    // Emit surplus Intents
    for (const s of allSurplus) {
        const unit = ctx.recipeStore.getResourceSpec(s.specId)?.defaultUnitOfResource ?? 'unit';
        planStore.addIntent({
            action: 'transfer',
            provider: canonical[0],
            resourceConformsTo: s.specId,
            resourceQuantity: { hasNumericalValue: s.quantity, hasUnit: unit },
            hasPointInTime: s.availableFrom,
            atLocation: s.atLocation,
            plannedWithin: s.plannedWithin,
            resourceClassifiedAs: [PLAN_TAGS.SURPLUS],
            finished: false,
        });
    }

    // Emit conservation Intents
    {
        const emittedConservationSpecs = new Set<string>();
        for (const c of allConservationData) {
            emittedConservationSpecs.add(c.specId);
            planStore.addIntent({
                action: 'cite',
                resourceConformsTo: c.specId,
                resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
                plannedWithin: `conservation:${c.specId}`,
                note: JSON.stringify({
                    onhand: c.onhand, tor: c.tor, toy: c.toy, tog: c.tog,
                    zone: c.zone, tippingPointBreached: c.tippingPointBreached,
                }),
                finished: false,
            });
        }
        // Child conservation intents
        if (subStores && subStores.length > 0) {
            const mergedChild = new Map<string, Record<string, unknown>>();
            for (const childStore of subStores) {
                for (const ci of childStore.intentsForTag(PLAN_TAGS.CONSERVATION)) {
                    const cn = parseConservationNote(ci);
                    const cSpecId = ci.resourceConformsTo ?? '';
                    const existing = mergedChild.get(cSpecId);
                    if (!existing) {
                        mergedChild.set(cSpecId, {
                            onhand: cn.onhand, tor: cn.tor, toy: cn.toy, tog: cn.tog,
                            zone: cn.zone, tippingPointBreached: cn.tippingPointBreached,
                        });
                    } else if (cn.tippingPointBreached) {
                        existing.tippingPointBreached = true;
                    }
                }
            }
            for (const [specId, note] of mergedChild) {
                if (emittedConservationSpecs.has(specId)) {
                    if (note.tippingPointBreached) {
                        const existing = planStore.intentsForTag(PLAN_TAGS.CONSERVATION)
                            .find(i => i.resourceConformsTo === specId);
                        if (existing) {
                            const parsed = JSON.parse(existing.note ?? '{}');
                            parsed.tippingPointBreached = true;
                            planStore.removeRecords({ intentIds: [existing.id] });
                            planStore.addIntent({ ...existing, note: JSON.stringify(parsed) });
                        }
                    }
                } else {
                    emittedConservationSpecs.add(specId);
                    planStore.addIntent({
                        action: 'cite',
                        resourceConformsTo: specId,
                        resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
                        plannedWithin: `conservation:${specId}`,
                        note: JSON.stringify(note),
                        finished: false,
                    });
                }
            }
        }
    }

    return {
        planStore,
        purchaseIntents: allPurchaseIntents,
        unmetDemand,
        laborGaps,
    };
}
