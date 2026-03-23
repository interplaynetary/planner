/**
 * Execution Monitors — pure functions from ObserverEvent × Context → ExecutionAlert[].
 *
 * Monitors don't manage subscriptions. They're composed as an array and
 * called by the execution engine on each Observer event. Stateful monitors
 * (ADU shift) are factories that return a Monitor closure.
 *
 * Sinks are side-effect functions for state accumulation (snapshots).
 */

import type { ObserverEvent } from '../observation/observer';
import { bufferStatus, computeADU, recalibrateBufferZone } from '../algorithms/ddmrp';
import type { ExecutionAlert, ExecutionContext, Monitor, Sink } from './alerts';
import type { BufferProfile, EconomicEvent, DemandAdjustmentFactor } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';

const NON_CONSUMING_ACTIONS = new Set(['use', 'work', 'cite', 'deliverService']);

// =============================================================================
// MONITORS (event → alerts)
// =============================================================================

/** Buffer status: emits alert when a resource update affects a buffered spec's zone. */
export const bufferStatusMonitor: Monitor = (event, ctx) => {
    if (event.type !== 'resource_updated' && event.type !== 'resource_created') return [];
    const specId = event.resource.conformsTo;
    if (!specId) return [];

    const bz = ctx.bufferZoneStore.findZone(specId);
    if (!bz) return [];

    const onhand = ctx.observer.conformingResources(specId)
        .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
    const status = bufferStatus(onhand, bz);

    return [{
        kind: 'buffer-status' as const,
        specId,
        zone: status.zone,
        onhand,
        tor: bz.tor, toy: bz.toy, tog: bz.tog,
        timestamp: event.event.hasPointInTime ?? event.event.created ?? new Date().toISOString(),
    }];
};

/** Material sync: emits alerts for non-buffered process inputs with projected shortfall. */
export const materialSyncMonitor: Monitor = (event, ctx) => {
    if (event.type !== 'resource_updated' && event.type !== 'recorded') return [];

    const timestamp = event.type === 'recorded'
        ? (event.event.hasPointInTime ?? event.event.created ?? new Date().toISOString())
        : (event.event.hasPointInTime ?? event.event.created ?? new Date().toISOString());

    const alerts: ExecutionAlert[] = [];
    for (const proc of ctx.planStore.allProcesses()) {
        if (proc.finished) continue;
        for (const c of ctx.planStore.commitmentsForProcess(proc.id)) {
            if (c.inputOf !== proc.id || !c.resourceConformsTo || c.finished) continue;
            if (NON_CONSUMING_ACTIONS.has(c.action)) continue;
            if (ctx.bufferZoneStore.findZone(c.resourceConformsTo)) continue;

            const requiredQty = c.resourceQuantity?.hasNumericalValue ?? 0;
            if (requiredQty <= 0) continue;

            let available = ctx.observer.conformingResources(c.resourceConformsTo)
                .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);

            if (c.due) {
                for (const intent of ctx.planStore.allIntents()) {
                    if (intent.outputOf && intent.resourceConformsTo === c.resourceConformsTo
                        && !intent.finished && intent.due && intent.due <= c.due) {
                        available += intent.resourceQuantity?.hasNumericalValue ?? 0;
                    }
                }
            }

            const shortage = requiredQty - available;
            if (shortage > 1e-9) {
                alerts.push({
                    kind: 'material-sync' as const,
                    specId: c.resourceConformsTo,
                    processId: proc.id,
                    inputCommitmentId: c.id,
                    requiredQty,
                    projectedAvailable: available,
                    shortage,
                    timestamp,
                });
            }
        }
    }
    return alerts;
};

/**
 * ADU shift: factory returning a stateful Monitor that tracks rolling consumption
 * and emits alerts when ADU breaches thresholds.
 */
