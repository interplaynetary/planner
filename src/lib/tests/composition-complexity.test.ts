import { describe, expect, test, beforeEach } from 'bun:test';
import { PlanStore, PLAN_TAGS } from '../planning/planning';
import { PlanNetter } from '../planning/netting';
import { StoreRegistry, qualify } from '../planning/store-registry';
import { ProcessRegistry } from '../process-registry';

// =============================================================================
// HELPERS
// =============================================================================

let idCounter = 0;
function nextId(): string {
    return `test-${++idCounter}`;
}

// =============================================================================
// 1. TAG INDEX
// =============================================================================

describe('PlanStore tag index', () => {
    let ps: PlanStore;

    beforeEach(() => {
        idCounter = 0;
        ps = new PlanStore(new ProcessRegistry(nextId), nextId);
    });

    test('intentsForTag returns same results as brute-force filter', () => {
        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT] });
        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.SURPLUS] });
        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT, PLAN_TAGS.METABOLIC_DEBT] });
        ps.addIntent({ action: 'transfer' }); // no tags

        const deficits = ps.intentsForTag(PLAN_TAGS.DEFICIT);
        expect(deficits).toHaveLength(2);
        expect(deficits.every(i => i.resourceClassifiedAs?.includes(PLAN_TAGS.DEFICIT))).toBe(true);

        const surpluses = ps.intentsForTag(PLAN_TAGS.SURPLUS);
        expect(surpluses).toHaveLength(1);

        const metabolic = ps.intentsForTag(PLAN_TAGS.METABOLIC_DEBT);
        expect(metabolic).toHaveLength(1);
    });

    test('intentsForTag after removeRecords does not return stale entries', () => {
        const i1 = ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT] });
        const i2 = ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT] });

        expect(ps.intentsForTag(PLAN_TAGS.DEFICIT)).toHaveLength(2);

        ps.removeRecords({ intentIds: [i1.id] });
        const remaining = ps.intentsForTag(PLAN_TAGS.DEFICIT);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe(i2.id);
    });

    test('intentsForTag after removeRecordsForPlan does not return stale entries', () => {
        const plan = ps.addPlan({ name: 'test', created: new Date().toISOString() });
        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT], plannedWithin: plan.id });
        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT], plannedWithin: plan.id });
        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT] }); // different plan

        expect(ps.intentsForTag(PLAN_TAGS.DEFICIT)).toHaveLength(3);

        ps.removeRecordsForPlan(plan.id);
        expect(ps.intentsForTag(PLAN_TAGS.DEFICIT)).toHaveLength(1);
    });

    test('merge propagates tag index', () => {
        const sub = new PlanStore(new ProcessRegistry(nextId), nextId);
        sub.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.SURPLUS] });

        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.SURPLUS] });
        ps.merge(sub);

        expect(ps.intentsForTag(PLAN_TAGS.SURPLUS)).toHaveLength(2);
    });
});

// =============================================================================
// 2. SPEC INDEX
// =============================================================================

