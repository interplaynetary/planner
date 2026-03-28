import { describe, expect, test } from 'bun:test';
import { AgentStore } from '../agents';
import { buildMembershipIndex } from '../indexes/membership';
import { planFederation } from '../planning/plan-federation';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';
import { BufferZoneStore } from '../knowledge/buffer-zones';
import { buildIndependentDemandIndex } from '../indexes/independent-demand';
import { buildIndependentSupplyIndex } from '../indexes/independent-supply';
import { buildAgentIndex } from '../indexes/agents';
import { SpatialThingStore } from '../knowledge/spatial-things';

// =============================================================================
// HELPERS
// =============================================================================

function makeHierarchy(): AgentStore {
    const store = new AgentStore();
    store.addAgent({ id: 'uc', type: 'Organization', name: 'UC' });
    store.addAgent({ id: 'fed-a', type: 'Organization', name: 'Federation A' });
    store.addAgent({ id: 'fed-b', type: 'Organization', name: 'Federation B' });
    store.addAgent({ id: 'commune-1', type: 'Organization', name: 'Commune 1' });
    store.addAgent({ id: 'commune-2', type: 'Organization', name: 'Commune 2' });
    store.addAgent({ id: 'commune-3', type: 'Organization', name: 'Commune 3' });

    store.addRelationship({ id: 'r-fa-uc', subject: 'fed-a', object: 'uc', relationship: 'member' });
    store.addRelationship({ id: 'r-fb-uc', subject: 'fed-b', object: 'uc', relationship: 'member' });
    store.addRelationship({ id: 'r-c1-fa', subject: 'commune-1', object: 'fed-a', relationship: 'member' });
    store.addRelationship({ id: 'r-c2-fa', subject: 'commune-2', object: 'fed-a', relationship: 'member' });
    store.addRelationship({ id: 'r-c3-fb', subject: 'commune-3', object: 'fed-b', relationship: 'member' });

    // 5 persons in commune-1, 3 in commune-2, 2 in commune-3
    for (let i = 0; i < 5; i++) {
        store.addAgent({ id: `p1-${i}`, type: 'Person', name: `Person 1-${i}` });
        store.addRelationship({ subject: `p1-${i}`, object: 'commune-1', relationship: 'member' });
    }
    for (let i = 0; i < 3; i++) {
        store.addAgent({ id: `p2-${i}`, type: 'Person', name: `Person 2-${i}` });
        store.addRelationship({ subject: `p2-${i}`, object: 'commune-2', relationship: 'member' });
    }
    for (let i = 0; i < 2; i++) {
        store.addAgent({ id: `p3-${i}`, type: 'Person', name: `Person 3-${i}` });
        store.addRelationship({ subject: `p3-${i}`, object: 'commune-3', relationship: 'member' });
    }

    return store;
}

// =============================================================================
// TESTS
// =============================================================================

describe('AgentStore deletion methods', () => {
    test('removeRelationship deletes selectively', () => {
        const store = new AgentStore();
        store.addAgent({ id: 'a', type: 'Organization', name: 'A' });
        store.addAgent({ id: 'b', type: 'Organization', name: 'B' });
        store.addRelationship({ id: 'r1', subject: 'a', object: 'b', relationship: 'member' });
        store.addRelationship({ id: 'r2', subject: 'b', object: 'a', relationship: 'steward' });

        expect(store.removeRelationship('r1')).toBe(true);
        expect(store.removeRelationship('r1')).toBe(false); // already gone
        expect(store.allRelationships()).toHaveLength(1);
        expect(store.allRelationships()[0].id).toBe('r2');
        // Agents untouched
        expect(store.getAgent('a')).toBeDefined();
        expect(store.getAgent('b')).toBeDefined();
    });

    test('removeAgent cascades relationships where agent is subject or object', () => {
        const store = new AgentStore();
        store.addAgent({ id: 'a', type: 'Organization', name: 'A' });
        store.addAgent({ id: 'b', type: 'Organization', name: 'B' });
        store.addAgent({ id: 'c', type: 'Organization', name: 'C' });
        store.addRelationship({ id: 'r1', subject: 'a', object: 'b', relationship: 'member' });
        store.addRelationship({ id: 'r2', subject: 'b', object: 'c', relationship: 'member' });
        store.addRelationship({ id: 'r3', subject: 'c', object: 'a', relationship: 'member' });

        const removed = store.removeAgent('b');
        expect(removed.sort()).toEqual(['r1', 'r2']);
        expect(store.getAgent('b')).toBeUndefined();
        expect(store.allRelationships()).toHaveLength(1);
        expect(store.allRelationships()[0].id).toBe('r3');
    });
});

