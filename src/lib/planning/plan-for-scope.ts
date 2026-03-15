/**
 * planForScope — scope-based planning orchestrator.
 *
 * Mirrors planForRegion but uses VF Agent scopes (Sₖ ⊆ V) as the planning
 * unit instead of H3 geohash cells. This enables planning for communal /
 * organisational units that are not geographically bounded.
 *
 * Algorithm phases:
 *   Phase 0: Normalise scope IDs (deduplicate, drop dominated descendants)
 *   Phase 1: Extract demand/supply slots for the canonical scope cover
 *   Phase 2: Classify each demand slot
 *   Phase 3: Formulate
 *     Pass 1: Explode primary independent demands (class order → due date)
 *     Derived: Compute replenishment demands from Pass 1 allocations
 *     Pass 2: Explode derived replenishment demands; collect metabolicDebt
 *     Backtrack: Retract latest-due Pass 1 demands to free capacity
 *   Phase B: Forward-schedule unabsorbed supply (dependentSupply)
 *   Phase 4: Collect result
 *
 * planForRegion is preserved unchanged for backward compatibility.
 */

import { nanoid } from 'nanoid';

import type { Intent } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';
import { PlanStore } from './planning';
import { ProcessRegistry } from '../process-registry';
import { PlanNetter } from './netting';
import { dependentDemand, type DependentDemandResult } from '../algorithms/dependent-demand';
import { dependentSupply } from '../algorithms/dependent-supply';
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

// Re-export shared types from plan-for-region so callers can import from one place
export type {
    MetabolicDebt,
    SurplusSignal,
    DemandSlotClass,
    Conflict,
} from './plan-for-region';

// =============================================================================
// TYPES
// =============================================================================

export interface ScopePlanContext {
    recipeStore: RecipeStore;
    observer: Observer;
    demandIndex: IndependentDemandIndex;
    supplyIndex: IndependentSupplyIndex;
    /**
     * Scope hierarchy: childScopeId → parentScopeId.
     * Used by normalizeScopes() to drop sub-scopes dominated by an ancestor
     * already present in the scope list.
     */
    parentOf?: Map<string, string>;
    generateId?: () => string;
    agents?: { provider?: string; receiver?: string };
    config?: { insuranceFactor?: number };
    /**
     * Buffer alerts for Pass 2 injection (spec P7).
     * Keys are ResourceSpec IDs. The planner injects a derived demand for
     * any spec whose alert is 'red' or 'yellow'.
     * Quantity = tog − onhand (replenishment-to-target).
     * When absent, only tag:plan:replenishment-required specs are processed in Pass 2.
     */
    bufferAlerts?: Map<string, { onhand: number; tor: number; toy: number; tog: number; zone: 'red' | 'yellow' | 'green' | 'excess' }>;
}

/** Deficit signal for scope-based composition (replaces h3_cell with scopeId). */
export interface ScopeDeficitSignal {
    /** Plan ID where this demand was attempted. */
    plannedWithin: string;
    /** Stable identifier for this deficit (original intent_id or synthetic key). */
    intentId: string;
    specId: string;
    action: string;
    shortfall: number;
    due?: string;
    /** Scope ID instead of h3_cell */
    scopeId?: string;
    source: 'unmet_demand' | 'metabolic_debt';
    /**
     * Original quantity demanded before any level resolved part of it.
     * Defaults to `shortfall` when first emitted; preserved as the deficit
     * propagates upward so consumers can see total vs. remaining.
     */
    originalShortfall?: number;
    /**
     * Chain of scope IDs where partial resolution occurred, innermost first.
     * Each entry is a scope that satisfied some portion of this demand.
     * Example: ["commune-A", "federation-X"] means commune-A resolved some,
     * then federation-X resolved more, and the remainder propagates further.
     */
    resolvedAt?: string[];
}

export interface ScopePlanSignals {
    deficits: ScopeDeficitSignal[];
    surplus: SurplusSignal[];
}

