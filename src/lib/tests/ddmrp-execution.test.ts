import { describe, it, expect, beforeEach } from 'bun:test';
import {
    computeOTIF,
    computeMaterialSyncAlerts,
    computeLeadTimeAlerts,
    computeSignalIntegrity,
    computeExecutionPriority,
    bufferStatus,
    detectADUAlerts,
    projectBufferZones,
    computeTimeBuffer,
    runRecalibrationCycle,
    zoneDistribution,
    zoneTransitions,
    classifyAnalyticsZone,
} from '../algorithms/ddmrp';
import { PlanStore, PLAN_TAGS } from '../planning/planning';
import { Observer } from '../observation/observer';
import { ProcessRegistry } from '../process-registry';
import { BufferZoneStore } from '../knowledge/buffer-zones';
import { RecipeStore } from '../knowledge/recipes';
import type { Commitment, EconomicEvent, BufferZone, BufferProfile, DemandAdjustmentFactor } from '../schemas';

// ─── helpers ──────────────────────────────────────────────────────────────────

let counter = 0;
const genId = () => `id-${++counter}`;

function makeZone(overrides: Partial<BufferZone> = {}): BufferZone {
    return {
        id: 'bz-1',
        specId: 'spec-A',
        profileId: 'prof-1',
        bufferClassification: 'replenished',
        adu: 10,
        aduUnit: 'each',
        dltDays: 10,
        moq: 0,
        moqUnit: 'each',
        tor: 100,
        toy: 200,
        tog: 300,
        lastComputedAt: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

// ─── computeOTIF ─────────────────────────────────────────────────────────────

describe('computeOTIF', () => {
    it('on-time + in-full delivery → otif = true', () => {
        const commitments: Commitment[] = [{
            id: 'c1', action: 'transfer',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-01-15T00:00:00.000Z',
            finished: true,
        }];
        const events: EconomicEvent[] = [{
            id: 'e1', action: 'transfer',
            fulfills: 'c1',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            hasPointInTime: '2026-01-14T00:00:00.000Z',
        }];

        const { results, summary } = computeOTIF(commitments, events);
        expect(results).toHaveLength(1);
        expect(results[0].onTime).toBe(true);
        expect(results[0].inFull).toBe(true);
        expect(results[0].otif).toBe(true);
        expect(results[0].deliveredQty).toBe(100);
        expect(results[0].deliveredDate).toBe('2026-01-14T00:00:00.000Z');
        expect(summary.otifRate).toBe(1);
    });

    it('late delivery → onTime = false', () => {
        const commitments: Commitment[] = [{
            id: 'c1', action: 'transfer',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
            due: '2026-01-10T00:00:00.000Z',
            finished: true,
        }];
        const events: EconomicEvent[] = [{
            id: 'e1', action: 'transfer',
            fulfills: 'c1',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
            hasPointInTime: '2026-01-12T00:00:00.000Z',
        }];

        const { results } = computeOTIF(commitments, events);
        expect(results[0].onTime).toBe(false);
        expect(results[0].inFull).toBe(true);
        expect(results[0].otif).toBe(false);
    });

    it('partial delivery → inFull = false', () => {
        const commitments: Commitment[] = [{
            id: 'c1', action: 'transfer',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-01-15T00:00:00.000Z',
            finished: true,
        }];
        const events: EconomicEvent[] = [{
            id: 'e1', action: 'transfer',
            fulfills: 'c1',
            resourceQuantity: { hasNumericalValue: 60, hasUnit: 'each' },
            hasPointInTime: '2026-01-14T00:00:00.000Z',
        }];

        const { results } = computeOTIF(commitments, events);
        expect(results[0].onTime).toBe(true);
        expect(results[0].inFull).toBe(false);
        expect(results[0].otif).toBe(false);
        expect(results[0].deliveredQty).toBe(60);
    });

    it('no fulfilling events → deliveredQty = 0, otif = false', () => {
        const commitments: Commitment[] = [{
            id: 'c1', action: 'transfer',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-01-15T00:00:00.000Z',
            finished: true,
        }];
        const events: EconomicEvent[] = [];

        const { results } = computeOTIF(commitments, events);
        expect(results).toHaveLength(1);
        expect(results[0].deliveredQty).toBe(0);
        expect(results[0].onTime).toBe(false);
        expect(results[0].inFull).toBe(false);
        expect(results[0].otif).toBe(false);
    });

    it('summary rates computed correctly across mixed results', () => {
        const commitments: Commitment[] = [
            {
                id: 'c1', action: 'transfer',
                resourceConformsTo: 'spec-A',
                resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
                due: '2026-01-15T00:00:00.000Z',
                finished: true,
            },
            {
                id: 'c2', action: 'transfer',
                resourceConformsTo: 'spec-B',
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
                due: '2026-01-20T00:00:00.000Z',
                finished: true,
            },
        ];
        const events: EconomicEvent[] = [
            // c1: on-time, in-full
            {
                id: 'e1', action: 'transfer', fulfills: 'c1',
                resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
                hasPointInTime: '2026-01-14T00:00:00.000Z',
            },
            // c2: late, in-full
            {
                id: 'e2', action: 'transfer', fulfills: 'c2',
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
                hasPointInTime: '2026-01-22T00:00:00.000Z',
            },
        ];

        const { summary } = computeOTIF(commitments, events);
        expect(summary.total).toBe(2);
        expect(summary.onTimeRate).toBe(0.5);
        expect(summary.inFullRate).toBe(1);
        expect(summary.otifRate).toBe(0.5);
    });

    it('skips commitments without due date', () => {
        const commitments: Commitment[] = [{
            id: 'c1', action: 'transfer',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            // no due date
        }];
        const events: EconomicEvent[] = [];

        const { results } = computeOTIF(commitments, events);
        expect(results).toHaveLength(0);
    });

    it('skips unfinished commitments with no fulfilling events', () => {
        const commitments: Commitment[] = [{
            id: 'c1', action: 'transfer',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-01-15T00:00:00.000Z',
            finished: false,
        }];
        const events: EconomicEvent[] = [];

        const { results } = computeOTIF(commitments, events);
        expect(results).toHaveLength(0);
    });
});

// ─── computeMaterialSyncAlerts ───────────────────────────────────────────────

describe('computeMaterialSyncAlerts', () => {
    let registry: ProcessRegistry;
    let observer: Observer;
    let planStore: PlanStore;

    beforeEach(() => {
        counter = 0;
        registry = new ProcessRegistry(genId);
        observer = new Observer(registry, genId);
        planStore = new PlanStore(registry, genId);
    });

    it('non-buffered input with insufficient supply → alert with correct shortage', () => {
        const process = planStore.processes.register({
            id: 'proc-1', name: 'Assembly',
            finished: false,
        });

        // Input commitment: needs 100 units of spec-A
        planStore.addCommitment({
            id: 'c-in-1', action: 'consume',
            inputOf: 'proc-1',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-02-01T00:00:00.000Z',
            finished: false,
        });

        // Seed 30 units on-hand
        observer.seedResource({
            id: 'r1', conformsTo: 'spec-A',
            accountingQuantity: { hasNumericalValue: 30, hasUnit: 'each' },
            onhandQuantity: { hasNumericalValue: 30, hasUnit: 'each' },
        });

        // No buffer zone store → non-buffered
        const alerts = computeMaterialSyncAlerts(planStore, observer);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].specId).toBe('spec-A');
        expect(alerts[0].requiredQty).toBe(100);
        expect(alerts[0].projectedAvailable).toBe(30);
        expect(alerts[0].shortage).toBe(70);
    });

    it('buffered input → no alert (protected by buffer)', () => {
        const process = planStore.processes.register({
            id: 'proc-2', name: 'Assembly',
            finished: false,
        });

        planStore.addCommitment({
            id: 'c-in-2', action: 'consume',
            inputOf: 'proc-2',
            resourceConformsTo: 'spec-B',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-02-01T00:00:00.000Z',
            finished: false,
        });

        // Seed minimal on-hand (less than required)
        observer.seedResource({
            id: 'r2', conformsTo: 'spec-B',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'each' },
            onhandQuantity: { hasNumericalValue: 10, hasUnit: 'each' },
        });

        // spec-B is buffered
        const bufferZoneStore = new BufferZoneStore(genId);
        bufferZoneStore.addBufferZone(makeZone({ specId: 'spec-B' }));

        const alerts = computeMaterialSyncAlerts(planStore, observer, bufferZoneStore);
        expect(alerts).toHaveLength(0);
    });

    it('sufficient supply → no alert', () => {
        const process = planStore.processes.register({
            id: 'proc-3', name: 'Assembly',
            finished: false,
        });

        planStore.addCommitment({
            id: 'c-in-3', action: 'consume',
            inputOf: 'proc-3',
            resourceConformsTo: 'spec-C',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
            due: '2026-02-15T00:00:00.000Z',
            finished: false,
        });

        // On-hand of 60 (more than required 50)
        observer.seedResource({
            id: 'r3', conformsTo: 'spec-C',
            accountingQuantity: { hasNumericalValue: 60, hasUnit: 'each' },
            onhandQuantity: { hasNumericalValue: 60, hasUnit: 'each' },
        });

        const alerts = computeMaterialSyncAlerts(planStore, observer);
        expect(alerts).toHaveLength(0);
    });

    it('skips non-consuming actions (use, work, cite, deliverService)', () => {
        const process = planStore.processes.register({
            id: 'proc-4', name: 'Inspection',
            finished: false,
        });

        planStore.addCommitment({
            id: 'c-use', action: 'use',
            inputOf: 'proc-4',
            resourceConformsTo: 'spec-D',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-02-01T00:00:00.000Z',
            finished: false,
        });

        // No on-hand at all
        const alerts = computeMaterialSyncAlerts(planStore, observer);
        expect(alerts).toHaveLength(0);
    });
});

