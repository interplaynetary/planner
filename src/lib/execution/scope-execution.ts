/**
 * Scope Execution — reactive execution engine for a scope.
 *
 * One Observer subscription dispatches events to all monitors and sinks.
 * Monitors are pure functions (event → alerts). Sinks are side effects.
 * Composition: add/remove monitors via array. Federation aggregates alert stores.
 *
 * ```
 * const { alerts, teardown } = startExecution(ctx);
 * // ... Observer events fire, alerts accumulate ...
 * const redBuffers = alerts.ofKind('buffer-status').filter(a => a.zone === 'red');
 * teardown();
 * ```
 */

import { AlertStore, type ExecutionAlert, type ExecutionContext, type Monitor, type Sink } from './alerts';
import { standardMonitors, standardSinks } from './monitors';

// =============================================================================
// EXECUTION ENGINE
// =============================================================================

export interface ExecutionHandle {
    /** Accumulated alerts from all monitors. */
    alerts: AlertStore;
    /** Stop listening. */
    teardown: () => void;
}

/**
 * Start reactive execution for a scope.
 *
 * Subscribes once to the Observer. Each event is dispatched to all monitors
 * (producing alerts) and all sinks (side effects). Alerts go to both the
 * local AlertStore and an optional external emitter (for federation aggregation).
 *
 * @param ctx      — scope's execution context
 * @param monitors — alert-producing functions (default: standardMonitors())
 * @param sinks    — side-effect functions (default: standardSinks())
 * @param forward  — optional callback for federation aggregation
 */
export function startExecution(
    ctx: ExecutionContext,
    monitors: Monitor[] = standardMonitors(),
    sinks: Sink[] = standardSinks(),
    forward?: (alert: ExecutionAlert) => void,
): ExecutionHandle {
    const alerts = new AlertStore();

    const unsubscribe = ctx.observer.subscribe((event) => {
        // Monitors: pure event → alerts
        for (const monitor of monitors) {
            for (const alert of monitor(event, ctx)) {
                alerts.push(alert);
                forward?.(alert);
            }
        }
        // Sinks: side effects
        for (const sink of sinks) {
            sink(event, ctx);
        }
    });

    return { alerts, teardown: unsubscribe };
}

// Re-export for convenience
export { type ExecutionContext, type Monitor, type Sink } from './alerts';
export { standardMonitors, standardSinks, bufferStatusMonitor, materialSyncMonitor, createADUShiftMonitor, createSnapshotSink } from './monitors';
