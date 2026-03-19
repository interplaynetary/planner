import type { PlanStore } from './planning';
import type { RemoteTransport } from './remote-transport';
import { snapshotStore } from './remote-transport';
import type { ResolvedRecord } from './store-registry';

export class MockTransport implements RemoteTransport {
    readonly store = new Map<string, Map<string, ResolvedRecord>>();
    readonly announced: string[] = [];
    latencyMs = 0;

    async fetch(scopeId: string, recordId: string): Promise<ResolvedRecord> {
        if (this.latencyMs > 0) await new Promise(r => setTimeout(r, this.latencyMs));
        return this.store.get(scopeId)?.get(recordId) ?? {};
    }

    async announce(scopeId: string, store: PlanStore): Promise<void> {
        const snapshot = snapshotStore(store);
        const bucket = new Map<string, ResolvedRecord>();
        for (const plan of snapshot.plans)             bucket.set(plan.id, { plan });
        for (const commitment of snapshot.commitments) bucket.set(commitment.id, { commitment });
        for (const intent of snapshot.intents)         bucket.set(intent.id, { intent });
        for (const process of snapshot.processes)       bucket.set(process.id, { process });
        for (const [id, m] of Object.entries(snapshot.meta)) {
            const existing = bucket.get(id);
            if (existing) existing.meta = m;
            else bucket.set(id, { meta: m });
        }
        this.store.set(scopeId, bucket);
        this.announced.push(scopeId);
    }

    seedRecord(scopeId: string, recordId: string, record: ResolvedRecord): void {
        if (!this.store.has(scopeId)) this.store.set(scopeId, new Map());
        this.store.get(scopeId)!.set(recordId, record);
    }
}
