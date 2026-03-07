import { nanoid } from 'nanoid';
import type { CapacityBuffer } from '../schemas';

export class CapacityBufferStore {
    private buffers = new Map<string, CapacityBuffer>();

    constructor(private generateId: () => string = () => nanoid()) {}

    addBuffer(b: Omit<CapacityBuffer, 'id'> & { id?: string }): CapacityBuffer {
        const buf: CapacityBuffer = { id: b.id ?? this.generateId(), ...b } as CapacityBuffer;
        this.buffers.set(buf.id, buf);
        return buf;
    }

    getBuffer(id: string): CapacityBuffer | undefined {
        return this.buffers.get(id);
    }

    bufferForSpec(processSpecId: string): CapacityBuffer | undefined {
        return [...this.buffers.values()].find(b => b.processSpecId === processSpecId);
    }

    allBuffers(): CapacityBuffer[] {
        return [...this.buffers.values()];
    }

    updateBuffer(id: string, updates: Partial<Omit<CapacityBuffer, 'id'>>): void {
        const b = this.buffers.get(id);
        if (b) this.buffers.set(id, { ...b, ...updates });
    }
}
