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
import { PlanStore, PLAN_TAGS, type DeficitMeta, type ConservationMeta } from './planning';
import { ProcessRegistry } from '../process-registry';
import {
    planForScope,
    type ScopePlanContext,
    type ScopePlanResult,
} from './plan-for-scope';
import type { ConservationSignal } from './plan-for-region';
import { StoreRegistry } from './store-registry';
import type { RemoteTransport } from './remote-transport';

// =============================================================================
// TYPES
// =============================================================================

// =============================================================================
// LATERAL MATCHING POLICY
// =============================================================================

export interface LateralMatchingPolicy {
    /** Whether a surplus should be offered for lateral matching. */
    shouldOffer(surplus: Intent, scopeId: string): boolean;
    /** Whether a deficit should request lateral matching. */
    shouldRequest(deficit: Intent, scopeId: string): boolean;
    /** Score a potential (offer, request) match. Higher = better. */
    scoreMatch(offer: Intent, request: Intent, ctx: FederationPlanContext): number;
}

/** Default policy: replicates current behavior — skip ancestor/descendant, score by min(offerQty, requestQty). */
export class DefaultLateralMatchingPolicy implements LateralMatchingPolicy {
    constructor(private parentOf: Map<string, string>) {}

    shouldOffer(_surplus: Intent, _scopeId: string): boolean {
        return (_surplus.resourceQuantity?.hasNumericalValue ?? 0) > 1e-9;
    }

    shouldRequest(_deficit: Intent, _scopeId: string): boolean {
        return (_deficit.resourceQuantity?.hasNumericalValue ?? 0) > 1e-9;
    }

    scoreMatch(offer: Intent, request: Intent, _ctx: FederationPlanContext): number {
        const offerScope = offer.provider ?? '';
        const requestScope = request.receiver ?? request.inScopeOf?.[0] ?? '';
        if (offerScope === requestScope) return -1;
        if (this.isAncestorOf(offerScope, requestScope)) return -1;
        if (this.isAncestorOf(requestScope, offerScope)) return -1;
        if (offer.resourceConformsTo !== request.resourceConformsTo) return -1;
        const offerQty = offer.resourceQuantity?.hasNumericalValue ?? 0;
        const requestQty = request.resourceQuantity?.hasNumericalValue ?? 0;
        return Math.min(offerQty, requestQty);
    }

    private isAncestorOf(a: string, b: string): boolean {
        let cur = this.parentOf.get(b);
        while (cur) {
            if (cur === a) return true;
            cur = this.parentOf.get(cur);
        }
        return false;
    }
}

// =============================================================================
// TYPES
// =============================================================================

export interface FederationPlanContext extends ScopePlanContext {
    /** Narrows optional parentOf → required. */
    parentOf: Map<string, string>;
    /**
     * When provided, StoreRegistry auto-announces each scope after planning
     * and resolveAsync() falls back to remote fetch on local miss.
     */
    remoteTransport?: RemoteTransport;
    /**
     * Optional policy controlling lateral matching behavior.
     * When absent, DefaultLateralMatchingPolicy is used (replicates current behavior).
     */
    lateralMatchingPolicy?: LateralMatchingPolicy;
    /** Cache from a previous planFederation call. */
    cache?: FederationPlanCache;
    /** Scope IDs whose inputs changed. Ancestors auto-included. Absent = full replan. */
    dirtyScopes?: Set<string>;
}

export interface FederationPlanCache {
    byScope: ReadonlyMap<string, ScopePlanResult>;
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
     * Federation-level PlanStore holding lateral-transfer Agreements + Commitments.
     * Query lateral matches via federationStore.allAgreements() and
     * federationStore.commitmentsForAgreement(id).
     */
    federationStore: PlanStore;
    /** Agreements created for lateral matches (one per surplus→deficit transfer). */
    lateralAgreements: import('../schemas').Agreement[];
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
    /** Cache for incremental replanning — pass back as ctx.cache on next call. */
    cache: FederationPlanCache;
}

// =============================================================================
// FEDERATION EVENT TYPES
// =============================================================================

