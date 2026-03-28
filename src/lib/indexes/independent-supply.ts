/**
 * Independent Supply Index
 *
 * A pre-planning snapshot of available supply, aggregated from three strata:
 *
 *   1. Inventory       — EconomicResources with positive on-hand quantity
 *   2. Scheduled       — outputOf Intents/Commitments (future production / receipts)
 *   3. Labor           — AgentCapacity nodes from AgentIndex (remaining effort hours)
 *
 * This index is the supply-side counterpart of IndependentDemandIndex. Together
 * they give the planning algorithm a complete pre-built view of supply vs demand
 * before any soft allocations are made.
 *
 * Design notes:
 *   - ONE SupplySlot per source entity (resource / intent / commitment / AgentCapacity).
 *   - Labor slots have spec_id=undefined; the spec_index maps each resource_spec
 *     of the AgentCapacity → the SAME slot ID (reference-only, no hour duplication).
 *   - Spatial hierarchy stats: sum_quantity = material, sum_hours = labor.
 *   - No space_time_index — spatial + spec queries are sufficient for planning.
 */

import {
    createHexIndex, addItemToHexIndex, queryHexIndexRadius,
    type HexIndex, type HexNode,
} from '../utils/space-time-index';
import { spatialThingToH3 } from '../utils/space';
import type { EconomicResource, Intent, Commitment, SpatialThing } from '../schemas';
import type { SpatialThingStore } from '../knowledge/spatial-things';
import type { Observer } from '../observation/observer';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A single supply slot — one per source entity.
 *
 * Unified view over inventory, scheduled receipts, and labor capacity.
 * The slot_type field indicates which stratum the slot came from.
 */
export interface SupplySlot {
    /**
     * Unique ID:
     *   inventory         → `inv:${resource.id}`
     *   scheduled_receipt → `sched:${intent.id}` or `sched:${commitment.id}`
     *   labor             → `labor:${capacityId}`
     */
    id: string;

    /** Which supply stratum this slot came from */
    slot_type: 'inventory' | 'scheduled_receipt' | 'labor';

    /**
     * ResourceSpecification ID.
     * Undefined for labor slots — spec_index maps each skill → the slot.
     */
    spec_id?: string;

    /** Material quantity available (inventory or scheduled receipt). 0 for labor. */
    quantity: number;

    /** Labor hours available (AgentCapacity.remaining_hours). 0 for material strata. */
    hours: number;

    /** H3 cell at the build resolution */
    h3_cell?: string;

    /**
     * ISO datetime — when this supply becomes available.
     * Populated for scheduled_receipt slots (from intent.hasEnd / due).
     * Absent for inventory (already on-hand) and labor (uses capacity temporal context).
     */
    available_from?: string;

    /** Agent ID — populated for labor slots only */
    agent_id?: string;

    /** Source entity ID for traceability back to the VF graph */
    source_id: string;

    /** Scope IDs this supply belongs to (from custodianScope / inScopeOf) */
    scope_ids?: string[];
}

export interface IndependentSupplyIndex {
    /**
     * All supply slots — source of truth.
     * One per resource / intent / commitment / AgentCapacity.
     */
    supply_slots: Map<string, SupplySlot>;

    /**
     * Spec index — maps ResourceSpecification ID → Set<slotId>.
     * For labor slots: each resource_spec of the AgentCapacity references the same slot.
     * Summing hours across the resulting slots is safe — no duplication.
     */
    spec_index: Map<string, Set<string>>;

    /**
     * Cell index — maps H3 cell (at build resolution) → Set<slotId>.
     */
    cell_index: Map<string, Set<string>>;

    /**
     * Spatial hierarchy over SupplySlots.
     * HexNode stats: sum_quantity = material, sum_hours = labor.
     */
    spatial_hierarchy: HexIndex<SupplySlot>;

    /** scope_index — maps scope Agent ID → Set<slotId> */
    scope_index: Map<string, Set<string>>;
}

// =============================================================================
// BUILD
// =============================================================================

function addTo(map: Map<string, Set<string>>, key: string | undefined, id: string): void {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
}

