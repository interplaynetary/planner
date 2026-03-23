import { describe, it, expect, beforeEach } from 'bun:test';
import { Observer } from '../observation/observer';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { BufferZoneStore } from '../knowledge/buffer-zones';
import { BufferSnapshotStore } from '../knowledge/buffer-snapshots';
import { AlertStore, type ExecutionContext } from '../execution/alerts';
import {
    bufferStatusMonitor,
    materialSyncMonitor,
    createADUShiftMonitor,
    createSnapshotSink,
    standardMonitors,
    standardSinks,
} from '../execution/monitors';
import { startExecution } from '../execution/scope-execution';

let idCounter = 0;
const nextId = () => `id-${++idCounter}`;

function makeCtx(overrides?: {
    zones?: Array<{
        specId: string; tor: number; toy: number; tog: number;
        adu?: number; aduAlertHighPct?: number; aduAlertLowPct?: number;
    }>;
}): ExecutionContext {
    const reg = new ProcessRegistry(nextId);
    const observer = new Observer(reg, nextId);
    const planStore = new PlanStore(new ProcessRegistry(nextId), nextId);
    const bufferZoneStore = new BufferZoneStore();
    for (const z of overrides?.zones ?? []) {
        bufferZoneStore.addBufferZone({
            specId: z.specId, profileId: 'p1',
            tor: z.tor, toy: z.toy, tog: z.tog,
            adu: z.adu ?? 10, dltDays: 5,
            bufferClassification: 'replenished' as const,
            aduUnit: 'unit', moq: 1, moqUnit: 'unit',
            lastComputedAt: new Date().toISOString(),
            aduAlertHighPct: z.aduAlertHighPct,
            aduAlertLowPct: z.aduAlertLowPct,
        });
    }
    return { observer, planStore, bufferZoneStore, snapshotStore: new BufferSnapshotStore() };
}

beforeEach(() => { idCounter = 0; });

// =============================================================================
// MONITORS AS PURE FUNCTIONS
// =============================================================================

describe('bufferStatusMonitor', () => {
    it('returns buffer-status alert on resource update for buffered spec', () => {
        const ctx = makeCtx({ zones: [{ specId: 'wheat', tor: 20, toy: 40, tog: 60 }] });
        ctx.observer.seedResource({
            id: 'r1', name: 'Wheat', conformsTo: 'wheat',
            accountingQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });

        // Simulate a resource_updated event
        const mockEvent = {
            type: 'resource_updated' as const,
            resource: ctx.observer.getResource('r1')!,
            event: { id: 'e1', action: 'consume' as const, hasPointInTime: '2026-03-22T10:00:00.000Z' } as any,
            changes: ['onhandQuantity'],
        };

        const alerts = bufferStatusMonitor(mockEvent, ctx);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe('buffer-status');
        expect(alerts[0].specId).toBe('wheat');
    });

    it('returns empty for non-buffered specs', () => {
        const ctx = makeCtx(); // no buffer zones
        ctx.observer.seedResource({
            id: 'r1', name: 'Bolts', conformsTo: 'bolts',
            accountingQuantity: { hasNumericalValue: 100, hasUnit: 'ea' },
            onhandQuantity: { hasNumericalValue: 100, hasUnit: 'ea' },
        });

        const mockEvent = {
            type: 'resource_updated' as const,
            resource: ctx.observer.getResource('r1')!,
            event: { id: 'e1', action: 'consume' as const, hasPointInTime: '2026-03-22T10:00:00.000Z' } as any,
            changes: ['onhandQuantity'],
        };

        expect(bufferStatusMonitor(mockEvent, ctx)).toHaveLength(0);
    });

    it('ignores irrelevant event types', () => {
        const ctx = makeCtx({ zones: [{ specId: 'wheat', tor: 20, toy: 40, tog: 60 }] });
        const mockEvent = { type: 'process_completed' as const, processId: 'p1' };
        expect(bufferStatusMonitor(mockEvent, ctx)).toHaveLength(0);
    });
});

