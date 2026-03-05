/**
 * Strategic Inventory Positioning — DDMRP Component 1.
 *
 * Pure functions for identifying and evaluating:
 *   - Decoupling points (stock buffers that break the demand-supply linkage)
 *   - Control points (time buffers for visible execution — pacing, gating, convergence)
 *
 * All functions are stateless. Callers supply RecipeStore; no side effects.
 *
 * DDMRP ref: Ptak & Smith "Demand Driven MRP" (2nd ed.)
 *   Ch 7  — Strategic Inventory Positioning
 *   Ch 11 — Demand Driven Scheduling (control point selection)
 *   DDI Operational Map §4 — DDOM buffer type assignment
 */

import type { RecipeProcess, Duration } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import { recipeLeadTime } from './ddmrp';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Structural analysis of a single process in a recipe chain.
 * Convergent/divergent/gating are structural properties — callers supply
 * variability and instability signals separately.
 */
export interface RoutingGeometry {
    /** RecipeProcess ID */
    processId: string;
    /** ProcessSpecification ID (null if unset) */
    processSpecId: string | null;
    /** Number of distinct predecessor processes that feed into this one */
    upstreamPathCount: number;
    /** Number of distinct successor processes fed by this one */
    downstreamPathCount: number;
    /**
     * True when this process CONSUMES a stock buffer output
     * (upstream process outputs a spec that has bufferType === 'stock').
     */
    consumesBuffer: boolean;
    /**
     * True when this process PRODUCES output destined for a stock buffer
     * (this process's output feeds a downstream buffer).
     */
    producesBuffer: boolean;
    /** Process template duration in days (0 if unspecified). */
    durationDays: number;
    /** True when upstreamPathCount > 1 — multiple feeds converge here */
    isConvergent: boolean;
    /** True when downstreamPathCount > 1 — this process fans out */
    isDivergent: boolean;
    /**
     * True when this is the last process before a buffer or the final output.
     * A gating point controls entry into a constrained or synchronised segment.
     */
    isGatingPoint: boolean;
}

/**
 * Scored candidate for a stock-buffer decoupling point.
 * A decoupling point is placed at a ResourceSpecification in the recipe DAG —
 * specifically at a "stage" output that is consumed by one or more downstream processes.
 */
export interface DecouplingCandidateResult {
    /** RecipeProcess ID whose primary output is the candidate decoupling point */
    processId: string;
    /** Output ResourceSpec ID that would hold the buffer */
    specId: string | null;
    /** Total CLT through the full recipe (days) */
    fullCltDays: number;
    /**
     * DLT from this point to the final output (days).
     * Placing a buffer here compresses customer lead time to this value.
     */
    decoupledDltDays: number;
    /** DLT from start of recipe to this point (days). */
    upstreamDays: number;
    /**
     * Lead-time compression ratio: (fullCLT − decoupledDLT) / fullCLT × 100.
     * Higher = more compression = more customer-facing benefit.
     */
    compressionPct: number;
    /**
     * Cross-recipe leverage: number of OTHER recipes that also consume this spec
     * as an input. Higher leverage = broader inventory coverage from a single buffer.
     */
    leverageScore: number;
    /**
     * Composite positioning score (0–100 scale, higher = stronger candidate):
     *   compressionPct × 0.5
     * + leverageScore × 10 (capped at 30)
     * + variabilityScore × 0.2 (0–100 input: process variability from caller)
     */
    positioningScore: number;
    /** Suggested buffer type based on the position in the BOM/routing. */
    suggestedBufferType: 'stock' | 'time' | 'capacity';
}

/**
 * Scored candidate for a time-buffer control point.
 * Control points provide visible execution pacing (LTM tracking, time buffers).
 */
export interface ControlPointCandidateResult {
    /** RecipeProcess ID */
    processId: string;
    /** ProcessSpecification ID (null if unset) */
    processSpecId: string | null;
    /** True when upstreamPathCount > 1 */
    isConvergent: boolean;
    /** True when downstreamPathCount > 1 */
    isDivergent: boolean;
    /**
     * True when this is the last process before a buffer or divergence point.
     * Pacing resources schedule everything upstream.
     */
    isGatingPoint: boolean;
    /**
     * True when this process is the bottleneck / drum resource.
     * Set by the caller via `instabilityByProcess[processId] >= highInstabilityThreshold`.
     * Without caller input, defaults to false.
     */
    isPacingResource: boolean;
    /** Number of upstream paths that must synchronise at this point. */
    upstreamPathCount: number;
    /**
     * Composite placement score:
     *   isPacingResource × 3
     * + isConvergent × 2
     * + isGatingPoint × 2
     * + isDivergent × 1
     * + instabilityScore (0–3, from caller)
     */
    placementScore: number;
}