export type FederationEventKind =
    | 'scope-planned'
    | 'scope-cached'
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
// DIRTY EXPANSION
// =============================================================================

function computeEffectiveDirty(
    scopeIds: string[],
    parentOf: Map<string, string>,
    cache?: FederationPlanCache,
    dirtyScopes?: Set<string>,
): Set<string> {
    if (!cache || !dirtyScopes) return new Set(scopeIds);
    const dirty = new Set<string>();
    // Scopes not in cache are always dirty
    for (const id of scopeIds) {
        if (!cache.byScope.has(id)) dirty.add(id);
    }
    // Add explicitly dirty scopes
    for (const id of dirtyScopes) dirty.add(id);
    // Expand upward: ancestors of dirty scopes must replan
    for (const id of [...dirty]) {
        let cur = parentOf.get(id);
        while (cur) {
            if (dirty.has(cur)) break;
            dirty.add(cur);
            cur = parentOf.get(cur);
        }
    }
    return dirty;
}

// =============================================================================
// EXTRACTED FUNCTIONS
// =============================================================================

/** 5A: Build hierarchy maps from scope IDs and parentOf. */
export function buildHierarchy(
    scopeIds: string[],
    parentOf: Map<string, string>,
): { childrenOf: Map<string, string[]>; planOrder: string[] } {
    const plannable = new Set(scopeIds);
    const childrenOf = new Map<string, string[]>();
    for (const id of scopeIds) childrenOf.set(id, []);
    for (const [child, parent] of parentOf) {
        if (plannable.has(child) && plannable.has(parent)) {
            childrenOf.get(parent)!.push(child);
        }
    }
    const planOrder = topoSort(scopeIds, childrenOf);
    return { childrenOf, planOrder };
}

/** 5B: Bottom-up fold — plan each scope in topological order, caching where possible. */
export function foldScopes(
    planOrder: string[],
    childrenOf: Map<string, string[]>,
    planScope: (scopeId: string, subStores: PlanStore[]) => ScopePlanResult,
    opts?: {
        cache?: FederationPlanCache;
        effectiveDirty?: Set<string>;
        registry?: StoreRegistry;
    },
): Map<string, ScopePlanResult> {
    const byScope = new Map<string, ScopePlanResult>();
    for (const scopeId of planOrder) {
        const children = childrenOf.get(scopeId) ?? [];

        if (opts?.effectiveDirty && !opts.effectiveDirty.has(scopeId) && opts.cache?.byScope.has(scopeId)) {
            const cached = opts.cache.byScope.get(scopeId)!;
            byScope.set(scopeId, cached);
            opts.registry?.register(scopeId, cached.planStore);
            opts.registry?.notify(scopeId);
            continue;
        }

        const subStores: PlanStore[] = children.map(c => byScope.get(c)!.planStore);
        const result = planScope(scopeId, subStores);
        byScope.set(scopeId, result);
        opts?.registry?.register(scopeId, result.planStore);
        opts?.registry?.notify(scopeId);
    }
    return byScope;
}

export interface DeficitWorkItem {
    scopeId: string; specId: string; shortfall: number;
    intentId: string; unit: string; isMetabolicDebt: boolean;
}

export interface LateralMatchResult {
    federationStore: PlanStore;
    agreements: import('../schemas').Agreement[];
    events: FederationEvent[];
    deficitWork: DeficitWorkItem[];
}

