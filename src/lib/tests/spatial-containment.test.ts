import { describe, it, expect } from 'bun:test';
import { SpatialThingStore } from '../knowledge/spatial-things';

function makeHierarchy(): SpatialThingStore {
    const store = new SpatialThingStore();
    store.addLocation({ id: 'building', name: 'East Building', lat: 38.555, long: -91.131 });
    store.addLocation({ id: 'floor-2', name: 'Floor 2', containedIn: 'building' });
    store.addLocation({ id: 'floor-3', name: 'Floor 3', containedIn: 'building' });
    store.addLocation({ id: 'room-3b', name: 'Room 3B', containedIn: 'floor-2' });
    store.addLocation({ id: 'room-3c', name: 'Room 3C', containedIn: 'floor-2' });
    return store;
}

describe('SpatialThingStore — containment hierarchy', () => {
    it('resolveChain returns [self, parent, ..., root]', () => {
        const store = makeHierarchy();
        const chain = store.resolveChain('room-3b');
        expect(chain.map(s => s.id)).toEqual(['room-3b', 'floor-2', 'building']);
    });

    it('resolveChain for root returns single element', () => {
        const store = makeHierarchy();
        expect(store.resolveChain('building').map(s => s.id)).toEqual(['building']);
    });

    it('resolveChain for unknown ID returns empty', () => {
        const store = makeHierarchy();
        expect(store.resolveChain('nonexistent')).toEqual([]);
    });

    it('resolveRoot returns topmost ancestor', () => {
        const store = makeHierarchy();
        expect(store.resolveRoot('room-3b')!.id).toBe('building');
        expect(store.resolveRoot('floor-2')!.id).toBe('building');
        expect(store.resolveRoot('building')!.id).toBe('building');
    });

    it('resolveCoordinates inherits from ancestor with coordinates', () => {
        const store = makeHierarchy();
        // room-3b has no coords, but building does
        const coords = store.resolveCoordinates('room-3b');
        expect(coords).toEqual({ lat: 38.555, long: -91.131 });
    });

    it('resolveCoordinates returns own coords when present', () => {
        const store = makeHierarchy();
        const coords = store.resolveCoordinates('building');
        expect(coords).toEqual({ lat: 38.555, long: -91.131 });
    });

    it('resolveCoordinates returns undefined for chain without coords', () => {
        const store = new SpatialThingStore();
        store.addLocation({ id: 'a', name: 'A' });
        store.addLocation({ id: 'b', name: 'B', containedIn: 'a' });
        expect(store.resolveCoordinates('b')).toBeUndefined();
    });

    it('isDescendantOrEqual: self', () => {
        const store = makeHierarchy();
        expect(store.isDescendantOrEqual('room-3b', 'room-3b')).toBe(true);
    });

    it('isDescendantOrEqual: direct child', () => {
        const store = makeHierarchy();
        expect(store.isDescendantOrEqual('floor-2', 'building')).toBe(true);
    });

    it('isDescendantOrEqual: grandchild', () => {
        const store = makeHierarchy();
        expect(store.isDescendantOrEqual('room-3b', 'building')).toBe(true);
    });

    it('isDescendantOrEqual: non-descendant', () => {
        const store = makeHierarchy();
        // floor-3 is sibling of floor-2, not descendant
        expect(store.isDescendantOrEqual('floor-3', 'floor-2')).toBe(false);
        // building is NOT a descendant of room-3b
        expect(store.isDescendantOrEqual('building', 'room-3b')).toBe(false);
    });

    it('isDescendantOrEqual: cross-branch siblings', () => {
        const store = makeHierarchy();
        expect(store.isDescendantOrEqual('room-3b', 'room-3c')).toBe(false);
        expect(store.isDescendantOrEqual('room-3c', 'room-3b')).toBe(false);
    });

    it('childrenOf returns direct children only', () => {
        const store = makeHierarchy();
        const children = store.childrenOf('building');
        expect(children.map(s => s.id).sort()).toEqual(['floor-2', 'floor-3']);
    });

    it('childrenOf does not include grandchildren', () => {
        const store = makeHierarchy();
        const children = store.childrenOf('building');
        expect(children.some(s => s.id === 'room-3b')).toBe(false);
    });

    it('childrenOf leaf returns empty', () => {
        const store = makeHierarchy();
        expect(store.childrenOf('room-3b')).toEqual([]);
    });

    it('cycle detection: addLocation throws on direct cycle', () => {
        const store = new SpatialThingStore();
        store.addLocation({ id: 'a', name: 'A' });
        store.addLocation({ id: 'b', name: 'B', containedIn: 'a' });
        expect(() => {
            store.addLocation({ id: 'a', name: 'A-cycle', containedIn: 'b' });
        }).toThrow(/cycle/i);
    });

    it('cycle detection: addLocation throws on transitive cycle', () => {
        const store = new SpatialThingStore();
        store.addLocation({ id: 'a', name: 'A' });
        store.addLocation({ id: 'b', name: 'B', containedIn: 'a' });
        store.addLocation({ id: 'c', name: 'C', containedIn: 'b' });
        expect(() => {
            store.addLocation({ id: 'a', name: 'A-cycle', containedIn: 'c' });
        }).toThrow(/cycle/i);
    });

    it('deep chain (5 levels) resolves correctly', () => {
        const store = new SpatialThingStore();
        store.addLocation({ id: 'l1', name: 'L1', lat: 10, long: 20 });
        store.addLocation({ id: 'l2', name: 'L2', containedIn: 'l1' });
        store.addLocation({ id: 'l3', name: 'L3', containedIn: 'l2' });
        store.addLocation({ id: 'l4', name: 'L4', containedIn: 'l3' });
        store.addLocation({ id: 'l5', name: 'L5', containedIn: 'l4' });

        expect(store.resolveChain('l5').map(s => s.id)).toEqual(['l5', 'l4', 'l3', 'l2', 'l1']);
        expect(store.resolveCoordinates('l5')).toEqual({ lat: 10, long: 20 });
        expect(store.isDescendantOrEqual('l5', 'l1')).toBe(true);
        expect(store.isDescendantOrEqual('l5', 'l3')).toBe(true);
    });
});
