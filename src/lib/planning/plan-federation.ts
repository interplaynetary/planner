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
import type { PlanStore } from './planning';
import {
    planForScope,
    buildScopePlanSignals,
    type ScopePlanContext,
    type ScopePlanResult,
    type ScopeDeficitSignal,
    type ScopePlanSignals,
    type SurplusSignal,
} from './plan-for-scope';
import { StoreRegistry } from './store-registry';
import type { RemoteTransport } from './remote-transport';

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
    }>;
    /**
     * When provided, StoreRegistry auto-announces each scope after planning
     * and resolveAsync() falls back to remote fetch on local miss.
     */
    remoteTransport?: RemoteTransport;
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
     * Deficits that remain after the root-level planner has had its turn —
     * demands the entire federation could not satisfy.
     */
    unresolved: ScopeDeficitSignal[];
    /** Surpluses at the root level available for external trade. */
    rootSurplus: SurplusSignal[];
    /**
     * Distributed address space for the federation plan.
     * Maps scopeId → PlanStore and supports cross-scope reference resolution
     * via qualify("scopeId::recordId") and reactive subscriptions.
     */
    registry: StoreRegistry;
    /**
     * Peer trade proposals from the lateral matching pass.
     * These represent surplus-to-deficit matches between scopes that are not
     * in an ancestor/descendant relationship — true peer trades.
     */
    tradeProposals: TradeProposal[];
    /**
     * Ordered federation event log across all planning rounds.
     * Round 0 = bottom-up hierarchy pass, Round 1 = lateral matching.
     */
    events: FederationEvent[];
}

// =============================================================================
// LATERAL MATCHING TYPES
// =============================================================================

/** A peer trade proposal created during the lateral matching pass. */
export interface TradeProposal {
    id: string;
    /** Scope offering surplus. */
    fromScopeId: string;
    /** Scope with the unmet demand. */
    toScopeId: string;
    specId: string;
    quantity: number;
    status: 'proposed' | 'accepted' | 'settled';
}

export type FederationEventKind =
    | 'scope-planned'
    | 'deficit-announced'
    | 'surplus-offered'
    | 'lateral-match'
    | 'deficit-propagated'
    | 'residual-unresolved';

/** An event emitted during the federation planning process. */
export interface FederationEvent {
    kind: FederationEventKind;
    /** Planning round: 0 = bottom-up pass, 1 = lateral matching, 2+ = residuals. */
    round: number;
    scopeId: string;
    targetScopeId?: string;
    specId?: string;
    quantity?: number;
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
        recipeStore:  ctx.recipeStore,
        observer:     ctx.observer,
        demandIndex:  ctx.demandIndex,
        supplyIndex:  ctx.supplyIndex,
        parentOf:     ctx.parentOf,
        generateId,
        agents:       ctx.agents,
        config:       ctx.config,
        bufferAlerts: ctx.bufferAlerts,
    };

    for (const scopeId of planOrder) {
        const children = childrenOf.get(scopeId) ?? [];

        const childSignals: ScopePlanSignals[] = children.map(c =>
            buildScopePlanSignals(byScope.get(c)!),
        );
        const subStores: PlanStore[] = children.map(c =>
            byScope.get(c)!.planStore,
        );

        const result = planForScope(
            [scopeId],
            horizon,
            scopeCtx,
            children.length > 0 ? subStores : undefined,
            children.length > 0 ? childSignals : undefined,
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
    // Step 5 — Lateral matching pass (peer trade proposals)
    //
    // After the bottom-up hierarchy pass, any deficits that remain are those
    // that couldn't be resolved within a sub-tree. We attempt to match them
    // against surplus in unrelated scopes (not ancestor/descendant).
    // -------------------------------------------------------------------------
    const tradeProposals: TradeProposal[] = [];

    // Build a mutable surplus pool
    const surplusPool = new Map<string, Array<{ scopeId: string; qty: number }>>();
    for (const [sid, result] of byScope) {
        for (const s of result.surplus) {
            const bucket = surplusPool.get(s.specId) ?? [];
            bucket.push({ scopeId: sid, qty: s.quantity });
            surplusPool.set(s.specId, bucket);
        }
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

    // Collect unresolved deficits (deduplicated by intentId)
    const seenDeficitIds = new Set<string>();
    const deficitWork: Array<{ scopeId: string; specId: string; shortfall: number; intentId: string }> = [];
    for (const [sid, result] of byScope) {
        for (const d of result.deficits) {
            if (d.shortfall <= 1e-9) continue;
            if (seenDeficitIds.has(d.intentId)) continue;
            seenDeficitIds.add(d.intentId);
            deficitWork.push({ scopeId: sid, specId: d.specId, shortfall: d.shortfall, intentId: d.intentId });
            events.push({ kind: 'deficit-announced', round: 1, scopeId: sid, specId: d.specId, quantity: d.shortfall });
        }
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
            tradeProposals.push({
                id: generateId(),
                fromScopeId: entry.scopeId,
                toScopeId: deficit.scopeId,
                specId: deficit.specId,
                quantity: qty,
                status: 'proposed',
            });
            events.push({ kind: 'lateral-match', round: 1, scopeId: entry.scopeId, targetScopeId: deficit.scopeId, specId: deficit.specId, quantity: qty });
            if (deficit.shortfall <= 1e-9) break;
        }
        if (deficit.shortfall > 1e-9) {
            events.push({ kind: 'deficit-propagated', round: 1, scopeId: deficit.scopeId, specId: deficit.specId, quantity: deficit.shortfall });
        }
    }

    // Write resolved shortfalls back to ALL copies of each deficit in byScope.
    // deficitWork mutated shortfall in-place on local copies; byScope still has
    // the original values — the resolvedPct stat reads from byScope so we must sync.
    const finalShortfall = new Map<string, number>();
    for (const d of deficitWork) finalShortfall.set(d.intentId, d.shortfall);
    for (const result of byScope.values()) {
        for (const d of result.deficits) {
            const resolved = finalShortfall.get(d.intentId);
            if (resolved !== undefined) d.shortfall = resolved;
        }
    }

    // Residual unresolved (survived all passes)
    for (const d of root.deficits) {
        if (d.shortfall > 1e-9) {
            events.push({ kind: 'residual-unresolved', round: 2, scopeId: rootId, specId: d.specId, quantity: d.shortfall });
        }
    }

    return {
        byScope,
        root,
        planOrder,
        allPurchaseIntents,
        unresolved: root.deficits,
        rootSurplus: root.surplus,
        registry,
        tradeProposals,
        events,
    };
}