describe('createADUShiftMonitor', () => {
    it('accumulates consumption and detects surge', () => {
        const ctx = makeCtx({ zones: [{ specId: 'flour', tor: 10, toy: 20, tog: 30, adu: 5, aduAlertHighPct: 0.5 }] });
        const monitor = createADUShiftMonitor();

        // Feed multiple high-consumption events
        const alerts: any[] = [];
        for (let i = 0; i < 10; i++) {
            const result = monitor({
                type: 'recorded' as const,
                event: {
                    id: `e${i}`, action: 'consume' as const,
                    resourceConformsTo: 'flour',
                    resourceQuantity: { hasNumericalValue: 20, hasUnit: 'kg' },
                    hasPointInTime: `2026-03-${String(22 + i).padStart(2, '0')}T10:00:00.000Z`,
                } as any,
            }, ctx);
            alerts.push(...result);
        }

        // Should eventually detect a surge (currentADU >> storedADU of 5)
        const surges = alerts.filter(a => a.direction === 'surge');
        expect(surges.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// SINKS
// =============================================================================

describe('createSnapshotSink', () => {
    it('captures snapshot on resource_updated for buffered spec', () => {
        const ctx = makeCtx({ zones: [{ specId: 'flour', tor: 10, toy: 20, tog: 30 }] });
        ctx.observer.seedResource({
            id: 'r1', name: 'Flour', conformsTo: 'flour',
            accountingQuantity: { hasNumericalValue: 25, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 25, hasUnit: 'kg' },
        });

        const sink = createSnapshotSink();
        sink({
            type: 'resource_updated' as const,
            resource: ctx.observer.getResource('r1')!,
            event: { id: 'e1', action: 'consume' as const, hasPointInTime: '2026-03-22T10:00:00.000Z' } as any,
            changes: ['onhandQuantity'],
        }, ctx);

        const snaps = ctx.snapshotStore.forSpec('flour');
        expect(snaps).toHaveLength(1);
        expect(snaps[0].date).toBe('2026-03-22');
    });

    it('captures only one snapshot per spec per day', () => {
        const ctx = makeCtx({ zones: [{ specId: 'flour', tor: 10, toy: 20, tog: 30 }] });
        ctx.observer.seedResource({
            id: 'r1', name: 'Flour', conformsTo: 'flour',
            accountingQuantity: { hasNumericalValue: 25, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 25, hasUnit: 'kg' },
        });

        const sink = createSnapshotSink();
        const resource = ctx.observer.getResource('r1')!;

        sink({ type: 'resource_updated' as const, resource, event: { id: 'e1', action: 'consume' as const, hasPointInTime: '2026-03-22T10:00:00.000Z' } as any, changes: ['onhandQuantity'] }, ctx);
        sink({ type: 'resource_updated' as const, resource, event: { id: 'e2', action: 'consume' as const, hasPointInTime: '2026-03-22T14:00:00.000Z' } as any, changes: ['onhandQuantity'] }, ctx);

        expect(ctx.snapshotStore.forSpec('flour')).toHaveLength(1);
    });
});

// =============================================================================
// EXECUTION ENGINE (integrated)
// =============================================================================

describe('startExecution', () => {
    it('dispatches Observer events to monitors and collects alerts', () => {
        const ctx = makeCtx({ zones: [{ specId: 'steel', tor: 20, toy: 40, tog: 60 }] });
        ctx.observer.seedResource({
            id: 'r1', name: 'Steel', conformsTo: 'steel',
            accountingQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });

        const { alerts, teardown } = startExecution(ctx);

        ctx.observer.record({
            id: nextId(), action: 'consume', provider: 'agent1',
            resourceInventoriedAs: 'r1', resourceConformsTo: 'steel',
            resourceQuantity: { hasNumericalValue: 45, hasUnit: 'kg' },
            hasPointInTime: '2026-03-22T10:00:00.000Z',
        });

        expect(alerts.ofKind('buffer-status').length).toBeGreaterThan(0);
        expect(alerts.ofKind('buffer-status')[0].zone).toBe('red');

        teardown();
    });

    it('forwards alerts to federation emitter', () => {
        const ctx = makeCtx({ zones: [{ specId: 'wheat', tor: 20, toy: 40, tog: 60 }] });
        ctx.observer.seedResource({
            id: 'r1', name: 'Wheat', conformsTo: 'wheat',
            accountingQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });

        const federationAlerts = new AlertStore();
        const { alerts: scopeAlerts, teardown } = startExecution(
            ctx, standardMonitors(), standardSinks(), federationAlerts.emitter(),
        );

        ctx.observer.record({
            id: nextId(), action: 'consume', provider: 'agent1',
            resourceInventoriedAs: 'r1', resourceConformsTo: 'wheat',
            resourceQuantity: { hasNumericalValue: 35, hasUnit: 'kg' },
            hasPointInTime: '2026-03-22T10:00:00.000Z',
        });

        expect(scopeAlerts.length).toBeGreaterThan(0);
        expect(federationAlerts.length).toBeGreaterThan(0);
        expect(federationAlerts.ofKind('buffer-status')[0].specId).toBe('wheat');

        teardown();
    });

    it('accepts custom monitors via composition', () => {
        const ctx = makeCtx({ zones: [{ specId: 'wheat', tor: 20, toy: 40, tog: 60 }] });
        ctx.observer.seedResource({
            id: 'r1', name: 'Wheat', conformsTo: 'wheat',
            accountingQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });

        // Custom monitor that tags everything as lead-time alert
        const customMonitor = () => [{
            kind: 'lead-time' as const,
            orderId: 'custom', specId: 'wheat', dueDate: '2026-04-01',
            daysRemaining: 10, alertZone: 'green' as const,
            timestamp: new Date().toISOString(),
        }];

        const { alerts, teardown } = startExecution(
            ctx, [...standardMonitors(), customMonitor], [],
        );

        ctx.observer.record({
            id: nextId(), action: 'consume', provider: 'agent1',
            resourceInventoriedAs: 'r1', resourceConformsTo: 'wheat',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            hasPointInTime: '2026-03-22T10:00:00.000Z',
        });

        expect(alerts.ofKind('lead-time').length).toBeGreaterThan(0);
        expect(alerts.ofKind('buffer-status').length).toBeGreaterThan(0);

        teardown();
    });

    it('teardown stops all monitoring', () => {
        const ctx = makeCtx({ zones: [{ specId: 'wheat', tor: 20, toy: 40, tog: 60 }] });
        ctx.observer.seedResource({
            id: 'r1', name: 'Wheat', conformsTo: 'wheat',
            accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
        });

        const { alerts, teardown } = startExecution(ctx);
        teardown();

        ctx.observer.record({
            id: nextId(), action: 'consume', provider: 'agent1',
            resourceInventoriedAs: 'r1', resourceConformsTo: 'wheat',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            hasPointInTime: '2026-03-22T10:00:00.000Z',
        });

        expect(alerts.length).toBe(0);
    });
});

// =============================================================================
// ALERT STORE
// =============================================================================

describe('AlertStore', () => {
    it('filters by kind', () => {
        const store = new AlertStore();
        store.push({ kind: 'buffer-status', specId: 'a', zone: 'red', onhand: 5, tor: 20, toy: 40, tog: 60, timestamp: '2026-03-22T10:00:00Z' });
        store.push({ kind: 'lead-time', orderId: 'o1', specId: 'b', dueDate: '2026-04-01', daysRemaining: 3, alertZone: 'red', timestamp: '2026-03-22T10:00:00Z' });

        expect(store.ofKind('buffer-status')).toHaveLength(1);
        expect(store.ofKind('lead-time')).toHaveLength(1);
        expect(store.ofKind('adu-shift')).toHaveLength(0);
    });

    it('filters by spec', () => {
        const store = new AlertStore();
        store.push({ kind: 'buffer-status', specId: 'wheat', zone: 'red', onhand: 5, tor: 20, toy: 40, tog: 60, timestamp: '2026-03-22T10:00:00Z' });
        store.push({ kind: 'buffer-status', specId: 'flour', zone: 'yellow', onhand: 25, tor: 10, toy: 30, tog: 50, timestamp: '2026-03-22T10:00:00Z' });

        expect(store.forSpec('wheat')).toHaveLength(1);
        expect(store.forSpec('nonexistent')).toHaveLength(0);
    });

    it('filters by timestamp', () => {
        const store = new AlertStore();
        store.push({ kind: 'buffer-status', specId: 'a', zone: 'red', onhand: 5, tor: 20, toy: 40, tog: 60, timestamp: '2026-03-20T10:00:00Z' });
        store.push({ kind: 'buffer-status', specId: 'a', zone: 'yellow', onhand: 25, tor: 20, toy: 40, tog: 60, timestamp: '2026-03-22T10:00:00Z' });

        expect(store.since('2026-03-21T00:00:00Z')).toHaveLength(1);
    });

    it('clears all alerts', () => {
        const store = new AlertStore();
        store.push({ kind: 'buffer-status', specId: 'a', zone: 'red', onhand: 5, tor: 20, toy: 40, tog: 60, timestamp: '2026-03-22T10:00:00Z' });
        store.clear();
        expect(store.length).toBe(0);
    });
});