/**
 * Six structural DDMRP decoupling tests for a candidate stage.
 * All are boolean; callers interpret the result.
 */
export interface DecouplingTestResult {
    /** 1. Does placing a buffer here decouple the customer horizon from upstream lead time? */
    decouplesHorizon: boolean;
    /** 2. Does both upstream AND downstream benefit from the decoupling? */
    biDirectionalBenefit: boolean;
    /**
     * 3. Does the upstream segment produce to a stable specification that can be
     * held in inventory without significant spoilage, obsolescence, or re-work?
     * (Proxy: outputSpec.defaultBatchSize > 0 when known; always true when unknown.)
     */
    orderIndependence: boolean;
    /**
     * 4. Is this the PRIMARY planning mechanism for the downstream segment?
     * True when downstream has no other control point with a higher placement score.
     */
    isPrimaryPlanningMechanism: boolean;
    /**
     * 5. Does placing a buffer here meet minimum relative priority vs. the full CLT?
     * True when decoupledDltDays / fullCltDays ≤ 0.6  (at most 60% of CLT remains).
     */
    relativePriorityMet: boolean;
    /**
     * 6. Is the candidate ADU stable enough for dynamic adjustment to work?
     * True when the caller-supplied variabilityFactor ≤ 0.5
     * (moderate variability can be absorbed by VF; high variability → MTA not viable).
     */
    dynamicAdjustmentReady: boolean;
    /** Count of tests that returned true. */
    testsPassed: number;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/** Convert a VF Duration to calendar days (mirrors ddmrp.ts internal). */
function durToDays(d: Duration | undefined): number {
    if (!d) return 0;
    switch (d.hasUnit) {
        case 'minutes': return d.hasNumericalValue / 1440;
        case 'hours':   return d.hasNumericalValue / 24;
        case 'days':    return d.hasNumericalValue;
        case 'weeks':   return d.hasNumericalValue * 7;
        default:        return 0;
    }
}

/**
 * Compute the critical-path length (days) from `fromProcessId` to the end of the chain.
 * Uses a forward DP on the topologically-sorted successors map.
 * Returns 0 when `fromProcessId` is not in the chain or is the final process.
 */
function downstreamDlt(
    fromProcessId: string,
    chain: RecipeProcess[],
    successors: Map<string, string[]>,
): number {
    const idx = new Map<string, number>(chain.map((p, i) => [p.id, i]));
    if (!idx.has(fromProcessId)) return 0;

    // ef[id] = earliest-finish days from the start of fromProcessId
    const ef = new Map<string, number>();
    // Seed: we start AT fromProcessId (its duration contributes to downstream)
    for (const rp of chain) {
        ef.set(rp.id, 0);
    }
    ef.set(fromProcessId, durToDays(chain[idx.get(fromProcessId)!].hasDuration));

    // Forward pass from fromProcessId onwards (in topological order)
    const fromIdx = idx.get(fromProcessId)!;
    for (let i = fromIdx; i < chain.length; i++) {
        const rp = chain[i];
        const myEf = ef.get(rp.id) ?? 0;
        for (const succId of (successors.get(rp.id) ?? [])) {
            const succDur = durToDays(chain[idx.get(succId)!].hasDuration);
            const candidate = myEf + succDur;
            if (candidate > (ef.get(succId) ?? 0)) {
                ef.set(succId, candidate);
            }
        }
    }

    return Math.max(...Array.from(ef.values()));
}

/**
 * Build predecessor and successor maps from a topologically sorted process chain.
 * Edges: A → B when A outputs a spec that B inputs (same spec + stage matching).
 */
function buildAdjacency(
    chain: RecipeProcess[],
    recipeStore: RecipeStore,
): { predecessors: Map<string, string[]>; successors: Map<string, string[]> } {
    const predecessors = new Map<string, string[]>(chain.map(p => [p.id, []]));
    const successors   = new Map<string, string[]>(chain.map(p => [p.id, []]));

    for (const src of chain) {
        const { outputs } = recipeStore.flowsForProcess(src.id);
        for (const outFlow of outputs) {
            if (!outFlow.resourceConformsTo) continue;
            for (const dst of chain) {
                if (dst.id === src.id) continue;
                const { inputs } = recipeStore.flowsForProcess(dst.id);
                const connected = inputs.some(
                    f => f.resourceConformsTo === outFlow.resourceConformsTo &&
                         f.stage === outFlow.stage,
                );
                if (connected) {
                    successors.get(src.id)!.push(dst.id);
                    predecessors.get(dst.id)!.push(src.id);
                }
            }
        }
    }

    return { predecessors, successors };
}

// =============================================================================
// 1. routingGeometry
// =============================================================================

/**
 * Structural analysis of every process in a recipe chain.
 *
 * Returns one `RoutingGeometry` entry per RecipeProcess in topological order.
 * `bufferType` presence on the associated ProcessSpecification drives
 * `consumesBuffer` / `producesBuffer` flags.
 */
export function routingGeometry(
    recipeId: string,
    recipeStore: RecipeStore,
): RoutingGeometry[] {
    const chain = recipeStore.getProcessChain(recipeId);
    if (chain.length === 0) return [];

    const { predecessors, successors } = buildAdjacency(chain, recipeStore);

    // Determine which specs are buffer outputs (ProcessSpec.bufferType === 'stock')
    const bufferSpecIds = new Set<string>();
    for (const rp of chain) {
        if (!rp.processConformsTo) continue;
        const pSpec = recipeStore.getProcessSpec(rp.processConformsTo);
        if (pSpec?.bufferType === 'stock') {
            // This process's outputs are buffer outputs
            const { outputs } = recipeStore.flowsForProcess(rp.id);
            for (const f of outputs) {
                if (f.resourceConformsTo) bufferSpecIds.add(f.resourceConformsTo);
            }
        }
    }

    return chain.map(rp => {
        const preds = predecessors.get(rp.id) ?? [];
        const succs = successors.get(rp.id) ?? [];

        const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);

        const consumesBuffer = inputs.some(f =>
            f.resourceConformsTo && bufferSpecIds.has(f.resourceConformsTo),
        );
        const producesBuffer = outputs.some(f =>
            f.resourceConformsTo && bufferSpecIds.has(f.resourceConformsTo),
        );

        const isConvergent   = preds.length > 1;
        const isDivergent    = succs.length > 1;
        // Gating: last process before a buffer or the terminal output
        const isGatingPoint  = producesBuffer || succs.length === 0;

        return {
            processId:          rp.id,
            processSpecId:      rp.processConformsTo ?? null,
            upstreamPathCount:  preds.length,
            downstreamPathCount: succs.length,
            consumesBuffer,
            producesBuffer,
            durationDays:       durToDays(rp.hasDuration),
            isConvergent,
            isDivergent,
            isGatingPoint,
        };
    });
}

