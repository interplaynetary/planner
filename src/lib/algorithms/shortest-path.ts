/**
 * Shortest-Path primitives — Dijkstra and Bellman-Ford on a generic graph.
 *
 * Used by critical-path.ts for DLT segmentation and supply network routing.
 * Edge weights represent lead time (days), cost, or any non-negative scalar.
 *
 * Reference: CLRS §24 (Dijkstra §24.3, Bellman-Ford §24.1).
 */

import { z } from 'zod';

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** A single directed edge in the graph. */
export const GraphEdgeSchema = z.object({
    from: z.string(),
    to: z.string(),
    weight: z.number(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

/** Shortest-path result from a single source. */
export const ShortestPathResultSchema = z.object({
    /** distance[nodeId] = shortest distance from source; Infinity if unreachable. */
    distance: z.map(z.string(), z.number()),
    /** predecessor[nodeId] = previous node on the shortest path. */
    predecessor: z.map(z.string(), z.string().nullable()),
});
export type ShortestPathResult = z.infer<typeof ShortestPathResultSchema>;

// =============================================================================
// DIJKSTRA (non-negative weights)
// =============================================================================

/**
 * Dijkstra's algorithm for single-source shortest paths.
 * Requires all edge weights ≥ 0.
 *
 * Time: O((V + E) log V) via a binary-heap priority queue.
 *
 * @param nodes  All node IDs in the graph (including isolated nodes).
 * @param edges  Directed edges with non-negative weights.
 * @param source Starting node ID.
 */
export function dijkstra(
    nodes: string[],
    edges: GraphEdge[],
    source: string,
): ShortestPathResult {
    const distance = new Map<string, number>();
    const predecessor = new Map<string, string | null>();

    for (const n of nodes) {
        distance.set(n, Infinity);
        predecessor.set(n, null);
    }
    distance.set(source, 0);

    // Build adjacency list
    const adj = new Map<string, { to: string; weight: number }[]>();
    for (const n of nodes) adj.set(n, []);
    for (const e of edges) {
        const list = adj.get(e.from);
        if (list) list.push({ to: e.to, weight: e.weight });
    }

    // Min-heap: [distance, nodeId]
    // Simple O(V²) implementation (sufficient for supply-network sizes)
    const visited = new Set<string>();

    while (true) {
        // Extract min from unvisited
        let u: string | null = null;
        let minDist = Infinity;
        for (const [n, d] of distance) {
            if (!visited.has(n) && d < minDist) {
                minDist = d;
                u = n;
            }
        }
        if (u === null) break;
        visited.add(u);

        for (const { to: v, weight } of adj.get(u) ?? []) {
            const alt = (distance.get(u) ?? Infinity) + weight;
            if (alt < (distance.get(v) ?? Infinity)) {
                distance.set(v, alt);
                predecessor.set(v, u);
            }
        }
    }

    return { distance, predecessor };
}

// =============================================================================
// BELLMAN-FORD (handles negative weights, detects negative cycles)
// =============================================================================

/**
 * Bellman-Ford algorithm for single-source shortest paths.
 * Handles negative edge weights; detects negative-weight cycles.
 *
 * Time: O(V × E).
 *
 * @returns ShortestPathResult, or null if a negative-weight cycle is detected.
 */
export function bellmanFord(
    nodes: string[],
    edges: GraphEdge[],
    source: string,
): ShortestPathResult | null {
    const distance = new Map<string, number>();
    const predecessor = new Map<string, string | null>();

    for (const n of nodes) {
        distance.set(n, Infinity);
        predecessor.set(n, null);
    }
    distance.set(source, 0);

    const V = nodes.length;

    // Relax all edges V-1 times
    for (let i = 0; i < V - 1; i++) {
        for (const { from: u, to: v, weight } of edges) {
            const du = distance.get(u) ?? Infinity;
            if (du === Infinity) continue;
            const alt = du + weight;
            if (alt < (distance.get(v) ?? Infinity)) {
                distance.set(v, alt);
                predecessor.set(v, u);
            }
        }
    }

    // Negative-cycle detection: one more relaxation pass
    for (const { from: u, to: v, weight } of edges) {
        const du = distance.get(u) ?? Infinity;
        if (du === Infinity) continue;
        if (du + weight < (distance.get(v) ?? Infinity)) {
            return null; // negative-weight cycle detected
        }
    }

    return { distance, predecessor };
}

// =============================================================================
// PATH RECONSTRUCTION
// =============================================================================

/**
 * Reconstruct the path from source to target using the predecessor map.
 * Returns an ordered array of node IDs [source, ..., target], or null if
 * target is unreachable.
 */
export function reconstructPath(
    target: string,
    result: ShortestPathResult,
): string[] | null {
    if ((result.distance.get(target) ?? Infinity) === Infinity) return null;

    const path: string[] = [];
    let current: string | null = target;
    while (current !== null) {
        path.unshift(current);
        current = result.predecessor.get(current) ?? null;
    }
    return path;
}
