import { nanoid } from 'nanoid';
import type { SpatialThing } from '../schemas';

export class SpatialThingStore {
    private _locations = new Map<string, SpatialThing>();

    addLocation(loc: Omit<SpatialThing, 'id'> & { id?: string }): SpatialThing {
        const location: SpatialThing = { id: loc.id ?? nanoid(), ...loc };
        this._locations.set(location.id, location);
        return location;
    }

    getLocation(id: string): SpatialThing | undefined {
        return this._locations.get(id);
    }

    allLocations(): SpatialThing[] {
        return [...this._locations.values()];
    }
}