describe('PlanStore spec index', () => {
    let ps: PlanStore;

    beforeEach(() => {
        idCounter = 0;
        ps = new PlanStore(new ProcessRegistry(nextId), nextId);
    });

    test('intentsForSpec returns only matching intents', () => {
        ps.addIntent({ action: 'transfer', resourceConformsTo: 'spec:wheat' });
        ps.addIntent({ action: 'transfer', resourceConformsTo: 'spec:corn' });
        ps.addIntent({ action: 'transfer', resourceConformsTo: 'spec:wheat' });
        ps.addIntent({ action: 'transfer' }); // no spec

        const wheat = ps.intentsForSpec('spec:wheat');
        expect(wheat).toHaveLength(2);
        expect(wheat.every(i => i.resourceConformsTo === 'spec:wheat')).toBe(true);

        expect(ps.intentsForSpec('spec:corn')).toHaveLength(1);
        expect(ps.intentsForSpec('spec:nonexistent')).toHaveLength(0);
    });

    test('commitmentsForSpec returns only matching commitments', () => {
        ps.addCommitment({ action: 'transfer', provider: 'a', receiver: 'b', resourceConformsTo: 'spec:wheat', finished: false });
        ps.addCommitment({ action: 'transfer', provider: 'a', receiver: 'b', resourceConformsTo: 'spec:corn', finished: false });
        ps.addCommitment({ action: 'transfer', provider: 'a', receiver: 'b', finished: false }); // no spec

        expect(ps.commitmentsForSpec('spec:wheat')).toHaveLength(1);
        expect(ps.commitmentsForSpec('spec:corn')).toHaveLength(1);
        expect(ps.commitmentsForSpec('spec:nonexistent')).toHaveLength(0);
    });

    test('spec index consistency after removeRecords', () => {
        const i1 = ps.addIntent({ action: 'transfer', resourceConformsTo: 'spec:wheat' });
        ps.addIntent({ action: 'transfer', resourceConformsTo: 'spec:wheat' });
        const c1 = ps.addCommitment({ action: 'transfer', provider: 'a', receiver: 'b', resourceConformsTo: 'spec:wheat', finished: false });

        ps.removeRecords({ intentIds: [i1.id], commitmentIds: [c1.id] });

        expect(ps.intentsForSpec('spec:wheat')).toHaveLength(1);
        expect(ps.commitmentsForSpec('spec:wheat')).toHaveLength(0);
    });

    test('merge propagates spec index', () => {
        const sub = new PlanStore(new ProcessRegistry(nextId), nextId);
        sub.addIntent({ action: 'transfer', resourceConformsTo: 'spec:wheat' });
        sub.addCommitment({ action: 'transfer', provider: 'a', receiver: 'b', resourceConformsTo: 'spec:wheat', finished: false });

        ps.addIntent({ action: 'transfer', resourceConformsTo: 'spec:wheat' });
        ps.merge(sub);

        expect(ps.intentsForSpec('spec:wheat')).toHaveLength(2);
        expect(ps.commitmentsForSpec('spec:wheat')).toHaveLength(1);
    });

    test('complexity spot-check: 1000 intents across 10 specs', () => {
        for (let i = 0; i < 1000; i++) {
            ps.addIntent({
                action: 'transfer',
                resourceConformsTo: `spec:${i % 10}`,
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });
        }

        const result = ps.intentsForSpec('spec:0');
        expect(result).toHaveLength(100);
        expect(result.every(i => i.resourceConformsTo === 'spec:0')).toBe(true);

        // Each spec bucket should have ~100
        for (let s = 0; s < 10; s++) {
            expect(ps.intentsForSpec(`spec:${s}`)).toHaveLength(100);
        }
    });
});

// =============================================================================
// 3. LAZY REGISTRY
// =============================================================================

