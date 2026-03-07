import { describe, it, expect, beforeEach } from 'bun:test';
import {
    computeADU,
    computeBufferZone,
    bufferStatus,
    computeNFP,
    qualifyDemand,
    generateReplenishmentSignal,
    ltmAlertZoneFull,
    projectOnHand,
} from '../algorithms/ddmrp';
import { PlanStore } from '../planning/planning';
import { Observer } from '../observation/observer';
import { ProcessRegistry } from '../process-registry';
import type { BufferZone, BufferProfile, EconomicEvent } from '../schemas';

// ─── helpers ──────────────────────────────────────────────────────────────────

let counter = 0;
const genId = () => `id-${++counter}`;

function makeProfile(overrides: Partial<BufferProfile> = {}): BufferProfile {
    return {
        id: 'prof-1',
        name: 'Test',
        itemType: 'Manufactured',
        leadTimeFactor: 1.0,
        variabilityFactor: 0.5,
        ...overrides,
    };
}

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

// ─── computeADU ───────────────────────────────────────────────────────────────

describe('computeADU', () => {
    const SPEC = 'spec-A';
    const asOf = new Date('2026-01-10T00:00:00Z');

    it('rolling window: sums only events within the window', () => {
        const events: EconomicEvent[] = [
            {
                id: 'e1',
                action: 'consume',
                resourceConformsTo: SPEC,
                resourceQuantity: { hasNumericalValue: 60, hasUnit: 'each' },
                hasPointInTime: '2026-01-05T00:00:00Z',  // inside 10-day window
            },
            {
                id: 'e2',
                action: 'consume',
                resourceConformsTo: SPEC,
                resourceQuantity: { hasNumericalValue: 40, hasUnit: 'each' },
                hasPointInTime: '2026-01-08T00:00:00Z',  // inside window
            },
            {
                id: 'e3',
                action: 'consume',
                resourceConformsTo: SPEC,
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
                hasPointInTime: '2025-12-20T00:00:00Z',  // outside 10-day window
            },
        ];

        const result = computeADU(events, SPEC, 10, asOf);
        expect(result.adu).toBe(10);          // 100 / 10
        expect(result.windowDays).toBe(10);
        expect(result.sampleCount).toBe(2);   // 2 days with activity
        expect(result.computedFrom).toBe('2026-01-05');
    });

    it('zero-consumption days are counted in the denominator (ADU not inflated)', () => {
        // 1 event in a 30-day window → ADU = qty/30, NOT qty/1
        const events: EconomicEvent[] = [
            {
                id: 'e1',
                action: 'consume',
                resourceConformsTo: SPEC,
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'each' },
                hasPointInTime: '2026-01-07T00:00:00Z',
            },
        ];
        const result = computeADU(events, SPEC, 30, asOf);
        expect(result.adu).toBe(1);      // 30 / 30
        expect(result.sampleCount).toBe(1);
    });

    it('action filtering: non-decrement actions (produce) are excluded', () => {
        const events: EconomicEvent[] = [
            {
                id: 'e-prod',
                action: 'produce',                          // onhandEffect = increment → excluded
                resourceConformsTo: SPEC,
                resourceQuantity: { hasNumericalValue: 999, hasUnit: 'each' },
                hasPointInTime: '2026-01-05T00:00:00Z',
            },
            {
                id: 'e-cons',
                action: 'consume',
                resourceConformsTo: SPEC,
                resourceQuantity: { hasNumericalValue: 20, hasUnit: 'each' },
                hasPointInTime: '2026-01-06T00:00:00Z',
            },
        ];
        const result = computeADU(events, SPEC, 10, asOf);
        expect(result.adu).toBe(2);   // 20 / 10; produce event ignored
        expect(result.sampleCount).toBe(1);
    });

    it('returns zero ADU for empty event list', () => {
        const result = computeADU([], SPEC, 10, asOf);
        expect(result.adu).toBe(0);
        expect(result.sampleCount).toBe(0);
    });
});

// ─── computeBufferZone ────────────────────────────────────────────────────────

