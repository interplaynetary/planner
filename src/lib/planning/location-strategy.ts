/**
 * PlanningMode — decomposed into SpatialModel + ScopePolicy + SacrificePolicy.
 *
 * planForUnit delegates to a PlanningMode (composed from these three policies):
 *   SpatialModel  — normalization, extraction, classification, location mapping, observer
 *   ScopePolicy   — federation-specific: transport candidates, seed injection, scheduled receipts
 *   SacrificePolicy — backtracking: candidate selection, sacrifice recording, success check
 */

import type { Commitment } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { Observer } from '../observation/observer';
import type { PlanStore } from './planning';
import type { ProcessRegistry } from '../process-registry';
import type { IndependentDemandIndex, DemandSlot } from '../indexes/independent-demand';
import type { IndependentSupplyIndex, SupplySlot } from '../indexes/independent-supply';
import type { DependentDemandResult } from '../algorithms/dependent-demand';

// =============================================================================
// SHARED TYPES
// =============================================================================

export type DemandSlotClass =
    | 'locally-satisfiable'
    | 'transport-candidate'
    | 'producible-with-imports'
    | 'external-dependency';

export interface SlotRecord {
    slot: DemandSlot;
    result: DependentDemandResult;
    slotClass: DemandSlotClass;
}

export interface SurplusSignal {
    plannedWithin: string;
    specId: string;
    quantity: number;
    availableFrom?: string;
    atLocation?: string;
}

export interface MetabolicDebt {
    specId: string;
    shortfall: number;
    plannedWithin: string;
}

export interface Conflict {
    type: 'inventory-overclaim' | 'capacity-contention';
    resourceOrAgentId: string;
    overclaimed: number;
    candidates: string[];
}

// =============================================================================
// SPATIAL MODEL — normalization, extraction, classification, location
// =============================================================================

export interface SpatialModel {
    /** Phase 0: Normalize location identifiers (deduplicate, drop dominated). */
    normalize(ids: string[]): string[];

    /** Phase 1: Extract demand/supply slots for canonical locations. */
    extractSlots(
        canonical: string[],
        horizon: { from: Date; to: Date },
        demandIndex: IndependentDemandIndex,
        supplyIndex: IndependentSupplyIndex,
    ): { demands: DemandSlot[]; supply: SupplySlot[] };

    /** Phase 2: Classify a demand slot. */
    classifySlot(
        slot: DemandSlot,
        canonical: string[],
        supplyIndex: IndependentSupplyIndex,
        recipeStore: RecipeStore,
    ): DemandSlotClass;

    /** Read the location identifier from a demand slot. */
    locationOf(slot: DemandSlot): string | undefined;

    /** Deficit Intent fields: atLocation + inScopeOf from a location string. */
    deficitLocationFields(
        location: string | undefined,
        canonical: string[],
    ): { atLocation?: string; inScopeOf?: string[] };

    /** Phase B: observer for supply processing (scoped vs full). */
    observerForSupply(observer: Observer, canonical: string[]): Observer;
}

// =============================================================================
// SCOPE POLICY — federation-specific behaviour (no-ops for region)
// =============================================================================

export interface ScopePolicy {
    /** Pass 1: handle transport-candidate slots. Returns null to use default. */
    handleTransportCandidate(
        slot: DemandSlot,
        planStore: PlanStore,
        planId: string,
        recipeStore: RecipeStore,
        agents?: { provider?: string; receiver?: string },
    ): DependentDemandResult | null;

    /** Inject federation boundary seeds before Pass 1. Returns seed intent IDs. */
    injectFederationSeeds(
        planStore: PlanStore,
        supplyIndex: IndependentSupplyIndex,
    ): string[];

    /** Phase B: handle scheduled_receipt as direct surplus. Returns null to use dependentSupply. */
    handleScheduledReceipt(
        supplySlot: SupplySlot,
        planStore: PlanStore,
        processes: ProcessRegistry,
        recipeStore: RecipeStore,
        generateId: () => string,
        supplyPlanId: string,
    ): SurplusSignal | null;

    /** Annotate commitments with child origin. */
    annotateChildCommitments(
        commitments: Commitment[],
        originLocation: string,
    ): void;
}

// =============================================================================
// SACRIFICE POLICY — backtracking behaviour
// =============================================================================

export interface SacrificePolicy {
    /** Select next candidate to retract from the remaining set. */
    selectRetractCandidate(remaining: Set<SlotRecord>, canonical: string[]): SlotRecord | undefined;

    /** Optional: return top N candidates for scored multi-candidate evaluation. */
    selectRetractCandidates?(remaining: Set<SlotRecord>, canonical: string[], limit: number): SlotRecord[];

    /** Optional: score a candidate's re-explode result (higher = better). */
    scoreCandidate?(result: DependentDemandResult, slot: import('../indexes/independent-demand').DemandSlot): number;

    /** After permanent sacrifice, update state. Returns true if depth limit reached. */
    recordSacrifice(slot: DemandSlot, canonical: string[]): boolean;

    /** Whether a re-explode result counts as successful. */
    isReExplodeSuccess(result: DependentDemandResult): boolean;
}

// =============================================================================
// PLANNING MODE — composed from the three policies
// =============================================================================

export interface PlanningMode {
    spatial: SpatialModel;
    scope: ScopePolicy;
    sacrifice: SacrificePolicy;
}

// =============================================================================
// NULL SCOPE POLICY — no-op for region planner
// =============================================================================

export const NULL_SCOPE_POLICY: ScopePolicy = {
    handleTransportCandidate: () => null,
    injectFederationSeeds: () => [],
    handleScheduledReceipt: () => null,
    annotateChildCommitments: () => {},
};