export interface ScopePlanResult {
    planStore: PlanStore;
    purchaseIntents: Intent[];
    surplus: SurplusSignal[];
    unmetDemand: DemandSlot[];
    metabolicDebt: MetabolicDebt[];
    laborGaps: Intent[];
    deficits: ScopeDeficitSignal[];
}

// Import the concrete types we need from plan-for-region (not re-exported as values)
import type {
    MetabolicDebt,
    SurplusSignal,
    Conflict,
    DemandSlotClass,
} from './plan-for-region';

// Internal record for per-slot tracking across passes
interface SlotRecord {
    slot: DemandSlot;
    result: DependentDemandResult;
    slotClass: DemandSlotClass;
}

// =============================================================================
// HELPERS
// =============================================================================

const CLASS_ORDER: Record<string, number> = {
    'locally-satisfiable':     0,
    'transport-candidate':     1,
    'producible-with-imports': 2,
    'external-dependency':     3,
};

// =============================================================================
// CONFLICT DETECTION (copied from plan-for-region — no external deps)
// =============================================================================

const NON_CONSUMING_ACTIONS = new Set(['use', 'work', 'cite', 'deliverService']);

function detectConflicts(planStore: PlanStore, observer: Observer): Conflict[] {
    const conflicts: Conflict[] = [];

    // --- Inventory overclaim ---
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

    // --- Capacity contention (stub — requires AgentIndex, not available here) ---
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
    // Emission deferred — AgentIndex required for limit lookup.
    void workByAgent;

    return conflicts;
}

// =============================================================================
// MERGE PLAN STORES (copied from plan-for-region — no external deps)
// =============================================================================

function mergePlanStores(subStores: PlanStore[], generateId?: () => string): PlanStore {
    const gen = generateId ?? (() => nanoid());
    const processes = new ProcessRegistry(gen);
    const merged = new PlanStore(processes, gen);
    for (const sub of subStores) {
        merged.merge(sub);
    }
    return merged;
}

// =============================================================================
// PHASE 0 — NORMALISE SCOPES
// =============================================================================

/**
 * Deduplicate scope IDs and drop any scope that is a descendant of another
 * scope already present (dominated by ancestor = redundant for coverage).
 *
 * @param scopeIds  Input list (may contain duplicates or ancestor+descendant pairs)
 * @param parentOf  Scope hierarchy map (childId → parentId). Optional; if absent,
 *                  all unique scopeIds are returned as-is.
 */
export function normalizeScopes(scopeIds: string[], parentOf?: Map<string, string>): string[] {
    const unique = [...new Set(scopeIds)];
    if (!parentOf || parentOf.size === 0) return unique;
    const uniqueSet = new Set(unique);
    return unique.filter(scopeId => {
        // Walk ancestors; if any ancestor is in the set, this scope is dominated.
        let current = parentOf.get(scopeId);
        while (current) {
            if (uniqueSet.has(current)) return false;
            current = parentOf.get(current);
        }
        return true;
    });
}

// =============================================================================
// PHASE 1 — EXTRACT
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
// PHASE 2 — CLASSIFY
// =============================================================================

export function classifyScopeSlot(
    slot: DemandSlot,
    canonical: string[],
    supplyIndex: IndependentSupplyIndex,
    recipeStore: RecipeStore,
): DemandSlotClass {
    const specId = slot.spec_id ?? '';

    // Is there supply of this spec within the canonical scopes?
    const localSupply = canonical.some(sid =>
        querySupplyByScope(supplyIndex, sid).some(s => s.spec_id === specId && s.quantity > 0)
    );
    if (localSupply) return 'locally-satisfiable';

    // Is there supply elsewhere (any scope)?
    const allSupply = querySupplyBySpec(supplyIndex, specId);
    if (allSupply.length > 0) return 'transport-candidate';

    // Is there a recipe that could produce it?
    const recipes = recipeStore.recipesForOutput(specId);
    if (recipes.length > 0) return 'producible-with-imports';

    return 'external-dependency';
}

// =============================================================================
// PLAN FOR SCOPE
// =============================================================================