/** 5C: Lateral matching pass — match surplus against deficits across unrelated scopes. */
export function matchLaterally(
    registry: StoreRegistry,
    policy: LateralMatchingPolicy,
    ctx: FederationPlanContext,
    generateId: () => string,
): LateralMatchResult {
    const federationStore = new PlanStore(new ProcessRegistry(generateId), generateId);
    const agreements: import('../schemas').Agreement[] = [];
    const events: FederationEvent[] = [];

    // Phase 1: Publication — collect offers and requests
    const offers: Array<{ scopeId: string; intent: Intent; qty: number; unit: string }> = [];
    for (const { scopeId: sid, intent: i } of registry.intentsForTag(PLAN_TAGS.SURPLUS)) {
        if (policy.shouldOffer(i, sid)) {
            offers.push({
                scopeId: sid, intent: i,
                qty: i.resourceQuantity?.hasNumericalValue ?? 0,
                unit: i.resourceQuantity?.hasUnit ?? 'unit',
            });
            if ((i.resourceQuantity?.hasNumericalValue ?? 0) > 1e-9) {
                events.push({ kind: 'surplus-offered', round: 1, scopeId: sid, specId: i.resourceConformsTo ?? '', quantity: i.resourceQuantity?.hasNumericalValue ?? 0 });
            }
        }
    }

    const seenDeficitIds = new Set<string>();
    const requests: Array<{ scopeId: string; intent: Intent; shortfall: number; unit: string; intentId: string; specId: string; isMetabolicDebt: boolean }> = [];
    for (const { scopeId: sid, intent: i } of registry.intentsForTag(PLAN_TAGS.DEFICIT)) {
        const shortfall = i.resourceQuantity?.hasNumericalValue ?? 0;
        if (shortfall <= 1e-9) continue;
        if (seenDeficitIds.has(i.id)) continue;
        seenDeficitIds.add(i.id);
        if (policy.shouldRequest(i, sid)) {
            requests.push({
                scopeId: sid, intent: i, shortfall,
                unit: i.resourceQuantity?.hasUnit ?? 'unit',
                intentId: i.id, specId: i.resourceConformsTo ?? '',
                isMetabolicDebt: i.resourceClassifiedAs?.includes(PLAN_TAGS.METABOLIC_DEBT) ?? false,
            });
            events.push({ kind: 'deficit-announced', round: 1, scopeId: sid, specId: i.resourceConformsTo ?? '', quantity: shortfall });
        }
    }

    // Phase 2: Matching — score pairs, greedily accept
    const matchCandidates: Array<{ offer: typeof offers[0]; request: typeof requests[0]; score: number }> = [];

    const isCustomPolicy = !(policy instanceof DefaultLateralMatchingPolicy);
    if (isCustomPolicy) {
        for (const offer of offers) {
            for (const request of requests) {
                const offerIntent: Intent = { ...offer.intent, provider: offer.scopeId } as Intent;
                const requestIntent: Intent = { ...request.intent, receiver: request.scopeId } as Intent;
                const score = policy.scoreMatch(offerIntent, requestIntent, ctx);
                if (score > 0) matchCandidates.push({ offer, request, score });
            }
        }
    } else {
        const offersBySpec = new Map<string, typeof offers>();
        for (const o of offers) {
            const spec = o.intent.resourceConformsTo ?? '';
            let b = offersBySpec.get(spec);
            if (!b) { b = []; offersBySpec.set(spec, b); }
            b.push(o);
        }
        const requestsBySpec = new Map<string, typeof requests>();
        for (const r of requests) {
            let b = requestsBySpec.get(r.specId);
            if (!b) { b = []; requestsBySpec.set(r.specId, b); }
            b.push(r);
        }
        for (const [spec, specOffers] of offersBySpec) {
            const specRequests = requestsBySpec.get(spec);
            if (!specRequests) continue;
            for (const offer of specOffers) {
                for (const request of specRequests) {
                    const offerIntent: Intent = { ...offer.intent, provider: offer.scopeId } as Intent;
                    const requestIntent: Intent = { ...request.intent, receiver: request.scopeId } as Intent;
                    const score = policy.scoreMatch(offerIntent, requestIntent, ctx);
                    if (score > 0) matchCandidates.push({ offer, request, score });
                }
            }
        }
    }
    matchCandidates.sort((a, b) => b.score - a.score);

    const offerRemaining = new Map(offers.map(o => [o, o.qty]));
    const requestRemaining = new Map(requests.map(r => [r, r.shortfall]));

    for (const { offer, request } of matchCandidates) {
        const offerQty = offerRemaining.get(offer) ?? 0;
        const requestQty = requestRemaining.get(request) ?? 0;
        if (offerQty <= 1e-9 || requestQty <= 1e-9) continue;

        const qty = Math.min(offerQty, requestQty);
        offerRemaining.set(offer, offerQty - qty);
        requestRemaining.set(request, requestQty - qty);
        request.shortfall -= qty;

        const { proposal } = federationStore.publishOffer({
            provider: offer.scopeId, action: 'transfer',
            resourceConformsTo: request.specId,
            resourceQuantity: { hasNumericalValue: qty, hasUnit: request.unit },
            resourceClassifiedAs: [PLAN_TAGS.LATERAL_TRANSFER],
        });
        const { agreement, commitments } = federationStore.acceptProposal(proposal.id, { receiver: request.scopeId });
        agreements.push(agreement);
        for (const c of commitments) {
            if (!c.resourceClassifiedAs?.includes(PLAN_TAGS.LATERAL_TRANSFER)) {
                c.resourceClassifiedAs = [...(c.resourceClassifiedAs ?? []), PLAN_TAGS.LATERAL_TRANSFER];
            }
        }
        events.push({ kind: 'lateral-match', round: 1, scopeId: offer.scopeId, targetScopeId: request.scopeId, specId: request.specId, quantity: qty });
    }

    const deficitWork = requests.map(r => ({
        scopeId: r.scopeId, specId: r.specId, shortfall: r.shortfall,
        intentId: r.intentId, unit: r.unit, isMetabolicDebt: r.isMetabolicDebt,
    }));

    for (const deficit of deficitWork) {
        if (deficit.shortfall > 1e-9) {
            events.push({ kind: 'deficit-propagated', round: 1, scopeId: deficit.scopeId, specId: deficit.specId, quantity: deficit.shortfall });
        }
    }

    return { federationStore, agreements, events, deficitWork };
}

