/**
 * StoreRegistry — cross-scope reference resolution for distributed planning.
 *
 * Maps scopeId → PlanStore and provides:
 *  - Qualified reference format "scopeId::recordId" for cross-scope addressing.
 *  - resolve(qualifiedRef) — parse qualifier, look up store, return record.
 *  - resolveLocal(store, recordId, parentOf?) — local-first with hierarchy fallback.
 *  - subscribe/notify — reactive listener pattern (mirrors Observer.subscribe).
 *  - register/get — basic registry operations.
 */

import { z } from 'zod';

import type { Plan, Commitment, Intent, Process } from '../schemas';
import type { PlanStore, SignalMeta } from './planning';
import type { RemoteTransport } from './remote-transport';

// =============================================================================
// QUALIFIED REFERENCE FORMAT
// =============================================================================

export const QualifiedRefSchema = z.string().regex(/^[^:]+::[^:]+$/);
export type QualifiedRef = z.infer<typeof QualifiedRefSchema>;

/**
 * Encode a scope ID and record ID into a qualified reference string.
 * Format: "scopeId::recordId"
 */
export function qualify(scopeId: string, recordId: string): QualifiedRef {
    return `${scopeId}::${recordId}` as QualifiedRef;
}

/**
 * Parse a qualified reference into its components.
 * Returns null if the string is not a valid qualified reference.
 */
export function parseRef(ref: string): { scopeId: string; recordId: string } | null {
    const idx = ref.indexOf('::');
    if (idx < 1 || idx === ref.length - 2) return null;
    return {
        scopeId: ref.slice(0, idx),
        recordId: ref.slice(idx + 2),
    };
}

// =============================================================================
// RESOLVED RECORD
// =============================================================================

export interface ResolvedRecord {
    plan?: Plan;
    commitment?: Commitment;
    intent?: Intent;
    process?: Process;
    meta?: SignalMeta;
}

// =============================================================================
// STORE REGISTRY
// =============================================================================

export class StoreRegistry {
    private stores = new Map<string, PlanStore>();
    private listeners = new Map<string, Array<() => void>>();
    // Flat index keyed by qualify(scopeId, recordId) → ResolvedRecord
    private _index = new Map<string, ResolvedRecord>();
    // Reverse map for resolveLocal: PlanStore → scopeId
    private _storeToScope = new Map<PlanStore, string>();
    private readonly _transport: RemoteTransport | undefined;

    constructor(transport?: RemoteTransport) {
        this._transport = transport;
    }

    // -------------------------------------------------------------------------
    // Registry operations
    // -------------------------------------------------------------------------

    register(scopeId: string, store: PlanStore): void {
        this.stores.set(scopeId, store);
        this._storeToScope.set(store, scopeId);
        if (this._transport?.announce) {
            void this._transport.announce(scopeId, store).catch(() => { /* swallow */ });
        }
    }

    get(scopeId: string): PlanStore | undefined {
        return this.stores.get(scopeId);
    }

    allScopeIds(): string[] {
        return Array.from(this.stores.keys());
    }

    /**
     * Aggregate intents with a given tag across all registered stores.
     * Returns each matching intent annotated with its owning scope ID.
     */
    intentsForTag(tag: string): Array<{ scopeId: string; intent: Intent }> {
        const results: Array<{ scopeId: string; intent: Intent }> = [];
        for (const [scopeId, store] of this.stores) {
            for (const intent of store.intentsForTag(tag)) {
                results.push({ scopeId, intent });
            }
        }
        return results;
    }

    // -------------------------------------------------------------------------
    // Cross-scope resolution
    // -------------------------------------------------------------------------

    /**
     * Resolve a qualified reference ("scopeId::recordId") to a record in the
     * corresponding scope's store.
     *
     * Returns an empty object (not null) if the scope or record is not found,
     * so callers can safely destructure without null-checking.
     */
    resolve(qualifiedRef: QualifiedRef): ResolvedRecord {
        const cached = this._index.get(qualifiedRef);
        if (cached) return cached;
        const parsed = parseRef(qualifiedRef);
        if (!parsed) return {};
        const store = this.stores.get(parsed.scopeId);
        if (!store) return {};
        const result = this._lookupInStore(store, parsed.recordId);
        if (result.plan || result.commitment || result.intent || result.process || result.meta) {
            this._index.set(qualifiedRef, result);
        }
        return result;
    }

