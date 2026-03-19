/**
 * Federation Planning Orchestrator — hierarchical bottom-up planning across scopes.
 *
 * Chains planForScope calls level by level, leaf communes first, the Universal
 * Commune last. Each scope receives the unmet demands and surpluses of its
 * children as `childSignals`, and the children's plan stores as `subStores`
 * for conflict detection and surgical resolution.
 *
 * Algorithm:
 *   1. Build a children map from the parentOf hierarchy.
 *   2. Topological sort — post-order (children always precede their parent).
 *   3. Bottom-up pass: for each scope, planForScope with collected child signals
 *      and sub-stores from already-planned children.
 *   4. Return per-scope results, the root result, and any residual deficits.
 *
 * The Universal Commune is the natural root — the scope that has no parent in
 * the hierarchy among the provided scope IDs.
 */

import { nanoid } from 'nanoid';
import type { Intent } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { Observer } from '../observation/observer';
import type { IndependentDemandIndex } from '../indexes/independent-demand';
import type { IndependentSupplyIndex } from '../indexes/independent-supply';
import { PlanStore, PLAN_TAGS, parseDeficitNote, parseConservationNote } from './planning';
import { ProcessRegistry } from '../process-registry';
import {
    planForScope,
    type ScopePlanContext,
    type ScopePlanResult,
} from './plan-for-scope';
import type { ConservationSignal } from './plan-for-region';
import { StoreRegistry } from './store-registry';
import type { RemoteTransport } from './remote-transport';
import type { BufferZoneStore } from '../knowledge/buffer-zones';

// =============================================================================
// TYPES
// =============================================================================

export interface FederationPlanContext {
    recipeStore: RecipeStore;
    observer: Observer;
    demandIndex: IndependentDemandIndex;
    supplyIndex: IndependentSupplyIndex;
    /**
     * Scope hierarchy: childScopeId → parentScopeId.
     * Derived from MembershipIndex.scopeParent or supplied directly.
     * Scopes absent from this map are treated as roots (no parent).
     */
    parentOf: Map<string, string>;
    generateId?: () => string;
    agents?: { provider?: string; receiver?: string };
    config?: { insuranceFactor?: number };
    /**
     * Buffer alerts forwarded to every scope's Pass 2 (optional).
     * Same structure as ScopePlanContext.bufferAlerts.
     */
    bufferAlerts?: Map<string, {
        onhand: number; tor: number; toy: number; tog: number;
        zone: 'red' | 'yellow' | 'green' | 'excess';
        tippingPointBreached?: boolean;
    }>;
    /**
     * When provided, StoreRegistry auto-announces each scope after planning
     * and resolveAsync() falls back to remote fetch on local miss.
     */
    remoteTransport?: RemoteTransport;
    /**
     * Number of members in each leaf scope.  Passed through to every planForScope
     * call so the backtracking loop can weight sacrifice proportionally.
     * Intermediate/aggregate scopes need not be listed — their weight is the sum
     * of their leaf descendants, computed on the fly if needed.
     */
    memberCounts?: Map<string, number>;
    /**
     * Maximum demand-retractions in the backtracking loop at each federation level.
     * Passed through unchanged — each planForScope invocation enforces its own limit.
     * Default (undefined): unbounded.
     */
    sacrificeDepth?: number;
    /**
     * When provided, bufferAlerts for each scope is derived automatically from
     * BufferZoneStore + current observer inventory. Passed through to planForScope.
     * Takes precedence over explicit bufferAlerts.
     */
    bufferZoneStore?: BufferZoneStore;
}

export interface FederationPlanResult {
    /** Results keyed by scope ID, available for every scope that was planned. */
    byScope: Map<string, ScopePlanResult>;
    /**
     * The root scope's result (highest ancestor — the Universal Commune in a
     * fully-specified hierarchy, or the last scope processed if the root is
     * implicit).
     */
    root: ScopePlanResult;
    /** Topological order in which scopes were planned (leaves → root). */
    planOrder: string[];
    /** All purchase intents emitted across all scope levels (deduplicated). */
    allPurchaseIntents: Intent[];
    /**
     * Distributed address space for the federation plan.
     * Maps scopeId → PlanStore and supports cross-scope reference resolution
     * via qualify("scopeId::recordId") and reactive subscriptions.
     */
    registry: StoreRegistry;
    /**
     * Lateral-transfer Intents (tag:plan:lateral-transfer) from the peer matching pass.
     * Query: federationStore.intentsForTag(PLAN_TAGS.LATERAL_TRANSFER)
     * Fields: provider = fromScopeId, inScopeOf[0] = toScopeId,
     *         resourceConformsTo = specId, resourceQuantity.hasNumericalValue = quantity
     */
    federationStore: PlanStore;
    /**
     * Ordered federation event log across all planning rounds.
     * Round 0 = bottom-up hierarchy pass, Round 1 = lateral matching.
     */
    events: FederationEvent[];
    /**
     * All conservation signals emitted across all scopes.
     * Ecological buffers in yellow/red zone; each signal instructs upstream
     * demand sources to reduce extraction of the affected resource.
     * Signals with tippingPointBreached: true require immediate escalation.
     */
    allConservationSignals: ConservationSignal[];
}