// ─── computeLeadTimeAlerts ───────────────────────────────────────────────────

describe('computeLeadTimeAlerts', () => {
    const asOf = new Date('2026-01-10T00:00:00Z');

    it('order well before alert horizon → not included', () => {
        // leadTimeDays=30, alertHorizon=10, daysRemaining=20 (way outside horizon)
        const orders = [{
            id: 'o1', specId: 'spec-A',
            dueDate: '2026-01-30T00:00:00.000Z',
            leadTimeDays: 30,
        }];
        const alerts = computeLeadTimeAlerts(orders, asOf);
        expect(alerts).toHaveLength(0);
    });

    it('order in green zone → alertZone = green', () => {
        // leadTimeDays=30, alertHorizon=10, thirdSize~3.33
        // daysRemaining must be between 6.67..10 for green
        // Due Jan 19 → 9 days remaining → green (between 6.67 and 10)
        const orders = [{
            id: 'o1', specId: 'spec-A',
            dueDate: '2026-01-19T00:00:00.000Z',
            leadTimeDays: 30,
        }];
        const alerts = computeLeadTimeAlerts(orders, asOf);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].alertZone).toBe('green');
    });

    it('order in yellow zone → alertZone = yellow', () => {
        // leadTimeDays=30, alertHorizon=10, thirdSize~3.33
        // daysRemaining must be between 3.33..6.67 for yellow
        // Due Jan 15 → 5 days remaining → yellow
        const orders = [{
            id: 'o1', specId: 'spec-A',
            dueDate: '2026-01-15T00:00:00.000Z',
            leadTimeDays: 30,
        }];
        const alerts = computeLeadTimeAlerts(orders, asOf);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].alertZone).toBe('yellow');
    });

    it('order in red zone → alertZone = red', () => {
        // leadTimeDays=30, alertHorizon=10, thirdSize~3.33
        // daysRemaining must be 0..3.33 for red
        // Due Jan 12 → 2 days remaining → red
        const orders = [{
            id: 'o1', specId: 'spec-A',
            dueDate: '2026-01-12T00:00:00.000Z',
            leadTimeDays: 30,
        }];
        const alerts = computeLeadTimeAlerts(orders, asOf);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].alertZone).toBe('red');
    });

    it('past due → alertZone = late', () => {
        const orders = [{
            id: 'o1', specId: 'spec-A',
            dueDate: '2026-01-08T00:00:00.000Z',
            leadTimeDays: 30,
        }];
        const alerts = computeLeadTimeAlerts(orders, asOf);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].alertZone).toBe('late');
        expect(alerts[0].daysRemaining).toBeLessThan(0);
    });
});