/**
 * Top-level planning orchestrator for a set of VF Agent scopes.
 *
 * @param scopeIds     Agent IDs that define the planning scope (Sₖ ⊆ V)
 * @param horizon      Planning window (from/to dates)
 * @param ctx          Context (recipes, observer, indexes, etc.)
 * @param subStores    Optional leaf sub-stores for the merge planner path
 * @param childSignals Optional signals from sub-planners for upward composition
 */
export function planForScope(
    scopeIds: string[],
    horizon: { from: Date; to: Date },
    ctx: ScopePlanContext,
    subStores?: PlanStore[],
    childSignals?: ScopePlanSignals[],
): ScopePlanResult {
    const generateId = ctx.generateId ?? (() => nanoid());

    // -------------------------------------------------------------------------
    // Phase 0 — Normalise scopes
    // -------------------------------------------------------------------------
    const canonical = normalizeScopes(scopeIds, ctx.parentOf);

    // -------------------------------------------------------------------------
    // Phase 1 — Extract demand and supply slots
    // -------------------------------------------------------------------------
    const { demands: rawDemands, supply: extractedSupply } = extractScopeSlots(
        canonical,
        horizon,
        ctx.demandIndex,
        ctx.supplyIndex,
    );

    // Inject child deficit signals as demand slots (composable upward routing).
    // metabolic_debt deficits are injected first so they sort earlier within the same
    // classification bucket, fulfilling spec §565 "elevated priority over unmetDemand".
    //
    // Also build a provenance map so that when this level emits its own deficit
    // for a re-injected child demand, it can carry forward originalShortfall and
    // resolvedAt from the child signal.
    const childProvenanceByIntentId = new Map<string, Pick<ScopeDeficitSignal, 'originalShortfall' | 'resolvedAt'> & { originScopeId: string }>();
    if (childSignals && childSignals.length > 0) {
        const seenIntentId = new Set<string>();
        for (const pass of ['metabolic_debt', 'unmet_demand'] as const) {
            for (const signals of childSignals) {
                for (const deficit of signals.deficits) {
                    if (deficit.source !== pass) continue;
                    if (seenIntentId.has(deficit.intentId)) continue;
                    seenIntentId.add(deficit.intentId);
                    childProvenanceByIntentId.set(deficit.intentId, {
                        originalShortfall: deficit.originalShortfall ?? deficit.shortfall,
                        resolvedAt: deficit.resolvedAt ?? (deficit.scopeId ? [deficit.scopeId] : []),
                        originScopeId: deficit.scopeId ?? '',
                    });
                    rawDemands.push({
                        intent_id: deficit.intentId,
                        spec_id: deficit.specId,
                        action: deficit.action,
                        fulfilled_quantity: 0,
                        fulfilled_hours: 0,
                        required_quantity: deficit.shortfall,
                        required_hours: 0,
                        remaining_quantity: deficit.shortfall,
                        remaining_hours: 0,
                        due: deficit.due,
                        // No h3_cell for scope-injected deficits
                    });
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Phase 2 — Classify demand slots
    // -------------------------------------------------------------------------
    const classified = rawDemands.map(slot => ({
        slot,
        slotClass: classifyScopeSlot(slot, canonical, ctx.supplyIndex, ctx.recipeStore),
    }));

    // -------------------------------------------------------------------------
    // Phase 3 — Formulate
    // -------------------------------------------------------------------------

    // Setup: plan store + netter
    let planStore: PlanStore;
    if (subStores && subStores.length > 0) {
        planStore = mergePlanStores(subStores, generateId);
    } else {
        planStore = new PlanStore(new ProcessRegistry(generateId), generateId);
    }

    const processes = planStore.processes;
    const netter = new PlanNetter(planStore, ctx.observer);
    const pass1Records: SlotRecord[] = [];
    const allPurchaseIntents: Intent[] = [];
    const unmetDemand: DemandSlot[] = [];
    const replenDebts: MetabolicDebt[] = [];
    const allDeficits: ScopeDeficitSignal[] = [];

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

        // transport-candidates must be sourced externally, not produced locally.
        // Firing a production recipe here would resolve the demand at the wrong scope.
        if (slotClass === 'transport-candidate') {
            const purchaseIntent = planStore.addIntent({
                action: 'transfer',
                receiver: ctx.agents?.receiver,
                resourceConformsTo: slot.spec_id,
                resourceQuantity: {
                    hasNumericalValue: slot.remaining_quantity,
                    hasUnit: ctx.recipeStore.getResourceSpec(slot.spec_id)?.defaultUnitOfResource ?? 'unit',
                },
                due: slot.due,
                plannedWithin: planId,
                note: `Transport required: ${slot.spec_id} (supply exists in another scope)`,
                finished: false,
            });
            const result: DependentDemandResult = {
                plan: planStore.getPlan(planId)!,
                processes: [],
                commitments: [],
                intents: [],
                purchaseIntents: [purchaseIntent],
                allocated: [],
                allocatedScheduledIds: new Set(),
            };
            pass1Records.push({ slot, result, slotClass });
            allPurchaseIntents.push(purchaseIntent);
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
            atLocation: slot.atLocation,   // use atLocation (SpatialThing ID), not h3_cell
            agents: ctx.agents,
            generateId,
        });

        pass1Records.push({ slot, result, slotClass });
        allPurchaseIntents.push(...result.purchaseIntents);

        const childProvPass1 = childProvenanceByIntentId.get(slot.intent_id);
        if (childProvPass1?.originScopeId) {
            for (const commitment of result.commitments) {
                commitment.inScopeOf = [
                    ...(commitment.inScopeOf ?? []),
                    childProvPass1.originScopeId,
                ];
            }
        }
    }

    // Emit ScopeDeficitSignals for all Pass 1 demands where the spec couldn't be sourced.
    for (const record of pass1Records) {
        const unresolved = record.result.purchaseIntents
            .filter(i => i.resourceConformsTo === record.slot.spec_id)
            .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        if (unresolved > 1e-9) {
            const childProv = childProvenanceByIntentId.get(record.slot.intent_id);
            const resolvedHere = childProv
                ? (childProv.originalShortfall ?? unresolved) - unresolved > 1e-9
                : false;
            allDeficits.push({
                plannedWithin: record.result.plan.id,
                intentId: record.slot.intent_id,
                specId: record.slot.spec_id ?? '',
                action: record.slot.action,
                shortfall: unresolved,
                due: record.slot.due,
                scopeId: record.slot.inScopeOf?.[0] ?? canonical[0],
                source: 'unmet_demand',
                originalShortfall: childProv?.originalShortfall ?? unresolved,
                resolvedAt: resolvedHere
                    ? [...(childProv?.resolvedAt ?? []), canonical[0]]
                    : childProv?.resolvedAt,
            });
        }
    }

    // --- Compute derived replenishment demands ---
    const consumedBySpec = new Map<string, number>();
    for (const { result } of pass1Records) {
        for (const alloc of result.allocated) {
            consumedBySpec.set(
                alloc.specId,
                (consumedBySpec.get(alloc.specId) ?? 0) + alloc.quantity,
            );
        }
    }
    const derivedDemands: Array<{ specId: string; qty: number }> = [];
    for (const [specId, qty] of consumedBySpec) {
        const spec = ctx.recipeStore.getResourceSpec(specId);
        if (spec?.resourceClassifiedAs?.includes('tag:plan:replenishment-required')) {
            derivedDemands.push({ specId, qty });
        }
    }

    // P7: inject buffer-zone alert demands (red/yellow-zone replenishment to TOG)
    if (ctx.bufferAlerts) {
        for (const [specId, alert] of ctx.bufferAlerts) {
            if (alert.zone === 'red' || alert.zone === 'yellow') {
                const replenQty = Math.max(0, alert.tog - alert.onhand);
                if (replenQty > 1e-9 && !derivedDemands.some(d => d.specId === specId)) {
                    derivedDemands.push({ specId, qty: replenQty });
                }
            }
        }
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

    // --- Backtracking: if replenDebts remains, retract low-criticality Pass 1 ---
    if (replenDebts.length > 0) {
        // Spec §551: external-dependency (class 3) retracted before locally-satisfiable (class 0);
        // latest due date first within each class.
        const retractOrder = [...pass1Records].sort((a, b) => {
            const classDiff = (CLASS_ORDER[b.slotClass] ?? 3) - (CLASS_ORDER[a.slotClass] ?? 3);
            if (classDiff !== 0) return classDiff;
            return new Date(b.slot.due ?? 0).getTime() - new Date(a.slot.due ?? 0).getTime();
        });

        for (const candidate of retractOrder) {
            if (replenDebts.length === 0) break;

            netter.retract(candidate.result);

            const retryReplenNetter = netter.fork({ observer: undefined });

            const resolvedDebt: string[] = [];
            for (const debt of replenDebts) {
                const retryPlanId = `replenish-retry-${generateId()}`;
                planStore.addPlan({ id: retryPlanId, name: `Retry replenishment for ${debt.specId}` });
                const reResult = dependentDemand({
                    planId: retryPlanId,
                    demandSpecId: debt.specId,
                    demandQuantity: debt.shortfall,
                    dueDate: horizon.to,
                    recipeStore: ctx.recipeStore,
                    planStore,
                    processes,
                    observer: undefined,
                    netter: retryReplenNetter,
                    agents: ctx.agents,
                    generateId,
                });
                allPurchaseIntents.push(...reResult.purchaseIntents);

                const newPurchasedQty = reResult.purchaseIntents
                    .filter(i => i.resourceConformsTo === debt.specId)
                    .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
                if (newPurchasedQty < debt.shortfall - 1e-9) {
                    debt.shortfall = newPurchasedQty;
                }
                if (newPurchasedQty <= 1e-9) {
                    resolvedDebt.push(debt.specId);
                }
            }

            replenDebts.splice(0, replenDebts.length, ...replenDebts.filter(
                d => !resolvedDebt.includes(d.specId),
            ));

            // §551: attempt re-explode with freed capacity before declaring unmet
            const reExplodePlanId = `reexplode-${generateId()}`;
            planStore.addPlan({ id: reExplodePlanId, name: `Re-explode for ${candidate.slot.spec_id}` });
            const reResult = candidate.slot.spec_id ? dependentDemand({
                planId: reExplodePlanId,
                demandSpecId: candidate.slot.spec_id,
                demandQuantity: candidate.slot.remaining_quantity,
                dueDate: candidate.slot.due ? new Date(candidate.slot.due) : horizon.to,
                recipeStore: ctx.recipeStore,
                planStore,
                processes,
                observer: ctx.observer,
                netter,
                atLocation: candidate.slot.atLocation,
                agents: ctx.agents,
                generateId,
            }) : null;

            if (reResult && reResult.allocated.length > 0) {
                // Re-explode succeeded — keep the slot with updated result
                const backtrackChildProv = childProvenanceByIntentId.get(candidate.slot.intent_id);
                if (backtrackChildProv?.originScopeId) {
                    for (const commitment of reResult.commitments) {
                        commitment.inScopeOf = [
                            ...(commitment.inScopeOf ?? []),
                            backtrackChildProv.originScopeId,
                        ];
                    }
                }
                pass1Records.push({ slot: candidate.slot, slotClass: candidate.slotClass, result: reResult });
            } else {
                // Re-explode failed — demand is truly unmet
                unmetDemand.push(candidate.slot);

                const backtrackProv = childProvenanceByIntentId.get(candidate.slot.intent_id);
                allDeficits.push({
                    plannedWithin: candidate.result.plan.id,
                    intentId: candidate.slot.intent_id,
                    specId: candidate.slot.spec_id ?? '',
                    action: candidate.slot.action,
                    shortfall: candidate.slot.remaining_quantity,
                    due: candidate.slot.due,
                    scopeId: candidate.slot.inScopeOf?.[0] ?? canonical[0],
                    source: 'unmet_demand',
                    originalShortfall: backtrackProv?.originalShortfall ?? candidate.slot.remaining_quantity,
                    resolvedAt: backtrackProv?.resolvedAt,
                });
            }

            const idx = pass1Records.indexOf(candidate);
            if (idx >= 0) pass1Records.splice(idx, 1);
        }
    }

    // Emit ScopeDeficitSignals for unresolved replenDebts
    for (const debt of replenDebts) {
        allDeficits.push({
            plannedWithin: debt.plannedWithin,
            intentId: `synthetic:debt:${debt.plannedWithin}:${debt.specId}`,
            specId: debt.specId,
            action: 'produce',
            shortfall: debt.shortfall,
            scopeId: canonical[0],
            source: 'metabolic_debt',
        });
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

        // For produce intents (scheduled_receipt), synthesise a process node so it
        // shows up in the network diagram even when the spec is a terminal product
        // with no downstream consumption recipe.  The node's outputOf intent is also
        // picked up by the edge-drawing logic in ScopeNetworkDiagram, connecting it
        // to any downstream consuming process created by dependentSupply below.
        if (supplySlot.slot_type === 'scheduled_receipt') {
            const specName = ctx.recipeStore.getResourceSpec(supplySlot.spec_id)?.name ?? supplySlot.spec_id;
            const unit = ctx.recipeStore.getResourceSpec(supplySlot.spec_id)?.defaultUnitOfResource ?? 'unit';
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
            // Produce intents represent committed production for export to other scopes.
            // Routing them through dependentSupply would greedily absorb them into local
            // downstream recipes, leaving no surplus for lateral matching.
            // Treat the entire quantity as surplus directly.
            allSurplus.push({
                specId: supplySlot.spec_id,
                quantity: supplySlot.quantity,
                plannedWithin: supplyPlanId,
                availableFrom: supplySlot.available_from,
                atLocation: supplySlot.h3_cell,
            });
            continue;
        }

        // For inventory slots: use a scope-local observer so computeMaxByOtherMaterials
        // only sees resources available within this planning scope, not federation-wide.
        // This prevents cross-scope resources from satisfying local recipe constraints
        // and causing greedy absorption of inventory that should flow to lateral matching.
        const scopedObserver = new Observer();
        for (const r of ctx.observer.allResources()) {
            if (r.custodianScope && canonical.includes(r.custodianScope)) {
                scopedObserver.seedResource(r);
            }
        }

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
            observer: scopedObserver,
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

                // Sort: external-dependency first (highest class number), then latest due
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
                    allDeficits.push({
                        plannedWithin: record.result.plan.id,
                        intentId: record.slot.intent_id,
                        specId: record.slot.spec_id ?? '',
                        action: record.slot.action,
                        shortfall: record.slot.remaining_quantity,
                        due: record.slot.due,
                        scopeId: record.slot.inScopeOf?.[0] ?? canonical[0],
                        source: 'unmet_demand',
                        originalShortfall: mergeProv?.originalShortfall ?? record.slot.remaining_quantity,
                        resolvedAt: mergeProv?.resolvedAt,
                    });

                    // Re-explode at merge scope
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
                        });
                        allPurchaseIntents.push(...reResult.purchaseIntents);
                        const mergeChildProv = childProvenanceByIntentId.get(slot.intent_id);
                        if (mergeChildProv?.originScopeId) {
                            for (const commitment of reResult.commitments) {
                                commitment.inScopeOf = [
                                    ...(commitment.inScopeOf ?? []),
                                    mergeChildProv.originScopeId,
                                ];
                            }
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

    const metabolicDebt: MetabolicDebt[] = allDeficits
        .filter(d => d.source === 'metabolic_debt')
        .map(d => ({ specId: d.specId, shortfall: d.shortfall, plannedWithin: d.plannedWithin }));

    return {
        planStore,
        purchaseIntents: allPurchaseIntents,
        surplus: allSurplus,
        unmetDemand,
        metabolicDebt,
        laborGaps,
        deficits: allDeficits,
    };
}

// =============================================================================
// SIGNAL HELPERS
// =============================================================================

/** Extract ScopePlanSignals from a completed ScopePlanResult for passing to a parent planner. */
export function buildScopePlanSignals(result: ScopePlanResult): ScopePlanSignals {
    return { deficits: result.deficits, surplus: result.surplus };
}
