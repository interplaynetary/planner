/**
 * LocationStrategy — abstraction over the two planning models (scope vs region).
 *
 * planForUnit delegates to a LocationStrategy for the 5 axes of difference:
 *   1. Location normalization (scope hierarchy vs H3 spatial tree)
 *   2. Slot extraction (scope queries vs location queries)
 *   3. Demand classification (individual-claimable bypass vs pure geospatial)
 *   4. Backtracking (proportional sacrifice vs simple class-order + due-date)
 *   5. Phase B observer (scoped vs full)
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
// LOCATION STRATEGY INTERFACE
// =============================================================================

export interface LocationStrategy {
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

    /** Read the location identifier from a demand slot (scope → inScopeOf, region → h3_cell). */
    locationOf(slot: DemandSlot): string | undefined;

    /** Backtracking: select next candidate to retract from the remaining set. */
    selectRetractCandidate(remaining: Set<SlotRecord>, canonical: string[]): SlotRecord | undefined;

    /** After permanent sacrifice, update state. Returns true if backtrack depth limit reached. */
    recordSacrifice(slot: DemandSlot, canonical: string[]): boolean;

    /** Whether a re-explode result counts as successful (scope checks more conditions). */
    isReExplodeSuccess(result: DependentDemandResult): boolean;

    /** Phase B: observer for supply processing (scoped or full). */
    observerForSupply(observer: Observer, canonical: string[]): Observer;

    /** Pass 1: handle transport-candidate slots by skipping dependentDemand. Returns null to use default. */
    handleTransportCandidate(
        slot: DemandSlot,
        planStore: PlanStore,
        planId: string,
        recipeStore: RecipeStore,
        agents?: { provider?: string; receiver?: string },
    ): DependentDemandResult | null;

    /** Inject federation boundary seeds before Pass 1. Returns seed intent IDs to clean up. */
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

    /** Deficit Intent fields: atLocation + inScopeOf from a location string. */
    deficitLocationFields(
        location: string | undefined,
        canonical: string[],
    ): { atLocation?: string; inScopeOf?: string[] };

    /** Annotate commitments with child origin (scope: adds inScopeOf; region: no-op). */
    annotateChildCommitments(
        commitments: Commitment[],
        originLocation: string,
    ): void;
}