/** 5D: Write resolved shortfalls back to deficit Intents in every scope's planStore. */
export function writeBackShortfalls(
    byScope: Map<string, ScopePlanResult>,
    deficitWork: DeficitWorkItem[],
): void {
    const finalShortfall = new Map<string, number>();
    for (const d of deficitWork) finalShortfall.set(d.intentId, d.shortfall);
    for (const result of byScope.values()) {
        for (const i of result.planStore.intentsForTag(PLAN_TAGS.DEFICIT)) {
            const newShortfall = finalShortfall.get(i.id);
            if (newShortfall === undefined) continue;
            if (Math.abs(newShortfall - (i.resourceQuantity?.hasNumericalValue ?? 0)) < 1e-9) continue;
            const meta = result.planStore.getMeta(i.id) as DeficitMeta | undefined;
            const originalShortfall = meta?.originalShortfall ?? i.resourceQuantity?.hasNumericalValue ?? 0;
            const resolvedAt = meta?.resolvedAt ?? [];
            result.planStore.removeRecords({ intentIds: [i.id] });
            const reEmitted = result.planStore.addIntent({
                ...i,
                resourceQuantity: { hasNumericalValue: newShortfall, hasUnit: i.resourceQuantity?.hasUnit ?? 'unit' },
            });
            result.planStore.setMeta(reEmitted.id, { kind: 'deficit', originalShortfall, resolvedAt });
        }
    }
}

/** 5E: Analyze sacrifice imbalance across scopes. */
export function analyzeSacrifice(
    deficitWork: DeficitWorkItem[],
    memberCounts?: Map<string, number>,
): FederationEvent[] {
    if (!memberCounts || memberCounts.size === 0) return [];
    const events: FederationEvent[] = [];
    const deficitPerScope = new Map<string, number>();
    for (const d of deficitWork) {
        if (d.shortfall <= 1e-9) continue;
        deficitPerScope.set(d.scopeId, (deficitPerScope.get(d.scopeId) ?? 0) + d.shortfall);
    }
    const totalDeficit = [...deficitPerScope.values()].reduce((a, b) => a + b, 0);
    const totalMembers = [...deficitPerScope.keys()]
        .reduce((s, sid) => s + (memberCounts.get(sid) ?? 1), 0);
    const targetPerMember = totalMembers > 0 ? totalDeficit / totalMembers : 0;

    for (const [sid, deficit] of deficitPerScope) {
        const members = memberCounts.get(sid) ?? 1;
        const actual = deficit / members;
        if (Math.abs(actual - targetPerMember) > targetPerMember * 0.1 + 1e-9) {
            events.push({
                kind: 'sacrifice-rebalanced', round: 2, scopeId: sid,
                quantity: deficit, sacrificePerMember: actual,
                targetSacrificePerMember: targetPerMember,
            });
        }
    }
    return events;
}

