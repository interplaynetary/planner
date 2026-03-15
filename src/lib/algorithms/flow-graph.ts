/**
 * Flow Graph — scope-level flow analysis from spec §§219–262.
 *
 * Computes:
 *   internal_flow[k]     — value flow between members of scope k
 *   external_flow[k]     — value flow crossing scope k's boundary
 *   bilateral_flow[k,l]  — flow between scope k and scope l
 *   total_flow[k]        — internal + external
 *   coherence[k]         — internal / total ∈ [0,1]
 *   interdependence[k,l] — bilateral / (external_k + external_l)
 *
 * Edge weight w(e) = resourceQuantity.hasNumericalValue × market_price.
 * Market price is caller-supplied (Map<resourceSpecId, price>) since the
 * planner has no built-in price oracle.
 *
 * Boundary dynamics (§§251–262) — P4:
 *   mergeCandidates(graph, θ)  — scope pairs where interdependence > θ
 *   splitCandidates(graph, θ)  — scopes where coherence < θ
 *   boundaryObjective(graph)   — Σₖ coherence[k] × total_flow[k] / Σ total_flow
 */

import { z } from 'zod';
import type { EconomicEvent } from '../schemas';
import type { MembershipIndex } from '../indexes/membership';

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** A single directed economic-value edge between two scopes. */
export const FlowEdgeSchema = z.object({
    sourceScope: z.string(),
    targetScope: z.string(),
    /** Value-weighted sum: resourceQuantity.hasNumericalValue × market_price */
    value: z.number(),
    /** Number of underlying events contributing to this edge */
    eventCount: z.number().int(),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowGraphSchema = z.object({
    /** Raw edges keyed by `${sourceScope}→${targetScope}` */
    edges: z.map(z.string(), FlowEdgeSchema),

    /** Scope IDs present in the graph */
    scopes: z.set(z.string()),

    /**
     * Pre-computed per-scope aggregates for fast query.
     * Populated by buildFlowGraph.
     */
    _internal: z.map(z.string(), z.number()),   // scopeId → internal_flow
    _external: z.map(z.string(), z.number()),   // scopeId → external_flow
});
export type FlowGraph = z.infer<typeof FlowGraphSchema>;

// =============================================================================
// BUILD
// =============================================================================

/**
 * Resolve the scope of an agent given a MembershipIndex.
 * - For a Person: their primary scope (personToScope).
 * - For an Organization-type agent: the agent ID itself is the scope.
 * Returns undefined when the agent has no scope mapping.
 */
function resolveScope(agentId: string, index: MembershipIndex): string | undefined {
    // Person → scope
    const ps = index.personToScope.get(agentId);
    if (ps) return ps;
    // Organization acting as provider/receiver is its own scope
    // (present in scopeParent keys or scopeToDescendantCitizens keys)
    if (
        index.scopeParent.has(agentId) ||
        index.scopeToDescendantCitizens.has(agentId)
    ) {
        return agentId;
    }
    return undefined;
}

function edgeKey(src: string, tgt: string): string {
    return `${src}→${tgt}`;
}

/**
 * Build a FlowGraph from EconomicEvents using the MembershipIndex for
 * scope classification.
 *
 * @param events         EconomicEvents to analyse (any action)
 * @param index          MembershipIndex for agent → scope resolution
 * @param marketPrices   ResourceSpec ID → price per unit (defaults to 1.0)
 */
export function buildFlowGraph(
    events: EconomicEvent[],
    index: MembershipIndex,
    marketPrices: Map<string, number> = new Map(),
): FlowGraph {
    const edges = new Map<string, FlowEdge>();
    const scopes = new Set<string>();

    for (const event of events) {
        if (!event.provider || !event.receiver) continue;
        if (event.provider === event.receiver) continue;

        const srcScope = resolveScope(event.provider, index);
        const tgtScope = resolveScope(event.receiver, index);
        if (!srcScope || !tgtScope) continue;

        const qty   = event.resourceQuantity?.hasNumericalValue ?? 0;
        const price = event.resourceConformsTo
            ? (marketPrices.get(event.resourceConformsTo) ?? 1)
            : 1;
        const value = qty * price;
        if (value <= 0) continue;

        scopes.add(srcScope);
        scopes.add(tgtScope);

        const key = edgeKey(srcScope, tgtScope);
        const existing = edges.get(key);
        if (existing) {
            existing.value += value;
            existing.eventCount++;
        } else {
            edges.set(key, { sourceScope: srcScope, targetScope: tgtScope, value, eventCount: 1 });
        }
    }

    // Pre-compute internal / external per scope
    const _internal = new Map<string, number>();
    const _external = new Map<string, number>();

    for (const scopeId of scopes) {
        _internal.set(scopeId, 0);
        _external.set(scopeId, 0);
    }

    for (const edge of edges.values()) {
        const { sourceScope: src, targetScope: tgt, value } = edge;
        if (src === tgt) {
            _internal.set(src, (_internal.get(src) ?? 0) + value);
        } else {
            _external.set(src, (_external.get(src) ?? 0) + value);
            _external.set(tgt, (_external.get(tgt) ?? 0) + value);
        }
    }

    return { edges, scopes, _internal, _external };
}

// =============================================================================
// METRICS
// =============================================================================

/** Σ w(e) where source ∈ Sₖ AND target ∈ Sₖ */
export function internalFlow(scopeId: string, graph: FlowGraph): number {
    return graph._internal.get(scopeId) ?? 0;
}

/** Σ w(e) where exactly one of {source, target} ∈ Sₖ */
export function externalFlow(scopeId: string, graph: FlowGraph): number {
    return graph._external.get(scopeId) ?? 0;
}

/** internal_flow + external_flow */
export function totalFlow(scopeId: string, graph: FlowGraph): number {
    return internalFlow(scopeId, graph) + externalFlow(scopeId, graph);
}

/**
 * bilateral_flow[k,l] = Σ w(e) where {source, target} = {Sₖ, Sₗ}
 * (both directions summed).
 */
export function bilateralFlow(scopeA: string, scopeB: string, graph: FlowGraph): number {
    const fwd = graph.edges.get(edgeKey(scopeA, scopeB))?.value ?? 0;
    const rev = graph.edges.get(edgeKey(scopeB, scopeA))?.value ?? 0;
    return fwd + rev;
}

/**
 * coherence[k] = internal_flow[k] / total_flow[k]
 * Returns 0 when total_flow is 0.
 */
export function coherence(scopeId: string, graph: FlowGraph): number {
    const total = totalFlow(scopeId, graph);
    if (total === 0) return 0;
    return internalFlow(scopeId, graph) / total;
}

/**
 * interdependence[k,l] = bilateral_flow[k,l] / (external_flow[k] + external_flow[l])
 * Returns 0 when denominator is 0.
 */
export function interdependence(scopeA: string, scopeB: string, graph: FlowGraph): number {
    const denominator = externalFlow(scopeA, graph) + externalFlow(scopeB, graph);
    if (denominator === 0) return 0;
    return bilateralFlow(scopeA, scopeB, graph) / denominator;
}

// =============================================================================
// P4 — BOUNDARY DYNAMICS
// =============================================================================

/**
 * Pairs of scopes where interdependence > theta_merge → propose merger.
 * Returns unique pairs (each pair appears once, smaller scope ID first).
 */
export function mergeCandidates(
    graph: FlowGraph,
    theta_merge: number,
): [string, string][] {
    const candidates: [string, string][] = [];
    const scopes = [...graph.scopes];

    for (let i = 0; i < scopes.length; i++) {
        for (let j = i + 1; j < scopes.length; j++) {
            const a = scopes[i], b = scopes[j];
            if (interdependence(a, b, graph) > theta_merge) {
                candidates.push([a, b]);
            }
        }
    }

    return candidates;
}

/**
 * Scopes where coherence < theta_split → propose partition.
 */
export function splitCandidates(graph: FlowGraph, theta_split: number): string[] {
    return [...graph.scopes].filter(s => coherence(s, graph) < theta_split);
}

/**
 * Boundary optimality objective:
 *   Σₖ coherence[k] × total_flow[k] / Σ total_flow
 *
 * Returns 0 when total flow across all scopes is 0.
 */
export function boundaryObjective(graph: FlowGraph): number {
    let weightedSum = 0;
    let totalSum = 0;

    for (const scopeId of graph.scopes) {
        const tf = totalFlow(scopeId, graph);
        weightedSum += coherence(scopeId, graph) * tf;
        totalSum += tf;
    }

    return totalSum === 0 ? 0 : weightedSum / totalSum;
}