describe('computeBufferZone', () => {
    it('TOR / TOY / TOG formula (no MOQ, with orderCycleDays)', () => {
        const profile = makeProfile({ leadTimeFactor: 1.0, variabilityFactor: 0.5, orderCycleDays: 7 });
        // adu=10, dlt=10
        // redBase   = 10 * 10 * 1.0 = 100
        // redSafety = 100 * 0.5     = 50
        // tor       = 150 * 1       = 150
        // toy       = 150 + 100     = 250
        // green     = max(70, 100, 0) = 100  (redBase wins)
        // tog       = 250 + 100     = 350
        const result = computeBufferZone(profile, 10, 'each', 10, 0, 'each');
        expect(result.redBase).toBe(100);
        expect(result.redSafety).toBe(50);
        expect(result.tor).toBe(150);
        expect(result.toy).toBe(250);
        expect(result.tog).toBe(350);
    });

    it('MOQ rounding: MOQ dominates green zone when largest', () => {
        const profile = makeProfile({ leadTimeFactor: 1.0, variabilityFactor: 0.5, orderCycleDays: 7 });
        // moq=120 > max(70, 100) → green=120
        const result = computeBufferZone(profile, 10, 'each', 10, 120, 'each');
        expect(result.tog).toBe(250 + 120);   // = 370
    });

    it('orderCycleDays dominates green zone when largest', () => {
        const profile = makeProfile({ leadTimeFactor: 1.0, variabilityFactor: 0.5, orderCycleDays: 20 });
        // adu=10, cycle=20 → adu*cycle=200 > redBase(100) > moq(0)
        const result = computeBufferZone(profile, 10, 'each', 10, 0, 'each');
        expect(result.tog).toBe(250 + 200);   // = 450
    });

    it('demandAdjFactor scales effective ADU', () => {
        const profile = makeProfile({ leadTimeFactor: 1.0, variabilityFactor: 0 });
        // effectiveADU = 10 * 2 = 20, dlt=5
        // redBase = 20*5*1 = 100, tor=100, toy=100+100=200
        const result = computeBufferZone(profile, 10, 'each', 5, 0, 'each', { demandAdjFactor: 2 });
        expect(result.effectiveADU).toBe(20);
        expect(result.tor).toBe(100);
        expect(result.toy).toBe(200);
    });
});

// ─── bufferStatus ─────────────────────────────────────────────────────────────

describe('bufferStatus', () => {
    const bz = makeZone({ tor: 100, toy: 200, tog: 300 });

    it('pct=0 → red zone', () => {
        const r = bufferStatus(0, bz);
        expect(r.zone).toBe('red');
        expect(r.pct).toBe(0);
    });

    it('onhand = tor → red zone boundary', () => {
        const r = bufferStatus(100, bz);
        expect(r.zone).toBe('red');
        expect(r.redPct).toBe(100);
    });

    it('onhand just above tor → yellow zone', () => {
        const r = bufferStatus(101, bz);
        expect(r.zone).toBe('yellow');
    });

    it('onhand = toy → yellow zone boundary', () => {
        const r = bufferStatus(200, bz);
        expect(r.zone).toBe('yellow');
    });

    it('onhand just above toy → green zone', () => {
        const r = bufferStatus(201, bz);
        expect(r.zone).toBe('green');
    });

    it('onhand = tog → green zone boundary (pct=100)', () => {
        const r = bufferStatus(300, bz);
        expect(r.zone).toBe('green');
        expect(r.pct).toBeCloseTo(100, 1);
    });

    it('onhand = 2×tog → excess zone (pct=200)', () => {
        const r = bufferStatus(600, bz);
        expect(r.zone).toBe('excess');
        expect(r.pct).toBeCloseTo(200, 1);
    });
});

// ─── computeNFP ───────────────────────────────────────────────────────────────

