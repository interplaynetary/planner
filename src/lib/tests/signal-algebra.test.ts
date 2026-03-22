import { describe, it, expect } from 'bun:test';
import { nanoid } from 'nanoid';
import { ProcessRegistry } from '../process-registry';
import {
    PlanStore,
    PLAN_TAGS,
    signalToIntent,
    intentToSignal,
    type PlanSignal,
    type DeficitSignal,
    type SurplusSignal,
    type ConservationSignal,
    type ReplenishmentPlanSignal,
} from '../planning/planning';

function makePlanStore(): PlanStore {
    const gen = () => nanoid();
    return new PlanStore(new ProcessRegistry(gen), gen);
}

describe('Signal Algebra', () => {
    describe('emitSignal', () => {
        it('emits a deficit signal with correct tags and fields', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            const signal: DeficitSignal = {
                kind: 'deficit', specId: 'wheat', qty: 10, unit: 'kg',
                originalShortfall: 15, resolvedAt: ['scope-a'],
                due: '2026-04-01', location: 'loc-1', source: 'unmet_demand',
            };
            const intent = ps.emitSignal(signal, plan.id);
            expect(intent.resourceConformsTo).toBe('wheat');
            expect(intent.resourceQuantity?.hasNumericalValue).toBe(10);
            expect(intent.resourceQuantity?.hasUnit).toBe('kg');
            expect(intent.resourceClassifiedAs).toContain(PLAN_TAGS.DEFICIT);
            expect(intent.resourceClassifiedAs).not.toContain(PLAN_TAGS.METABOLIC_DEBT);
            expect(intent.due).toBe('2026-04-01');
            expect(intent.atLocation).toBe('loc-1');
            const meta = ps.getMeta(intent.id);
            expect(meta?.kind).toBe('deficit');
            if (meta?.kind === 'deficit') {
                expect(meta.originalShortfall).toBe(15);
                expect(meta.resolvedAt).toEqual(['scope-a']);
            }
        });

        it('emits a metabolic debt deficit with METABOLIC_DEBT tag', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            const signal: DeficitSignal = {
                kind: 'deficit', specId: 'iron', qty: 5, unit: 'kg',
                originalShortfall: 5, resolvedAt: [],
                source: 'metabolic_debt',
            };
            const intent = ps.emitSignal(signal, plan.id);
            expect(intent.resourceClassifiedAs).toContain(PLAN_TAGS.DEFICIT);
            expect(intent.resourceClassifiedAs).toContain(PLAN_TAGS.METABOLIC_DEBT);
        });

        it('emits a surplus signal with correct tags and fields', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            const signal: SurplusSignal = {
                kind: 'surplus', specId: 'flour', qty: 20, unit: 'kg',
                scope: 'scope-x', availableFrom: '2026-03-20', location: 'loc-2',
            };
            const intent = ps.emitSignal(signal, plan.id);
            expect(intent.resourceConformsTo).toBe('flour');
            expect(intent.resourceQuantity?.hasNumericalValue).toBe(20);
            expect(intent.resourceClassifiedAs).toContain(PLAN_TAGS.SURPLUS);
            expect(intent.provider).toBe('scope-x');
            expect(intent.hasPointInTime).toBe('2026-03-20');
        });

        it('emits a conservation signal with correct tags and meta', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            const signal: ConservationSignal = {
                kind: 'conservation', specId: 'water',
                onhand: 100, tor: 30, toy: 60, tog: 90,
                zone: 'yellow', tippingPointBreached: true,
            };
            const intent = ps.emitSignal(signal, plan.id);
            expect(intent.action).toBe('cite');
            expect(intent.resourceClassifiedAs).toContain(PLAN_TAGS.CONSERVATION);
            const meta = ps.getMeta(intent.id);
            expect(meta?.kind).toBe('conservation');
            if (meta?.kind === 'conservation') {
                expect(meta.onhand).toBe(100);
                expect(meta.zone).toBe('yellow');
                expect(meta.tippingPointBreached).toBe(true);
            }
        });

        it('emits a replenishment signal with correct tags and meta', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            const signal: ReplenishmentPlanSignal = {
                kind: 'replenishment', specId: 'steel', qty: 50, unit: 'ton',
                onhand: 10, onorder: 5, qualifiedDemand: 30, nfp: 15,
                priority: 2, zone: 'red', dueDate: '2026-04-15', bufferZoneId: 'bz-1',
            };
            const intent = ps.emitSignal(signal, plan.id);
            expect(intent.resourceConformsTo).toBe('steel');
            expect(intent.resourceQuantity?.hasNumericalValue).toBe(50);
            expect(intent.resourceClassifiedAs).toContain(PLAN_TAGS.REPLENISHMENT);
            expect(intent.action).toBe('produce');
            const meta = ps.getMeta(intent.id);
            expect(meta?.kind).toBe('replenishment');
            if (meta?.kind === 'replenishment') {
                expect(meta.onhand).toBe(10);
                expect(meta.priority).toBe(2);
                expect(meta.zone).toBe('red');
                expect(meta.bufferZoneId).toBe('bz-1');
            }
        });
    });

    describe('signalsOfKind', () => {
        it('returns typed signals matching emissions', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            ps.emitSignal({ kind: 'deficit', specId: 'a', qty: 1, unit: 'u', originalShortfall: 1, resolvedAt: [] }, plan.id);
            ps.emitSignal({ kind: 'deficit', specId: 'b', qty: 2, unit: 'u', originalShortfall: 2, resolvedAt: [] }, plan.id);
            ps.emitSignal({ kind: 'surplus', specId: 'c', qty: 3, unit: 'u' }, plan.id);

            const deficits = ps.signalsOfKind('deficit');
            expect(deficits).toHaveLength(2);
            expect(deficits[0].kind).toBe('deficit');
            expect(deficits.map(d => d.specId).sort()).toEqual(['a', 'b']);

            const surpluses = ps.signalsOfKind('surplus');
            expect(surpluses).toHaveLength(1);
            expect(surpluses[0].specId).toBe('c');
            expect(surpluses[0].qty).toBe(3);
        });

        it('returns empty array when no signals of that kind', () => {
            const ps = makePlanStore();
            expect(ps.signalsOfKind('conservation')).toHaveLength(0);
        });
    });

    describe('round-trip: emit → query recovers original data', () => {
        it('deficit round-trip', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            const original: DeficitSignal = {
                kind: 'deficit', specId: 'wheat', qty: 10, unit: 'kg',
                originalShortfall: 15, resolvedAt: ['scope-a', 'scope-b'],
                due: '2026-04-01', location: 'loc-1', source: 'metabolic_debt',
            };
            ps.emitSignal(original, plan.id);
            const recovered = ps.signalsOfKind('deficit');
            expect(recovered).toHaveLength(1);
            expect(recovered[0].specId).toBe('wheat');
            expect(recovered[0].qty).toBe(10);
            expect(recovered[0].originalShortfall).toBe(15);
            expect(recovered[0].resolvedAt).toEqual(['scope-a', 'scope-b']);
            expect(recovered[0].source).toBe('metabolic_debt');
        });

        it('conservation round-trip', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            const original: ConservationSignal = {
                kind: 'conservation', specId: 'water',
                onhand: 100, tor: 30, toy: 60, tog: 90,
                zone: 'red', tippingPointBreached: true,
            };
            ps.emitSignal(original, plan.id);
            const recovered = ps.signalsOfKind('conservation');
            expect(recovered).toHaveLength(1);
            expect(recovered[0].onhand).toBe(100);
            expect(recovered[0].tor).toBe(30);
            expect(recovered[0].zone).toBe('red');
            expect(recovered[0].tippingPointBreached).toBe(true);
        });

        it('replenishment round-trip', () => {
            const ps = makePlanStore();
            const plan = ps.addPlan({ name: 'test' });
            const original: ReplenishmentPlanSignal = {
                kind: 'replenishment', specId: 'steel', qty: 50, unit: 'ton',
                onhand: 10, onorder: 5, qualifiedDemand: 30, nfp: 15,
                priority: 2, zone: 'red', dueDate: '2026-04-15', bufferZoneId: 'bz-1',
            };
            ps.emitSignal(original, plan.id);
            const recovered = ps.signalsOfKind('replenishment');
            expect(recovered).toHaveLength(1);
            expect(recovered[0].specId).toBe('steel');
            expect(recovered[0].onhand).toBe(10);
            expect(recovered[0].priority).toBe(2);
            expect(recovered[0].bufferZoneId).toBe('bz-1');
        });
    });

    describe('intentToSignal on non-signal intent', () => {
        it('returns null for a plain intent', () => {
            const ps = makePlanStore();
            const intent = ps.addIntent({
                action: 'produce', resourceConformsTo: 'widget',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'ea' },
                finished: false,
            });
            const result = intentToSignal(intent, ps.getMeta(intent.id));
            expect(result).toBeNull();
        });
    });
});
