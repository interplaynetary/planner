/**
 * Network Flow — max-flow / min-cut on a directed capacity graph.
 *
 * Used for DLT segmentation and federation routing between scopes.
 * Implements the Edmonds-Karp variant of Ford-Fulkerson (BFS augmenting paths).
 *
 * Time: O(V × E²).
 *
 * Reference: https://web.stanford.edu/class/cs97si/08-network-flow-problems.pdf
 */

import { z } from 'zod';

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** A directed edge with a capacity and current flow. */
export const FlowEdgeSchema = z.object({
    from: z.string(),
    to: z.string(),
    capacity: z.number(),
    flow: z.number(),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowNetworkSchema = z.object({
    nodes: z.set(z.string()),
    /** All forward edges (residual graph maintained internally). */
    edges: z.array(FlowEdgeSchema),
});
export type FlowNetwork = z.infer<typeof FlowNetworkSchema>;

export const MaxFlowResultSchema = z.object({
    /** Maximum flow value from source to sink. */
    maxFlow: z.number(),
    /**
     * Residual graph after the algorithm completes.
     * Each edge's `.flow` holds the assigned flow.
     */
    network: FlowNetworkSchema,
});
export type MaxFlowResult = z.infer<typeof MaxFlowResultSchema>;

export const MinCutResultSchema = z.object({
    /** Total capacity of the minimum cut. */
    cutCapacity: z.number(),
    /** Nodes reachable from source in the residual graph (the S-side of the cut). */
    sourceSide: z.set(z.string()),
    /** Nodes NOT reachable from source (the T-side of the cut). */
    sinkSide: z.set(z.string()),
});
export type MinCutResult = z.infer<typeof MinCutResultSchema>;

// =============================================================================
// HELPERS
// =============================================================================

function buildAdjacency(
    edges: FlowEdge[],
): Map<string, number[]> {
    const adj = new Map<string, number[]>();
    for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (!adj.has(e.from)) adj.set(e.from, []);
        if (!adj.has(e.to))   adj.set(e.to,   []);
        adj.get(e.from)!.push(i);
        adj.get(e.to)!.push(i);   // reverse edge index for residual graph
    }
    return adj;
}

/** BFS to find an augmenting path; returns parent edge indices or null if none. */
function bfsAugmentingPath(
    source: string,
    sink: string,
    edges: FlowEdge[],
    adj: Map<string, number[]>,
): Map<string, number> | null {
    const visited = new Set<string>([source]);
    const parentEdge = new Map<string, number>(); // nodeId → edge index used to reach it
    const queue: string[] = [source];

    while (queue.length > 0) {
        const u = queue.shift()!;
        for (const ei of adj.get(u) ?? []) {
            const e = edges[ei];
            // Determine direction and residual capacity
            let v: string;
            let residual: number;
            if (e.from === u) {
                v = e.to;
                residual = e.capacity - e.flow;
            } else {
                v = e.from;
                residual = e.flow; // reverse edge capacity
            }
            if (!visited.has(v) && residual > 0) {
                visited.add(v);
                parentEdge.set(v, ei);
                if (v === sink) return parentEdge;
                queue.push(v);
            }
        }
    }
    return null;
}

// =============================================================================
// EDMONDS-KARP MAX-FLOW
// =============================================================================

/**
 * Compute maximum flow from source to sink using Edmonds-Karp (BFS Ford-Fulkerson).
 *
 * Mutates edge `.flow` values in-place on a deep copy of the network.
 * The original network is not modified.
 */
export function maxFlow(network: FlowNetwork, source: string, sink: string): MaxFlowResult {
    // Deep copy edges so the original network is not mutated
    const edges: FlowEdge[] = network.edges.map(e => ({ ...e }));
    const adj = buildAdjacency(edges);

    let totalFlow = 0;

    while (true) {
        const parentEdge = bfsAugmentingPath(source, sink, edges, adj);
        if (!parentEdge) break;

        // Find bottleneck along the augmenting path
        let bottleneck = Infinity;
        let node = sink;
        while (node !== source) {
            const ei = parentEdge.get(node)!;
            const e = edges[ei];
            const res = e.from === node ? e.flow : e.capacity - e.flow;
            // Correct: forward = capacity - flow, backward = flow
            const residual = e.to === node ? e.capacity - e.flow : e.flow;
            bottleneck = Math.min(bottleneck, residual);
            node = e.to === node ? e.from : e.to;
        }

        // Augment along the path
        node = sink;
        while (node !== source) {
            const ei = parentEdge.get(node)!;
            const e = edges[ei];
            if (e.to === node) {
                e.flow += bottleneck;
            } else {
                e.flow -= bottleneck;
            }
            node = e.to === node ? e.from : e.to;
        }

        totalFlow += bottleneck;
    }

    return {
        maxFlow: totalFlow,
        network: { nodes: new Set(network.nodes), edges },
    };
}

// =============================================================================
// MIN-CUT
// =============================================================================

/**
 * Compute the minimum S-T cut after running max-flow.
 * The min-cut equals the max-flow (max-flow min-cut theorem).
 *
 * @param result  Result from maxFlow()
 * @param source  Source node
 */
export function minCut(result: MaxFlowResult, source: string): MinCutResult {
    const { edges, nodes } = result.network;
    const adj = buildAdjacency(edges);

    // BFS on residual graph to find nodes reachable from source
    const sourceSide = new Set<string>([source]);
    const queue = [source];

    while (queue.length > 0) {
        const u = queue.shift()!;
        for (const ei of adj.get(u) ?? []) {
            const e = edges[ei];
            let v: string;
            let residual: number;
            if (e.from === u) {
                v = e.to;
                residual = e.capacity - e.flow;
            } else {
                v = e.from;
                residual = e.flow;
            }
            if (!sourceSide.has(v) && residual > 0) {
                sourceSide.add(v);
                queue.push(v);
            }
        }
    }

    const sinkSide = new Set<string>();
    for (const n of nodes) {
        if (!sourceSide.has(n)) sinkSide.add(n);
    }

    // Sum capacities of edges crossing from S to T
    let cutCapacity = 0;
    for (const e of edges) {
        if (sourceSide.has(e.from) && sinkSide.has(e.to)) {
            cutCapacity += e.capacity;
        }
    }

    return { cutCapacity, sourceSide, sinkSide };
}