// =============================================================================
// 2. rankDecouplingCandidates
// =============================================================================

/**
 * Score each intermediate process output as a potential stock-buffer decoupling point.
 *
 * Skips the final output process (nothing downstream to decouple from).
 * Skips processes whose output spec already has a buffer zone configured
 * (`existingBufferSpecIds` constraint).
 *
 * @param recipeId            Recipe to analyse
 * @param recipeStore         Recipe knowledge store
 * @param existingBufferSpecIds  Spec IDs already buffered — excluded from candidates
 * @param variabilityByStage  Optional map of processId → variability score (0–100).
 *                            Higher variability = stronger decoupling candidate.
 */
export function rankDecouplingCandidates(
    recipeId: string,
    recipeStore: RecipeStore,
    existingBufferSpecIds?: Set<string>,
    variabilityByStage?: Map<string, number>,
): DecouplingCandidateResult[] {
    const chain     = recipeStore.getProcessChain(recipeId);
    const fullClt   = recipeLeadTime(recipeId, recipeStore);
    const excluded  = existingBufferSpecIds ?? new Set<string>();

    if (chain.length <= 1) return [];

    const { successors } = buildAdjacency(chain, recipeStore);

    const results: DecouplingCandidateResult[] = [];

    for (let i = 0; i < chain.length - 1; i++) {
        const rp = chain[i];
        // Only consider intermediate processes (not the final one)
        const succs = successors.get(rp.id) ?? [];
        if (succs.length === 0) continue;   // terminal — skip

        const { outputs } = recipeStore.flowsForProcess(rp.id);
        // Primary output spec for this candidate stage
        const primaryOutput = outputs.find(f => f.resourceConformsTo)?.resourceConformsTo ?? null;

        if (primaryOutput && excluded.has(primaryOutput)) continue;

        // DLT from the first downstream process to end (days)
        // = longest path through all successors of rp, not including rp itself
        const decoupledDlt = succs.length > 0
            ? Math.max(...succs.map(id => downstreamDlt(id, chain, successors)))
            : 0;
        const upstreamDays = fullClt - decoupledDlt;

        const compressionPct = fullClt > 0
            ? ((fullClt - decoupledDlt) / fullClt) * 100
            : 0;

        // Cross-recipe leverage: how many OTHER recipes consume primaryOutput
        const leverageScore = primaryOutput
            ? recipeStore.recipesForInput(primaryOutput).filter(r => r.id !== recipeId).length
            : 0;

        const variabilityScore = variabilityByStage?.get(rp.id) ?? 0;

        const positioningScore =
            compressionPct * 0.5 +
            Math.min(leverageScore * 10, 30) +
            variabilityScore * 0.2;

        // Suggest buffer type:
        //   - terminal stage of a BOM leg → stock
        //   - divergent (fan-out) → stock (hides variability from multiple consumers)
        //   - convergent assembly → time (synchronisation point, not inventory stocking)
        const geometry = routingGeometry(recipeId, recipeStore);
        const thisGeom = geometry.find(g => g.processId === rp.id);
        let suggestedBufferType: 'stock' | 'time' | 'capacity' = 'stock';
        if (thisGeom?.isConvergent) suggestedBufferType = 'time';

        results.push({
            processId:          rp.id,
            specId:             primaryOutput,
            fullCltDays:        fullClt,
            decoupledDltDays:   decoupledDlt,
            upstreamDays,
            compressionPct,
            leverageScore,
            positioningScore,
            suggestedBufferType,
        });
    }

    // Sort descending by positioningScore
    results.sort((a, b) => b.positioningScore - a.positioningScore);
    return results;
}