function addSlot(
    index: IndependentSupplyIndex,
    slot: SupplySlot,
    specIds: string[],
    st?: SpatialThing,
    h3Resolution?: number,
): void {
    index.supply_slots.set(slot.id, slot);

    for (const specId of specIds) {
        addTo(index.spec_index, specId, slot.id);
    }

    if (slot.h3_cell) {
        addTo(index.cell_index, slot.h3_cell, slot.id);
    }

    for (const scopeId of slot.scope_ids ?? []) {
        addTo(index.scope_index, scopeId, slot.id);
    }

    if (st && slot.h3_cell && h3Resolution !== undefined) {
        addItemToHexIndex(
            index.spatial_hierarchy,
            slot,
            slot.id,
            { lat: st.lat, lon: st.long, h3_index: slot.h3_cell },
            { quantity: slot.quantity, hours: slot.hours },
        );
    }
}

/**
 * Build the IndependentSupplyIndex from resources and planned flows.
 *
 * Two strata:
 *   1. Resources — material (inventory) and capacity (labor), distinguished by unitOfEffort.
 *   2. Scheduled — outputOf Intents/Commitments (future production/receipts).
 *
 * @param resources    All EconomicResources in scope
 * @param intents      All Intents (only outputOf + non-work + non-finished are indexed)
 * @param commitments  All Commitments (only outputOf + non-work + non-finished are indexed)
 * @param observer     Observer for skill queries on capacity resources
 * @param locations    SpatialThing lookup for H3 indexing
 * @param h3Resolution H3 resolution for spatial bucketing (default 7 ≈ 1km²)
 */
export function buildIndependentSupplyIndex(
    resources: EconomicResource[],
    intents: Intent[],
    commitments: Commitment[],
    observer: Observer,
    locations: SpatialThingStore,
    h3Resolution: number = 7,
): IndependentSupplyIndex {
    const index: IndependentSupplyIndex = {
        supply_slots: new Map(),
        spec_index: new Map(),
        cell_index: new Map(),
        spatial_hierarchy: createHexIndex<SupplySlot>(),
        scope_index: new Map(),
    };

    // --- Stratum 1: Resources (material inventory + agent capacity) ---

    for (const resource of resources) {
        if (resource.containedIn) continue;
        const qty = resource.onhandQuantity?.hasNumericalValue ?? 0;
        if (qty <= 0) continue;

        const st = resource.currentLocation ? locations.getLocation(resource.currentLocation) : undefined;
        const h3Cell = st ? spatialThingToH3(st, h3Resolution) : undefined;

        if (resource.unitOfEffort) {
            // Capacity resource → labor supply slot
            const agentId = resource.primaryAccountable;
            const skills = agentId ? observer.skillsOf(agentId) : [];
            const specIds = skills.map(s => s.conformsTo).filter(Boolean);

            const slot: SupplySlot = {
                id:        'capacity:' + resource.id,
                slot_type: 'labor',
                spec_id:   undefined,
                quantity:  0,
                hours:     qty,
                h3_cell:   h3Cell,
                agent_id:  agentId,
                source_id: resource.id,
                scope_ids: resource.custodianScope ? [resource.custodianScope] : [],
            };

            addSlot(index, slot, specIds, st, h3Resolution);
        } else {
            // Material resource → inventory supply slot
            const slot: SupplySlot = {
                id:        'inv:' + resource.id,
                slot_type: 'inventory',
                spec_id:   resource.conformsTo,
                quantity:  qty,
                hours:     0,
                h3_cell:   h3Cell,
                source_id: resource.id,
                scope_ids: resource.custodianScope ? [resource.custodianScope] : [],
            };

            addSlot(index, slot, resource.conformsTo ? [resource.conformsTo] : [], st, h3Resolution);
        }
    }

    // --- Stratum 2: Scheduled Receipts (outputOf Intents) ---

    for (const intent of intents) {
        if (!intent.outputOf) continue;
        if (intent.finished) continue;
        if (intent.action === 'work') continue;   // labor handled separately

        const st = intent.atLocation ? locations.getLocation(intent.atLocation) : undefined;
        const h3Cell = st ? spatialThingToH3(st, h3Resolution) : undefined;

        const slot: SupplySlot = {
            id:             'sched:' + intent.id,
            slot_type:      'scheduled_receipt',
            spec_id:        intent.resourceConformsTo,
            quantity:       intent.resourceQuantity?.hasNumericalValue ?? 0,
            hours:          0,
            h3_cell:        h3Cell,
            available_from: intent.hasEnd ?? intent.due ?? intent.hasPointInTime,
            source_id:      intent.id,
            scope_ids:      intent.inScopeOf ?? [],
        };

        addSlot(index, slot, intent.resourceConformsTo ? [intent.resourceConformsTo] : [], st, h3Resolution);
    }

    // --- Stratum 2b: Scheduled Receipts (outputOf Commitments) ---

    for (const commitment of commitments) {
        if (!commitment.outputOf) continue;
        if (commitment.finished) continue;
        if (commitment.action === 'work') continue;

        const st = commitment.atLocation ? locations.getLocation(commitment.atLocation) : undefined;
        const h3Cell = st ? spatialThingToH3(st, h3Resolution) : undefined;

        const slot: SupplySlot = {
            id:             'sched:' + commitment.id,
            slot_type:      'scheduled_receipt',
            spec_id:        commitment.resourceConformsTo,
            quantity:       commitment.resourceQuantity?.hasNumericalValue ?? 0,
            hours:          0,
            h3_cell:        h3Cell,
            available_from: commitment.hasEnd ?? commitment.due ?? commitment.hasPointInTime,
            source_id:      commitment.id,
            scope_ids:      commitment.inScopeOf ?? [],
        };

        addSlot(index, slot, commitment.resourceConformsTo ? [commitment.resourceConformsTo] : [], st, h3Resolution);
    }

    return index;
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * All supply slots for a given ResourceSpecification.
 * Includes inventory, scheduled receipts, and labor (via skill lookup).
 */
export function querySupplyBySpec(
    index: IndependentSupplyIndex,
    specId: string,
): SupplySlot[] {
    const ids = index.spec_index.get(specId) ?? new Set<string>();
    return [...ids].map(id => index.supply_slots.get(id)!).filter(Boolean);
}

/**
 * All supply slots near a location.
 */
export function querySupplyByLocation(
    index: IndependentSupplyIndex,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): SupplySlot[] {
    if (!query.h3_index && query.latitude === undefined) return [];
    const ids = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...ids].map(id => index.supply_slots.get(id)!).filter(Boolean);
}