describe('computeNFP', () => {
    let planStore: PlanStore;
    let observer: Observer;
    const SPEC = 'spec-A';
    const today = new Date('2026-01-01T00:00:00Z');
    const profile = makeProfile();

    beforeEach(() => {
        counter = 0;
        observer = new Observer();
        planStore = new PlanStore(new ProcessRegistry(), genId);
    });

    function setOnHand(qty: number) {
        observer.record({
            id: genId(),
            action: 'produce',
            resourceInventoriedAs: 'res-A',
            resourceConformsTo: SPEC,
            resourceQuantity: { hasNumericalValue: qty, hasUnit: 'each' },
            outputOf: 'proc-1',
        });
    }

    it('zone=red when NFP ≤ TOR', () => {
        const bz = makeZone({ tor: 100, toy: 200, tog: 300, adu: 0, ostHorizonDays: 1 });
        setOnHand(50);
        const r = computeNFP(SPEC, bz, profile, planStore, observer, today);
        expect(r.zone).toBe('red');
        expect(r.onhand).toBe(50);
        expect(r.nfp).toBe(50);
    });

    it('zone=yellow when TOR < NFP ≤ TOY', () => {
        const bz = makeZone({ tor: 100, toy: 200, tog: 300, adu: 0, ostHorizonDays: 1 });
        setOnHand(150);
        const r = computeNFP(SPEC, bz, profile, planStore, observer, today);
        expect(r.zone).toBe('yellow');
    });

    it('zone=green when TOY < NFP ≤ TOG', () => {
        const bz = makeZone({ tor: 100, toy: 200, tog: 300, adu: 0, ostHorizonDays: 1 });
        setOnHand(250);
        const r = computeNFP(SPEC, bz, profile, planStore, observer, today);
        expect(r.zone).toBe('green');
    });

    it('zone=excess when NFP > TOG', () => {
        const bz = makeZone({ tor: 100, toy: 200, tog: 300, adu: 0, ostHorizonDays: 1 });
        setOnHand(400);
        const r = computeNFP(SPEC, bz, profile, planStore, observer, today);
        expect(r.zone).toBe('excess');
    });

    it('onorder supply commitments add to NFP', () => {
        const bz = makeZone({ tor: 100, toy: 200, tog: 300, adu: 0, ostHorizonDays: 1 });
        setOnHand(50);
        // Supply commitment: outputOf set → onorder
        planStore.addCommitment({
            action: 'produce',
            resourceConformsTo: SPEC,
            outputOf: 'proc-1',
            finished: false,
            resourceQuantity: { hasNumericalValue: 80, hasUnit: 'each' },
        });
        const r = computeNFP(SPEC, bz, profile, planStore, observer, today);
        // nfp = 50 + 80 - 0 = 130  → yellow (> tor=100, ≤ toy=200)
        expect(r.onorder).toBe(80);
        expect(r.nfp).toBe(130);
        expect(r.zone).toBe('yellow');
    });

    it('priority = nfp / tog', () => {
        const bz = makeZone({ tor: 100, toy: 200, tog: 400, adu: 0, ostHorizonDays: 1 });
        setOnHand(200);
        const r = computeNFP(SPEC, bz, profile, planStore, observer, today);
        expect(r.priority).toBeCloseTo(0.5, 5);
    });
});

// ─── qualifyDemand ────────────────────────────────────────────────────────────

describe('qualifyDemand', () => {
    let planStore: PlanStore;
    const SPEC = 'spec-Q';
    const today = new Date('2026-01-01T00:00:00Z');

    beforeEach(() => {
        counter = 0;
        planStore = new PlanStore(new ProcessRegistry(), genId);
    });

    it('excludes demand beyond OST horizon', () => {
        const bz = makeZone({ specId: SPEC, adu: 10, ostHorizonDays: 5 });
        const profile = makeProfile();

        // Within horizon (today+2):
        planStore.addCommitment({
            action: 'consume', inputOf: 'p-1', resourceConformsTo: SPEC, finished: false,
            due: '2026-01-03T00:00:00Z',
            resourceQuantity: { hasNumericalValue: 30, hasUnit: 'each' },
        });
        // Beyond horizon (today+10):
        planStore.addCommitment({
            action: 'consume', inputOf: 'p-1', resourceConformsTo: SPEC, finished: false,
            due: '2026-01-11T00:00:00Z',
            resourceQuantity: { hasNumericalValue: 999, hasUnit: 'each' },
        });

        const qd = qualifyDemand(SPEC, today, bz, profile, planStore);
        expect(qd).toBe(30);   // only the first commitment qualifies
    });

    it('excludes spike orders when ostMultiplier is set', () => {
        // adu=10, ostMultiplier=2 → threshold=20; qty=25 is a spike
        const bz = makeZone({ specId: SPEC, adu: 10, ostHorizonDays: 30 });
        const profile = makeProfile({ ostMultiplier: 2 });

        planStore.addCommitment({
            action: 'consume', inputOf: 'p-1', resourceConformsTo: SPEC, finished: false,
            due: '2026-01-05T00:00:00Z',
            resourceQuantity: { hasNumericalValue: 15, hasUnit: 'each' },  // ≤ 20: qualifies
        });
        planStore.addCommitment({
            action: 'consume', inputOf: 'p-1', resourceConformsTo: SPEC, finished: false,
            due: '2026-01-05T00:00:00Z',
            resourceQuantity: { hasNumericalValue: 25, hasUnit: 'each' },  // > 20: spike
        });

        const qd = qualifyDemand(SPEC, today, bz, profile, planStore);
        expect(qd).toBe(15);
    });

    it('finished commitments are excluded', () => {
        const bz = makeZone({ specId: SPEC, adu: 0, ostHorizonDays: 30 });
        const profile = makeProfile();

        planStore.addCommitment({
            action: 'consume', inputOf: 'p-1', resourceConformsTo: SPEC, finished: true,
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
        });
        const qd = qualifyDemand(SPEC, today, bz, profile, planStore);
        expect(qd).toBe(0);
    });
});