    /**
     * Async variant: local O(1) first, then remote fetch on miss.
     * Returns {} if no transport is configured or the remote returns nothing.
     */
    async resolveAsync(qualifiedRef: QualifiedRef): Promise<ResolvedRecord> {
        // 1. Fast local path (cached or on-demand)
        const local = this.resolve(qualifiedRef);
        if (local.plan || local.commitment || local.intent || local.process || local.meta) return local;
        // 2. Degrade gracefully if no transport
        if (!this._transport) return {};
        // 3. Parse and remote-fetch
        const parsed = parseRef(qualifiedRef);
        if (!parsed) return {};
        return this._transport.fetch(parsed.scopeId, parsed.recordId);
    }

    /**
     * Resolve a plain record ID within a given store, falling back to ancestor
     * scopes via the parentOf hierarchy if not found locally.
     *
     * @param store     The store to search first.
     * @param recordId  The record ID to find.
     * @param parentOf  Optional scope hierarchy (childScopeId → parentScopeId)
     *                  used to walk up and retry in parent stores.
     */
    resolveLocal(
        store: PlanStore,
        recordId: string,
        parentOf?: Map<string, string>,
    ): ResolvedRecord {
        const local = this._lookup(store, recordId);
        if (local.plan || local.commitment || local.intent || local.process) return local;

        if (!parentOf) return {};

        // Find this store's scope ID so we can walk the hierarchy
        for (const [scopeId, s] of this.stores) {
            if (s !== store) continue;
            let current = parentOf.get(scopeId);
            while (current) {
                const parentStore = this.stores.get(current);
                if (parentStore) {
                    const result = this._lookup(parentStore, recordId);
                    if (result.plan || result.commitment || result.intent || result.process) return result;
                }
                current = parentOf.get(current);
            }
            break;
        }

        return {};
    }

    // -------------------------------------------------------------------------
    // Reactive subscription (mirrors Observer.subscribe pattern)
    // -------------------------------------------------------------------------

    /**
     * Subscribe to change notifications for a specific scope.
     * Returns an unsubscribe function.
     */
    subscribe(scopeId: string, listener: () => void): () => void {
        const bucket = this.listeners.get(scopeId) ?? [];
        bucket.push(listener);
        this.listeners.set(scopeId, bucket);
        return () => {
            const current = this.listeners.get(scopeId);
            if (!current) return;
            const next = current.filter(l => l !== listener);
            if (next.length === 0) {
                this.listeners.delete(scopeId);
            } else {
                this.listeners.set(scopeId, next);
            }
        };
    }

    /**
     * Notify all listeners registered for a given scope that its store has changed.
     */
    notify(scopeId: string): void {
        const bucket = this.listeners.get(scopeId);
        if (!bucket) return;
        for (const listener of bucket) listener();
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    private _lookup(store: PlanStore, recordId: string): ResolvedRecord {
        const scopeId = this._storeToScope.get(store);
        if (!scopeId) return {};
        // Check cache first, then on-demand
        const cached = this._index.get(qualify(scopeId, recordId));
        if (cached) return cached;
        const result = this._lookupInStore(store, recordId);
        if (result.plan || result.commitment || result.intent || result.process || result.meta) {
            this._index.set(qualify(scopeId, recordId), result);
        }
        return result;
    }

    private _lookupInStore(store: PlanStore, recordId: string): ResolvedRecord {
        const plan = store.getPlan(recordId);
        if (plan) return { plan };
        const commitment = store.getCommitment(recordId);
        if (commitment) return { commitment };
        const intent = store.getIntent(recordId);
        if (intent) {
            const meta = store.getMeta(recordId);
            return meta ? { intent, meta } : { intent };
        }
        const process = store.allProcesses().find(p => p.id === recordId);
        if (process) return { process };
        const meta = store.getMeta(recordId);
        if (meta) return { meta };
        return {};
    }
}