/**
 * Intersection: supply for a specific spec near a location.
 * Primary query for planning: "is there supply of type X within Y km?"
 */
export function querySupplyBySpecAndLocation(
    index: IndependentSupplyIndex,
    specId: string,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): SupplySlot[] {
    const specIds = index.spec_index.get(specId) ?? new Set<string>();
    if (specIds.size === 0) return [];
    const spatialIds = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...specIds]
        .filter(id => spatialIds.has(id))
        .map(id => index.supply_slots.get(id)!)
        .filter(Boolean);
}

/**
 * Raw HexNode for a cell — aggregated stats and full SupplySlot objects.
 * stats.sum_quantity = total material; stats.sum_hours = total labor hours.
 */
export function querySupplyByHex(
    index: IndependentSupplyIndex,
    cell: string,
): HexNode<SupplySlot> | null {
    return index.spatial_hierarchy.nodes.get(cell) ?? null;
}

/**
 * Sum material quantity across supply slots.
 * Does not include labor (hours field).
 */
export function getTotalSupplyQuantity(slots: SupplySlot[]): number {
    return slots.reduce((sum, s) => sum + s.quantity, 0);
}

/**
 * Sum labor hours across supply slots.
 * Does not include material (quantity field).
 */
export function getTotalSupplyHours(slots: SupplySlot[]): number {
    return slots.reduce((sum, s) => sum + s.hours, 0);
}

/**
 * All supply slots belonging to a given scope Agent ID.
 * Covers inventory (custodianScope) and scheduled receipts (inScopeOf).
 * Labor slots are not scope-indexed.
 */
export function querySupplyByScope(
    index: IndependentSupplyIndex,
    scopeId: string,
): SupplySlot[] {
    const ids = index.scope_index.get(scopeId) ?? new Set<string>();
    return [...ids].map(id => index.supply_slots.get(id)!).filter(Boolean);
}