// ─── generateReplenishmentSignal ──────────────────────────────────────────────

describe('generateReplenishmentSignal', () => {
    const today = new Date('2026-01-01T00:00:00Z');

    function makeNFP(nfpVal: number, tog: number) {
        return {
            onhand: nfpVal,
            onorder: 0,
            qualifiedDemand: 0,
            nfp: nfpVal,
            zone: nfpVal <= tog / 3 ? 'red' : nfpVal <= (2 * tog) / 3 ? 'yellow' : 'green',
            priority: nfpVal / tog,
        } as const;
    }

    it('MOQ rounding: rounds up to nearest MOQ multiple', () => {
        const bz = makeZone({ tog: 300, moq: 50, dltDays: 5 });
        // raw = 300 - 100 = 200, ceil(200/50)*50 = 200
        const sig = generateReplenishmentSignal('spec-A', undefined, bz, makeNFP(100, 300), today, genId);
        expect(sig.recommendedQty).toBe(200);
    });

    it('MOQ rounding: partial multiple rounds up', () => {
        const bz = makeZone({ tog: 300, moq: 50, dltDays: 5 });
        // raw = 300 - 110 = 190, ceil(190/50)*50 = 200
        const sig = generateReplenishmentSignal('spec-A', undefined, bz, makeNFP(110, 300), today, genId);
        expect(sig.recommendedQty).toBe(200);
    });

    it('zero-excess guard: when NFP > TOG, recommendedQty = MOQ', () => {
        const bz = makeZone({ tog: 300, moq: 50, dltDays: 5 });
        // raw = 300 - 350 = -50 ≤ 0 → MOQ
        const sig = generateReplenishmentSignal('spec-A', undefined, bz, makeNFP(350, 300), today, genId);
        expect(sig.recommendedQty).toBe(50);
    });

    it('dueDate = today + dltDays', () => {
        const bz = makeZone({ tog: 300, moq: 1, dltDays: 7 });
        const sig = generateReplenishmentSignal('spec-A', undefined, bz, makeNFP(100, 300), today, genId);
        expect(sig.dueDate).toBe('2026-01-08');  // 2026-01-01 + 7 days
    });

    it('status is open, specId and bufferZoneId are set', () => {
        const bz = makeZone({ id: 'bz-test', specId: 'spec-X', tog: 100, moq: 10, dltDays: 3 });
        const sig = generateReplenishmentSignal('spec-X', undefined, bz, makeNFP(50, 100), today, genId);
        expect(sig.status).toBe('open');
        expect(sig.specId).toBe('spec-X');
        expect(sig.bufferZoneId).toBe('bz-test');
    });
});

// ─── ltmAlertZoneFull ─────────────────────────────────────────────────────────