// ─── computeSignalIntegrity ──────────────────────────────────────────────────

describe('computeSignalIntegrity', () => {
    let registry: ProcessRegistry;
    let planStore: PlanStore;

    beforeEach(() => {
        counter = 0;
        registry = new ProcessRegistry(genId);
        planStore = new PlanStore(registry, genId);
    });

    it('approved signal: compute timing and qty deltas', () => {
        // Create a commitment that was the approved order
        const commitment = planStore.addCommitment({
            id: 'comm-1', action: 'produce',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 120, hasUnit: 'each' },
            due: '2026-01-17T00:00:00.000Z',
        });

        // Create a replenishment intent with metadata
        const intent = planStore.addIntent({
            action: 'produce',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-01-15T00:00:00.000Z',
            resourceClassifiedAs: [PLAN_TAGS.REPLENISHMENT],
            finished: false,
        });

        planStore.setMeta(intent.id, {
            kind: 'replenishment',
            onhand: 50, onorder: 20, qualifiedDemand: 80, nfp: -10,
            priority: -0.03, zone: 'red',
            recommendedQty: 100, dueDate: '2026-01-15',
            bufferZoneId: 'bz-1', createdAt: '2026-01-01T00:00:00Z',
            status: 'approved',
            approvedCommitmentId: 'comm-1',
        });

        const { records, timingAccuracy, qtyAccuracy } = computeSignalIntegrity(planStore);
        expect(records).toHaveLength(1);
        expect(records[0].status).toBe('approved');
        expect(records[0].recommendedQty).toBe(100);
        expect(records[0].actualQty).toBe(120);
        expect(records[0].qtyDelta).toBe(20); // 120 - 100
        // Timing: 2026-01-17 - 2026-01-15 = 2 days
        expect(records[0].timingDeltaDays).toBe(2);
        // Accuracy metrics should be numbers between 0 and 1
        expect(timingAccuracy).toBeGreaterThanOrEqual(0);
        expect(timingAccuracy).toBeLessThanOrEqual(1);
        expect(qtyAccuracy).toBeGreaterThanOrEqual(0);
        expect(qtyAccuracy).toBeLessThanOrEqual(1);
    });

    it('open signal: status = open, no actual values', () => {
        const intent = planStore.addIntent({
            action: 'produce',
            resourceConformsTo: 'spec-B',
            resourceQuantity: { hasNumericalValue: 80, hasUnit: 'each' },
            due: '2026-02-01T00:00:00.000Z',
            resourceClassifiedAs: [PLAN_TAGS.REPLENISHMENT],
            finished: false,
        });

        planStore.setMeta(intent.id, {
            kind: 'replenishment',
            onhand: 30, onorder: 10, qualifiedDemand: 60, nfp: -20,
            priority: -0.07, zone: 'red',
            recommendedQty: 80, dueDate: '2026-02-01',
            bufferZoneId: 'bz-2', createdAt: '2026-01-15T00:00:00Z',
            status: 'open',
        });

        const { records } = computeSignalIntegrity(planStore);
        expect(records).toHaveLength(1);
        expect(records[0].status).toBe('open');
        expect(records[0].actualDate).toBeUndefined();
        expect(records[0].actualQty).toBeUndefined();
        expect(records[0].timingDeltaDays).toBe(0);
        expect(records[0].qtyDelta).toBe(0);
    });

    it('accuracy metrics computed correctly with multiple signals', () => {
        // Signal 1: approved, exact match
        const c1 = planStore.addCommitment({
            id: 'comm-exact', action: 'produce',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-01-15T00:00:00.000Z',
        });
        const i1 = planStore.addIntent({
            action: 'produce',
            resourceConformsTo: 'spec-A',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'each' },
            due: '2026-01-15T00:00:00.000Z',
            resourceClassifiedAs: [PLAN_TAGS.REPLENISHMENT],
            finished: false,
        });
        planStore.setMeta(i1.id, {
            kind: 'replenishment',
            onhand: 50, onorder: 20, qualifiedDemand: 80, nfp: -10,
            priority: -0.03, zone: 'red',
            recommendedQty: 100, dueDate: '2026-01-15',
            bufferZoneId: 'bz-1', createdAt: '2026-01-01T00:00:00Z',
            status: 'approved', approvedCommitmentId: 'comm-exact',
        });

        // Signal 2: open (should not affect accuracy)
        const i2 = planStore.addIntent({
            action: 'produce',
            resourceConformsTo: 'spec-B',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
            resourceClassifiedAs: [PLAN_TAGS.REPLENISHMENT],
            finished: false,
        });
        planStore.setMeta(i2.id, {
            kind: 'replenishment',
            onhand: 10, onorder: 0, qualifiedDemand: 40, nfp: -30,
            priority: -0.1, zone: 'red',
            recommendedQty: 50, dueDate: '2026-02-01',
            bufferZoneId: 'bz-2', createdAt: '2026-01-20T00:00:00Z',
            status: 'open',
        });

        const { records, timingAccuracy, qtyAccuracy } = computeSignalIntegrity(planStore);
        expect(records).toHaveLength(2);
        // Only signal 1 is approved — exact match → perfect accuracy
        expect(qtyAccuracy).toBe(1); // 0 delta / 100 recommended = 0 error
        expect(timingAccuracy).toBe(1); // 0 delta
    });
});

