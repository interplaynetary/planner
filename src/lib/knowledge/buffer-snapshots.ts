import { z } from 'zod';
import type { Observer } from '../observation/observer';
import { BufferZoneStore } from './buffer-zones';
import { bufferStatus } from '../algorithms/ddmrp';

export const BufferSnapshotSchema = z.object({
    specId: z.string(),
    date: z.string(),           // ISO date string (YYYY-MM-DD)
    onhand: z.number(),
    tor: z.number(),
    toy: z.number(),
    tog: z.number(),
    zone: z.enum(['red', 'yellow', 'green', 'excess']),
});
export type BufferSnapshot = z.infer<typeof BufferSnapshotSchema>;

export class BufferSnapshotStore {
    private snapshots: BufferSnapshot[] = [];

    /** Record a snapshot. */
    record(snapshot: BufferSnapshot): void {
        this.snapshots.push(snapshot);
    }

    /** Record multiple snapshots at once. */
    recordAll(snapshots: BufferSnapshot[]): void {
        this.snapshots.push(...snapshots);
    }

    /** Get snapshots for a spec, optionally filtered by date range. */
    forSpec(specId: string, from?: string, to?: string): BufferSnapshot[] {
        return this.snapshots.filter(s => {
            if (s.specId !== specId) return false;
            if (from && s.date < from) return false;
            if (to && s.date > to) return false;
            return true;
        });
    }

    /** Get the latest snapshot for a spec. */
    latest(specId: string): BufferSnapshot | undefined {
        let best: BufferSnapshot | undefined;
        for (const s of this.snapshots) {
            if (s.specId !== specId) continue;
            if (!best || s.date > best.date) best = s;
        }
        return best;
    }

    /** Get all snapshots. */
    all(): readonly BufferSnapshot[] {
        return this.snapshots;
    }

    /** Get unique spec IDs that have snapshots. */
    trackedSpecs(): string[] {
        return [...new Set(this.snapshots.map(s => s.specId))];
    }
}

/**
 * Capture current buffer state from Observer inventory.
 * Call this periodically (daily/post-planning) to build up time-series data.
 */
export function captureBufferSnapshots(
    bufferZoneStore: BufferZoneStore,
    observer: Observer,
    asOf: Date,
): BufferSnapshot[] {
    const dateStr = asOf.toISOString().slice(0, 10); // YYYY-MM-DD
    const snapshots: BufferSnapshot[] = [];

    for (const bz of bufferZoneStore.allBufferZones()) {
        const onhand = observer.conformingResources(bz.specId)
            .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
        const status = bufferStatus(onhand, bz);
        snapshots.push({
            specId: bz.specId,
            date: dateStr,
            onhand,
            tor: bz.tor,
            toy: bz.toy,
            tog: bz.tog,
            zone: status.zone,
        });
    }

    return snapshots;
}
