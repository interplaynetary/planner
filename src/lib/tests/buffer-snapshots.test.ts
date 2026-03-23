import { describe, it, expect } from 'bun:test';
import { BufferSnapshotStore, captureBufferSnapshots } from '../knowledge/buffer-snapshots';
import { BufferZoneStore } from '../knowledge/buffer-zones';
import { Observer } from '../observation/observer';
import { ProcessRegistry } from '../process-registry';

describe('BufferSnapshotStore', () => {
    it('records and queries by spec', () => {
        const store = new BufferSnapshotStore();
        store.record({ specId: 'wheat', date: '2026-03-01', onhand: 50, tor: 20, toy: 40, tog: 60, zone: 'green' });
        store.record({ specId: 'wheat', date: '2026-03-02', onhand: 30, tor: 20, toy: 40, tog: 60, zone: 'yellow' });
        store.record({ specId: 'flour', date: '2026-03-01', onhand: 100, tor: 30, toy: 60, tog: 90, zone: 'excess' });

        const wheatSnaps = store.forSpec('wheat');
        expect(wheatSnaps).toHaveLength(2);

        const flourSnaps = store.forSpec('flour');
        expect(flourSnaps).toHaveLength(1);
    });

    it('filters by date range', () => {
        const store = new BufferSnapshotStore();
        store.record({ specId: 'wheat', date: '2026-03-01', onhand: 50, tor: 20, toy: 40, tog: 60, zone: 'green' });
        store.record({ specId: 'wheat', date: '2026-03-05', onhand: 30, tor: 20, toy: 40, tog: 60, zone: 'yellow' });
        store.record({ specId: 'wheat', date: '2026-03-10', onhand: 15, tor: 20, toy: 40, tog: 60, zone: 'red' });

        const filtered = store.forSpec('wheat', '2026-03-03', '2026-03-08');
        expect(filtered).toHaveLength(1);
        expect(filtered[0].date).toBe('2026-03-05');
    });

    it('returns latest snapshot for spec', () => {
        const store = new BufferSnapshotStore();
        store.record({ specId: 'wheat', date: '2026-03-01', onhand: 50, tor: 20, toy: 40, tog: 60, zone: 'green' });
        store.record({ specId: 'wheat', date: '2026-03-10', onhand: 15, tor: 20, toy: 40, tog: 60, zone: 'red' });

        const latest = store.latest('wheat');
        expect(latest?.date).toBe('2026-03-10');
        expect(latest?.zone).toBe('red');
    });

    it('returns undefined for unknown spec', () => {
        const store = new BufferSnapshotStore();
        expect(store.latest('nonexistent')).toBeUndefined();
    });

    it('tracks unique spec IDs', () => {
        const store = new BufferSnapshotStore();
        store.record({ specId: 'wheat', date: '2026-03-01', onhand: 50, tor: 20, toy: 40, tog: 60, zone: 'green' });
        store.record({ specId: 'flour', date: '2026-03-01', onhand: 100, tor: 30, toy: 60, tog: 90, zone: 'excess' });
        store.record({ specId: 'wheat', date: '2026-03-02', onhand: 45, tor: 20, toy: 40, tog: 60, zone: 'green' });

        expect(store.trackedSpecs().sort()).toEqual(['flour', 'wheat']);
    });
});

describe('captureBufferSnapshots', () => {
    it('captures current state from Observer', () => {
        const bzStore = new BufferZoneStore();
        bzStore.addBufferZone({
            specId: 'wheat', profileId: 'p1',
            tor: 20, toy: 40, tog: 60,
            adu: 5, aduUnit: 'kg', dltDays: 3,
            moq: 0, moqUnit: 'kg',
            bufferClassification: 'replenished',
            lastComputedAt: '2026-01-01T00:00:00Z',
        });

        const observer = new Observer(new ProcessRegistry());
        observer.seedResource({
            id: 'r1', name: 'Wheat', conformsTo: 'wheat',
            accountingQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });

        const snapshots = captureBufferSnapshots(bzStore, observer, new Date('2026-03-15'));
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].specId).toBe('wheat');
        expect(snapshots[0].onhand).toBe(50);
        expect(snapshots[0].zone).toBe('green');
        expect(snapshots[0].date).toBe('2026-03-15');
    });

    it('captures multiple buffers', () => {
        const bzStore = new BufferZoneStore();
        bzStore.addBufferZone({
            specId: 'a', profileId: 'p1',
            tor: 10, toy: 20, tog: 30,
            adu: 1, aduUnit: 'u', dltDays: 1,
            moq: 0, moqUnit: 'u',
            bufferClassification: 'replenished',
            lastComputedAt: '2026-01-01T00:00:00Z',
        });
        bzStore.addBufferZone({
            specId: 'b', profileId: 'p1',
            tor: 5, toy: 10, tog: 15,
            adu: 1, aduUnit: 'u', dltDays: 1,
            moq: 0, moqUnit: 'u',
            bufferClassification: 'replenished',
            lastComputedAt: '2026-01-01T00:00:00Z',
        });

        const observer = new Observer(new ProcessRegistry());
        observer.seedResource({ id: 'r1', name: 'A', conformsTo: 'a', accountingQuantity: { hasNumericalValue: 5, hasUnit: 'u' }, onhandQuantity: { hasNumericalValue: 5, hasUnit: 'u' } });
        observer.seedResource({ id: 'r2', name: 'B', conformsTo: 'b', accountingQuantity: { hasNumericalValue: 20, hasUnit: 'u' }, onhandQuantity: { hasNumericalValue: 20, hasUnit: 'u' } });

        const snapshots = captureBufferSnapshots(bzStore, observer, new Date('2026-03-15'));
        expect(snapshots).toHaveLength(2);
        // A: onhand=5, tor=10 → red; B: onhand=20, tog=15 → excess
        expect(snapshots.find(s => s.specId === 'a')?.zone).toBe('red');
        expect(snapshots.find(s => s.specId === 'b')?.zone).toBe('excess');
    });
});