// ─── computeExecutionPriority ────────────────────────────────────────────────

describe('computeExecutionPriority', () => {
    let registry: ProcessRegistry;
    let observer: Observer;
    let bufferZoneStore: BufferZoneStore;

    beforeEach(() => {
        counter = 0;
        registry = new ProcessRegistry(genId);
        observer = new Observer(registry, genId);
        bufferZoneStore = new BufferZoneStore(genId);
    });

    it('multiple buffers sorted by severity (lowest percentage first)', () => {
        // Buffer A: on-hand 50 / tog 300 = 16.7%
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-A', specId: 'spec-A',
            tor: 100, toy: 200, tog: 300,
        }));
        observer.seedResource({
            id: 'r-A', conformsTo: 'spec-A',
            accountingQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
        });

        // Buffer B: on-hand 250 / tog 300 = 83.3%
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-B', specId: 'spec-B',
            tor: 100, toy: 200, tog: 300,
        }));
        observer.seedResource({
            id: 'r-B', conformsTo: 'spec-B',
            accountingQuantity: { hasNumericalValue: 250, hasUnit: 'each' },
            onhandQuantity: { hasNumericalValue: 250, hasUnit: 'each' },
        });

        // Buffer C: on-hand 150 / tog 300 = 50%
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-C', specId: 'spec-C',
            tor: 100, toy: 200, tog: 300,
        }));
        observer.seedResource({
            id: 'r-C', conformsTo: 'spec-C',
            accountingQuantity: { hasNumericalValue: 150, hasUnit: 'each' },
            onhandQuantity: { hasNumericalValue: 150, hasUnit: 'each' },
        });

        const entries = computeExecutionPriority(bufferZoneStore, observer);
        expect(entries).toHaveLength(3);
        // Sorted by percentage ascending: A (16.7%), C (50%), B (83.3%)
        expect(entries[0].specId).toBe('spec-A');
        expect(entries[1].specId).toBe('spec-C');
        expect(entries[2].specId).toBe('spec-B');
        // Verify percentages
        expect(entries[0].percentage).toBeCloseTo(50 / 300, 5);
        expect(entries[1].percentage).toBeCloseTo(150 / 300, 5);
        expect(entries[2].percentage).toBeCloseTo(250 / 300, 5);
    });

    it('on-hand below TOR → red zone, lowest percentage', () => {
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-red', specId: 'spec-R',
            tor: 100, toy: 200, tog: 300,
        }));
        observer.seedResource({
            id: 'r-R', conformsTo: 'spec-R',
            accountingQuantity: { hasNumericalValue: 40, hasUnit: 'each' },
            onhandQuantity: { hasNumericalValue: 40, hasUnit: 'each' },
        });

        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-green', specId: 'spec-G',
            tor: 100, toy: 200, tog: 300,
        }));
        observer.seedResource({
            id: 'r-G', conformsTo: 'spec-G',
            accountingQuantity: { hasNumericalValue: 220, hasUnit: 'each' },
            onhandQuantity: { hasNumericalValue: 220, hasUnit: 'each' },
        });

        const entries = computeExecutionPriority(bufferZoneStore, observer);
        expect(entries).toHaveLength(2);
        // Red zone item comes first
        expect(entries[0].specId).toBe('spec-R');
        expect(entries[0].zone).toBe('red');
        expect(entries[0].percentage).toBeCloseTo(40 / 300, 5);
        // Green zone item comes second
        expect(entries[1].specId).toBe('spec-G');
        expect(entries[1].zone).toBe('green');
    });

    it('zero on-hand → percentage = 0, red zone', () => {
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-empty', specId: 'spec-E',
            tor: 100, toy: 200, tog: 300,
        }));
        // No resources seeded → on-hand = 0

        const entries = computeExecutionPriority(bufferZoneStore, observer);
        expect(entries).toHaveLength(1);
        expect(entries[0].percentage).toBe(0);
        expect(entries[0].zone).toBe('red');
        expect(entries[0].onhand).toBe(0);
    });
});