describe('ltmAlertZoneFull', () => {
    // dltDays=12 → alertHorizon=4 → third≈1.333
    const dltDays = 12;
    const today = new Date('2026-01-01T00:00:00Z');

    function commitment(due: string | undefined) {
        return { id: 'c-1', action: 'produce' as const, finished: false, due };
    }

    it('returns null when commitment has no due date', () => {
        expect(ltmAlertZoneFull(commitment(undefined), dltDays, today)).toBeNull();
    });

    it('early: daysRemaining > alertHorizon (4)', () => {
        // today+5 → 5 > 4 → early
        expect(ltmAlertZoneFull(commitment('2026-01-06T00:00:00Z'), dltDays, today)).toBe('early');
    });

    it('green: daysRemaining in first third of alert horizon', () => {
        // today+3 → 3 > 2.667 (=1.333*2) → green
        expect(ltmAlertZoneFull(commitment('2026-01-04T00:00:00Z'), dltDays, today)).toBe('green');
    });

    it('yellow: daysRemaining in second third of alert horizon', () => {
        // today+2 → 2 > 1.333 but 2 ≤ 2.667 → yellow
        expect(ltmAlertZoneFull(commitment('2026-01-03T00:00:00Z'), dltDays, today)).toBe('yellow');
    });

    it('red: daysRemaining in final third of alert horizon', () => {
        // today+1 → 1 ≤ 1.333 → red
        expect(ltmAlertZoneFull(commitment('2026-01-02T00:00:00Z'), dltDays, today)).toBe('red');
    });

    it('late: daysRemaining < 0 (past due)', () => {
        // yesterday → -1 < 0 → late
        expect(ltmAlertZoneFull(commitment('2025-12-31T00:00:00Z'), dltDays, today)).toBe('late');
    });
});

// ─── projectOnHand ────────────────────────────────────────────────────────────

describe('projectOnHand', () => {
    let planStore: PlanStore;
    let observer: Observer;
    const SPEC = 'spec-P';
    const today = new Date('2026-01-01T00:00:00Z');

    beforeEach(() => {
        counter = 0;
        observer = new Observer();
        planStore = new PlanStore(new ProcessRegistry(), genId);
    });

    function setOnHand(qty: number) {
        observer.record({
            id: genId(),
            action: 'produce',
            resourceInventoriedAs: 'res-P',
            resourceConformsTo: SPEC,
            resourceQuantity: { hasNumericalValue: qty, hasUnit: 'each' },
            outputOf: 'proc-1',
        });
    }

    it('multi-day projection with supply and demand', () => {
        // dltDays=3 → projects days +1, +2, +3
        const bz = makeZone({ specId: SPEC, dltDays: 3, tor: 50, toy: 100, tog: 200 });
        setOnHand(100);

        // Day +1: supply=50, demand=30 → OH = 100+50-30 = 120 (green)
        planStore.addCommitment({
            action: 'produce', outputOf: 'proc-1', resourceConformsTo: SPEC, finished: false,
            due: '2026-01-02T00:00:00Z',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
        });
        planStore.addCommitment({
            action: 'consume', inputOf: 'proc-1', resourceConformsTo: SPEC, finished: false,
            due: '2026-01-02T00:00:00Z',
            resourceQuantity: { hasNumericalValue: 30, hasUnit: 'each' },
        });

        const proj = projectOnHand(SPEC, bz, today, planStore, observer);
        expect(proj).toHaveLength(3);
        expect(proj[0].date).toBe('2026-01-02');
        expect(proj[0].receipts).toBe(50);
        expect(proj[0].demand).toBe(30);
        expect(proj[0].projectedOnHand).toBe(120);
        expect(proj[0].zone).toBe('green');

        // Subsequent days: no flows → OH stays at 120
        expect(proj[1].projectedOnHand).toBe(120);
        expect(proj[2].projectedOnHand).toBe(120);
    });

    it('stockout detection when projected OH goes negative', () => {
        const bz = makeZone({ specId: SPEC, dltDays: 2, tor: 50, toy: 100, tog: 200 });
        setOnHand(10);

        // Day +1: large demand → stockout
        planStore.addCommitment({
            action: 'consume', inputOf: 'proc-1', resourceConformsTo: SPEC, finished: false,
            due: '2026-01-02T00:00:00Z',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'each' },
        });

        const proj = projectOnHand(SPEC, bz, today, planStore, observer);
        expect(proj[0].projectedOnHand).toBe(-40);
        expect(proj[0].zone).toBe('stockout');
    });

    it('returns dltDays entries', () => {
        const bz = makeZone({ specId: SPEC, dltDays: 5, tor: 50, toy: 100, tog: 200 });
        setOnHand(150);
        const proj = projectOnHand(SPEC, bz, today, planStore, observer);
        expect(proj).toHaveLength(5);
    });
});
