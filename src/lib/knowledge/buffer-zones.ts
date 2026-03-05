/**
 * BufferZoneStore — Knowledge layer registry for DDMRP buffer zones and signals.
 *
 * Co-locates BufferZone and ReplenishmentSignal because they share the same
 * DDS&OP lifecycle: BufferZones are the configured parameters; ReplenishmentSignals
 * are the ephemeral planning outputs that reference them via bufferZoneId.
 *
 * Lookup semantics for findZone():
 *   - Exact match (specId + atLocation) wins over global zone (specId, no atLocation)
 *   - If no location-specific zone exists, falls back to the global zone for that spec
 *
 * DDMRP ref: Ptak & Smith Ch 8 — Buffer Profiles & Levels
 *            Ch 12 — Signal Integrity
 */

import { nanoid } from 'nanoid';
import type { BufferZone, ReplenishmentSignal } from '../schemas';

// =============================================================================
// BUFFER ZONE STORE
// =============================================================================

export class BufferZoneStore {
    private zones   = new Map<string, BufferZone>();
    private signals = new Map<string, ReplenishmentSignal>();

    constructor(private generateId: () => string = () => nanoid()) {}

    // =========================================================================
    // BufferZone CRUD
    // =========================================================================

    /**
     * Register a BufferZone. If `id` is omitted, one is generated.
     * Overwrites an existing zone with the same ID.
     */
    addBufferZone(zone: Omit<BufferZone, 'id'> & { id?: string }): BufferZone {
        const z: BufferZone = { id: zone.id ?? this.generateId(), ...zone } as BufferZone;
        this.zones.set(z.id, z);
        return z;
    }

    getBufferZone(id: string): BufferZone | undefined {
        return this.zones.get(id);
    }

    allBufferZones(): BufferZone[] {
        return Array.from(this.zones.values());
    }

    /**
     * All zones for a given ResourceSpecification ID (across all locations).
     * Returns the global zone (no atLocation) first, then location-specific zones.
     */
    zonesForSpec(specId: string): BufferZone[] {
        const all = Array.from(this.zones.values()).filter(z => z.specId === specId);
        return [
            ...all.filter(z => !z.atLocation),
            ...all.filter(z => !!z.atLocation),
        ];
    }

    /**
     * Find the best-matching zone for a spec + optional location.
     *
     * Priority:
     *   1. Exact match: specId + atLocation
     *   2. Global match: specId + no atLocation
     *   3. undefined (no zone configured)
     */
    findZone(specId: string, atLocation?: string): BufferZone | undefined {
        if (atLocation) {
            const exact = Array.from(this.zones.values())
                .find(z => z.specId === specId && z.atLocation === atLocation);
            if (exact) return exact;
        }
        return Array.from(this.zones.values())
            .find(z => z.specId === specId && !z.atLocation);
    }

    /**
     * Patch specific fields on an existing zone. Returns the updated zone.
     * Useful for stamping `lastComputedAt` without a full recalibration call.
     *
     * @throws if zone ID is not found
     */
    updateZone(id: string, updates: Partial<Omit<BufferZone, 'id'>>): BufferZone {
        const existing = this.zones.get(id);
        if (!existing) throw new Error(`BufferZone ${id} not found`);
        const updated = { ...existing, ...updates, id };
        this.zones.set(id, updated);
        return updated;
    }

    /**
     * Replace a zone with a fully-recomputed version (e.g. output of recalibrateBufferZone).
     * The `id` in `zone` must already exist in the store.
     *
     * @throws if zone ID is not found
     */
    replaceZone(zone: BufferZone): BufferZone {
        if (!this.zones.has(zone.id)) throw new Error(`BufferZone ${zone.id} not found`);
        this.zones.set(zone.id, zone);
        return zone;
    }

    /**
     * Return all zones whose recalculation cadence is due on or before `asOf`.
     *
     * Cadence check (conservative — triggers recalc at the first opportunity):
     *   'daily'   → lastComputedAt is before today
     *   'weekly'  → lastComputedAt is more than 7 days before asOf
     *   'monthly' → lastComputedAt is more than 30 days before asOf
     */
    zonesDueForRecalibration(asOf: Date, profileMap: Map<string, { recalculationCadence?: 'daily' | 'weekly' | 'monthly' }>): BufferZone[] {
        const asOfMs = asOf.getTime();
        return Array.from(this.zones.values()).filter(z => {
            const lastMs = new Date(z.lastComputedAt).getTime();
            const ageMs  = asOfMs - lastMs;
            const profile = profileMap.get(z.profileId);
            switch (profile?.recalculationCadence) {
                case 'daily':   return ageMs >= 86_400_000;
                case 'weekly':  return ageMs >= 7  * 86_400_000;
                case 'monthly': return ageMs >= 30 * 86_400_000;
                default:        return false;  // no cadence = manual recalibration only
            }
        });
    }

    // =========================================================================
    // ReplenishmentSignal CRUD
    // =========================================================================

    /**
     * Store a ReplenishmentSignal. If `id` is omitted, one is generated.
     * Generated signals come from generateReplenishmentSignal() in ddmrp.ts.
     */
    addSignal(signal: Omit<ReplenishmentSignal, 'id'> & { id?: string }): ReplenishmentSignal {
        const s: ReplenishmentSignal = { id: signal.id ?? this.generateId(), ...signal } as ReplenishmentSignal;
        this.signals.set(s.id, s);
        return s;
    }

    getSignal(id: string): ReplenishmentSignal | undefined {
        return this.signals.get(id);
    }

    allSignals(): ReplenishmentSignal[] {
        return Array.from(this.signals.values());
    }

    /** All signals with status 'open' — awaiting approval or rejection. */
    openSignals(): ReplenishmentSignal[] {
        return Array.from(this.signals.values()).filter(s => s.status === 'open');
    }

    /** All signals for a given ResourceSpecification ID. */
    signalsForSpec(specId: string): ReplenishmentSignal[] {
        return Array.from(this.signals.values()).filter(s => s.specId === specId);
    }

    /**
     * All signals whose dueDate is on or before `asOf` and status is still 'open'.
     * Used for the LTM alert screen: signals that should have been approved by now.
     */
    overdueSignals(asOf: Date): ReplenishmentSignal[] {
        const asOfStr = asOf.toISOString().slice(0, 10);
        return Array.from(this.signals.values())
            .filter(s => s.status === 'open' && s.dueDate <= asOfStr);
    }

    /**
     * Update a signal's status (approved / rejected) and optionally set
     * approvedCommitmentId. Called by PlanStore.promoteSignalToCommitment()
     * when you want the store copy kept in sync too.
     *
     * @throws if signal ID is not found
     */
    updateSignalStatus(
        id: string,
        status: 'approved' | 'rejected',
        approvedCommitmentId?: string,
    ): ReplenishmentSignal {
        const existing = this.signals.get(id);
        if (!existing) throw new Error(`ReplenishmentSignal ${id} not found`);
        existing.status = status;
        if (approvedCommitmentId) existing.approvedCommitmentId = approvedCommitmentId;
        return existing;
    }
}