// ─── detectADUAlerts ────────────────────────────────────────────────────────

describe('detectADUAlerts', () => {
    let bufferZoneStore: BufferZoneStore;

    beforeEach(() => {
        counter = 0;
        bufferZoneStore = new BufferZoneStore();
    });

    it('surge detection: currentADU > adu × (1 + highPct)', () => {
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-1', specId: 'spec-A',
            adu: 100, aduAlertHighPct: 0.2, aduAlertLowPct: 0.2,
        }));
        const currentADUs = new Map([['spec-A', 130]]);

        const alerts = detectADUAlerts(bufferZoneStore, currentADUs);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].direction).toBe('surge');
        expect(alerts[0].specId).toBe('spec-A');
        expect(alerts[0].previousADU).toBe(100);
        expect(alerts[0].currentADU).toBe(130);
        expect(alerts[0].changePct).toBeCloseTo(0.3, 5);
        expect(alerts[0].thresholdPct).toBe(0.2);
    });

    it('drop detection: currentADU < adu × (1 - lowPct)', () => {
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-1', specId: 'spec-A',
            adu: 100, aduAlertHighPct: 0.2, aduAlertLowPct: 0.2,
        }));
        const currentADUs = new Map([['spec-A', 70]]);

        const alerts = detectADUAlerts(bufferZoneStore, currentADUs);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].direction).toBe('drop');
        expect(alerts[0].specId).toBe('spec-A');
        expect(alerts[0].previousADU).toBe(100);
        expect(alerts[0].currentADU).toBe(70);
        expect(alerts[0].changePct).toBeCloseTo(0.3, 5); // absolute value
        expect(alerts[0].thresholdPct).toBe(0.2);
    });

    it('no alert when within threshold', () => {
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-1', specId: 'spec-A',
            adu: 100, aduAlertHighPct: 0.3, aduAlertLowPct: 0.3,
        }));
        const currentADUs = new Map([['spec-A', 110]]);

        const alerts = detectADUAlerts(bufferZoneStore, currentADUs);
        expect(alerts).toHaveLength(0);
    });

    it('no alert when thresholds not configured', () => {
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-1', specId: 'spec-A',
            adu: 100,
            // no aduAlertHighPct or aduAlertLowPct
        }));
        const currentADUs = new Map([['spec-A', 200]]);

        const alerts = detectADUAlerts(bufferZoneStore, currentADUs);
        expect(alerts).toHaveLength(0);
    });
});

