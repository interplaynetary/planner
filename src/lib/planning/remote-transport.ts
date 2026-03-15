import type { PlanStore } from './planning';
import type { ResolvedRecord } from './store-registry';
import type { Plan, Commitment, Intent } from '../schemas';

export interface ScopeSnapshot {
    plans:       Plan[];
    commitments: Commitment[];
    intents:     Intent[];
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
    };
}
