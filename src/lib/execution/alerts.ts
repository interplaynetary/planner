/**
 * Execution Alerts — typed discriminated union for reactive execution monitoring.
 *
 * Analogous to PlanSignal in the planning layer. Alerts are emitted by
 * monitors when Observer events affect buffer health, material sync,
 * or lead time status.
 */

import { z } from 'zod';
import type { ObserverEvent } from '../observation/observer';

// =============================================================================
// ALERT SCHEMAS
// =============================================================================

export const BufferStatusAlertSchema = z.object({
    kind: z.literal('buffer-status'),
    specId: z.string(),
    zone: z.enum(['red', 'yellow', 'green', 'excess']),
    onhand: z.number(),
    tor: z.number(),
    toy: z.number(),
    tog: z.number(),
    timestamp: z.string(),
});

export const ADUShiftAlertSchema = z.object({
    kind: z.literal('adu-shift'),
    specId: z.string(),
    direction: z.enum(['surge', 'drop']),
    previousADU: z.number(),
    currentADU: z.number(),
    changePct: z.number(),
    timestamp: z.string(),
});

export const MaterialSyncAlertSchema = z.object({
    kind: z.literal('material-sync'),
    specId: z.string(),
    processId: z.string(),
    inputCommitmentId: z.string(),
    requiredQty: z.number(),
    projectedAvailable: z.number(),
    shortage: z.number(),
    timestamp: z.string(),
});

export const LeadTimeAlertSchema = z.object({
    kind: z.literal('lead-time'),
    orderId: z.string(),
    specId: z.string(),
    dueDate: z.string(),
    daysRemaining: z.number(),
    alertZone: z.enum(['green', 'yellow', 'red', 'late']),
    timestamp: z.string(),
});

export const ExecutionAlertSchema = z.discriminatedUnion('kind', [
    BufferStatusAlertSchema,
    ADUShiftAlertSchema,
    MaterialSyncAlertSchema,
    LeadTimeAlertSchema,
]);
export type ExecutionAlert = z.infer<typeof ExecutionAlertSchema>;

// =============================================================================
// MONITOR — pure function type
// =============================================================================

/**
 * A Monitor is a pure function: ObserverEvent × Context → ExecutionAlert[].
 *
 * Monitors don't subscribe themselves. They're called by the execution engine
 * on each event. Composition is array concatenation.
 */
export type Monitor = (event: ObserverEvent, ctx: ExecutionContext) => ExecutionAlert[];

/**
 * A Sink is a side-effect function: ObserverEvent × Context → void.
 *
 * Sinks consume events for state accumulation (e.g., snapshots) rather than
 * alert production. Same composition: array of sinks.
 */
export type Sink = (event: ObserverEvent, ctx: ExecutionContext) => void;

/** Shared context available to all monitors and sinks. */
export interface ExecutionContext {
    observer: import('../observation/observer').Observer;
    planStore: import('../planning/planning').PlanStore;
    bufferZoneStore: import('../knowledge/buffer-zones').BufferZoneStore;
    snapshotStore: import('../knowledge/buffer-snapshots').BufferSnapshotStore;
}

// =============================================================================
// ALERT STORE — composable accumulator
// =============================================================================

export class AlertStore {
    private readonly alerts: ExecutionAlert[] = [];

    push(alert: ExecutionAlert): void {
        this.alerts.push(alert);
    }

    /** Create a bound emitter for this store. */
    emitter(): (alert: ExecutionAlert) => void {
        return (alert) => this.push(alert);
    }

    ofKind<K extends ExecutionAlert['kind']>(kind: K): Extract<ExecutionAlert, { kind: K }>[] {
        return this.alerts.filter((a): a is Extract<ExecutionAlert, { kind: K }> => a.kind === kind);
    }

    forSpec(specId: string): ExecutionAlert[] {
        return this.alerts.filter(a => a.specId === specId);
    }

    since(timestamp: string): ExecutionAlert[] {
        return this.alerts.filter(a => a.timestamp >= timestamp);
    }

    all(): readonly ExecutionAlert[] {
        return this.alerts;
    }

    get length(): number {
        return this.alerts.length;
    }

    clear(): void {
        this.alerts.length = 0;
    }
}