// ─── projectBufferZones ─────────────────────────────────────────────────────

describe('projectBufferZones', () => {
    let bufferZoneStore: BufferZoneStore;

    const baseProfile: BufferProfile = {
        id: 'prof-1',
        name: 'Medium LT / Low Var',
        itemType: 'Purchased',
        leadTimeFactor: 0.5,
        variabilityFactor: 0.5,
        orderCycleDays: 5,
    };

    beforeEach(() => {
        counter = 0;
        bufferZoneStore = new BufferZoneStore();
    });

    it('current vs projected zones with higher ADU → larger zones', () => {
        // adu=10, dltDays=10, LTF=0.5, VF=0.5, orderCycleDays=5, moq=0
        // redBase = 10 * 10 * 0.5 = 50
        // redSafety = 50 * 0.5 = 25
        // tor = 50 + 25 = 75
        // toy = 75 + 10*10 = 175
        // greenBase = max(10*5, 50, 0) = 50
        // tog = 175 + 50 = 225
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-1', specId: 'spec-A', profileId: 'prof-1',
            adu: 10, dltDays: 10, moq: 0, moqUnit: 'each',
            tor: 75, toy: 175, tog: 225,
        }));

        const profiles = new Map([['prof-1', baseProfile]]);
        const projectedADUs = new Map([['spec-A', 20]]);

        const results = projectBufferZones(bufferZoneStore, projectedADUs, profiles);
        expect(results).toHaveLength(1);

        const r = results[0];
        expect(r.specId).toBe('spec-A');
        expect(r.currentADU).toBe(10);
        expect(r.projectedADU).toBe(20);

        // Current zones
        expect(r.current.tor).toBe(75);
        expect(r.current.toy).toBe(175);
        expect(r.current.tog).toBe(225);
        expect(r.current.avgOnHand).toBe(75 + (225 - 175) / 2); // 75 + 25 = 100

        // Projected with adu=20:
        // redBase = 20 * 10 * 0.5 = 100
        // redSafety = 100 * 0.5 = 50
        // tor = 100 + 50 = 150
        // toy = 150 + 20*10 = 350
        // greenBase = max(20*5, 100, 0) = 100
        // tog = 350 + 100 = 450
        expect(r.projected.tor).toBe(150);
        expect(r.projected.toy).toBe(350);
        expect(r.projected.tog).toBe(450);
        expect(r.projected.avgOnHand).toBe(150 + (450 - 350) / 2); // 150 + 50 = 200

        // Projected zones are larger
        expect(r.projected.tog).toBeGreaterThan(r.current.tog);
    });

    it('current vs projected with lower ADU → smaller zones', () => {
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-1', specId: 'spec-A', profileId: 'prof-1',
            adu: 20, dltDays: 10, moq: 0, moqUnit: 'each',
            tor: 150, toy: 350, tog: 450,
        }));

        const profiles = new Map([['prof-1', baseProfile]]);
        const projectedADUs = new Map([['spec-A', 10]]);

        const results = projectBufferZones(bufferZoneStore, projectedADUs, profiles);
        expect(results).toHaveLength(1);

        const r = results[0];
        expect(r.projected.tor).toBe(75);
        expect(r.projected.toy).toBe(175);
        expect(r.projected.tog).toBe(225);

        // Projected zones are smaller
        expect(r.projected.tog).toBeLessThan(r.current.tog);
    });

    it('skips min-max buffers', () => {
        bufferZoneStore.addBufferZone(makeZone({
            id: 'bz-mm', specId: 'spec-MM', profileId: 'prof-1',
            bufferClassification: 'min_max',
            adu: 10, dltDays: 10,
            tor: 75, toy: 75, tog: 150,
        }));

        const profiles = new Map([['prof-1', baseProfile]]);
        const projectedADUs = new Map([['spec-MM', 20]]);

        const results = projectBufferZones(bufferZoneStore, projectedADUs, profiles);
        expect(results).toHaveLength(0);
    });
});

