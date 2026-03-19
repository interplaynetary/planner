import { describe, expect, test } from 'bun:test';
import { PlanStore, PLAN_TAGS } from '../planning/planning';
import type { ConservationMeta, DeficitMeta } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { snapshotStore, hydrateStore } from '../planning/remote-transport';
import type { ScopeSnapshot } from '../planning/remote-transport';
import { StoreRegistry, qualify } from '../planning/store-registry';
import { MockTransport } from '../planning/mock-transport';

// =============================================================================
// HELPERS
// =============================================================================

let idCounter = 0;
function nextId(): string { return `test-${++idCounter}`; }

function buildPopulatedStore(): PlanStore {
    idCounter = 0;
    const reg = new ProcessRegistry(() => nextId());
    const store = new PlanStore(reg, () => nextId());

    const plan = store.addPlan({ name: 'test-plan' });
    const process = reg.register({ name: 'bake', basedOn: 'spec:bake', plannedWithin: plan.id, finished: false });
    store.addCommitment({
        action: 'produce', provider: 'agent:bakery',
        resourceConformsTo: 'spec:bread',
        resourceQuantity: { hasNumericalValue: 100, hasUnit: 'loaf' },
        outputOf: process.id, plannedWithin: plan.id, finished: false,
    });
    const deficitIntent = store.addIntent({
        action: 'transfer', provider: 'agent:bakery',
        resourceConformsTo: 'spec:flour',
        resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        resourceClassifiedAs: [PLAN_TAGS.DEFICIT],
        outputOf: process.id, plannedWithin: plan.id, finished: false,
    });
    store.setMeta(deficitIntent.id, {
        kind: 'deficit', originalShortfall: 50, resolvedAt: ['loc:mill'],
    } satisfies DeficitMeta);

    const conservationIntent = store.addIntent({
        action: 'cite', resourceConformsTo: 'spec:water',
        resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
        plannedWithin: 'conservation:spec:water', finished: false,
    });
    store.setMeta(conservationIntent.id, {
        kind: 'conservation', onhand: 200, tor: 50, toy: 100, tog: 150, zone: 'yellow',
    } satisfies ConservationMeta);

    return store;
}

// =============================================================================
// TESTS
// =============================================================================

