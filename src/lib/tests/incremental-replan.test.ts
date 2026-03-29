/**
 * Tests for incremental re-planning (cache + dirty-scope tracking) in planFederation.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { planFederation, type FederationPlanContext, type FederationPlanCache } from '../planning/plan-federation';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';
import { buildIndependentDemandIndex } from '../indexes/independent-demand';
import { buildIndependentSupplyIndex } from '../indexes/independent-supply';
import { PLAN_TAGS } from '../planning/planning';
import { SpatialThingStore } from '../knowledge/spatial-things';

// =============================================================================
// HIERARCHY: leaf-a, leaf-b → mid → root
// =============================================================================

const scopeIds = ['leaf-a', 'leaf-b', 'mid', 'root'];
const parentOf = new Map([
    ['leaf-a', 'mid'],
    ['leaf-b', 'mid'],
    ['mid', 'root'],
]);

const locations = new SpatialThingStore();
const horizon = { from: new Date('2026-04-01'), to: new Date('2026-06-30') };

let idCounter = 0;
const generateId = () => `inc-${++idCounter}`;

function makeCtx(overrides?: Partial<FederationPlanContext>): FederationPlanContext {
    const recipeStore = new RecipeStore();
    recipeStore.addResourceSpec({ id: 'wheat', name: 'Wheat', defaultUnitOfResource: 'kg' });
    recipeStore.addResourceSpec({ id: 'flour', name: 'Flour', defaultUnitOfResource: 'kg' });
    const pMill = recipeStore.addRecipeProcess({ id: 'p-mill', name: 'Mill' });
    recipeStore.addRecipe({ id: 'r-mill', name: 'Mill wheat', primaryOutput: 'flour', recipeProcesses: [pMill.id] });
    recipeStore.addRecipeFlow({ id: 'f-in', action: 'consume', resourceConformsTo: 'wheat', resourceQuantity: { hasNumericalValue: 2, hasUnit: 'kg' }, recipeInputOf: pMill.id });
    recipeStore.addRecipeFlow({ id: 'f-out', action: 'produce', resourceConformsTo: 'flour', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: pMill.id });

    const observer = new Observer();
    observer.seedResource({
        id: 'r-wheat', name: 'Wheat', conformsTo: 'wheat',
        accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
        onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
        currentLocation: 'leaf-a',
    });

    const demandIntents = [
        { id: 'd1', action: 'transfer' as const, resourceConformsTo: 'flour', resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' }, inScopeOf: ['leaf-a'] },
        { id: 'd2', action: 'transfer' as const, resourceConformsTo: 'flour', resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' }, inScopeOf: ['leaf-b'] },
    ];

    const demandIndex = buildIndependentDemandIndex(demandIntents, [], [], locations);
    const supplyIndex = buildIndependentSupplyIndex([], [], [], new Observer(), locations);

    return {
        recipeStore,
        observer,
        demandIndex,
        supplyIndex,
        parentOf,
        generateId,
        ...overrides,
    };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Incremental re-planning', () => {
    beforeEach(() => { idCounter = 0; });

    it('no cache → full replan (all scope-planned)', () => {
        const ctx = makeCtx();
        const result = planFederation(scopeIds, horizon, ctx);

        const round0 = result.events.filter(e => e.round === 0);
        expect(round0.every(e => e.kind === 'scope-planned')).toBe(true);
        expect(round0).toHaveLength(scopeIds.length);
        expect(result.cache).toBeDefined();
        expect(result.cache.byScope.size).toBe(scopeIds.length);
    });

    it('cache + empty dirty set → all cached (same references)', () => {
        const ctx = makeCtx();
        const first = planFederation(scopeIds, horizon, ctx);

        idCounter = 0;
        const ctx2 = makeCtx({ cache: first.cache, dirtyScopes: new Set() });
        const second = planFederation(scopeIds, horizon, ctx2);

        const round0 = second.events.filter(e => e.round === 0);
        expect(round0.every(e => e.kind === 'scope-cached')).toBe(true);
        expect(round0).toHaveLength(scopeIds.length);

        // Cached results should be the exact same object references
        for (const id of scopeIds) {
            expect(second.byScope.get(id)).toBe(first.cache.byScope.get(id));
        }
    });

    it('dirty leaf → ancestors propagate, sibling cached', () => {
        const ctx = makeCtx();
        const first = planFederation(scopeIds, horizon, ctx);

        idCounter = 0;
        const ctx2 = makeCtx({ cache: first.cache, dirtyScopes: new Set(['leaf-a']) });
        const second = planFederation(scopeIds, horizon, ctx2);

        const round0 = second.events.filter(e => e.round === 0);
        const planned = round0.filter(e => e.kind === 'scope-planned').map(e => e.scopeId);
        const cached = round0.filter(e => e.kind === 'scope-cached').map(e => e.scopeId);

        // leaf-a dirty → leaf-a, mid, root must replan
        expect(planned).toContain('leaf-a');
        expect(planned).toContain('mid');
        expect(planned).toContain('root');
        // leaf-b is clean
        expect(cached).toContain('leaf-b');
        expect(cached).toHaveLength(1);
    });

    it('new scope not in cache → planned', () => {
        // Plan with 3 scopes first
        const smallIds = ['leaf-a', 'mid', 'root'];
        const ctx = makeCtx();
        const first = planFederation(smallIds, horizon, ctx);

        // Now plan with 4 scopes, reusing cache from 3
        idCounter = 0;
        const ctx2 = makeCtx({ cache: first.cache, dirtyScopes: new Set() });
        const second = planFederation(scopeIds, horizon, ctx2);

        const round0 = second.events.filter(e => e.round === 0);
        const planned = round0.filter(e => e.kind === 'scope-planned').map(e => e.scopeId);

        // leaf-b wasn't in the cache → must be planned
        expect(planned).toContain('leaf-b');
        // Its ancestor mid and root must also replan (because leaf-b is dirty)
        expect(planned).toContain('mid');
        expect(planned).toContain('root');
    });

    it('correctness equivalence: incremental matches full replan for dirty scopes', () => {
        const ctx1 = makeCtx();
        const first = planFederation(scopeIds, horizon, ctx1);

        // Modify demand for leaf-a (increase flour demand)
        const modifiedDemands = [
            { id: 'd1', action: 'transfer' as const, resourceConformsTo: 'flour', resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' }, inScopeOf: ['leaf-a'] },
            { id: 'd2', action: 'transfer' as const, resourceConformsTo: 'flour', resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' }, inScopeOf: ['leaf-b'] },
        ];
        const modifiedDemandIndex = buildIndependentDemandIndex(modifiedDemands, [], [], locations);

        // Full replan with modified demand
        idCounter = 0;
        const fullCtx = makeCtx({ demandIndex: modifiedDemandIndex });
        const fullReplan = planFederation(scopeIds, horizon, fullCtx);

        // Incremental replan with modified demand, only leaf-a dirty
        idCounter = 0;
        const incrCtx = makeCtx({
            demandIndex: modifiedDemandIndex,
            cache: first.cache,
            dirtyScopes: new Set(['leaf-a']),
        });
        const incrReplan = planFederation(scopeIds, horizon, incrCtx);

        // Replanned scopes (leaf-a, mid, root) should have structurally equivalent PlanStore contents
        for (const id of ['leaf-a', 'mid', 'root']) {
            const fullDeficits = fullReplan.byScope.get(id)!.planStore.intentsForTag(PLAN_TAGS.DEFICIT);
            const incrDeficits = incrReplan.byScope.get(id)!.planStore.intentsForTag(PLAN_TAGS.DEFICIT);
            expect(fullDeficits.length).toBe(incrDeficits.length);

            const fullSurplus = fullReplan.byScope.get(id)!.planStore.intentsForTag(PLAN_TAGS.SURPLUS);
            const incrSurplus = incrReplan.byScope.get(id)!.planStore.intentsForTag(PLAN_TAGS.SURPLUS);
            expect(fullSurplus.length).toBe(incrSurplus.length);
        }

        // leaf-b should be cached (same reference from original cache)
        expect(incrReplan.byScope.get('leaf-b')).toBe(first.cache.byScope.get('leaf-b'));
    });
});