export function createADUShiftMonitor(): Monitor {
    const recentConsumption = new Map<string, number[]>();

    return (event, ctx) => {
        if (event.type !== 'recorded') return [];
        const ev = event.event;
        if (NON_CONSUMING_ACTIONS.has(ev.action)) return [];
        const specId = ev.resourceConformsTo;
        if (!specId) return [];

        const bz = ctx.bufferZoneStore.findZone(specId);
        if (!bz || (!bz.aduAlertHighPct && !bz.aduAlertLowPct)) return [];

        const qty = ev.resourceQuantity?.hasNumericalValue ?? 0;
        if (qty <= 0) return [];

        const history = recentConsumption.get(specId) ?? [];
        history.push(qty);
        recentConsumption.set(specId, history);

        const windowDays = bz.aduAlertWindowDays ?? 30;
        while (history.length > windowDays * 3) history.shift();
        const totalConsumed = history.reduce((s, q) => s + q, 0);
        const currentADU = totalConsumed / Math.max(1, Math.min(history.length, windowDays));

        if (bz.adu <= 0) return [];
        const changePct = (currentADU - bz.adu) / bz.adu;
        const timestamp = ev.hasPointInTime ?? ev.created ?? new Date().toISOString();

        if (bz.aduAlertHighPct && changePct > bz.aduAlertHighPct) {
            return [{
                kind: 'adu-shift' as const,
                specId,
                direction: 'surge' as const,
                previousADU: bz.adu,
                currentADU,
                changePct,
                timestamp,
            }];
        }
        if (bz.aduAlertLowPct && changePct < -bz.aduAlertLowPct) {
            return [{
                kind: 'adu-shift' as const,
                specId,
                direction: 'drop' as const,
                previousADU: bz.adu,
                currentADU,
                changePct: Math.abs(changePct),
                timestamp,
            }];
        }
        return [];
    };
}

// =============================================================================
// SINKS (event → side effects)
// =============================================================================

/** Snapshot capture: writes daily buffer state to BufferSnapshotStore. */
export function createSnapshotSink(): Sink {
    let lastDate = '';
    const snapshotted = new Set<string>();

    return (event, ctx) => {
        if (event.type !== 'resource_updated') return;
        const specId = event.resource.conformsTo;
        if (!specId) return;

        const bz = ctx.bufferZoneStore.findZone(specId);
        if (!bz) return;

        const eventDate = (event.event.hasPointInTime ?? event.event.created ?? new Date().toISOString()).slice(0, 10);

        if (eventDate !== lastDate) {
            snapshotted.clear();
            lastDate = eventDate;
        }
        if (snapshotted.has(specId)) return;
        snapshotted.add(specId);

        const onhand = ctx.observer.conformingResources(specId)
            .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
        const status = bufferStatus(onhand, bz);

        ctx.snapshotStore.record({
            specId,
            date: eventDate,
            onhand,
            tor: bz.tor, toy: bz.toy, tog: bz.tog,
            zone: status.zone,
        });
    };
}

/**
 * Recalibration sink: recalibrates overdue buffer zones on inventory changes.
 * Event-driven alternative to cron — fires at the first Observer event after
 * the cadence threshold is crossed.
 */
export function createRecalibrationSink(
    profiles: Map<string, BufferProfile>,
    events: EconomicEvent[],
    recipeStore: RecipeStore,
): Sink {
    return (event, ctx) => {
        if (event.type !== 'resource_updated' && event.type !== 'recorded') return;

        const specId = event.type === 'resource_updated'
            ? event.resource.conformsTo
            : event.event.resourceConformsTo;
        if (!specId) return;

        const zone = ctx.bufferZoneStore.findZone(specId);
        if (!zone) return;

        const profile = profiles.get(zone.profileId);
        if (!profile?.recalculationCadence) return;

        const ageMs = new Date().getTime() - new Date(zone.lastComputedAt).getTime();
        const thresholds: Record<string, number> = {
            daily: 86_400_000,
            weekly: 604_800_000,
            monthly: 2_592_000_000,
        };
        const threshold = thresholds[profile.recalculationCadence];
        if (!threshold || ageMs < threshold) return;

        // Overdue — recalibrate
        const windowDays = zone.aduWindowDays ?? 90;
        const asOf = new Date();
        const { adu } = computeADU(events, specId, windowDays, asOf);
        const updated = recalibrateBufferZone(zone, adu, zone.dltDays, profile, [], asOf);
        ctx.bufferZoneStore.replaceZone(updated);
    };
}

// =============================================================================
// STANDARD SET
// =============================================================================

/** The default set of monitors. Compose with custom monitors via array concat. */
export function standardMonitors(): Monitor[] {
    return [bufferStatusMonitor, materialSyncMonitor, createADUShiftMonitor()];
}

/** The default set of sinks. */
export function standardSinks(): Sink[] {
    return [createSnapshotSink()];
}