// ─── computeTimeBuffer ──────────────────────────────────────────────────────

describe('computeTimeBuffer', () => {
    it('basic sizing: 10 days × 0.5 variability × 0.5 coverage = 2.5 days', () => {
        const result = computeTimeBuffer(10, 0.5, 0.5);
        expect(result.routingTimeDays).toBe(10);
        expect(result.variabilityFactor).toBe(0.5);
        expect(result.coverageFactor).toBe(0.5);
        expect(result.timeBufferDays).toBe(2.5);
    });

    it('alert horizon is split into 3 equal zones', () => {
        const result = computeTimeBuffer(12, 0.5, 0.5);
        // 12 × 0.5 × 0.5 = 3 days → each zone = 1 day
        expect(result.timeBufferDays).toBe(3);
        expect(result.alertHorizon.greenDays).toBe(1);
        expect(result.alertHorizon.yellowDays).toBe(1);
        expect(result.alertHorizon.redDays).toBe(1);
    });

    it('custom coverage factor', () => {
        const result = computeTimeBuffer(10, 0.6, 0.8);
        // 10 × 0.6 × 0.8 = 4.8 days; each zone = 1.6
        expect(result.timeBufferDays).toBeCloseTo(4.8);
        expect(result.alertHorizon.greenDays).toBeCloseTo(1.6);
        expect(result.alertHorizon.yellowDays).toBeCloseTo(1.6);
        expect(result.alertHorizon.redDays).toBeCloseTo(1.6);
        expect(result.coverageFactor).toBe(0.8);
    });

    it('zero variability produces zero buffer', () => {
        const result = computeTimeBuffer(10, 0, 0.5);
        expect(result.timeBufferDays).toBe(0);
        expect(result.alertHorizon.greenDays).toBe(0);
        expect(result.alertHorizon.yellowDays).toBe(0);
        expect(result.alertHorizon.redDays).toBe(0);
    });

    it('uses default coverageFactor of 0.5 when omitted', () => {
        const result = computeTimeBuffer(10, 0.5);
        // 10 × 0.5 × 0.5 = 2.5
        expect(result.timeBufferDays).toBe(2.5);
        expect(result.coverageFactor).toBe(0.5);
    });
});

// ─── runRecalibrationCycle ──────────────────────────────────────────────────