describe('Snapshot hydration', () => {
    test('1: roundtrip preserves all record types', () => {
        const original = buildPopulatedStore();
        const snapshot = snapshotStore(original);
        const hydrated = hydrateStore(snapshot);

        expect(hydrated.allPlans().length).toBe(original.allPlans().length);
        expect(hydrated.allCommitments().length).toBe(original.allCommitments().length);
        expect(hydrated.allIntents().length).toBe(original.allIntents().length);
        expect(hydrated.allProcesses().length).toBe(original.allProcesses().length);
        expect([...hydrated.allMeta()].length).toBe([...original.allMeta()].length);

        // Verify IDs match
        for (const plan of original.allPlans())
            expect(hydrated.getPlan(plan.id)).toBeDefined();
        for (const commitment of original.allCommitments())
            expect(hydrated.getCommitment(commitment.id)).toBeDefined();
        for (const intent of original.allIntents())
            expect(hydrated.getIntent(intent.id)).toBeDefined();
        for (const process of original.allProcesses())
            expect(hydrated.processes.get(process.id)).toBeDefined();
        for (const [id, meta] of original.allMeta())
            expect(hydrated.getMeta(id)).toEqual(meta);
    });

    test('2: hydrated store conservation intents + meta aggregate correctly', () => {
        const original = buildPopulatedStore();
        const hydrated = hydrateStore(snapshotStore(original));

        // Simulate the conservation merge loop from collectPhase
        const mergedChild = new Map<string, { onhand: number; tor: number; toy: number; tog: number; zone: 'red' | 'yellow'; tippingPointBreached?: boolean }>();
        for (const ci of hydrated.intentsForTag(PLAN_TAGS.CONSERVATION)) {
            const cn = hydrated.getMeta(ci.id) as ConservationMeta | undefined;
            if (!cn) continue;
            const specId = ci.resourceConformsTo ?? '';
            mergedChild.set(specId, { onhand: cn.onhand, tor: cn.tor, toy: cn.toy, tog: cn.tog, zone: cn.zone });
        }
        expect(mergedChild.get('spec:water')).toEqual({
            onhand: 200, tor: 50, toy: 100, tog: 150, zone: 'yellow',
        });
    });

    test('3: processes traversable via outputOf after hydrate', () => {
        const original = buildPopulatedStore();
        const hydrated = hydrateStore(snapshotStore(original));

        const signalIntents = hydrated.allIntents().filter(i => i.outputOf);
        expect(signalIntents.length).toBeGreaterThan(0);
        for (const intent of signalIntents) {
            const process = hydrated.processes.get(intent.outputOf!);
            expect(process).toBeDefined();
            expect(process!.id).toBe(intent.outputOf);
        }
    });

    test('4: StoreRegistry indexes processes', () => {
        const original = buildPopulatedStore();
        const registry = new StoreRegistry();
        const scopeId = 'scope:bakery';
        registry.register(scopeId, original);

        for (const process of original.allProcesses()) {
            const result = registry.resolve(qualify(scopeId, process.id));
            expect(result.process).toBeDefined();
            expect(result.process!.id).toBe(process.id);
        }
    });

    test('5: StoreRegistry attaches meta to intent records', () => {
        const original = buildPopulatedStore();
        const registry = new StoreRegistry();
        const scopeId = 'scope:bakery';
        registry.register(scopeId, original);

        for (const [id, meta] of original.allMeta()) {
            const result = registry.resolve(qualify(scopeId, id));
            expect(result.meta).toEqual(meta);
            // Meta should be attached to the same record as the intent
            if (original.getIntent(id)) {
                expect(result.intent).toBeDefined();
            }
        }
    });

    test('6: MockTransport roundtrip includes processes + meta', async () => {
        const original = buildPopulatedStore();
        const transport = new MockTransport();
        const scopeId = 'scope:bakery';

        await transport.announce(scopeId, original);

        // Processes fetchable
        for (const process of original.allProcesses()) {
            const result = await transport.fetch(scopeId, process.id);
            expect(result.process).toBeDefined();
            expect(result.process!.id).toBe(process.id);
        }

        // Meta attached to intents
        for (const [id, meta] of original.allMeta()) {
            const result = await transport.fetch(scopeId, id);
            expect(result.meta).toEqual(meta);
        }
    });

    test('7: conservation crash guard: missing meta skipped', () => {
        // Create a child store with conservation intents but NO meta
        const reg = new ProcessRegistry();
        const childStore = new PlanStore(reg);
        childStore.addIntent({
            action: 'cite', resourceConformsTo: 'spec:water',
            resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
            plannedWithin: 'conservation:spec:water', finished: false,
        });
        // Intentionally no setMeta — simulates incomplete remote snapshot

        // The same loop from collectPhase must not crash
        const merged = new Map<string, { onhand: number }>();
        for (const ci of childStore.intentsForTag(PLAN_TAGS.CONSERVATION)) {
            const cn = childStore.getMeta(ci.id) as ConservationMeta | undefined;
            if (!cn) continue; // The fix — would crash without this guard
            merged.set(ci.resourceConformsTo ?? '', { onhand: cn.onhand });
        }
        expect(merged.size).toBe(0); // Skipped, not crashed
    });

    test('8: JSON roundtrip of ScopeSnapshot', () => {
        const original = buildPopulatedStore();
        const snapshot = snapshotStore(original);

        // Simulate wire transport
        const json = JSON.stringify(snapshot);
        const parsed = JSON.parse(json) as ScopeSnapshot;
        const hydrated = hydrateStore(parsed);

        expect(hydrated.allPlans().length).toBe(original.allPlans().length);
        expect(hydrated.allCommitments().length).toBe(original.allCommitments().length);
        expect(hydrated.allIntents().length).toBe(original.allIntents().length);
        expect(hydrated.allProcesses().length).toBe(original.allProcesses().length);
        expect([...hydrated.allMeta()].length).toBe([...original.allMeta()].length);

        // Meta values survive JSON roundtrip
        for (const [id, meta] of original.allMeta())
            expect(hydrated.getMeta(id)).toEqual(meta);
    });
});
