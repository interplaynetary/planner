import type { PlanStore } from './planning';
import type { RemoteTransport } from './remote-transport';
import { snapshotStore } from './remote-transport';
import type { ResolvedRecord } from './store-registry';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_ANNOUNCE_TIMEOUT_MS = 15_000;

export class ReticulumTransport implements RemoteTransport {
    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly announceTimeoutMs: number;

    constructor(
        port = 7733,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        announceTimeoutMs = DEFAULT_ANNOUNCE_TIMEOUT_MS,
    ) {
        this.baseUrl = `http://localhost:${port}`;
        this.timeoutMs = timeoutMs;
        this.announceTimeoutMs = announceTimeoutMs;
    }

    async fetch(scopeId: string, recordId: string): Promise<ResolvedRecord> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            let response: Response;
            try {
                response = await fetch(`${this.baseUrl}/resolve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scopeId, recordId }),
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
            if (!response.ok) return {};
            const data = await response.json() as unknown;
            if (typeof data === 'object' && data !== null) return data as ResolvedRecord;
            return {};
        } catch {
            return {};  // AbortError, connection refused, bad JSON — all degrade gracefully
        }
    }

    async announce(scopeId: string, store: PlanStore): Promise<void> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.announceTimeoutMs);
            try {
                await fetch(`${this.baseUrl}/announce`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scopeId, records: snapshotStore(store) }),
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
        } catch {
            console.warn(`[ReticulumTransport] announce failed for scope "${scopeId}"`);
        }
    }
}
