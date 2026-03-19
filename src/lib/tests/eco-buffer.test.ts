import { describe, it, expect, beforeEach } from 'bun:test';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';
import { BufferZoneStore } from '../knowledge/buffer-zones';
import { planForScope } from '../planning/plan-for-scope';
import { planFederation } from '../planning/plan-federation';
import { buildIndependentDemandIndex } from '../indexes/independent-demand';
import { buildIndependentSupplyIndex } from '../indexes/independent-supply';
import { buildAgentIndex } from '../indexes/agents';
import { bufferStatus } from '../algorithms/ddmrp';
import { PlanStore, PLAN_TAGS, type ConservationMeta } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';

const locations = new Map();
const di = buildIndependentDemandIndex([], [], [], locations);
const ai = buildAgentIndex([], [], new Map(), 7);
const si = buildIndependentSupplyIndex([], [], [], ai, locations);

describe('ecological buffer — tippingPoint + ConservationSignal', () => {
    let recipeStore: RecipeStore;
    let observer: Observer;
    let bzStore: BufferZoneStore;
    let idCounter: number;
    const generateId = () => `id-${++idCounter}`;

    beforeEach(() => {
        recipeStore = new RecipeStore();
        observer = new Observer();
        bzStore = new BufferZoneStore();
        idCounter = 0;
    });

    it('bufferStatus returns tippingPointBreached when onhand < tippingPoint', () => {
        const zone: any = { tor: 10, toy: 20, tog: 30, tippingPoint: 5 };
        expect(bufferStatus(3, zone).tippingPointBreached).toBe(true);
        expect(bufferStatus(6, zone).tippingPointBreached).toBe(false);
        expect(bufferStatus(8, zone).tippingPointBreached).toBe(false);
    });

    it('bufferStatus tippingPointBreached is undefined when no tippingPoint configured', () => {
        const zone: any = { tor: 10, toy: 20, tog: 30 };
        expect(bufferStatus(5, zone).tippingPointBreached).toBeUndefined();
    });

    it('planForScope emits ConservationSignal for ecological buffer in red zone', () => {
        recipeStore.addResourceSpec({
            id: 'soil-n', name: 'Soil Nitrogen',
            resourceClassifiedAs: ['tag:buffer:ecological'], defaultUnitOfResource: 'kg/ha',
        });
        observer.seedResource({
            id: 'soil-r1', name: 'Field A nitrogen',
            conformsTo: 'soil-n', onhandQuantity: { hasNumericalValue: 8, hasUnit: 'kg/ha' },
        });
        bzStore.addBufferZone({
            id: 'bz-soil-n', specId: 'soil-n', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 0.5, aduUnit: 'kg/ha', dltDays: 30, moq: 0, moqUnit: 'kg/ha',
            tor: 10, toy: 20, tog: 30, tippingPoint: 5,
            lastComputedAt: new Date().toISOString(),
        });

        const result = planForScope(['c1'], { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, bufferZoneStore: bzStore, generateId });

        const conservationIntents = result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION);
        expect(conservationIntents).toHaveLength(1);
        const sig = result.planStore.getMeta(conservationIntents[0].id) as ConservationMeta;
        expect(conservationIntents[0].resourceConformsTo).toBe('soil-n');
        expect(sig.zone).toBe('red');
        expect(sig.onhand).toBe(8);
        expect(sig.tippingPointBreached).toBe(false); // 8 > tippingPoint=5
    });

    it('planForScope sets tippingPointBreached true when onhand < tippingPoint', () => {
        recipeStore.addResourceSpec({
            id: 'aquifer', name: 'Aquifer Level',
            resourceClassifiedAs: ['tag:buffer:ecological'], defaultUnitOfResource: 'ML',
        });
        observer.seedResource({
            id: 'aq-r1', name: 'Aquifer',
            conformsTo: 'aquifer', onhandQuantity: { hasNumericalValue: 3, hasUnit: 'ML' },
        });
        bzStore.addBufferZone({
            id: 'bz-aq', specId: 'aquifer', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 0.2, aduUnit: 'ML', dltDays: 90, moq: 0, moqUnit: 'ML',
            tor: 10, toy: 20, tog: 30, tippingPoint: 5,
            lastComputedAt: new Date().toISOString(),
        });

        const result = planForScope(['c1'], { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, bufferZoneStore: bzStore, generateId });

        const conservationIntents = result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION);
        expect(conservationIntents).toHaveLength(1);
        expect((result.planStore.getMeta(conservationIntents[0].id) as ConservationMeta).tippingPointBreached).toBe(true);
    });

    it('ecological buffer does not trigger replenishment purchase intents (even with tag:plan:replenishment-required)', () => {
        recipeStore.addResourceSpec({
            id: 'soil-n', name: 'Soil Nitrogen',
            resourceClassifiedAs: ['tag:buffer:ecological', PLAN_TAGS.REPLENISHMENT_REQUIRED],
            defaultUnitOfResource: 'kg/ha',
        });
        observer.seedResource({
            id: 'soil-r1', name: 'Field A nitrogen',
            conformsTo: 'soil-n', onhandQuantity: { hasNumericalValue: 8, hasUnit: 'kg/ha' },
        });
        bzStore.addBufferZone({
            id: 'bz-soil-n', specId: 'soil-n', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 0.5, aduUnit: 'kg/ha', dltDays: 30, moq: 0, moqUnit: 'kg/ha',
            tor: 10, toy: 20, tog: 30,
            lastComputedAt: new Date().toISOString(),
        });

        const result = planForScope(['c1'], { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, bufferZoneStore: bzStore, generateId });

        const ecoIntents = result.purchaseIntents.filter(i => i.resourceConformsTo === 'soil-n');
        expect(ecoIntents).toHaveLength(0);
        expect(result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION)).toHaveLength(1);
    });

    it('planFederation collects and deduplicates conservation signals', () => {
        recipeStore.addResourceSpec({
            id: 'biodiversity', name: 'Biodiversity Index',
            resourceClassifiedAs: ['tag:buffer:ecological'], defaultUnitOfResource: 'index',
        });
        observer.seedResource({
            id: 'bio-a', name: 'Forest A', conformsTo: 'biodiversity',
            onhandQuantity: { hasNumericalValue: 5, hasUnit: 'index' },
        });
        bzStore.addBufferZone({
            id: 'bz-bio', specId: 'biodiversity', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 0.1, aduUnit: 'index', dltDays: 365, moq: 0, moqUnit: 'index',
            tor: 10, toy: 20, tog: 30, tippingPoint: 3,
            lastComputedAt: new Date().toISOString(),
        });

        const parentOf = new Map([['commune-A', 'federation'], ['commune-B', 'federation']]);
        const fedResult = planFederation(
            ['commune-A', 'commune-B', 'federation'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, parentOf,
              bufferZoneStore: bzStore, generateId },
        );

        // Deduplicated — only one signal per specId even though multiple scopes planned
        expect(fedResult.allConservationSignals).toHaveLength(1);
        const sig = fedResult.allConservationSignals[0];
        expect(sig.specId).toBe('biodiversity');
        expect(sig.zone).toBe('red');
        expect(sig.tippingPointBreached).toBe(false); // 5 > tippingPoint=3
    });

    it('conservation signals propagate upward through 3-level hierarchy (leaf → commune → federation)', () => {
        // Leaf scope emits a conservation signal for soil nitrogen in red zone.
        // Commune receives it via childSignals and passes it up to federation.
        recipeStore.addResourceSpec({
            id: 'soil-n', name: 'Soil Nitrogen',
            resourceClassifiedAs: ['tag:buffer:ecological'], defaultUnitOfResource: 'kg/ha',
        });
        observer.seedResource({
            id: 'soil-r1', name: 'Field A nitrogen',
            conformsTo: 'soil-n', onhandQuantity: { hasNumericalValue: 2, hasUnit: 'kg/ha' },
        });
        bzStore.addBufferZone({
            id: 'bz-soil-n', specId: 'soil-n', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 0.5, aduUnit: 'kg/ha', dltDays: 30, moq: 0, moqUnit: 'kg/ha',
            tor: 10, toy: 20, tog: 30, tippingPoint: 5,
            lastComputedAt: new Date().toISOString(),
        });

        const horizon = { from: new Date(), to: new Date(Date.now() + 86400000 * 30) };
        const ctx = { recipeStore, observer, demandIndex: di, supplyIndex: si, bufferZoneStore: bzStore, generateId };

        // Level 1: leaf scope
        const leafResult = planForScope(['leaf'], horizon, ctx);
        const leafConservation = leafResult.planStore.intentsForTag(PLAN_TAGS.CONSERVATION);
        expect(leafConservation).toHaveLength(1);
        expect((leafResult.planStore.getMeta(leafConservation[0].id) as ConservationMeta).tippingPointBreached).toBe(true); // 2 < tippingPoint=5

        // Level 2: commune receives leaf's signal via child PlanStore
        const communeResult = planForScope(['commune'], horizon, ctx, [leafResult.planStore]);
        const communeConservation = communeResult.planStore.intentsForTag(PLAN_TAGS.CONSERVATION);
        expect(communeConservation).toHaveLength(1);
        expect(communeConservation[0].resourceConformsTo).toBe('soil-n');
        expect((communeResult.planStore.getMeta(communeConservation[0].id) as ConservationMeta).tippingPointBreached).toBe(true); // escalated upward

        // Level 3: federation receives commune's signal via child PlanStore
        const fedResult = planForScope(['federation'], horizon, ctx, [communeResult.planStore]);
        const fedConservation = fedResult.planStore.intentsForTag(PLAN_TAGS.CONSERVATION);
        expect(fedConservation).toHaveLength(1);
        expect(fedConservation[0].resourceConformsTo).toBe('soil-n');
        expect((fedResult.planStore.getMeta(fedConservation[0].id) as ConservationMeta).tippingPointBreached).toBe(true); // breach preserved
    });

    it('tippingPoint breach escalates upward: non-breached parent gets escalated by breached child', () => {
        // Two children: one with breach, one without (same specId). Parent should see breach=true.
        recipeStore.addResourceSpec({
            id: 'water', name: 'Water Table',
            resourceClassifiedAs: ['tag:buffer:ecological'], defaultUnitOfResource: 'ML',
        });
        observer.seedResource({
            id: 'w-safe', name: 'Water Safe Zone',
            conformsTo: 'water', onhandQuantity: { hasNumericalValue: 6, hasUnit: 'ML' },
        });
        bzStore.addBufferZone({
            id: 'bz-water', specId: 'water', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 0.3, aduUnit: 'ML', dltDays: 60, moq: 0, moqUnit: 'ML',
            tor: 10, toy: 20, tog: 30, tippingPoint: 5,
            lastComputedAt: new Date().toISOString(),
        });

        const horizon = { from: new Date(), to: new Date(Date.now() + 86400000 * 30) };
        const ctx = { recipeStore, observer, demandIndex: di, supplyIndex: si, bufferZoneStore: bzStore, generateId };

        // Child A: onhand=6 → not breached (6 > tippingPoint=5)
        const childA = planForScope(['scope-a'], horizon, ctx);
        const childAConservation = childA.planStore.intentsForTag(PLAN_TAGS.CONSERVATION)[0];
        expect((childA.planStore.getMeta(childAConservation.id) as ConservationMeta).tippingPointBreached).toBe(false);

        // Manually create a breached PlanStore for child B (simulating a different resource instance)
        const childBStore = new PlanStore(new ProcessRegistry(generateId), generateId);
        const childBIntent = childBStore.addIntent({
            action: 'cite',
            resourceConformsTo: 'water',
            resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
            plannedWithin: 'conservation:water',
            finished: false,
        });
        childBStore.setMeta(childBIntent.id, {
            kind: 'conservation', onhand: 3, tor: 10, toy: 20, tog: 30, zone: 'red', tippingPointBreached: true,
        });

        // Parent receives both child PlanStores: first non-breached from A, then breached from B → should escalate
        const parentResult = planForScope(['parent'], horizon, ctx, [childA.planStore, childBStore]);
        const parentConservation = parentResult.planStore.intentsForTag(PLAN_TAGS.CONSERVATION);
        expect(parentConservation).toHaveLength(1);
        expect((parentResult.planStore.getMeta(parentConservation[0].id) as ConservationMeta).tippingPointBreached).toBe(true);
    });

    it('planFederation tippingPointBreached merged as true if any scope sees breach', () => {
        recipeStore.addResourceSpec({
            id: 'topsoil', name: 'Topsoil Depth',
            resourceClassifiedAs: ['tag:buffer:ecological'], defaultUnitOfResource: 'cm',
        });
        observer.seedResource({
            id: 'ts-a', name: 'Field A', conformsTo: 'topsoil',
            onhandQuantity: { hasNumericalValue: 2, hasUnit: 'cm' }, // below tippingPoint=3
        });
        bzStore.addBufferZone({
            id: 'bz-ts', specId: 'topsoil', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 0.05, aduUnit: 'cm', dltDays: 365, moq: 0, moqUnit: 'cm',
            tor: 5, toy: 10, tog: 15, tippingPoint: 3,
            lastComputedAt: new Date().toISOString(),
        });

        const parentOf = new Map([['commune-A', 'federation']]);
        const fedResult = planFederation(
            ['commune-A', 'federation'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, parentOf,
              bufferZoneStore: bzStore, generateId },
        );

        expect(fedResult.allConservationSignals).toHaveLength(1);
        expect(fedResult.allConservationSignals[0].tippingPointBreached).toBe(true);
    });
});
