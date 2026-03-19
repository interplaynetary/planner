import { PlanStore } from './planning';
import type { SignalMeta } from './planning';
import type { ResolvedRecord } from './store-registry';
import type { Plan, Commitment, Intent, Process } from '../schemas';
import { ProcessRegistry } from '../process-registry';

export interface ScopeSnapshot {
    plans:       Plan[];
    commitments: Commitment[];
    intents:     Intent[];
    processes:   Process[];
    meta:        Record<string, SignalMeta>;
}

/** Transport-agnostic interface for cross-node record resolution. */
export interface RemoteTransport {
    /** Returns {} on any error — never throws. */
    fetch(scopeId: string, recordId: string): Promise<ResolvedRecord>;
    /** Fire-and-forget: advertise this scope to the network. Optional. */
    announce?(scopeId: string, store: PlanStore): Promise<void>;
}

/** Serialize a PlanStore's records for the wire protocol. */
export function snapshotStore(store: PlanStore): ScopeSnapshot {
    return {
        plans:       store.allPlans(),
        commitments: store.allCommitments(),
        intents:     store.allIntents(),
        processes:   store.allProcesses(),
        meta:        Object.fromEntries(store.allMeta()),
    };
}

/** Reconstruct a PlanStore from a received snapshot. */
export function hydrateStore(snapshot: ScopeSnapshot): PlanStore {
    const registry = new ProcessRegistry();
    for (const process of snapshot.processes) registry.register(process);
    const store = new PlanStore(registry);
    for (const plan of snapshot.plans) store.addPlan(plan);
    for (const commitment of snapshot.commitments) store.addCommitment(commitment);
    for (const intent of snapshot.intents) store.addIntent(intent);
    for (const [id, m] of Object.entries(snapshot.meta)) store.setMeta(id, m);
    return store;
}
