import { nanoid } from 'nanoid';
import type { SpatialThing } from '../schemas';

export class SpatialThingStore {
    private _locations = new Map<string, SpatialThing>();

    addLocation(loc: Omit<SpatialThing, 'id'> & { id?: string }): SpatialThing {
        const location: SpatialThing = { id: loc.id ?? nanoid(), ...loc };

        // Cycle detection: if containedIn is set, ensure the new location's ID
        // does not already appear in the proposed parent's ancestor chain.
        if (location.containedIn) {
            const chain = this.resolveChain(location.containedIn);
            if (chain.some(st => st.id === location.id)) {
                throw new Error(
                    `SpatialThing cycle detected: adding '${location.id}' with containedIn '${location.containedIn}' would create a cycle`,
                );
            }
        }

        this._locations.set(location.id, location);
        return location;
    }

    getLocation(id: string): SpatialThing | undefined {
        return this._locations.get(id);
    }

    allLocations(): SpatialThing[] {
        return [...this._locations.values()];
    }

    /**
     * Walk the containedIn chain from `id` to the topmost ancestor (root).
     * Returns undefined if `id` is not found.
     */
    resolveRoot(id: string): SpatialThing | undefined {
        const chain = this.resolveChain(id);
        return chain.length > 0 ? chain[chain.length - 1] : undefined;
    }

    /**
     * Walk the containedIn chain upward, returning the first location
     * (including self) that has both lat and long defined.
     */
    resolveCoordinates(id: string): { lat: number; long: number } | undefined {
        const chain = this.resolveChain(id);
        for (const st of chain) {
            if (st.lat !== undefined && st.long !== undefined) {
                return { lat: st.lat, long: st.long };
            }
        }
        return undefined;
    }

    /**
     * Return the full containment chain: [self, parent, grandparent, ..., root].
     * Empty array if `id` is not found. Breaks on cycle or missing parent.
     */
    resolveChain(id: string): SpatialThing[] {
        const chain: SpatialThing[] = [];
        const visited = new Set<string>();
        let currentId: string | undefined = id;

        while (currentId) {
            if (visited.has(currentId)) break; // cycle guard
            const st = this._locations.get(currentId);
            if (!st) break;
            visited.add(currentId);
            chain.push(st);
            currentId = st.containedIn;
        }

        return chain;
    }

    /**
     * Returns true if `candidateId` is equal to `ancestorId` or is a
     * descendant (directly or transitively contained within) `ancestorId`.
     */
    isDescendantOrEqual(candidateId: string, ancestorId: string): boolean {
        if (candidateId === ancestorId) return true;
        const chain = this.resolveChain(candidateId);
        return chain.some(st => st.id === ancestorId);
    }

    /**
     * Return all locations whose containedIn directly references `id`.
     */
    childrenOf(id: string): SpatialThing[] {
        return this.allLocations().filter(st => st.containedIn === id);
    }
}