/** 5F: Aggregate conservation signals from all scopes (deduplicated by specId). */
export function aggregateConservation(
    byScope: Map<string, ScopePlanResult>,
): ConservationSignal[] {
    const seenSpecIds = new Set<string>();
    const signals: ConservationSignal[] = [];
    for (const result of byScope.values()) {
        for (const i of result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION)) {
            const specId = i.resourceConformsTo ?? '';
            const cn = result.planStore.getMeta(i.id) as ConservationMeta;
            if (!seenSpecIds.has(specId)) {
                seenSpecIds.add(specId);
                signals.push({
                    plannedWithin: i.plannedWithin ?? `conservation:${specId}`,
                    specId,
                    onhand: cn.onhand, tor: cn.tor, toy: cn.toy, tog: cn.tog,
                    zone: cn.zone,
                    tippingPointBreached: cn.tippingPointBreached,
                });
            } else {
                if (cn.tippingPointBreached) {
                    const existing = signals.find(s => s.specId === specId)!;
                    existing.tippingPointBreached = true;
                }
            }
        }
    }
    return signals;
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

    // Step 1+2: Build hierarchy and topological order
    const { childrenOf, planOrder } = buildHierarchy(scopeIds, ctx.parentOf);

    // Step 3: Bottom-up fold
    const effectiveDirty = computeEffectiveDirty(scopeIds, ctx.parentOf, ctx.cache, ctx.dirtyScopes);
    const registry = new StoreRegistry(ctx.remoteTransport);
    const scopeCtx: ScopePlanContext = { ...ctx, generateId };

    const byScope = foldScopes(planOrder, childrenOf,
        (id, subs) => planForScope([id], horizon, scopeCtx, subs.length > 0 ? subs : undefined),
        { cache: ctx.cache, effectiveDirty, registry },
    );

    // Step 4: Collect outputs
    const rootId = planOrder[planOrder.length - 1];
    const root = byScope.get(rootId)!;

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

    // Event log: round 0
    const events: FederationEvent[] = planOrder.map(scopeId => ({
        kind: (effectiveDirty.has(scopeId) || !ctx.cache?.byScope.has(scopeId)
            ? 'scope-planned' : 'scope-cached') as FederationEventKind,
        round: 0, scopeId,
    }));

    // Step 5: Lateral matching
    const policy = ctx.lateralMatchingPolicy ?? new DefaultLateralMatchingPolicy(ctx.parentOf);
    const lateral = matchLaterally(registry, policy, ctx, generateId);
    events.push(...lateral.events);

    // Write-back shortfalls
    writeBackShortfalls(byScope, lateral.deficitWork);
    registry.register('federation', lateral.federationStore);

    // Sacrifice analysis
    const sacrificeEvents = analyzeSacrifice(lateral.deficitWork, ctx.memberCounts);
    events.push(...sacrificeEvents);

    // Residual unresolved
    for (const i of root.planStore.intentsForTag(PLAN_TAGS.DEFICIT)) {
        const shortfall = i.resourceQuantity?.hasNumericalValue ?? 0;
        if (shortfall > 1e-9) {
            events.push({ kind: 'residual-unresolved', round: 2, scopeId: rootId, specId: i.resourceConformsTo ?? '', quantity: shortfall });
        }
    }

    // Conservation aggregation
    const allConservationSignals = aggregateConservation(byScope);

    return {
        byScope, root, planOrder, allPurchaseIntents, registry,
        federationStore: lateral.federationStore,
        lateralAgreements: lateral.agreements,
        events, allConservationSignals,
        cache: { byScope: new Map(byScope) },
    };
}
