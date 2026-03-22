import { describe, it, expect } from 'bun:test';
import { nanoid } from 'nanoid';
import { PlanStore, PLAN_TAGS, type ConservationMeta } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';
import { RecipeStore } from '../knowledge/recipes';
import { buildIndependentDemandIndex } from '../indexes/independent-demand';
import { buildIndependentSupplyIndex } from '../indexes/independent-supply';
import { buildAgentIndex } from '../indexes/agents';
import {
    buildHierarchy,
    foldScopes,
    matchLaterally,
    writeBackShortfalls,
    analyzeSacrifice,
    aggregateConservation,
    DefaultLateralMatchingPolicy,
    type FederationPlanContext,
    type DeficitWorkItem,
} from '../planning/plan-federation';
import type { ScopePlanResult } from '../planning/plan-for-scope';
import { StoreRegistry } from '../planning/store-registry';

let idCounter = 0;
const generateId = () => `id-${++idCounter}`;

function makeEmptyResult(): ScopePlanResult {
    return {
        planStore: new PlanStore(new ProcessRegistry(generateId), generateId),
        purchaseIntents: [],
        unmetDemand: [],
        laborGaps: [],
    };
}

describe('Federation Decomposition', () => {
    describe('buildHierarchy', () => {
        it('builds childrenOf map and topological order', () => {
            const parentOf = new Map([['a', 'b'], ['b', 'c']]);
            const { childrenOf, planOrder } = buildHierarchy(['a', 'b', 'c'], parentOf);
            expect(childrenOf.get('c')).toEqual(['b']);
            expect(childrenOf.get('b')).toEqual(['a']);
            expect(childrenOf.get('a')).toEqual([]);
            // Topological: a before b before c
            expect(planOrder.indexOf('a')).toBeLessThan(planOrder.indexOf('b'));
            expect(planOrder.indexOf('b')).toBeLessThan(planOrder.indexOf('c'));
        });

        it('handles disconnected scopes (forest)', () => {
            const parentOf = new Map<string, string>();
            const { childrenOf, planOrder } = buildHierarchy(['x', 'y'], parentOf);
            expect(childrenOf.get('x')).toEqual([]);
            expect(childrenOf.get('y')).toEqual([]);
            expect(planOrder).toHaveLength(2);
        });

        it('restricts to planned scopes only', () => {
            const parentOf = new Map([['a', 'b'], ['b', 'c']]);
            const { childrenOf } = buildHierarchy(['a', 'b'], parentOf);
            // 'c' not in scopeIds, so b→c link is ignored
            expect(childrenOf.has('c')).toBe(false);
            expect(childrenOf.get('b')).toEqual(['a']);
        });
    });

    describe('foldScopes', () => {
        it('calls planScope for each scope in order', () => {
            const calls: string[] = [];
            const byScope = foldScopes(
                ['leaf', 'root'],
                new Map([['root', ['leaf']], ['leaf', []]]),
                (id, subs) => {
                    calls.push(id);
                    return makeEmptyResult();
                },
            );
            expect(calls).toEqual(['leaf', 'root']);
            expect(byScope.size).toBe(2);
        });

        it('passes child subStores to parent', () => {
            let rootSubStores: PlanStore[] = [];
            foldScopes(
                ['leaf', 'root'],
                new Map([['root', ['leaf']], ['leaf', []]]),
                (id, subs) => {
                    if (id === 'root') rootSubStores = subs;
                    return makeEmptyResult();
                },
            );
            expect(rootSubStores).toHaveLength(1);
        });

        it('uses cache when scope is not dirty', () => {
            const cachedResult = makeEmptyResult();
            cachedResult.planStore.addPlan({ name: 'cached-plan' });
            const cache = { byScope: new Map([['leaf', cachedResult]]) };
            const effectiveDirty = new Set(['root']);
            const calls: string[] = [];

            const byScope = foldScopes(
                ['leaf', 'root'],
                new Map([['root', ['leaf']], ['leaf', []]]),
                (id, subs) => { calls.push(id); return makeEmptyResult(); },
                { cache, effectiveDirty },
            );
            // leaf was cached, not replanned
            expect(calls).toEqual(['root']);
            expect(byScope.get('leaf')?.planStore.allPlans()).toHaveLength(1);
        });
    });

    describe('analyzeSacrifice', () => {
        it('returns empty when no member counts', () => {
            const events = analyzeSacrifice([], undefined);
            expect(events).toEqual([]);
        });

        it('detects imbalanced sacrifice across scopes', () => {
            const deficitWork: DeficitWorkItem[] = [
                { scopeId: 'a', specId: 'wheat', shortfall: 100, intentId: 'i1', unit: 'kg', isMetabolicDebt: false },
                { scopeId: 'b', specId: 'wheat', shortfall: 10, intentId: 'i2', unit: 'kg', isMetabolicDebt: false },
            ];
            const memberCounts = new Map([['a', 10], ['b', 10]]);
            const events = analyzeSacrifice(deficitWork, memberCounts);
            expect(events.length).toBeGreaterThan(0);
            expect(events[0].kind).toBe('sacrifice-rebalanced');
        });

        it('skips resolved deficits (shortfall ≤ 0)', () => {
            const deficitWork: DeficitWorkItem[] = [
                { scopeId: 'a', specId: 'wheat', shortfall: 0, intentId: 'i1', unit: 'kg', isMetabolicDebt: false },
            ];
            const memberCounts = new Map([['a', 10]]);
            const events = analyzeSacrifice(deficitWork, memberCounts);
            expect(events).toEqual([]);
        });
    });

    describe('aggregateConservation', () => {
        it('collects conservation signals from multiple scopes, deduplicated', () => {
            const r1 = makeEmptyResult();
            const i1 = r1.planStore.addIntent({
                action: 'cite', resourceConformsTo: 'water',
                resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
                plannedWithin: 'conservation:water', finished: false,
            });
            r1.planStore.setMeta(i1.id, {
                kind: 'conservation', onhand: 50, tor: 20, toy: 40, tog: 60, zone: 'yellow',
            } as ConservationMeta);

            const r2 = makeEmptyResult();
            const i2 = r2.planStore.addIntent({
                action: 'cite', resourceConformsTo: 'water',
                resourceClassifiedAs: [PLAN_TAGS.CONSERVATION],
                plannedWithin: 'conservation:water', finished: false,
            });
            r2.planStore.setMeta(i2.id, {
                kind: 'conservation', onhand: 30, tor: 20, toy: 40, tog: 60, zone: 'yellow',
                tippingPointBreached: true,
            } as ConservationMeta);

            const byScope = new Map([['scope-a', r1], ['scope-b', r2]]);
            const signals = aggregateConservation(byScope);
            expect(signals).toHaveLength(1);
            expect(signals[0].specId).toBe('water');
            // tippingPointBreached escalated from scope-b
            expect(signals[0].tippingPointBreached).toBe(true);
        });

        it('returns empty for no conservation signals', () => {
            const byScope = new Map([['scope-a', makeEmptyResult()]]);
            const signals = aggregateConservation(byScope);
            expect(signals).toEqual([]);
        });
    });

    describe('writeBackShortfalls', () => {
        it('updates deficit intent quantities after lateral resolution', () => {
            const result = makeEmptyResult();
            const intent = result.planStore.addIntent({
                action: 'transfer', resourceConformsTo: 'wheat',
                resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                resourceClassifiedAs: [PLAN_TAGS.DEFICIT], finished: false,
            });
            result.planStore.setMeta(intent.id, { kind: 'deficit', originalShortfall: 100, resolvedAt: [] });

            const byScope = new Map([['scope-a', result]]);
            const deficitWork: DeficitWorkItem[] = [
                { scopeId: 'scope-a', specId: 'wheat', shortfall: 30, intentId: intent.id, unit: 'kg', isMetabolicDebt: false },
            ];

            writeBackShortfalls(byScope, deficitWork);

            const updated = result.planStore.intentsForTag(PLAN_TAGS.DEFICIT);
            expect(updated).toHaveLength(1);
            expect(updated[0].resourceQuantity?.hasNumericalValue).toBe(30);
        });

        it('preserves intents not in deficitWork', () => {
            const result = makeEmptyResult();
            result.planStore.addIntent({
                action: 'transfer', resourceConformsTo: 'iron',
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
                resourceClassifiedAs: [PLAN_TAGS.DEFICIT], finished: false,
            });

            const byScope = new Map([['scope-a', result]]);
            writeBackShortfalls(byScope, []);

            const unchanged = result.planStore.intentsForTag(PLAN_TAGS.DEFICIT);
            expect(unchanged).toHaveLength(1);
            expect(unchanged[0].resourceQuantity?.hasNumericalValue).toBe(50);
        });
    });
});