// =============================================================================
// FEDERATION EVENT TYPES
// =============================================================================

export type FederationEventKind =
    | 'scope-planned'
    | 'deficit-announced'
    | 'surplus-offered'
    | 'lateral-match'
    | 'deficit-propagated'
    | 'residual-unresolved'
    | 'sacrifice-rebalanced';

/** An event emitted during the federation planning process. */
export interface FederationEvent {
    kind: FederationEventKind;
    /** Planning round: 0 = bottom-up pass, 1 = lateral matching, 2+ = residuals. */
    round: number;
    scopeId: string;
    targetScopeId?: string;
    specId?: string;
    quantity?: number;
    /** For 'sacrifice-rebalanced': sacrifice per member at this scope vs. federation target. */
    sacrificePerMember?: number;
    targetSacrificePerMember?: number;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Post-order DFS topological sort over the scope tree.
 * Children are always emitted before their parent.
 * Handles forests (multiple disconnected trees).
 */
function topoSort(
    scopeIds: string[],
    childrenOf: Map<string, string[]>,
): string[] {
    const order: string[] = [];
    const visited = new Set<string>();

    function visit(id: string): void {
        if (visited.has(id)) return;
        visited.add(id);
        for (const child of childrenOf.get(id) ?? []) {
            visit(child);
        }
        order.push(id);
    }

    for (const id of scopeIds) visit(id);
    return order;
}

// =============================================================================
// PLAN FEDERATION
// =============================================================================

/**
 * Run hierarchical planning across a set of scopes.
 *
 * @param scopeIds  All scope IDs to plan (commune, federation, UC — any mix).
 *                  Scopes not connected by parentOf are treated as independent roots.
 * @param horizon   Planning window passed to every planForScope call.
 * @param ctx       Shared context (recipes, observer, indexes, hierarchy).
 */
export function planFederation(
    scopeIds: string[],
    horizon: { from: Date; to: Date },
    ctx: FederationPlanContext,
): FederationPlanResult {
    const generateId = ctx.generateId ?? (() => nanoid());
    const plannable = new Set(scopeIds);

    // -------------------------------------------------------------------------
    // Step 1 — Build children map (restrict to planned scopes only)
    // -------------------------------------------------------------------------
    const childrenOf = new Map<string, string[]>();
    for (const id of scopeIds) childrenOf.set(id, []);

    for (const [child, parent] of ctx.parentOf) {
        if (plannable.has(child) && plannable.has(parent)) {
            childrenOf.get(parent)!.push(child);
        }
    }

    // -------------------------------------------------------------------------
    // Step 2 — Topological sort (post-order: leaves first)
    // -------------------------------------------------------------------------
    const planOrder = topoSort(scopeIds, childrenOf);

    // -------------------------------------------------------------------------
    // Step 3 — Bottom-up planning pass
    // -------------------------------------------------------------------------
    const byScope = new Map<string, ScopePlanResult>();
    const registry = new StoreRegistry(ctx.remoteTransport);

    const scopeCtx: ScopePlanContext = {
        recipeStore:    ctx.recipeStore,
        observer:       ctx.observer,
        demandIndex:    ctx.demandIndex,
        supplyIndex:    ctx.supplyIndex,
        parentOf:       ctx.parentOf,
        generateId,
        agents:         ctx.agents,
        config:         ctx.config,
        bufferAlerts:    ctx.bufferAlerts,
        bufferZoneStore: ctx.bufferZoneStore,
        memberCounts:    ctx.memberCounts,
        sacrificeDepth:  ctx.sacrificeDepth,
    };

    for (const scopeId of planOrder) {
        const children = childrenOf.get(scopeId) ?? [];

        const subStores: PlanStore[] = children.map(c =>
            byScope.get(c)!.planStore,
        );

        const result = planForScope(
            [scopeId],
            horizon,
            scopeCtx,
            children.length > 0 ? subStores : undefined,
        );

        byScope.set(scopeId, result);
        registry.register(scopeId, result.planStore);  // builds O(1) index for this scope
        registry.notify(scopeId);                       // fires any listeners already subscribed
    }

    // -------------------------------------------------------------------------
    // Step 4 — Collect outputs
    // -------------------------------------------------------------------------
    // Root = last scope in topological order (highest ancestor)
    const rootId = planOrder[planOrder.length - 1];
    const root = byScope.get(rootId)!;

    // Deduplicated purchase intents across all levels
    const allPurchaseIntents: Intent[] = [];
    const seenIntentIds = new Set<string>();
    for (const result of byScope.values()) {
        for (const intent of result.purchaseIntents) {
            if (!seenIntentIds.has(intent.id)) {
                seenIntentIds.add(intent.id);
                allPurchaseIntents.push(intent);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Step 4 — Event log: round 0 (bottom-up pass complete)
    // -------------------------------------------------------------------------
    const events: FederationEvent[] = planOrder.map(scopeId => ({
        kind: 'scope-planned' as FederationEventKind,
        round: 0,
        scopeId,
    }));

    // -------------------------------------------------------------------------
    // Step 5 — Lateral matching pass (peer trade proposals as VF Intents)
    //
    // After the bottom-up hierarchy pass, any deficits that remain are those
    // that couldn't be resolved within a sub-tree. We attempt to match them
    // against surplus in unrelated scopes (not ancestor/descendant).
    // -------------------------------------------------------------------------

    // federationStore holds lateral-transfer Intents (tag:plan:lateral-transfer)
    const federationStore = new PlanStore(new ProcessRegistry(generateId), generateId);

    // Build a mutable surplus pool from planStore intents (cross-scope query via registry)
    const surplusPool = new Map<string, Array<{ scopeId: string; qty: number; intentId: string; unit: string }>>();
    for (const { scopeId: sid, intent: i } of registry.intentsForTag(PLAN_TAGS.SURPLUS)) {
        const specId = i.resourceConformsTo ?? '';
        const bucket = surplusPool.get(specId) ?? [];
        bucket.push({
            scopeId: sid,
            qty: i.resourceQuantity?.hasNumericalValue ?? 0,
            intentId: i.id,
            unit: i.resourceQuantity?.hasUnit ?? 'unit',
        });
        surplusPool.set(specId, bucket);
    }

    // Emit surplus-offered events
    for (const [specId, entries] of surplusPool) {
        for (const entry of entries) {
            if (entry.qty > 1e-9) {
                events.push({ kind: 'surplus-offered', round: 1, scopeId: entry.scopeId, specId, quantity: entry.qty });
            }
        }
    }

    // Helper: is scope A an ancestor of scope B?
    const isAncestorOf = (a: string, b: string): boolean => {
        let cur = ctx.parentOf.get(b);
        while (cur) {
            if (cur === a) return true;
            cur = ctx.parentOf.get(cur);
        }
        return false;
    };

    // Collect unresolved deficits (deduplicated by intentId, cross-scope query via registry)
    const seenDeficitIds = new Set<string>();
    const deficitWork: Array<{
        scopeId: string; specId: string; shortfall: number; intentId: string;
        unit: string; isMetabolicDebt: boolean;
    }> = [];
    for (const { scopeId: sid, intent: i } of registry.intentsForTag(PLAN_TAGS.DEFICIT)) {
        const shortfall = i.resourceQuantity?.hasNumericalValue ?? 0;
        if (shortfall <= 1e-9) continue;
        if (seenDeficitIds.has(i.id)) continue;
        seenDeficitIds.add(i.id);
        deficitWork.push({
            scopeId: sid,
            specId: i.resourceConformsTo ?? '',
            shortfall,
            intentId: i.id,
            unit: i.resourceQuantity?.hasUnit ?? 'unit',
            isMetabolicDebt: i.resourceClassifiedAs?.includes(PLAN_TAGS.METABOLIC_DEBT) ?? false,
        });
        events.push({ kind: 'deficit-announced', round: 1, scopeId: sid, specId: i.resourceConformsTo ?? '', quantity: shortfall });
    }

    // Lateral matching: try to match each deficit against a non-hierarchical surplus
    for (const deficit of deficitWork) {
        if (deficit.shortfall <= 1e-9) continue;
        const candidates = surplusPool.get(deficit.specId) ?? [];
        for (const entry of candidates) {
            if (entry.qty <= 1e-9) continue;
            if (entry.scopeId === deficit.scopeId) continue;
            // Skip ancestor/descendant pairs — the hierarchy already handles those
            if (isAncestorOf(entry.scopeId, deficit.scopeId)) continue;
            if (isAncestorOf(deficit.scopeId, entry.scopeId)) continue;
            const qty = Math.min(deficit.shortfall, entry.qty);
            entry.qty -= qty;
            deficit.shortfall -= qty;
            federationStore.addIntent({
                action: 'transfer',
                provider: entry.scopeId,
                inScopeOf: [deficit.scopeId],
                resourceConformsTo: deficit.specId,
                resourceQuantity: { hasNumericalValue: qty, hasUnit: entry.unit },
                resourceClassifiedAs: [PLAN_TAGS.LATERAL_TRANSFER],
                finished: false,
            });
            events.push({ kind: 'lateral-match', round: 1, scopeId: entry.scopeId, targetScopeId: deficit.scopeId, specId: deficit.specId, quantity: qty });
            if (deficit.shortfall <= 1e-9) break;
        }
        if (deficit.shortfall > 1e-9) {
            events.push({ kind: 'deficit-propagated', round: 1, scopeId: deficit.scopeId, specId: deficit.specId, quantity: deficit.shortfall });
        }
    }

    // Write resolved shortfalls back to ALL deficit Intents in every planStore that holds them.
    const finalShortfall = new Map<string, number>();
    for (const d of deficitWork) finalShortfall.set(d.intentId, d.shortfall);
    for (const result of byScope.values()) {
        for (const i of result.planStore.intentsForTag(PLAN_TAGS.DEFICIT)) {
            const newShortfall = finalShortfall.get(i.id);
            if (newShortfall === undefined) continue;
            if (Math.abs(newShortfall - (i.resourceQuantity?.hasNumericalValue ?? 0)) < 1e-9) continue;
            const { originalShortfall, resolvedAt } = parseDeficitNote(i);
            result.planStore.removeRecords({ intentIds: [i.id] });
            result.planStore.addIntent({
                ...i,
                resourceQuantity: { hasNumericalValue: newShortfall, hasUnit: i.resourceQuantity?.hasUnit ?? 'unit' },
                note: JSON.stringify({ originalShortfall, resolvedAt }),
            });
        }
    }

    // Register federationStore in the registry for cross-scope queries
    registry.register('federation', federationStore);

    // -------------------------------------------------------------------------
    // Sacrifice analysis — report per-scope sacrifice vs. proportional target
    // -------------------------------------------------------------------------
    if (ctx.memberCounts && ctx.memberCounts.size > 0) {
        // Collect remaining deficit per scope (after lateral matching resolved some)
        const deficitPerScope = new Map<string, number>();
        for (const d of deficitWork) {
            if (d.shortfall <= 1e-9) continue;
            deficitPerScope.set(d.scopeId, (deficitPerScope.get(d.scopeId) ?? 0) + d.shortfall);
        }

        const totalDeficit = [...deficitPerScope.values()].reduce((a, b) => a + b, 0);
        const totalMembers = [...deficitPerScope.keys()]
            .reduce((s, sid) => s + (ctx.memberCounts!.get(sid) ?? 1), 0);
        const targetPerMember = totalMembers > 0 ? totalDeficit / totalMembers : 0;

        for (const [sid, deficit] of deficitPerScope) {
            const members = ctx.memberCounts.get(sid) ?? 1;
            const actual = deficit / members;
            // Only emit when the imbalance is meaningful (> 10% deviation from target)
            if (Math.abs(actual - targetPerMember) > targetPerMember * 0.1 + 1e-9) {
                events.push({
                    kind: 'sacrifice-rebalanced',
                    round: 2,
                    scopeId: sid,
                    quantity: deficit,
                    sacrificePerMember: actual,
                    targetSacrificePerMember: targetPerMember,
                });
            }
        }
    }

    // Residual unresolved (survived all passes)
    for (const i of root.planStore.intentsForTag(PLAN_TAGS.DEFICIT)) {
        const shortfall = i.resourceQuantity?.hasNumericalValue ?? 0;
        if (shortfall > 1e-9) {
            events.push({ kind: 'residual-unresolved', round: 2, scopeId: rootId, specId: i.resourceConformsTo ?? '', quantity: shortfall });
        }
    }

    // Collect conservation signals from all scopes (deduplicated by specId — one per ecological resource)
    const seenConservationSpecIds = new Set<string>();
    const allConservationSignals: ConservationSignal[] = [];
    for (const result of byScope.values()) {
        for (const i of result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION)) {
            const specId = i.resourceConformsTo ?? '';
            const cn = parseConservationNote(i);
            if (!seenConservationSpecIds.has(specId)) {
                seenConservationSpecIds.add(specId);
                allConservationSignals.push({
                    plannedWithin: i.plannedWithin ?? `conservation:${specId}`,
                    specId,
                    onhand: cn.onhand, tor: cn.tor, toy: cn.toy, tog: cn.tog,
                    zone: cn.zone,
                    tippingPointBreached: cn.tippingPointBreached,
                });
            } else {
                // Merge: if any scope sees a tipping point breach, escalate
                if (cn.tippingPointBreached) {
                    const existing = allConservationSignals.find(s => s.specId === specId)!;
                    existing.tippingPointBreached = true;
                }
            }
        }
    }

    return {
        byScope,
        root,
        planOrder,
        allPurchaseIntents,
        registry,
        federationStore,
        events,
        allConservationSignals,
    };
}
