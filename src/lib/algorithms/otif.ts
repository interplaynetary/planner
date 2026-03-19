/**
 * OTIF (On-Time In-Full) Tracker — delivery performance metrics for VF Commitments.
 *
 * Evaluates each Commitment against its fulfillment events from the Observer to
 * compute per-line and aggregate OTIF metrics:
 *   - In-Full: fulfilled quantity >= committed quantity
 *   - On-Time: delivery date <= due date
 *   - OTIF:    both in-full AND on-time
 *
 * Also supports recurring Commitments via per-occurrence evaluation using
 * groupEventsByOccurrence() from recurrence.ts.
 *
 * Building blocks:
 *   Observer.getFulfillment(commitmentId) → FulfillmentState
 *   groupEventsByOccurrence(), materializeOccurrenceDates() from recurrence.ts
 */

import type { Commitment, EconomicEvent } from '../schemas';
import type { Observer } from '../observation/observer';
import type { AvailabilityWindow } from '../utils/time';
import {
    groupEventsByOccurrence,
    getOccurrenceStatus,
    materializeOccurrenceDates,
} from '../utils/recurrence';

// =============================================================================
// TYPES
// =============================================================================

/** Per-commitment delivery performance detail. */
export interface OTIFLine {
    commitmentId: string;
    specId: string;
    committedQty: number;
    fulfilledQty: number;
    /** True when fulfilledQty >= committedQty (within tolerance). */
    inFull: boolean;
    dueDate: string | undefined;
    /** Earliest date an event was recorded for this commitment. */
    deliveryDate: string | undefined;
    /** Days late (0 if on-time or no due date, positive if late). */
    daysLate: number;
    /** True when deliveryDate <= dueDate (or no due date set). */
    onTime: boolean;
    /** True when both inFull AND onTime. */
    otif: boolean;
}

/** Aggregate OTIF metrics across a set of commitments. */
export interface OTIFResult {
    totalLines: number;
    /** Fraction of lines that are in-full (0–1). */
    fillRate: number;
    /** Fraction of lines that are on-time (0–1). */
    onTimeRate: number;
    /** Fraction of lines that are both on-time AND in-full (0–1). */
    otifRate: number;
    /** Average days late across all lines (0 for on-time lines). */
    avgDaysLate: number;
    lines: OTIFLine[];
}