describe('buildMembershipIndex round-trip', () => {
    test('3 scopes + persons produce correct index', () => {
        const store = makeHierarchy();
        const idx = buildMembershipIndex(store.allAgents(), store.allRelationships());

        expect(idx.citizens.size).toBe(10);
        expect(idx.scopeParent.get('commune-1')).toBe('fed-a');
        expect(idx.scopeParent.get('commune-2')).toBe('fed-a');
        expect(idx.scopeParent.get('commune-3')).toBe('fed-b');
        expect(idx.scopeParent.get('fed-a')).toBe('uc');
        expect(idx.scopeParent.get('fed-b')).toBe('uc');

        // personToScope: each person mapped to their commune
        for (let i = 0; i < 5; i++) expect(idx.personToScope.get(`p1-${i}`)).toBe('commune-1');
        for (let i = 0; i < 3; i++) expect(idx.personToScope.get(`p2-${i}`)).toBe('commune-2');
        for (let i = 0; i < 2; i++) expect(idx.personToScope.get(`p3-${i}`)).toBe('commune-3');

        // descendantCitizens: commune-1 has 5, fed-a has 8 (5+3), uc has 10
        expect(idx.scopeToDescendantCitizens.get('commune-1')!.size).toBe(5);
        expect(idx.scopeToDescendantCitizens.get('commune-2')!.size).toBe(3);
        expect(idx.scopeToDescendantCitizens.get('fed-a')!.size).toBe(8);
        expect(idx.scopeToDescendantCitizens.get('fed-b')!.size).toBe(2);
        expect(idx.scopeToDescendantCitizens.get('uc')!.size).toBe(10);
    });
});

describe('dynamic scope addition and removal', () => {
    test('adding a scope dynamically appears in rebuilt index', () => {
        const store = makeHierarchy();

        // Add a new commune under fed-b
        store.addAgent({ id: 'commune-4', type: 'Organization', name: 'Commune 4' });
        store.addRelationship({ subject: 'commune-4', object: 'fed-b', relationship: 'member' });
        store.addAgent({ id: 'p4-0', type: 'Person', name: 'Person 4-0' });
        store.addRelationship({ subject: 'p4-0', object: 'commune-4', relationship: 'member' });

        const idx = buildMembershipIndex(store.allAgents(), store.allRelationships());
        expect(idx.scopeParent.get('commune-4')).toBe('fed-b');
        expect(idx.personToScope.get('p4-0')).toBe('commune-4');
        expect(idx.scopeToDescendantCitizens.get('commune-4')!.size).toBe(1);
        expect(idx.scopeToDescendantCitizens.get('fed-b')!.size).toBe(3); // was 2, now 3
        expect(idx.citizens.size).toBe(11);
    });

    test('removing a scope dynamically disappears from rebuilt index', () => {
        const store = makeHierarchy();

        // Remove commune-3 (and its persons)
        store.removeAgent('commune-3');
        // Persons p3-* now have dangling relationships (removed by cascade on commune-3)
        // But person agents still exist — their membership rels pointed at commune-3 which was removed
        // However removeAgent only cascades rels where commune-3 is subject/object
        // p3-0 → commune-3 has object=commune-3, so those ARE removed by cascade

        const idx = buildMembershipIndex(store.allAgents(), store.allRelationships());
        expect(idx.scopeParent.has('commune-3')).toBe(false);
        // p3-* still exist as Person agents but have no membership → not in personToScope
        expect(idx.personToScope.has('p3-0')).toBe(false);
        expect(idx.personToScope.has('p3-1')).toBe(false);
        expect(idx.scopeToDescendantCitizens.has('commune-3')).toBe(false);
        expect(idx.scopeToDescendantCitizens.get('fed-b')?.size ?? 0).toBe(0);
        expect(idx.scopeToDescendantCitizens.get('uc')!.size).toBe(8); // was 10, lost 2
    });
});

describe('integration: agent-derived hierarchy → planFederation', () => {
    test('3-scope hierarchy produces correct planOrder', () => {
        const store = makeHierarchy();
        const idx = buildMembershipIndex(store.allAgents(), store.allRelationships());

        // Derive scopeIds
        const scopeIds: string[] = [];
        const seen = new Set<string>();
        for (const scope of idx.personToScope.values()) seen.add(scope);
        for (const [child, parent] of idx.scopeParent) { seen.add(child); seen.add(parent); }
        scopeIds.push(...seen);

        // Derive memberCounts
        const memberCounts = new Map<string, number>();
        for (const scope of idx.personToScope.values())
            memberCounts.set(scope, (memberCounts.get(scope) ?? 0) + 1);

        const recipeStore = new RecipeStore();
        const observer = new Observer();
        const bufferZoneStore = new BufferZoneStore();
        const emptyAgentIndex = buildAgentIndex([], [], new SpatialThingStore());
        const demandIndex = buildIndependentDemandIndex([], [], [], new SpatialThingStore());
        const supplyIndex = buildIndependentSupplyIndex([], [], [], emptyAgentIndex, new SpatialThingStore());

        const result = planFederation(
            scopeIds,
            { from: new Date('2026-01-01'), to: new Date('2026-06-30') },
            {
                recipeStore,
                observer,
                demandIndex,
                supplyIndex,
                parentOf: idx.scopeParent,
                memberCounts,
                bufferZoneStore,
            },
        );

        // planOrder should be topologically sorted: leaves before parents
        const order = result.planOrder;
        expect(order.length).toBe(scopeIds.length);

        // Verify topo property: every child appears before its parent
        const position = new Map(order.map((id, i) => [id, i]));
        for (const [child, parent] of idx.scopeParent) {
            if (position.has(child) && position.has(parent)) {
                expect(position.get(child)!).toBeLessThan(position.get(parent)!);
            }
        }
    });
});