describe('Lazy StoreRegistry', () => {
    let ps: PlanStore;
    let registry: StoreRegistry;

    beforeEach(() => {
        idCounter = 0;
        ps = new PlanStore(new ProcessRegistry(nextId), nextId);
        registry = new StoreRegistry();
    });

    test('resolve returns same results as eager-indexed registry', () => {
        const plan = ps.addPlan({ name: 'test', created: new Date().toISOString() });
        const commitment = ps.addCommitment({
            action: 'transfer', provider: 'a', receiver: 'b', finished: false,
        });
        const intent = ps.addIntent({ action: 'transfer' });

        registry.register('scope1', ps);

        // Resolve each record
        const resolvedPlan = registry.resolve(qualify('scope1', plan.id));
        expect(resolvedPlan.plan).toBeDefined();
        expect(resolvedPlan.plan!.id).toBe(plan.id);

        const resolvedCommitment = registry.resolve(qualify('scope1', commitment.id));
        expect(resolvedCommitment.commitment).toBeDefined();
        expect(resolvedCommitment.commitment!.id).toBe(commitment.id);

        const resolvedIntent = registry.resolve(qualify('scope1', intent.id));
        expect(resolvedIntent.intent).toBeDefined();
        expect(resolvedIntent.intent!.id).toBe(intent.id);
    });

    test('resolve returns empty for nonexistent records', () => {
        registry.register('scope1', ps);
        const result = registry.resolve(qualify('scope1', 'nonexistent'));
        expect(result.plan).toBeUndefined();
        expect(result.commitment).toBeUndefined();
        expect(result.intent).toBeUndefined();
        expect(result.process).toBeUndefined();
    });

    test('resolve returns meta for intent records', () => {
        const intent = ps.addIntent({
            action: 'transfer',
            resourceClassifiedAs: [PLAN_TAGS.DEFICIT],
        });
        ps.setMeta(intent.id, { kind: 'deficit', originalShortfall: 10, resolvedAt: [] });

        registry.register('scope1', ps);

        const resolved = registry.resolve(qualify('scope1', intent.id));
        expect(resolved.intent).toBeDefined();
        expect(resolved.meta).toBeDefined();
        expect(resolved.meta!.kind).toBe('deficit');
    });

    test('resolveLocal falls back to parent scope', () => {
        const parentPs = new PlanStore(new ProcessRegistry(nextId), nextId);
        const parentPlan = parentPs.addPlan({ name: 'parent-plan', created: new Date().toISOString() });

        registry.register('parent', parentPs);
        registry.register('child', ps);

        const parentOf = new Map([['child', 'parent']]);
        const resolved = registry.resolveLocal(ps, parentPlan.id, parentOf);
        expect(resolved.plan).toBeDefined();
        expect(resolved.plan!.id).toBe(parentPlan.id);
    });

    test('intentsForTag delegates to store tag index', () => {
        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT] });
        ps.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.SURPLUS] });

        const ps2 = new PlanStore(new ProcessRegistry(nextId), nextId);
        ps2.addIntent({ action: 'transfer', resourceClassifiedAs: [PLAN_TAGS.DEFICIT] });

        registry.register('scope1', ps);
        registry.register('scope2', ps2);

        const deficits = registry.intentsForTag(PLAN_TAGS.DEFICIT);
        expect(deficits).toHaveLength(2);
        expect(deficits.some(d => d.scopeId === 'scope1')).toBe(true);
        expect(deficits.some(d => d.scopeId === 'scope2')).toBe(true);
    });
});

// =============================================================================
// 4. NETTING USES SPEC INDEX
// =============================================================================

describe('PlanNetter with spec index', () => {
    let ps: PlanStore;

    beforeEach(() => {
        idCounter = 0;
        ps = new PlanStore(new ProcessRegistry(nextId), nextId);
    });

    test('netDemand only absorbs intents for the correct spec', () => {
        const proc = ps.processes.register({ name: 'p', finished: false });
        // Output intent for wheat
        ps.addIntent({
            action: 'produce',
            outputOf: proc.id,
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            finished: false,
        });
        // Output intent for corn — should NOT be absorbed
        ps.addIntent({
            action: 'produce',
            outputOf: proc.id,
            resourceConformsTo: 'spec:corn',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            finished: false,
        });

        const netter = new PlanNetter(ps);
        const result = netter.netDemand('spec:wheat', 30);
        expect(result.remaining).toBe(0); // 30 absorbed from 50 wheat
    });

    test('netAvailableQty uses spec index correctly', () => {
        const proc = ps.processes.register({ name: 'p', finished: false });
        // 50 wheat output
        ps.addIntent({
            action: 'produce',
            outputOf: proc.id,
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            finished: false,
        });
        // 20 wheat consumption
        ps.addIntent({
            action: 'consume',
            inputOf: proc.id,
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 20, hasUnit: 'kg' },
            finished: false,
        });

        const netter = new PlanNetter(ps);
        const avail = netter.netAvailableQty('spec:wheat');
        expect(avail).toBe(30); // 50 - 20
    });
});