// =============================================================================
// 3. rankControlPointCandidates
// =============================================================================

/**
 * Score each process as a potential time-buffer control point.
 *
 * Control points are placed at:
 *   1. Pacing resources (drum / bottleneck)
 *   2. Gating points (last before a buffer / divergence)
 *   3. Convergent assembly points (synchronise multiple feeds)
 *   4. Divergent fan-out points (schedule downstream branches)
 *
 * Placement score:
 *   isPacingResource × 3
 *   + isConvergent × 2
 *   + isGatingPoint × 2
 *   + isDivergent × 1
 *   + instabilityScore 0–3 (from caller)
 *
 * @param instabilityByProcess  Optional map of processId → instability (0–100).
 *   Mapped to score 0–3 via: floor(instability / 33.4), capped at 3.
 *   Used to flag drum resources or highly variable operations as pacing.
 */
export function rankControlPointCandidates(
    recipeId: string,
    recipeStore: RecipeStore,
    instabilityByProcess?: Map<string, number>,
): ControlPointCandidateResult[] {
    const geometry = routingGeometry(recipeId, recipeStore);
    const highInstabilityThreshold = 80; // instability ≥ 80 → pacing resource

    return geometry
        .map(g => {
            const instability = instabilityByProcess?.get(g.processId) ?? 0;
            const isPacingResource = instability >= highInstabilityThreshold;
            const instabilityScore = Math.min(Math.floor(instability / 33.4), 3);

            const placementScore =
                (isPacingResource ? 3 : 0) +
                (g.isConvergent  ? 2 : 0) +
                (g.isGatingPoint ? 2 : 0) +
                (g.isDivergent   ? 1 : 0) +
                instabilityScore;

            return {
                processId:        g.processId,
                processSpecId:    g.processSpecId,
                isConvergent:     g.isConvergent,
                isDivergent:      g.isDivergent,
                isGatingPoint:    g.isGatingPoint,
                isPacingResource,
                upstreamPathCount: g.upstreamPathCount,
                placementScore,
            };
        })
        .sort((a, b) => b.placementScore - a.placementScore);
}

// =============================================================================
// 4. decouplingTests
// =============================================================================