describe('runRecalibrationCycle', () => {
    const baseProfile: BufferProfile = {
        id: 'prof-1',
        name: 'Standard',
        itemType: 'Purchased',
        leadTimeFactor: 0.5,
        variabilityFactor: 0.5,
        recalculationCadence: 'daily',
    };

    function makeRecalZone(overrides: Partial<BufferZone> = {}): BufferZone {
        return {
            id: 'bz-r1',
            specId: 'spec-R1',
            profileId: 'prof-1',
            bufferClassification: 'replenished',
            adu: 10,
            aduUnit: 'each',
            dltDays: 10,
            moq: 0,
            moqUnit: 'each',
            tor: 100,
            toy: 200,
            tog: 300,
            lastComputedAt: '2026-01-01T00:00:00Z',
            ...overrides,
        };
    }

    it('recalibrates zones that are due (lastComputedAt far in past)', () => {
        const store = new BufferZoneStore(genId);
        const zone = store.addBufferZone(makeRecalZone({
            id: 'bz-due',
            specId: 'spec-DUE',
            lastComputedAt: '2026-01-01T00:00:00Z',
        }));

        const profiles = new Map([['prof-1', baseProfile]]);
        const asOf = new Date('2026-03-20T00:00:00Z'); // well past daily cadence
        const events: EconomicEvent[] = [
            {
                id: 'ev1',
                action: 'consume',
                resourceConformsTo: 'spec-DUE',
                resourceQuantity: { hasNumericalValue: 90, hasUnit: 'each' },
                hasPointInTime: '2026-03-19T00:00:00Z',
            },
        ];

        const recipeStore = new RecipeStore(genId);
        const result = runRecalibrationCycle(store, profiles, events, [], recipeStore, asOf);

        expect(result.recalibrated).toContain('spec-DUE');
        expect(result.skipped).toHaveLength(0);

        // Zone should have updated lastComputedAt
        const updated = store.getBufferZone('bz-due');
        expect(updated).toBeDefined();
        expect(updated!.lastComputedAt).toBe(asOf.toISOString());
    });

    it('skips zones that are not due (lastComputedAt is recent)', () => {
        const store = new BufferZoneStore(genId);
        const asOf = new Date('2026-03-20T12:00:00Z');
        // lastComputedAt is same day → not due for daily cadence
        store.addBufferZone(makeRecalZone({
            id: 'bz-recent',
            specId: 'spec-RECENT',
            lastComputedAt: '2026-03-20T06:00:00Z',
        }));

        const profiles = new Map([['prof-1', baseProfile]]);
        const recipeStore = new RecipeStore(genId);
        const result = runRecalibrationCycle(store, profiles, [], [], recipeStore, asOf);

        expect(result.recalibrated).toHaveLength(0);
        expect(result.skipped).toContain('spec-RECENT');
    });

    it('returns correct recalibrated/skipped lists with mixed zones', () => {
        const store = new BufferZoneStore(genId);
        const asOf = new Date('2026-03-20T00:00:00Z');

        // Due zone (old lastComputedAt)
        store.addBufferZone(makeRecalZone({
            id: 'bz-old',
            specId: 'spec-OLD',
            lastComputedAt: '2026-03-01T00:00:00Z',
        }));

        // Not due zone (recent lastComputedAt)
        store.addBufferZone(makeRecalZone({
            id: 'bz-fresh',
            specId: 'spec-FRESH',
            lastComputedAt: '2026-03-20T00:00:00Z',
        }));

        const profiles = new Map([['prof-1', baseProfile]]);
        const recipeStore = new RecipeStore(genId);
        const result = runRecalibrationCycle(store, profiles, [], [], recipeStore, asOf);

        expect(result.recalibrated).toEqual(['spec-OLD']);
        expect(result.skipped).toEqual(['spec-FRESH']);
    });
});

// ─── zoneDistribution ───────────────────────────────────────────────────────

describe('zoneDistribution', () => {
    it('counts zones correctly', () => {
        const snaps: { zone: 'red' | 'yellow' | 'green' | 'excess' }[] = [
            { zone: 'green' }, { zone: 'green' }, { zone: 'yellow' },
            { zone: 'red' }, { zone: 'green' },
        ];
        const dist = zoneDistribution(snaps);
        expect(dist.green).toBe(3);
        expect(dist.yellow).toBe(1);
        expect(dist.red).toBe(1);
        expect(dist.excess).toBe(0);
        expect(dist.total).toBe(5);
    });
    it('returns zeros for empty array', () => {
        const dist = zoneDistribution([]);
        expect(dist.total).toBe(0);
    });
});

// ─── zoneTransitions ────────────────────────────────────────────────────────

describe('zoneTransitions', () => {
    it('counts zero for stable zone', () => {
        const snaps: { date: string; zone: 'red' | 'yellow' | 'green' | 'excess' }[] = [
            { date: '2026-03-01', zone: 'green' },
            { date: '2026-03-02', zone: 'green' },
            { date: '2026-03-03', zone: 'green' },
        ];
        expect(zoneTransitions(snaps)).toBe(0);
    });
    it('counts transitions correctly', () => {
        const snaps: { date: string; zone: 'red' | 'yellow' | 'green' | 'excess' }[] = [
            { date: '2026-03-01', zone: 'green' },
            { date: '2026-03-02', zone: 'yellow' },
            { date: '2026-03-03', zone: 'red' },
            { date: '2026-03-04', zone: 'red' },
            { date: '2026-03-05', zone: 'green' },
        ];
        expect(zoneTransitions(snaps)).toBe(3); // green→yellow, yellow→red, red→green
    });
});

// ─── classifyAnalyticsZone ──────────────────────────────────────────────────

describe('classifyAnalyticsZone', () => {
    it('classifies all 7 zones', () => {
        // tor=20, toy=50, tog=80
        expect(classifyAnalyticsZone(0, 20, 50, 80)).toBe('dark-red-low');
        expect(classifyAnalyticsZone(5, 20, 50, 80)).toBe('red-low');
        expect(classifyAnalyticsZone(15, 20, 50, 80)).toBe('yellow-low');
        expect(classifyAnalyticsZone(35, 20, 50, 80)).toBe('optimal');
        expect(classifyAnalyticsZone(65, 20, 50, 80)).toBe('yellow-high');
        expect(classifyAnalyticsZone(100, 20, 50, 80)).toBe('red-high');
        expect(classifyAnalyticsZone(150, 20, 50, 80)).toBe('dark-red-high');
    });
});