export interface OTIFOptions {
    /** Quantity tolerance: fulfilledQty >= committedQty * (1 - tolerance) counts as in-full. Default 0. */
    tolerance?: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function daysBetween(a: string, b: string): number {
    const msA = new Date(a).getTime();
    const msB = new Date(b).getTime();
    return Math.round((msB - msA) / (1000 * 60 * 60 * 24));
}

function earliestEventDate(events: EconomicEvent[]): string | undefined {
    let earliest: string | undefined;
    for (const e of events) {
        const d = e.hasPointInTime ?? e.hasBeginning ?? e.created;
        if (d && (!earliest || d < earliest)) earliest = d;
    }
    return earliest;
}

function aggregate(lines: OTIFLine[]): OTIFResult {
    const n = lines.length;
    if (n === 0) {
        return { totalLines: 0, fillRate: 0, onTimeRate: 0, otifRate: 0, avgDaysLate: 0, lines };
    }
    const inFullCount = lines.filter(l => l.inFull).length;
    const onTimeCount = lines.filter(l => l.onTime).length;
    const otifCount = lines.filter(l => l.otif).length;
    const totalDaysLate = lines.reduce((s, l) => s + l.daysLate, 0);
    return {
        totalLines: n,
        fillRate: inFullCount / n,
        onTimeRate: onTimeCount / n,
        otifRate: otifCount / n,
        avgDaysLate: totalDaysLate / n,
        lines,
    };
}

// =============================================================================
// COMPUTE OTIF — point-in-time commitments
// =============================================================================

/**
 * Evaluate OTIF for a set of Commitments against fulfillment data from the Observer.
 *
 * @param commitments  The commitments to evaluate
 * @param observer     Observer holding fulfillment state and events
 * @param opts         Optional tolerance for in-full check
 */
export function computeOTIF(
    commitments: Commitment[],
    observer: Observer,
    opts?: OTIFOptions,
): OTIFResult {
    const tolerance = opts?.tolerance ?? 0;
    const lines: OTIFLine[] = [];

    for (const c of commitments) {
        const committedQty = c.resourceQuantity?.hasNumericalValue ?? 0;
        const specId = c.resourceConformsTo ?? '';
        const dueDate = c.due;

        const fulfillment = observer.getFulfillment(c.id);
        const fulfilledQty = fulfillment?.totalFulfilled.hasNumericalValue ?? 0;

        const inFull = fulfilledQty >= committedQty * (1 - tolerance);

        // Get fulfilling events to find delivery date
        const events = observer.fulfilledBy(c.id);
        const deliveryDate = earliestEventDate(events);

        let daysLate = 0;
        let onTime = true;
        if (dueDate && deliveryDate) {
            const dueDateNorm = dueDate.slice(0, 10);
            const deliveryDateNorm = deliveryDate.slice(0, 10);
            daysLate = Math.max(0, daysBetween(dueDateNorm, deliveryDateNorm));
            onTime = daysLate === 0;
        } else if (dueDate && !deliveryDate && committedQty > 0) {
            // Not yet delivered — count as late if past due
            onTime = false;
            const now = new Date().toISOString().slice(0, 10);
            daysLate = Math.max(0, daysBetween(dueDate.slice(0, 10), now));
        }

        lines.push({
            commitmentId: c.id,
            specId,
            committedQty,
            fulfilledQty,
            inFull,
            dueDate,
            deliveryDate,
            daysLate,
            onTime,
            otif: inFull && onTime,
        });
    }

    return aggregate(lines);
}

// =============================================================================
// COMPUTE RECURRING OTIF — per-occurrence evaluation
// =============================================================================

/**
 * Evaluate OTIF for a recurring Commitment, producing one OTIFLine per occurrence
 * within the specified window.
 *
 * Uses groupEventsByOccurrence() for fulfilled occurrences and
 * materializeOccurrenceDates() to identify expected but unfulfilled occurrences.
 *
 * @param commitment  The recurring commitment (must have availability_window)
 * @param observer    Observer holding fulfillment events
 * @param window      Date range to evaluate: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * @param opts        Optional tolerance for in-full check
 */
export function computeRecurringOTIF(
    commitment: Commitment,
    observer: Observer,
    window: { from: string; to: string },
    opts?: OTIFOptions,
): OTIFResult {
    const tolerance = opts?.tolerance ?? 0;
    const committedQty = commitment.resourceQuantity?.hasNumericalValue ?? 0;
    const specId = commitment.resourceConformsTo ?? '';
    const availWindow = commitment.availability_window as AvailabilityWindow | undefined;

    if (!availWindow) {
        // Non-recurring: fall back to single-line evaluation
        return computeOTIF([commitment], observer, opts);
    }

    // Get all fulfilling events and group by occurrence date
    const events = observer.fulfilledBy(commitment.id);
    const eventsByOccurrence = groupEventsByOccurrence(events);

    // Materialize expected occurrence dates
    const expectedDates = materializeOccurrenceDates(availWindow, window.from, window.to);

    // Get per-occurrence fulfillment status
    const statusMap = getOccurrenceStatus(commitment, eventsByOccurrence);

    const lines: OTIFLine[] = [];

    for (const date of expectedDates) {
        const status = statusMap.get(date);
        const fulfilledQty = status?.fulfilled_quantity ?? 0;
        const inFull = fulfilledQty >= committedQty * (1 - tolerance);

        // For recurring commitments, each occurrence's due date is the occurrence date itself
        const dueDate = date;
        const occurrenceEvents = eventsByOccurrence.get(date) ?? [];
        const deliveryDate = earliestEventDate(occurrenceEvents);

        let daysLate = 0;
        let onTime = true;
        if (deliveryDate) {
            daysLate = Math.max(0, daysBetween(dueDate, deliveryDate.slice(0, 10)));
            onTime = daysLate === 0;
        } else if (committedQty > 0) {
            // No events for this occurrence — late if past due
            const now = new Date().toISOString().slice(0, 10);
            if (now > dueDate) {
                onTime = false;
                daysLate = daysBetween(dueDate, now);
            }
        }

        lines.push({
            commitmentId: commitment.id,
            specId,
            committedQty,
            fulfilledQty,
            inFull,
            dueDate,
            deliveryDate,
            daysLate,
            onTime,
            otif: inFull && onTime,
        });
    }

    return aggregate(lines);
}