/**
 * Run the six structural DDMRP decoupling tests for a specific candidate stage.
 *
 * @param recipeId         Recipe to analyse
 * @param stageProcessId   The candidate RecipeProcess ID
 * @param recipeStore      Recipe knowledge store
 * @param opts             Optional caller-supplied signals:
 *   - customerHorizonDays: customer lead-time expectation (default: fullCLT × 0.6)
 *   - variabilityFactor:   ADU stability proxy (0–1, default: 0.3)
 *   - existingControlPoints: IDs of already-placed control points downstream
 */
export function decouplingTests(
    recipeId: string,
    stageProcessId: string,
    recipeStore: RecipeStore,
    opts?: {
        customerHorizonDays?: number;
        variabilityFactor?: number;
        existingControlPoints?: string[];
    },
): DecouplingTestResult {
    const fullClt         = recipeLeadTime(recipeId, recipeStore);
    const chain           = recipeStore.getProcessChain(recipeId);
    const { successors }  = buildAdjacency(chain, recipeStore);
    const finalProcess    = chain[chain.length - 1];

    // Downstream DLT = longest path through successors of stageProcessId
    const stageSuccs = successors.get(stageProcessId) ?? [];
    const decoupledDlt = stageSuccs.length > 0
        ? Math.max(...stageSuccs.map(id => downstreamDlt(id, chain, successors)))
        : 0;

    const customerHorizon = opts?.customerHorizonDays ?? fullClt * 0.6;
    const variabilityFactor = opts?.variabilityFactor ?? 0.3;
    const downstreamCPs = new Set(opts?.existingControlPoints ?? []);

    // ── Test 1: decouplesHorizon ───────────────────────────────────────────────
    // Placing a buffer here means the customer sees only `decoupledDlt` days.
    // True when decoupledDlt < customerHorizonDays.
    const decouplesHorizon = decoupledDlt < customerHorizon;

    // ── Test 2: biDirectionalBenefit ──────────────────────────────────────────
    // Both upstream (make-to-stock) AND downstream (replenish from buffer) benefit.
    // True when upstreamDays > 0 AND decoupledDlt > 0.
    const upstreamDays = fullClt - decoupledDlt;
    const biDirectionalBenefit = upstreamDays > 0 && decoupledDlt > 0;

    // ── Test 3: orderIndependence ──────────────────────────────────────────────
    // Output spec can be stocked without spoilage / obsolescence concern.
    // Proxy: true unless the process spec explicitly marks it as time-sensitive.
    // (Without a dedicated schema flag, we use the bufferType hint if present.)
    const rp = chain.find(p => p.id === stageProcessId);
    const pSpec = rp?.processConformsTo ? recipeStore.getProcessSpec(rp.processConformsTo) : undefined;
    const orderIndependence = pSpec?.bufferType !== 'time';  // time-type ≠ stockable

    // ── Test 4: isPrimaryPlanningMechanism ─────────────────────────────────────
    // No downstream process has a higher-scored control point for this segment.
    // True when no entry in existingControlPoints belongs to the downstream segment.
    const downstreamIds = new Set<string>();
    const toVisit = [...(successors.get(stageProcessId) ?? [])];
    while (toVisit.length > 0) {
        const id = toVisit.pop()!;
        if (downstreamIds.has(id)) continue;
        downstreamIds.add(id);
        (successors.get(id) ?? []).forEach(s => toVisit.push(s));
    }
    const isPrimaryPlanningMechanism = !Array.from(downstreamIds).some(id => downstreamCPs.has(id));

    // ── Test 5: relativePriorityMet ────────────────────────────────────────────
    // At most 60% of CLT remains downstream — meaningful compression.
    const relativePriorityMet = fullClt > 0 && (decoupledDlt / fullClt) <= 0.6;

    // ── Test 6: dynamicAdjustmentReady ─────────────────────────────────────────
    // ADU stable enough for dynamic buffer adjustment.
    const dynamicAdjustmentReady = variabilityFactor <= 0.5;

    const tests = [
        decouplesHorizon,
        biDirectionalBenefit,
        orderIndependence,
        isPrimaryPlanningMechanism,
        relativePriorityMet,
        dynamicAdjustmentReady,
    ];
    const testsPassed = tests.filter(Boolean).length;

    return {
        decouplesHorizon,
        biDirectionalBenefit,
        orderIndependence,
        isPrimaryPlanningMechanism,
        relativePriorityMet,
        dynamicAdjustmentReady,
        testsPassed,
    };
}
