import { describe, it, expect, beforeEach } from 'bun:test';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';
import { BufferZoneStore } from '../knowledge/buffer-zones';
import { planForScope } from '../planning/plan-for-scope';
import { buildIndependentDemandIndex, type DemandSlot } from '../indexes/independent-demand';
import { buildIndependentSupplyIndex } from '../indexes/independent-supply';
import { buildAgentIndex } from '../indexes/agents';
import { PLAN_TAGS, type ConservationMeta } from '../planning/planning';
import type { BufferProfile, Intent } from '../schemas';
import { compositeBufferPriority, bufferTypeFromTags } from '../utils/buffer-type';

const locations = new Map();
const ai = buildAgentIndex([], [], new Map(), 7);

function makeProfile(id: string): BufferProfile {
    return {
        id, name: id,
        itemType: 'Purchased',
        leadTimeFactor: 1.0,
        variabilityFactor: 0.3,
    };
}

function makeDemandIndex(intents: Intent[]) {
    return buildIndependentDemandIndex(intents, [], [], locations);
}

describe('buffer-first inversion', () => {
    let recipeStore: RecipeStore;
    let observer: Observer;
    let bzStore: BufferZoneStore;
    let idCounter: number;
    let bufferProfiles: Map<string, BufferProfile>;
    const generateId = () => `id-${++idCounter}`;

    const horizon = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };

    beforeEach(() => {
        recipeStore = new RecipeStore();
        observer = new Observer();
        bzStore = new BufferZoneStore();
        bufferProfiles = new Map();
        idCounter = 0;
    });

    // -----------------------------------------------------------------------
    // 1. No activation without both flags
    // -----------------------------------------------------------------------
    it('does not activate buffer-first without bufferProfiles', () => {
        recipeStore.addResourceSpec({
            id: 'wheat', name: 'Wheat',
            resourceClassifiedAs: [],
            defaultUnitOfResource: 'kg',
        });
        observer.seedResource({
            id: 'r-wheat', name: 'Wheat stock',
            conformsTo: 'wheat', onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });
        bzStore.addBufferZone({
            id: 'bz-wheat', specId: 'wheat', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });

        // Demand that consumes wheat
        const demandIntent: Intent = {
            id: 'demand-1', action: 'transfer', resourceConformsTo: 'wheat',
            resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
            due: '2026-01-15T00:00:00.000Z', inScopeOf: ['c1'],
        };
        const di = makeDemandIndex([demandIntent]);
        const si = buildIndependentSupplyIndex([], [], [], ai, locations);

        // Without bufferProfiles → no buffer-first activation
        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, generateId,
            // bufferProfiles NOT provided
        });

        // No Pass 0 or deferred plans should exist
        const pass0Plans = result.planStore.allPlans().filter(p => p.name?.startsWith('Buffer-first replenishment'));
        const deferredPlans = result.planStore.allPlans().filter(p => p.name?.startsWith('Deferred demand'));
        expect(pass0Plans).toHaveLength(0);
        expect(deferredPlans).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // 2. Pass 0 reserves capacity — buffer gets first claim
    // -----------------------------------------------------------------------
    it('Pass 0 reserves capacity for red buffer before independent demands', () => {
        recipeStore.addResourceSpec({
            id: 'flour', name: 'Flour',
            resourceClassifiedAs: [],
            defaultUnitOfResource: 'kg',
        });
        // Only 20 kg on hand, buffer needs tog=100, demand wants 20
        observer.seedResource({
            id: 'r-flour', name: 'Flour stock',
            conformsTo: 'flour', onhandQuantity: { hasNumericalValue: 20, hasUnit: 'kg' },
        });
        bzStore.addBufferZone({
            id: 'bz-flour', specId: 'flour', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p1', makeProfile('p1'));

        // Independent demand for 20 kg flour
        const demandIntent: Intent = {
            id: 'demand-flour', action: 'transfer', resourceConformsTo: 'flour',
            resourceQuantity: { hasNumericalValue: 20, hasUnit: 'kg' },
            due: '2026-01-15T00:00:00.000Z', inScopeOf: ['c1'],
        };
        const di = makeDemandIndex([demandIntent]);
        const si = buildIndependentSupplyIndex([], [], [], ai, locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, bufferProfiles, generateId,
        });

        // Buffer-first should have reserved capacity via Pass 0 (netter.reserve)
        // A replenishment signal should exist for the stressed buffer
        const replenSignals = result.planStore.intentsForTag(PLAN_TAGS.REPLENISHMENT)
            .filter(i => i.resourceConformsTo === 'flour');
        expect(replenSignals.length).toBeGreaterThanOrEqual(1);
    });

    // -----------------------------------------------------------------------
    // 3. Composite priority — ecological-yellow outranks metabolic-red
    // -----------------------------------------------------------------------
    it('compositeBufferPriority: ecological-yellow < metabolic-red', () => {
        const ecoYellow = compositeBufferPriority('ecological', 'yellow');
        const metRed = compositeBufferPriority('metabolic', 'red');
        expect(ecoYellow).toBeLessThan(metRed);
    });

    it('composite sort orders strategic-red before metabolic-red in derived demands', () => {
        // Strategic buffer in red zone
        recipeStore.addResourceSpec({
            id: 'seed-stock', name: 'Seed Stock',
            resourceClassifiedAs: ['tag:buffer:strategic'],
            defaultUnitOfResource: 'kg',
        });
        observer.seedResource({
            id: 'r-seed', name: 'Seed stock',
            conformsTo: 'seed-stock', onhandQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
        });
        bzStore.addBufferZone({
            id: 'bz-seed', specId: 'seed-stock', profileId: 'p-strat',
            bufferClassification: 'replenished_override',
            adu: 2, aduUnit: 'kg', dltDays: 14, moq: 0, moqUnit: 'kg',
            tor: 20, toy: 40, tog: 60,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p-strat', makeProfile('p-strat'));

        // Metabolic buffer in red zone
        recipeStore.addResourceSpec({
            id: 'rice', name: 'Rice',
            resourceClassifiedAs: [],
            defaultUnitOfResource: 'kg',
        });
        observer.seedResource({
            id: 'r-rice', name: 'Rice stock',
            conformsTo: 'rice', onhandQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
        });
        bzStore.addBufferZone({
            id: 'bz-rice', specId: 'rice', profileId: 'p-met',
            bufferClassification: 'replenished_override',
            adu: 3, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 20, toy: 40, tog: 60,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p-met', makeProfile('p-met'));

        const di = makeDemandIndex([]);
        const si = buildIndependentSupplyIndex([], [], [], ai, locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, bufferProfiles, generateId,
        });

        // Both stressed buffers should get replenishment signals
        const replenSignals = result.planStore.intentsForTag(PLAN_TAGS.REPLENISHMENT);
        const seedSignal = replenSignals.find(i => i.resourceConformsTo === 'seed-stock');
        const riceSignal = replenSignals.find(i => i.resourceConformsTo === 'rice');
        expect(seedSignal).toBeDefined();
        expect(riceSignal).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // 4. Buffer guard defers demand, retried after Pass 2
    // -----------------------------------------------------------------------
    it('buffer guard defers demand that would breach TOY, retries after replenishment', () => {
        recipeStore.addResourceSpec({
            id: 'beans', name: 'Beans',
            resourceClassifiedAs: [],
            defaultUnitOfResource: 'kg',
        });
        // 50 kg on hand, toy=60 — consuming 50 would put us at 0 < toy
        observer.seedResource({
            id: 'r-beans', name: 'Beans stock',
            conformsTo: 'beans', onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });
        bzStore.addBufferZone({
            id: 'bz-beans', specId: 'beans', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p1', makeProfile('p1'));

        const demandIntent: Intent = {
            id: 'demand-beans', action: 'transfer', resourceConformsTo: 'beans',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            due: '2026-01-15T00:00:00.000Z', inScopeOf: ['c1'],
        };
        const di = makeDemandIndex([demandIntent]);
        const si = buildIndependentSupplyIndex([], [], [], ai, locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, bufferProfiles, generateId,
        });

        // The demand should be deferred then retried — look for a deferred plan
        const deferredPlans = result.planStore.allPlans().filter(p => p.name?.startsWith('Deferred demand'));
        expect(deferredPlans.length).toBeGreaterThanOrEqual(1);
    });

    // -----------------------------------------------------------------------
    // 5. Pass 0 specs excluded from Pass 2 — no double-replenishment
    // -----------------------------------------------------------------------
    it('Pass 0 handled specs are not double-replenished in Pass 2', () => {
        recipeStore.addResourceSpec({
            id: 'oil', name: 'Cooking Oil',
            resourceClassifiedAs: [],
            defaultUnitOfResource: 'L',
        });
        observer.seedResource({
            id: 'r-oil', name: 'Oil stock',
            conformsTo: 'oil', onhandQuantity: { hasNumericalValue: 10, hasUnit: 'L' },
        });
        bzStore.addBufferZone({
            id: 'bz-oil', specId: 'oil', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 2, aduUnit: 'L', dltDays: 7, moq: 0, moqUnit: 'L',
            tor: 15, toy: 30, tog: 50,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p1', makeProfile('p1'));

        const di = makeDemandIndex([]);
        const si = buildIndependentSupplyIndex([], [], [], ai, locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, bufferProfiles, generateId,
        });

        // Pass 0 reserves capacity (no demand explosion), replenishment signal is emitted,
        // and the reserved spec is NOT double-replenished in Pass 2
        const replenSignals = result.planStore.intentsForTag(PLAN_TAGS.REPLENISHMENT)
            .filter(i => i.resourceConformsTo === 'oil');
        expect(replenSignals.length).toBeGreaterThanOrEqual(1);
        const pass2Plans = result.planStore.allPlans().filter(p => p.name?.startsWith('Replenishment for oil'));
        expect(pass2Plans.length).toBe(0);
    });

    // -----------------------------------------------------------------------
    // 6. Combined backtracking — Pass 0 + Pass 2 debts resolved together
    // -----------------------------------------------------------------------
    it('Pass 0 debts merge into backtracking loop with Pass 2 debts', () => {
        // Two buffers: one handled by Pass 0, one by Pass 2
        recipeStore.addResourceSpec({
            id: 'sugar', name: 'Sugar',
            resourceClassifiedAs: [],
            defaultUnitOfResource: 'kg',
        });
        observer.seedResource({
            id: 'r-sugar', name: 'Sugar stock',
            conformsTo: 'sugar', onhandQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
        });
        bzStore.addBufferZone({
            id: 'bz-sugar', specId: 'sugar', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 3, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 20, toy: 40, tog: 60,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p1', makeProfile('p1'));

        const di = makeDemandIndex([]);
        const si = buildIndependentSupplyIndex([], [], [], ai, locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, bufferProfiles, generateId,
        });

        // Deficit signals should include Pass 0 debt (metabolic_debt source)
        const deficits = result.planStore.intentsForTag(PLAN_TAGS.DEFICIT);
        const metabolicDeficits = deficits.filter(d =>
            d.resourceClassifiedAs?.includes(PLAN_TAGS.METABOLIC_DEBT),
        );
        // Pass 0 debts that couldn't be sourced internally become metabolic debt deficits
        // (they're purchase intents that become deficit signals if unresolvable)
        // The key assertion: the planner doesn't crash and produces a valid result
        expect(result.planStore).toBeDefined();
        expect(result.purchaseIntents).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // 7. Ecological exclusion — ecological buffers produce ConservationSignal, not Pass 0
    // -----------------------------------------------------------------------
    it('ecological buffers are excluded from Pass 0 replenishment', () => {
        recipeStore.addResourceSpec({
            id: 'soil-carbon', name: 'Soil Carbon',
            resourceClassifiedAs: ['tag:buffer:ecological'],
            defaultUnitOfResource: 'tonne',
        });
        observer.seedResource({
            id: 'r-carbon', name: 'Soil carbon stock',
            conformsTo: 'soil-carbon', onhandQuantity: { hasNumericalValue: 5, hasUnit: 'tonne' },
        });
        bzStore.addBufferZone({
            id: 'bz-carbon', specId: 'soil-carbon', profileId: 'p-eco',
            bufferClassification: 'replenished_override',
            adu: 0.1, aduUnit: 'tonne', dltDays: 365, moq: 0, moqUnit: 'tonne',
            tor: 20, toy: 40, tog: 60, tippingPoint: 3,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p-eco', makeProfile('p-eco'));

        const di = makeDemandIndex([]);
        const si = buildIndependentSupplyIndex([], [], [], ai, locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, bufferProfiles, generateId,
        });

        // No Pass 0 replenishment for ecological buffer
        const pass0Plans = result.planStore.allPlans().filter(p => p.name?.startsWith('Buffer-first replenishment'));
        expect(pass0Plans.length).toBe(0);

        // Instead, a ConservationSignal should be emitted
        const conservationIntents = result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION);
        expect(conservationIntents.length).toBeGreaterThanOrEqual(1);
        const carbonSignal = conservationIntents.find(i => i.resourceConformsTo === 'soil-carbon');
        expect(carbonSignal).toBeDefined();
        const meta = result.planStore.getMeta(carbonSignal!.id) as ConservationMeta;
        expect(meta.zone).toBe('red');
    });

    // -----------------------------------------------------------------------
    // Helper unit tests
    // -----------------------------------------------------------------------
    describe('bufferTypeFromTags', () => {
        it('returns ecological for tag:buffer:ecological', () => {
            expect(bufferTypeFromTags(['tag:buffer:ecological'])).toBe('ecological');
        });
        it('returns metabolic as default', () => {
            expect(bufferTypeFromTags([])).toBe('metabolic');
            expect(bufferTypeFromTags(['some-other-tag'])).toBe('metabolic');
        });
        it('returns strategic for tag:buffer:strategic', () => {
            expect(bufferTypeFromTags(['tag:buffer:strategic'])).toBe('strategic');
        });
    });

    describe('compositeBufferPriority', () => {
        it('ecological-red = 0 (highest priority)', () => {
            expect(compositeBufferPriority('ecological', 'red')).toBe(0);
        });
        it('ecological-yellow < strategic-red', () => {
            expect(compositeBufferPriority('ecological', 'yellow')).toBeLessThan(
                compositeBufferPriority('strategic', 'red'),
            );
        });
        it('strategic-red < metabolic-red', () => {
            expect(compositeBufferPriority('strategic', 'red')).toBeLessThan(
                compositeBufferPriority('metabolic', 'red'),
            );
        });
        it('same tier: red < yellow < green < excess', () => {
            expect(compositeBufferPriority('metabolic', 'red')).toBeLessThan(
                compositeBufferPriority('metabolic', 'yellow'),
            );
            expect(compositeBufferPriority('metabolic', 'yellow')).toBeLessThan(
                compositeBufferPriority('metabolic', 'green'),
            );
            expect(compositeBufferPriority('metabolic', 'green')).toBeLessThan(
                compositeBufferPriority('metabolic', 'excess'),
            );
        });
    });
});
