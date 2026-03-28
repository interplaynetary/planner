/**
 * Labor-as-Resource — tests for capability/capacity separation.
 *
 * Core design:
 *   - Capacity: ONE resource per agent (total available hours), identified by unitOfEffort
 *   - Capability: skills are separate resources (via skillsOf/agentsWithSkill)
 *   - Action type 'work' is the discriminator at the planning layer
 *   - No tags, no guards — VF action semantics do the work
 *
 * Invariants:
 *   1. Over-offering is allowed (expressing willingness to multiple scopes)
 *   2. Overcommitment is structurally impossible (ATP gate on promoteToCommitment)
 *   3. Capacity resources are excluded from material inventory queries
 */

import { expect, test, describe } from 'bun:test';
import { Observer } from '../observation/observer';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';

describe('Capacity/Capability Separation', () => {
    // ─── Seeding & Queries ───────────────────────────────────────────────

    test('seedCapacityResource creates a capacity resource with correct fields', () => {
        const obs = new Observer();
        const res = obs.seedCapacityResource({
            agentId: 'alice',
            hoursAvailable: 40,
        });

        expect(res.id).toBe('capacity:alice');
        expect(res.conformsTo).toBe('spec:agent-capacity');
        expect(res.primaryAccountable).toBe('alice');
        expect(res.unitOfEffort).toBe('hours');
        expect(res.accountingQuantity?.hasNumericalValue).toBe(40);
        expect(res.onhandQuantity?.hasNumericalValue).toBe(40);
        // No classifiedAs tag — unitOfEffort is the structural discriminator
        expect(res.classifiedAs).toBeUndefined();
    });

    test('seedCapacityResource is retrievable via getResource', () => {
        const obs = new Observer();
        obs.seedCapacityResource({ agentId: 'bob', hoursAvailable: 30 });

        const res = obs.getResource('capacity:bob');
        expect(res).toBeDefined();
        expect(res!.primaryAccountable).toBe('bob');
        expect(res!.unitOfEffort).toBe('hours');
    });

    test('capacityResourceForAgent returns the single capacity resource', () => {
        const obs = new Observer();
        obs.seedCapacityResource({ agentId: 'alice', hoursAvailable: 40 });

        // Seed a non-capacity resource for alice (a skill)
        obs.seedResource({
            id: 'skill:alice:welding',
            conformsTo: 'spec:welding-certified',
            primaryAccountable: 'alice',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'certification' },
            onhandQuantity: { hasNumericalValue: 1, hasUnit: 'certification' },
        });

        const cap = obs.capacityResourceForAgent('alice');
        expect(cap).toBeDefined();
        expect(cap!.id).toBe('capacity:alice');
        expect(cap!.unitOfEffort).toBe('hours');

        // Bob has no capacity resource
        expect(obs.capacityResourceForAgent('bob')).toBeUndefined();
    });

    test('skillsOf excludes capacity resources', () => {
        const obs = new Observer();
        obs.seedCapacityResource({ agentId: 'alice', hoursAvailable: 40 });
        obs.seedResource({
            id: 'skill:alice:welding',
            conformsTo: 'spec:welding-certified',
            primaryAccountable: 'alice',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'certification' },
            onhandQuantity: { hasNumericalValue: 1, hasUnit: 'certification' },
        });

        const skills = obs.skillsOf('alice');
        expect(skills).toHaveLength(1);
        expect(skills[0].id).toBe('skill:alice:welding');
        // Capacity resource should NOT appear in skillsOf
        expect(skills.every(r => !r.unitOfEffort)).toBe(true);
    });

    // ─── Work events don't change capacity ──────────────────────────────

    test('work events do not change onhandQuantity (non-consuming)', () => {
        const obs = new Observer();
        obs.seedCapacityResource({ agentId: 'alice', hoursAvailable: 40 });

        const proc = obs.registerProcess({ name: 'welding-job' });
        obs.record({
            id: 'evt-work-1',
            action: 'work',
            resourceInventoriedAs: 'capacity:alice',
            provider: 'alice',
            inputOf: proc.id,
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        });

        const res = obs.getResource('capacity:alice');
        expect(res!.onhandQuantity?.hasNumericalValue).toBe(40);
    });

    test('work events do not change primaryAccountable (noEffect)', () => {
        const obs = new Observer();
        obs.seedCapacityResource({ agentId: 'alice', hoursAvailable: 40 });

        const proc = obs.registerProcess({ name: 'welding-job' });
        obs.record({
            id: 'evt-work-2',
            action: 'work',
            resourceInventoriedAs: 'capacity:alice',
            provider: 'alice',
            receiver: 'scope-A',
            inputOf: proc.id,
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        });

        const res = obs.getResource('capacity:alice');
        expect(res!.primaryAccountable).toBe('alice');
    });

    // ─── Over-offering (allowed) ────────────────────────────────────────

    test('over-offering is allowed — total offers can exceed capacity', () => {
        const registry = new ProcessRegistry();
        let idCount = 0;
        const ps = new PlanStore(registry, () => `id_${idCount++}`);
        const plan = ps.addPlan({ name: 'test-plan' });

        // Alice has 40 hrs but offers 30 + 20 + 10 = 60 total
        const offer1 = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 30, hasUnit: 'hours' },
            inScopeOf: ['scope-A'], plannedWithin: plan.id, finished: false,
        });
        const offer2 = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 20, hasUnit: 'hours' },
            inScopeOf: ['scope-B'], plannedWithin: plan.id, finished: false,
        });
        const offer3 = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 10, hasUnit: 'hours' },
            inScopeOf: ['scope-C'], plannedWithin: plan.id, finished: false,
        });

        expect(offer1.id).toBeDefined();
        expect(offer2.id).toBeDefined();
        expect(offer3.id).toBeDefined();
    });

    // ─── ATP gate (overcommitment prevented) ────────────────────────────

    test('promoteToCommitment succeeds when within capacity', () => {
        const obs = new Observer();
        obs.seedCapacityResource({ agentId: 'alice', hoursAvailable: 40 });

        const registry = new ProcessRegistry();
        let idCount = 0;
        const ps = new PlanStore(registry, () => `id_${idCount++}`);
        const plan = ps.addPlan({ name: 'test-plan' });

        const intent = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 20, hasUnit: 'hours' },
            plannedWithin: plan.id, finished: false,
        });

        const commitment = ps.promoteToCommitment(intent.id, { receiver: 'scope-A' }, obs);
        expect(commitment.action).toBe('work');
        expect(commitment.effortQuantity?.hasNumericalValue).toBe(20);
    });

    test('promoteToCommitment fails when it would exceed capacity', () => {
        const obs = new Observer();
        obs.seedCapacityResource({ agentId: 'alice', hoursAvailable: 40 });

        const registry = new ProcessRegistry();
        let idCount = 0;
        const ps = new PlanStore(registry, () => `id_${idCount++}`);
        const plan = ps.addPlan({ name: 'test-plan' });

        const i1 = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 30, hasUnit: 'hours' },
            plannedWithin: plan.id, finished: false,
        });
        ps.promoteToCommitment(i1.id, { receiver: 'scope-A' }, obs);

        const i2 = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 15, hasUnit: 'hours' },
            plannedWithin: plan.id, finished: false,
        });

        expect(() => {
            ps.promoteToCommitment(i2.id, { receiver: 'scope-B' }, obs);
        }).toThrow(/Capacity overcommitment/);
    });

    test('ATP gate allows commitment up to exact capacity', () => {
        const obs = new Observer();
        obs.seedCapacityResource({ agentId: 'alice', hoursAvailable: 40 });

        const registry = new ProcessRegistry();
        let idCount = 0;
        const ps = new PlanStore(registry, () => `id_${idCount++}`);
        const plan = ps.addPlan({ name: 'test-plan' });

        const i1 = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 25, hasUnit: 'hours' },
            plannedWithin: plan.id, finished: false,
        });
        ps.promoteToCommitment(i1.id, { receiver: 'scope-A' }, obs);

        // 25 + 15 = 40 = capacity → should succeed
        const i2 = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 15, hasUnit: 'hours' },
            plannedWithin: plan.id, finished: false,
        });
        const c2 = ps.promoteToCommitment(i2.id, { receiver: 'scope-B' }, obs);
        expect(c2.effortQuantity?.hasNumericalValue).toBe(15);

        // 40 + 1 = 41 > 40 → should fail
        const i3 = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 1, hasUnit: 'hours' },
            plannedWithin: plan.id, finished: false,
        });
        expect(() => {
            ps.promoteToCommitment(i3.id, { receiver: 'scope-C' }, obs);
        }).toThrow(/Capacity overcommitment/);
    });

    test('promoteToCommitment without observer skips ATP gate (backward compatible)', () => {
        const registry = new ProcessRegistry();
        let idCount = 0;
        const ps = new PlanStore(registry, () => `id_${idCount++}`);
        const plan = ps.addPlan({ name: 'test-plan' });

        const intent = ps.addIntent({
            action: 'work', provider: 'alice',
            resourceInventoriedAs: 'capacity:alice',
            effortQuantity: { hasNumericalValue: 999, hasUnit: 'hours' },
            plannedWithin: plan.id, finished: false,
        });

        const c = ps.promoteToCommitment(intent.id, { receiver: 'scope-A' });
        expect(c.action).toBe('work');
    });

    test('ATP gate only applies to work action — non-work intents bypass it', () => {
        const obs = new Observer();
        obs.seedResource({
            id: 'steel-stock',
            conformsTo: 'spec:steel-coil',
            accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
        });

        const registry = new ProcessRegistry();
        let idCount = 0;
        const ps = new PlanStore(registry, () => `id_${idCount++}`);
        const plan = ps.addPlan({ name: 'test-plan' });

        const intent = ps.addIntent({
            action: 'consume', provider: 'factory',
            resourceInventoriedAs: 'steel-stock',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            plannedWithin: plan.id, finished: false,
        });

        const c = ps.promoteToCommitment(intent.id, { receiver: 'warehouse' }, obs);
        expect(c.action).toBe('consume');
    });
});
