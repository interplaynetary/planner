/**
 * DDMRP Algorithm Layer — pure-function computations for the DDMRP planning cycle.
 *
 * All functions are stateless and side-effect-free. Callers supply the relevant
 * stores / event slices; no internal caching or mutation occurs here.
 *
 * DDMRP ref: Ptak & Smith "Demand Driven Material Requirements Planning" (2nd ed.)
 *   Ch 7  — Strategic Inventory Positioning
 *   Ch 8  — Buffer Profiles and Levels (zone formula)
 *   Ch 9  — Supply Order Generation (NFP, replenishment)
 *   Ch 10 — Demand Driven Sales & Operations Planning (ADU, DLT, execution alerts)
 *   Ch 11 — Demand Driven Scheduling
 *   Ch 12 — Signal Integrity
 */

import type {
    EconomicEvent,
    EconomicResource,
    Duration,
    BufferZone,
    BufferProfile,
    ReplenishmentSignal,
    DemandAdjustmentFactor,
    Intent,
    Commitment,
    RecipeProcess,
    PositioningAnalysis,
} from '../schemas';
import { ACTION_DEFINITIONS } from '../schemas';
import type { PlanStore } from '../planning/planning';
import type { Observer, FulfillmentState } from '../observation/observer';
import type { RecipeStore } from '../knowledge/recipes';
import type { BufferZoneStore } from '../knowledge/buffer-zones';
import { materializeOccurrenceDates } from '../utils/recurrence';
import { isSpecificDateWindow } from '../utils/time';
import type { AvailabilityWindow } from '../utils/time';

// =============================================================================
// INTERNAL CONSTANTS
// =============================================================================

/**
 * Actions that record usage/effort but do NOT reduce physical inventory
 * (onhandEffect = 'noEffect' in VF spec).
 * Mirrors the same set used in netting.ts.
 */
const NON_CONSUMING_ACTIONS = new Set(['use', 'work', 'cite', 'deliverService']);

// =============================================================================
// TYPES
// =============================================================================

export interface ADUResult {
    adu: number;
    unit: string;
    windowDays: number;
    /** ISO date of window start (earliest qualifying event, or window start if none) */
    computedFrom: string;
    /** Number of calendar days that had at least one qualifying event */
    sampleCount: number;
}

export interface NFPResult {
    onhand: number;
    onorder: number;
    qualifiedDemand: number;
    /** Net Flow Position = onhand + onorder − qualifiedDemand. CAN BE NEGATIVE. */
    nfp: number;
    zone: 'red' | 'yellow' | 'green' | 'excess';
    /** = nfp / bufferZone.tog (can be < 0 or > 1) */
    priority: number;
}

export interface BufferZoneComputation {
    effectiveADU: number;
    effectiveDLT: number;
    redBase: number;
    redSafety: number;
    tor: number;
    toy: number;
    tog: number;
}

export interface AggregatedFactors {
    demandAdjFactor: number;        // product of all active 'demand' type factors
    /** Zone factors with no targetZone (legacy / backward compat) — applied to red zone. */
    zoneAdjFactor: number;
    /** Green zone ZAF: adjusts order size / order frequency (Ch 8 §8.2.2). */
    greenZoneAdjFactor: number;
    /** Yellow zone ZAF: adjusts demand coverage window (promo or supply disruption). */
    yellowZoneAdjFactor: number;
    /** Red zone ZAF: adjusts embedded safety (temporary volatility). */
    redZoneAdjFactor: number;
    leadTimeAdjFactor: number;      // product of all active 'leadTime' type factors
    supplyOffsetDays: number;       // additive sum of all active supply offset days
}

export interface BufferStatusResult {
    onhand: number;
    /** onhand / tog × 100 */
    pct: number;
    zone: 'red' | 'yellow' | 'green' | 'excess';
    /**
     * onhand / tor × 100 — useful for configurable alert threshold comparisons.
     * e.g. `redPct < 50` fires the on-hand alert at 50% of red zone.
     */
    redPct: number;
    /**
     * True when bufferZone.tippingPoint is defined and onhand < tippingPoint.
     * Signals potential irreversible ecological collapse; the federation must escalate.
     * Undefined when no tippingPoint is configured on the zone.
     */
    tippingPointBreached?: boolean;
}

export interface DailyProjectionEntry {
    /** YYYY-MM-DD */
    date: string;
    /** Sum of consuming flows (Commitments + Intents) due on this day */
    demand: number;
    /** Sum of supply Commitments (outputOf set) due on this day */
    receipts: number;
    /** Running balance after demand and receipts (can be negative = stockout) */
    projectedOnHand: number;
    zone: 'red' | 'yellow' | 'green' | 'excess' | 'stockout';
}

export interface SchedulingSlot {
    id: string;
    specId: string;
    /** NFP / TOG × 100 — lower % = higher urgency */
    nfpPct: number;
    /** Sequence group for allergen/regulatory ordering (lower = scheduled first). */
    sequenceGroup?: number;
}

export interface PrioritizedShareSlot {
    id: string;
    bufferZone: BufferZone;
    nfp: NFPResult;
}

export interface SignalIntegrityEntry {
    signal: ReplenishmentSignal;
    /** The approved supply Commitment (undefined if not yet approved or not found) */
    commitment?: Commitment;
    /** Observer fulfillment state for the approved Commitment */
    fulfillmentState?: FulfillmentState;
    /**
     * Deviation between what was recommended and what was approved/delivered.
     * Undefined when no approved Commitment exists yet.
     */
    deviation?: {
        qtyDiff: number;    // approvedQty − recommendedQty (positive = over-ordered)
        late: boolean;      // due date of Commitment > signal.dueDate
    };
}

// =============================================================================
// 1. durationToDays — internal helper
// =============================================================================

/**
 * Convert a VF Duration to calendar days.
 * Returns 0 for unknown units (safe default — equivalent to instantaneous).
 */
function durationToDays(d: Duration): number {
    switch (d.hasUnit) {
        case 'm':
        case 'min':
        case 'minutes': return d.hasNumericalValue / 1440;
        case 'h':
        case 'hours':   return d.hasNumericalValue / 24;
        case 'd':
        case 'days':    return d.hasNumericalValue;
        case 'w':
        case 'weeks':   return d.hasNumericalValue * 7;
        default:        return 0;
    }
}

// =============================================================================
// 2. computeADU — past rolling ADU from EconomicEvents
// =============================================================================

/**
 * Rolling average daily usage from historical EconomicEvents.
 *
 * Only events whose action has `onhandEffect: 'decrement'` are included
 * (consume, lower, combine, accept, pickup — verified against ACTION_DEFINITIONS).
 *
 * ADU = total consumed / windowDays.
 * Days with no consumption count as zero (not excluded from the denominator).
 *
 * @param events     Caller-supplied event slice (decoupled from Observer); events with
 *                   `excludeFromADU: true` are skipped (anomalous / non-recurring demand)
 * @param specId     ResourceSpecification ID to filter on
 * @param windowDays Rolling window length in calendar days
 * @param asOf       Reference date (window spans [asOf − windowDays, asOf])
 */
export function computeADU(
    events: EconomicEvent[],
    specId: string,
    windowDays: number,
    asOf: Date,
): ADUResult {
    const windowStartMs = asOf.getTime() - windowDays * 86_400_000;

    const qualifying = events.filter(e => {
        if (e.resourceConformsTo !== specId) return false;
        const def = ACTION_DEFINITIONS[e.action];
        if (!def || def.onhandEffect !== 'decrement') return false;
        if (e.excludeFromADU) return false;
        const tStr = e.hasPointInTime ?? e.hasBeginning ?? e.created;
        if (!tStr) return false;
        return new Date(tStr).getTime() >= windowStartMs;
    });

    let totalConsumed = 0;
    let earliestMs = Infinity;
    const daysWithActivity = new Set<string>();

    for (const e of qualifying) {
        const qty = e.resourceQuantity?.hasNumericalValue ?? 0;
        totalConsumed += qty;

        const tStr = e.hasPointInTime ?? e.hasBeginning ?? e.created!;
        const t = new Date(tStr).getTime();
        if (t < earliestMs) earliestMs = t;

        daysWithActivity.add(new Date(t).toISOString().slice(0, 10));
    }

    const unit = qualifying[0]?.resourceQuantity?.hasUnit ?? '';
    const adu = windowDays > 0 ? totalConsumed / windowDays : 0;

    const computedFrom = isFinite(earliestMs)
        ? new Date(earliestMs).toISOString().slice(0, 10)
        : new Date(windowStartMs).toISOString().slice(0, 10);

    return { adu, unit, windowDays, computedFrom, sampleCount: daysWithActivity.size };
}

// =============================================================================
// 3. computeForwardADU — forward-looking ADU from recurring Intents
// =============================================================================

/**
 * Forward-looking ADU from recurring Intents and scheduled demand over
 * [asOf, asOf + windowDays].
 *
 * Three demand sources (non-exclusive):
 *   - `Intent.availability_window` → `AvailabilityWindow`: materialize occurrence dates
 *   - `Intent.availability_window` → `SpecificDateWindow`: use specific_dates within window
 *   - `Intent.due` (no availability_window): count if due date falls within window
 *
 * Only includes consuming Intents: `inputOf` set, action not in NON_CONSUMING_ACTIONS.
 *
 * @param intents    Caller-supplied Intents slice
 * @param specId     ResourceSpecification ID
 * @param windowDays Forward window length in calendar days
 * @param asOf       Window start (today)
 */
export function computeForwardADU(
    intents: Intent[],
    specId: string,
    windowDays: number,
    asOf: Date,
): ADUResult {
    const fromStr = asOf.toISOString().slice(0, 10);
    const toStr = new Date(asOf.getTime() + windowDays * 86_400_000).toISOString().slice(0, 10);

    const qualifying = intents.filter(i =>
        i.resourceConformsTo === specId &&
        i.inputOf !== undefined &&
        !NON_CONSUMING_ACTIONS.has(i.action) &&
        !i.finished,
    );

    const dailyDemand = new Map<string, number>();
    let unit = '';

    for (const intent of qualifying) {
        const qty = intent.resourceQuantity?.hasNumericalValue ?? 0;
        if (qty <= 0) continue;
        if (intent.resourceQuantity?.hasUnit) unit = intent.resourceQuantity.hasUnit;

        if (intent.availability_window) {
            if (isSpecificDateWindow(intent.availability_window)) {
                for (const d of intent.availability_window.specific_dates) {
                    if (d >= fromStr && d <= toStr) {
                        dailyDemand.set(d, (dailyDemand.get(d) ?? 0) + qty);
                    }
                }
            } else {
                const dates = materializeOccurrenceDates(
                    intent.availability_window as AvailabilityWindow,
                    fromStr,
                    toStr,
                );
                for (const d of dates) {
                    dailyDemand.set(d, (dailyDemand.get(d) ?? 0) + qty);
                }
            }
        } else if (intent.due) {
            const dueStr = intent.due.slice(0, 10);
            if (dueStr >= fromStr && dueStr <= toStr) {
                dailyDemand.set(dueStr, (dailyDemand.get(dueStr) ?? 0) + qty);
            }
        }
    }

    const totalDemand = Array.from(dailyDemand.values()).reduce((a, b) => a + b, 0);
    const adu = windowDays > 0 ? totalDemand / windowDays : 0;

    return {
        adu,
        unit,
        windowDays,
        computedFrom: fromStr,
        sampleCount: dailyDemand.size,
    };
}

// =============================================================================
// 4. blendADU — combine past and forward ADU
// =============================================================================

/**
 * Blend past (historical) and forward (forecast) ADU using BufferZone.aduBlendRatio.
 *
 * blendRatio = 0 → pure forward ADU
 * blendRatio = 1 → pure past ADU
 * blendRatio = 0.5 → equal weight
 *
 * When blendRatio is undefined, returns pastADU unchanged (conservative default).
 */
export function blendADU(pastADU: number, forwardADU: number, blendRatio?: number): number {
    const ratio = blendRatio ?? 1;
    return pastADU * ratio + forwardADU * (1 - ratio);
}

// =============================================================================
// INTERNAL: buildRecipePredecessors
// =============================================================================

/**
 * Shared predecessor + successor maps for a RecipeProcess chain.
 * Extracted so recipeLeadTime() and legLeadTime() share the same logic.
 * @internal
 */
function buildRecipePredecessors(
    chain: RecipeProcess[],
    recipeStore: RecipeStore,
): { predecessors: Map<string, string[]>; successors: Map<string, string[]> } {
    const processIds  = new Set(chain.map(rp => rp.id));
    const predecessors = new Map<string, string[]>();
    for (const rp of chain) predecessors.set(rp.id, []);

    const outputsBySpec = new Map<string, string[]>();
    const inputsBySpec  = new Map<string, string[]>();

    function specKey(specId: string, stage: string | undefined): string {
        return stage ? `${specId}::${stage}` : specId;
    }

    for (const rp of chain) {
        const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);
        for (const f of outputs) {
            if (!f.resourceConformsTo) continue;
            const k = specKey(f.resourceConformsTo, f.stage);
            const list = outputsBySpec.get(k) ?? [];
            if (!list.includes(rp.id)) list.push(rp.id);
            outputsBySpec.set(k, list);
        }
        for (const f of inputs) {
            if (!f.resourceConformsTo) continue;
            const k = specKey(f.resourceConformsTo, f.stage);
            const list = inputsBySpec.get(k) ?? [];
            if (!list.includes(rp.id)) list.push(rp.id);
            inputsBySpec.set(k, list);
        }
    }

    for (const [k, consumers] of inputsBySpec) {
        const prods = outputsBySpec.get(k) ?? [];
        for (const producer of prods) {
            for (const consumer of consumers) {
                if (producer === consumer) continue;
                if (!processIds.has(producer) || !processIds.has(consumer)) continue;
                const preds = predecessors.get(consumer)!;
                if (!preds.includes(producer)) preds.push(producer);
            }
        }
    }

    // Derive successors from predecessors
    const successors = new Map<string, string[]>();
    for (const rp of chain) successors.set(rp.id, []);
    for (const [id, preds] of predecessors) {
        for (const pred of preds) {
            const list = successors.get(pred);
            if (list && !list.includes(id)) list.push(id);
        }
    }

    return { predecessors, successors };
}

// =============================================================================
// 5. recipeLeadTime
// =============================================================================

/**
 * Template DLT in days via longest-path through the recipe DAG.
 * Mirrors the criticalPath() logic but operates on RecipeProcess instead of Process.
 *
 * @returns Critical-path length in calendar days (0 for empty / duration-less recipes)
 */
export function recipeLeadTime(recipeId: string, recipeStore: RecipeStore): number {
    const chain = recipeStore.getProcessChain(recipeId);
    if (chain.length === 0) return 0;

    const processIds = new Set(chain.map(rp => rp.id));
    const predecessors = new Map<string, string[]>();
    for (const rp of chain) predecessors.set(rp.id, []);

    const outputsBySpec = new Map<string, string[]>();
    const inputsBySpec  = new Map<string, string[]>();

    function specKey(specId: string, stage: string | undefined): string {
        return stage ? `${specId}::${stage}` : specId;
    }

    for (const rp of chain) {
        const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);
        for (const f of outputs) {
            if (!f.resourceConformsTo) continue;
            const k = specKey(f.resourceConformsTo, f.stage);
            const list = outputsBySpec.get(k) ?? [];
            if (!list.includes(rp.id)) list.push(rp.id);
            outputsBySpec.set(k, list);
        }
        for (const f of inputs) {
            if (!f.resourceConformsTo) continue;
            const k = specKey(f.resourceConformsTo, f.stage);
            const list = inputsBySpec.get(k) ?? [];
            if (!list.includes(rp.id)) list.push(rp.id);
            inputsBySpec.set(k, list);
        }
    }

    for (const [k, consumers] of inputsBySpec) {
        const prods = outputsBySpec.get(k) ?? [];
        for (const producer of prods) {
            for (const consumer of consumers) {
                if (producer === consumer) continue;
                if (!processIds.has(producer) || !processIds.has(consumer)) continue;
                const preds = predecessors.get(consumer)!;
                if (!preds.includes(producer)) preds.push(producer);
            }
        }
    }

    const EF = new Map<string, number>();
    for (const rp of chain) {
        const preds = predecessors.get(rp.id) ?? [];
        const latestPredEF = preds.length === 0 ? 0 : Math.max(...preds.map(p => EF.get(p) ?? 0));
        const dur = rp.hasDuration ? durationToDays(rp.hasDuration) : 0;
        EF.set(rp.id, latestPredEF + dur);
    }

    return Math.max(0, ...Array.from(EF.values()));
}

// =============================================================================
// 6. aggregateAdjustmentFactors
// =============================================================================

/**
 * Aggregate all active DemandAdjustmentFactors for a spec/location on a given date.
 *
 * Factors of the same type are compounded (multiplied) together.
 * Returns {1, 1, 1} when no active adjustments exist.
 *
 * @param adjustments  All DemandAdjustmentFactor records to consider
 * @param asOf         Reference date for validFrom/validTo window check
 * @param specId       ResourceSpecification ID to filter on
 * @param atLocation   Optional SpatialThing ID — location-specific factors override global ones
 */
export function aggregateAdjustmentFactors(
    adjustments: DemandAdjustmentFactor[],
    asOf: Date,
    specId: string,
    atLocation?: string,
): AggregatedFactors {
    const asOfStr = asOf.toISOString().slice(0, 10);

    let demand       = 1;
    let zone         = 1;   // untagged zone factors → red zone (backward compat)
    let greenZone    = 1;
    let yellowZone   = 1;
    let redZone      = 1;
    let leadTime     = 1;
    let supplyOffset = 0;

    for (const adj of adjustments) {
        if (adj.specId !== specId) continue;
        // Location match: if adj is location-scoped it must match caller's location.
        // Global adjustments (no atLocation) apply to all locations.
        if (adj.atLocation && adj.atLocation !== atLocation) continue;
        // Active window: validFrom ≤ asOf ≤ validTo (YYYY-MM-DD string comparison)
        if (adj.validFrom > asOfStr || adj.validTo < asOfStr) continue;

        switch (adj.type) {
            case 'demand':
                demand *= adj.factor;
                break;
            case 'zone':
                // Ch 8 §8.2.2: dispatch to the targeted zone; absent targetZone → red (backward compat).
                switch (adj.targetZone) {
                    case 'green':  greenZone  *= adj.factor; break;
                    case 'yellow': yellowZone *= adj.factor; break;
                    case 'red':    redZone    *= adj.factor; break;
                    default:       zone       *= adj.factor; break;  // legacy / untagged → red
                }
                break;
            case 'leadTime':
                leadTime *= adj.factor;
                break;
        }
        supplyOffset += adj.supplyOffsetDays ?? 0;
    }

    return {
        demandAdjFactor:      demand,
        zoneAdjFactor:        zone,
        greenZoneAdjFactor:   greenZone,
        yellowZoneAdjFactor:  yellowZone,
        redZoneAdjFactor:     redZone,
        leadTimeAdjFactor:    leadTime,
        supplyOffsetDays:     supplyOffset,
    };
}

// =============================================================================
// 7. qualifyDemand
// =============================================================================

/**
 * OST-filtered qualified demand for a spec within the OST horizon.
 *
 * Includes both non-finished Commitments and Intents that represent demand
 * (inputOf set, consuming action, due ≤ horizonDate, qty ≤ spikeThreshold).
 *
 * @param specId     ResourceSpecification ID
 * @param today      Reference date
 * @param bufferZone Provides ostHorizonDays + adu for spike threshold
 * @param profile    Provides ostMultiplier fallback
 * @param planStore  Source of Commitments and Intents
 */
export function qualifyDemand(
    specId: string,
    today: Date,
    bufferZone: BufferZone,
    profile: BufferProfile,
    planStore: PlanStore,
): number {
    const ostHorizonDays = bufferZone.ostHorizonDays ?? Math.ceil(bufferZone.dltDays * 0.5);
    const horizonDate = new Date(today.getTime() + ostHorizonDays * 86_400_000);

    const ostMultiplier = profile.ostMultiplier;
    const spikeThreshold = ostMultiplier != null
        ? bufferZone.adu * ostMultiplier
        : Infinity;

    let qualified = 0;

    function qualifies(flow: {
        resourceConformsTo?: string;
        inputOf?: string;
        action: string;
        finished?: boolean;
        due?: string;
        resourceQuantity?: { hasNumericalValue: number };
    }): boolean {
        if (flow.resourceConformsTo !== specId) return false;
        if (!flow.inputOf) return false;
        if (NON_CONSUMING_ACTIONS.has(flow.action)) return false;
        if (flow.finished) return false;
        if (flow.due && new Date(flow.due) > horizonDate) return false;
        const qty = flow.resourceQuantity?.hasNumericalValue ?? 0;
        if (qty > spikeThreshold) return false;
        return true;
    }

    for (const c of planStore.allCommitments()) {
        if (qualifies(c)) qualified += c.resourceQuantity?.hasNumericalValue ?? 0;
    }
    for (const i of planStore.allIntents()) {
        if (qualifies(i)) qualified += i.resourceQuantity?.hasNumericalValue ?? 0;
    }

    return qualified;
}

// =============================================================================
// 8. computeNFP
// =============================================================================

/**
 * Signed Net Flow Position = onhand + onorder − qualifiedDemand.
 *
 * On-hand: sum of onhandQuantity across conforming resources (custody-based).
 * On-order: supply-side Commitments only (not Intents — only approved orders count).
 * Qualified demand: output of qualifyDemand().
 *
 * @param specId     ResourceSpecification ID
 * @param bufferZone Provides TOR/TOY/TOG for zone classification
 * @param profile    Passed through to qualifyDemand()
 * @param planStore  Source of Commitments and Intents
 * @param observer   Source of on-hand inventory
 * @param today      Reference date (defaults to now — pass explicitly for determinism)
 */
export function computeNFP(
    specId: string,
    bufferZone: BufferZone,
    profile: BufferProfile,
    planStore: PlanStore,
    observer: Observer,
    today: Date = new Date(),
): NFPResult {
    const onhand = observer
        .conformingResources(specId)
        .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);

    let onorder = 0;
    for (const c of planStore.allCommitments()) {
        if (
            c.resourceConformsTo === specId &&
            c.outputOf !== undefined &&
            !NON_CONSUMING_ACTIONS.has(c.action) &&
            !c.finished
        ) {
            onorder += c.resourceQuantity?.hasNumericalValue ?? 0;
        }
    }

    const qualifiedDemand = qualifyDemand(specId, today, bufferZone, profile, planStore);
    const nfp = onhand + onorder - qualifiedDemand;

    let zone: NFPResult['zone'];
    if (nfp <= bufferZone.tor) {
        zone = 'red';
    } else if (nfp <= bufferZone.toy) {
        zone = 'yellow';
    } else if (nfp <= bufferZone.tog) {
        zone = 'green';
    } else {
        zone = 'excess';
    }

    const priority = bufferZone.tog > 0 ? nfp / bufferZone.tog : 0;

    return { onhand, onorder, qualifiedDemand, nfp, zone, priority };
}

// =============================================================================
// 9. computeBufferZone
// =============================================================================

/**
 * Pure formula: TOR / TOY / TOG from profile settings + ADU + DLT + MOQ + adjustments.
 *
 * Correct Ptak & Smith Ch 8 form (all three green zone components):
 *   redBase  = effectiveADU × effectiveDLT × LTF
 *   redSafety = redBase × VF
 *   TOR      = (redBase + redSafety) × ZAF
 *   TOY      = TOR + effectiveADU × effectiveDLT
 *   green    = max(effectiveADU × orderCycleDays, redBase, MOQ)  ← three-way max
 *   TOG      = TOY + green
 *
 * The `redBase` floor on green ensures the green zone always covers at least
 * one DLT worth of ADU × LTF even when orderCycleDays is absent and MOQ is small.
 *
 * @param profile         BufferProfile with LTF, VF, and optional orderCycleDays
 * @param adu             Computed ADU value
 * @param aduUnit         Unit label (informational only)
 * @param dltDays         Decoupled Lead Time in calendar days
 * @param moq             Minimum order quantity in aduUnit
 * @param moqUnit         Unit label for MOQ (informational only)
 * @param opts            Optional dynamic adjustment factors and per-part DOC override
 */
export function computeBufferZone(
    profile: BufferProfile,
    adu: number,
    aduUnit: string,
    dltDays: number,
    moq: number,
    moqUnit: string,
    opts?: {
        demandAdjFactor?: number;
        leadTimeAdjFactor?: number;
        /**
         * Legacy / untagged zone adjustment factor — applied to red zone.
         * Prefer the explicit per-zone fields below (Ch 8 §8.2.2).
         */
        zoneAdjFactor?: number;
        /** Red zone ZAF: adjusts embedded safety (temporary volatility). Multiplied with zoneAdjFactor. */
        redZoneAdjFactor?: number;
        /** Yellow zone ZAF: adjusts demand coverage window (promo or supply disruption). */
        yellowZoneAdjFactor?: number;
        /** Green zone ZAF: adjusts order size / order frequency (capacity setup optimization). */
        greenZoneAdjFactor?: number;
        /** Per-part Desired/Imposed Order Cycle override (N-5). Preferred over profile.orderCycleDays. */
        docDays?: number;
    },
): BufferZoneComputation {
    const effectiveADU = adu * (opts?.demandAdjFactor ?? 1);
    const effectiveDLT = dltDays * (opts?.leadTimeAdjFactor ?? 1);

    // Ch 8 §8.2.2: per-zone ZAF dispatch.
    // Untagged zone factor (zoneAdjFactor) retains backward-compat behaviour: applies to red zone.
    const effectiveRedZAF    = (opts?.redZoneAdjFactor ?? 1) * (opts?.zoneAdjFactor ?? 1);
    const effectiveYellowZAF = opts?.yellowZoneAdjFactor ?? 1;
    const effectiveGreenZAF  = opts?.greenZoneAdjFactor  ?? 1;

    const redBase   = effectiveADU * effectiveDLT * profile.leadTimeFactor;
    const redSafety = redBase * profile.variabilityFactor;
    const tor       = (redBase + redSafety) * effectiveRedZAF;
    const toy       = tor + effectiveADU * effectiveDLT * effectiveYellowZAF;

    // Three-way max per Ptak & Smith Ch 7/8, scaled by green ZAF:
    //   order_cycle × ADU  (per-part docDays preferred over profile.orderCycleDays)
    //   DLT × ADU × LTF    (minimum DLT coverage = redBase)
    //   MOQ                (minimum batch size)
    const effectiveDOC = opts?.docDays ?? profile.orderCycleDays;
    const greenBase = Math.max(
        effectiveDOC != null ? effectiveADU * effectiveDOC : 0,
        redBase,
        moq,
    ) * effectiveGreenZAF;
    const tog = toy + greenBase;

    return { effectiveADU, effectiveDLT, redBase, redSafety, tor, toy, tog };
}

// =============================================================================
// 9b. computeMinMaxBuffer
// =============================================================================

/**
 * Min-max buffer variant (Ch 7): no yellow zone — TOY = TOR ("Not Applicable").
 * Red and green zones use the same formulas as replenished buffers.
 * Suitable for items where demand is relatively stable and a simple Min/Max
 * policy replaces the full 3-zone DDMRP structure.
 *
 * DDMRP ref: Ptak & Smith Ch 7 §"Buffer Types".
 */
export function computeMinMaxBuffer(
    profile: BufferProfile,
    adu: number,
    aduUnit: string,
    dltDays: number,
    moq: number,
    moqUnit: string,
    opts?: {
        demandAdjFactor?: number;
        leadTimeAdjFactor?: number;
        zoneAdjFactor?: number;
        redZoneAdjFactor?: number;
        yellowZoneAdjFactor?: number;
        greenZoneAdjFactor?: number;
        docDays?: number;
    },
): BufferZoneComputation {
    const result = computeBufferZone(profile, adu, aduUnit, dltDays, moq, moqUnit, opts);
    // Min-max has no yellow zone; TOY = TOR (Not Applicable per Ch 7)
    return { ...result, toy: result.tor };
}

// =============================================================================
// 10. recalibrateBufferZone
// =============================================================================

/**
 * Update a BufferZone with fresh ADU, DLT, and the current set of active
 * DemandAdjustmentFactors. Returns a new BufferZone object (does not mutate input).
 *
 * Workflow:
 *   1. Aggregate all active DemandAdjustmentFactors for this spec/location
 *   2. Recompute TOR/TOY/TOG via computeBufferZone
 *   3. Stamp lastComputedAt + activeAdjustmentIds
 *
 * @param existing     The zone record to refresh
 * @param newADU       Fresh ADU (from computeADU / computeForwardADU / blendADU)
 * @param newDLTDays   Fresh DLT in calendar days (from recipeLeadTime or criticalPath)
 * @param profile      BufferProfile associated with this zone
 * @param adjustments  All DemandAdjustmentFactor records to consider
 * @param asOf         Reference date for factor activation / lastComputedAt
 */
export function recalibrateBufferZone(
    existing: BufferZone,
    newADU: number,
    newDLTDays: number,
    profile: BufferProfile,
    adjustments: DemandAdjustmentFactor[],
    asOf: Date,
): BufferZone {
    // Ch 7: replenished_override zones are user-managed (contractual/constrained);
    // auto-recalculation must never overwrite user-set TOR/TOY/TOG values.
    // But track current ADU/DLT for drift monitoring (Ch 7: contract renegotiation signals).
    if (existing.bufferClassification === 'replenished_override') {
        return { ...existing, adu: newADU, dltDays: newDLTDays, lastComputedAt: asOf.toISOString() };
    }

    const factors = aggregateAdjustmentFactors(
        adjustments, asOf, existing.specId, existing.atLocation,
    );

    // Bootstrap ADU blending — Ch 7 Fig 7-16
    let effectiveADU = newADU;
    let newBootstrapDays = existing.bootstrapDaysAccumulated;
    let clearEstimate = false;

    if (existing.estimatedADU !== undefined && existing.estimatedADU > 0) {
        const windowDays = existing.aduWindowDays ?? 84;
        const prevDays = existing.bootstrapDaysAccumulated ?? 0;
        const elapsedDays = existing.lastComputedAt
            ? Math.max(0, Math.floor((asOf.getTime() - new Date(existing.lastComputedAt).getTime()) / 86_400_000))
            : 0;
        const daysActual = Math.min(windowDays, prevDays + elapsedDays);
        const { blendedADU, bootstrapComplete } = bootstrapADU(newADU, daysActual, existing.estimatedADU, windowDays);
        effectiveADU = blendedADU;
        newBootstrapDays = daysActual;
        clearEstimate = bootstrapComplete;
    }

    // Ch 7: min-max zones have no yellow zone (TOY = TOR); dispatch accordingly.
    // Pass per-part DOC override (N-5) so green zone uses the item's own order cycle.
    const optsWithDoc = { ...factors, docDays: existing.orderCycleDays };
    const comp = existing.bufferClassification === 'min_max'
        ? computeMinMaxBuffer(profile, effectiveADU, existing.aduUnit, newDLTDays, existing.moq, existing.moqUnit, optsWithDoc)
        : computeBufferZone(profile, effectiveADU, existing.aduUnit, newDLTDays, existing.moq, existing.moqUnit, optsWithDoc);

    const asOfStr = asOf.toISOString().slice(0, 10);
    const activeAdjustmentIds = adjustments
        .filter(adj =>
            adj.specId === existing.specId &&
            (!adj.atLocation || adj.atLocation === existing.atLocation) &&
            adj.validFrom <= asOfStr &&
            adj.validTo >= asOfStr,
        )
        .map(adj => adj.id);

    return {
        ...existing,
        adu: effectiveADU,
        dltDays: newDLTDays,
        tor: comp.tor,
        toy: comp.toy,
        tog: comp.tog,
        redBase: comp.redBase,       // N-6: persist decomposition for planner visibility
        redSafety: comp.redSafety,   // N-6
        demandAdjFactor: factors.demandAdjFactor,
        zoneAdjFactor: factors.zoneAdjFactor,
        leadTimeAdjFactor: factors.leadTimeAdjFactor,
        supplyOffsetDays: factors.supplyOffsetDays || undefined,
        activeAdjustmentIds,
        bootstrapDaysAccumulated: newBootstrapDays,
        estimatedADU: clearEstimate ? undefined : existing.estimatedADU,
        lastComputedAt: asOf.toISOString(),
    };
}

// =============================================================================
// 11. bufferStatus
// =============================================================================

/**
 * Current on-hand buffer status — physical position relative to zone boundaries.
 *
 * Uses `onhandQuantity` (custody-based) NOT `accountingQuantity`.
 * This is the C5 execution metric, not the planning NFP.
 *
 * @param onhand      Sum of EconomicResource.onhandQuantity for the spec
 * @param bufferZone  Zone boundaries to classify against
 */
export function bufferStatus(onhand: number, bufferZone: BufferZone): BufferStatusResult {
    const pct    = bufferZone.tog > 0 ? (onhand / bufferZone.tog) * 100 : 0;
    const redPct = bufferZone.tor > 0 ? (onhand / bufferZone.tor) * 100 : 0;

    let zone: BufferStatusResult['zone'];
    if (onhand <= bufferZone.tor) {
        zone = 'red';
    } else if (onhand <= bufferZone.toy) {
        zone = 'yellow';
    } else if (onhand <= bufferZone.tog) {
        zone = 'green';
    } else {
        zone = 'excess';
    }

    const result: BufferStatusResult = { onhand, pct, zone, redPct };
    if (bufferZone.tippingPoint !== undefined) {
        result.tippingPointBreached = onhand < bufferZone.tippingPoint;
    }
    return result;
}

// =============================================================================
// 12. projectOnHand
// =============================================================================

/**
 * Day-by-day on-hand projection over [today, today + dltDays].
 *
 * For each day:
 *   demand[t]   = consuming Commitments/Intents (inputOf set) due on that day
 *   receipts[t] = supply Commitments (outputOf set) due on that day (not Intents —
 *                 only approved orders are expected to arrive)
 *   OH[t]       = OH[t-1] + receipts[t] − demand[t]
 *
 * A negative projected on-hand means stockout — the 'stockout' zone signals dark-red.
 *
 * @param specId     ResourceSpecification ID
 * @param bufferZone Zone boundaries for per-day zone classification
 * @param today      Reference date (day 0 starts with current on-hand)
 * @param planStore  Source of Commitments and Intents
 * @param observer   Source of current on-hand (onhandQuantity)
 */
export function projectOnHand(
    specId: string,
    bufferZone: BufferZone,
    today: Date,
    planStore: PlanStore,
    observer: Observer,
): DailyProjectionEntry[] {
    const dltDays = Math.max(1, Math.ceil(bufferZone.dltDays));
    const result: DailyProjectionEntry[] = [];

    // Day 0 = sum of current onhandQuantity
    let runningOH = observer
        .conformingResources(specId)
        .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);

    // Pre-bucket commitments and intents by due date
    const supplyByDay  = new Map<string, number>(); // outputOf Commitments only
    const demandByDay  = new Map<string, number>(); // inputOf Commitments + Intents

    function bucket(map: Map<string, number>, dateStr: string, qty: number): void {
        map.set(dateStr, (map.get(dateStr) ?? 0) + qty);
    }

    for (const c of planStore.allCommitments()) {
        if (c.resourceConformsTo !== specId || c.finished || !c.due) continue;
        const d = c.due.slice(0, 10);
        const qty = c.resourceQuantity?.hasNumericalValue ?? 0;
        if (c.outputOf && !NON_CONSUMING_ACTIONS.has(c.action)) {
            bucket(supplyByDay, d, qty);
        } else if (c.inputOf && !NON_CONSUMING_ACTIONS.has(c.action)) {
            bucket(demandByDay, d, qty);
        }
    }
    for (const i of planStore.allIntents()) {
        if (
            i.resourceConformsTo === specId &&
            i.inputOf &&
            !NON_CONSUMING_ACTIONS.has(i.action) &&
            !i.finished &&
            i.due
        ) {
            bucket(demandByDay, i.due.slice(0, 10), i.resourceQuantity?.hasNumericalValue ?? 0);
        }
    }

    for (let t = 0; t < dltDays; t++) {
        const dayMs  = today.getTime() + (t + 1) * 86_400_000;
        const dayStr = new Date(dayMs).toISOString().slice(0, 10);

        const receipts = supplyByDay.get(dayStr) ?? 0;
        const demand   = demandByDay.get(dayStr) ?? 0;
        runningOH = runningOH + receipts - demand;

        let zone: DailyProjectionEntry['zone'];
        if (runningOH < 0) {
            zone = 'stockout';
        } else if (runningOH <= bufferZone.tor) {
            zone = 'red';
        } else if (runningOH <= bufferZone.toy) {
            zone = 'yellow';
        } else if (runningOH <= bufferZone.tog) {
            zone = 'green';
        } else {
            zone = 'excess';
        }

        result.push({ date: dayStr, demand, receipts, projectedOnHand: runningOH, zone });
    }

    return result;
}

// =============================================================================
// 13. ltmAlertZone — Lead Time Managed alert
// =============================================================================

/**
 * LTM (Lead Time Managed) sub-zone for an open supply order.
 *
 * Alert horizon = last third of DLT.
 * Within the alert horizon, three sub-zones (equal thirds, innermost = red):
 *   null   — order is outside the alert horizon (not yet time-critical)
 *   green  — first third of alert horizon (order tracking begins)
 *   yellow — second third (expediting attention)
 *   red    — final third + overdue (immediate action required)
 *
 * @param commitment  Open supply Commitment to assess
 * @param dltDays     Decoupled Lead Time for this item in calendar days
 * @param today       Reference date
 */
export function ltmAlertZone(
    commitment: Commitment,
    dltDays: number,
    today: Date,
): 'green' | 'yellow' | 'red' | null {
    if (!commitment.due) return null;

    const daysRemaining = (new Date(commitment.due).getTime() - today.getTime()) / 86_400_000;
    const alertHorizon  = dltDays / 3;

    if (daysRemaining > alertHorizon) return null;

    const third = alertHorizon / 3;
    if (daysRemaining > third * 2) return 'green';
    if (daysRemaining > third) return 'yellow';
    return 'red';
}

// =============================================================================
// 14. prioritizedShare — DDMRP sequential zone-fill for scarce supply
// =============================================================================

/**
 * Allocate a scarce supply quantity across multiple buffer locations using DDMRP
 * sequential zone-fill priority (Ptak & Smith Ch 9, §Prioritized Share):
 *
 *   Phase 1: Fill all locations from their current NFP to TOR
 *   Phase 2: Fill all remaining locations from TOR to TOY
 *   Phase 3: Distribute surplus proportionally by green zone size (TOG − TOY)
 *
 * Within each phase, if supply is insufficient the phase's total demand is filled
 * proportionally (by shortfall weight) so no location is starved completely.
 *
 * @param slots        Buffer slots competing for the scarce supply
 * @param totalSupply  Total available supply quantity (in aduUnit)
 * @returns Map<slot.id, allocatedQty>
 */
export function prioritizedShare(
    slots: PrioritizedShareSlot[],
    totalSupply: number,
): Map<string, number> {
    const allocated = new Map<string, number>(slots.map(s => [s.id, 0]));
    let remaining = totalSupply;

    function add(id: string, qty: number): void {
        allocated.set(id, (allocated.get(id) ?? 0) + qty);
        remaining -= qty;
    }

    // Current effective position for a slot (nfp + already allocated)
    function pos(s: PrioritizedShareSlot): number {
        return s.nfp.nfp + (allocated.get(s.id) ?? 0);
    }

    function fillPhase(
        getWant: (s: PrioritizedShareSlot) => number,
    ): void {
        if (remaining <= 0) return;

        const wants = slots.map(s => ({ id: s.id, want: Math.max(0, getWant(s)) }));
        const totalWant = wants.reduce((sum, w) => sum + w.want, 0);
        if (totalWant <= 0) return;

        if (remaining >= totalWant) {
            // Enough to satisfy all
            for (const w of wants) add(w.id, w.want);
        } else {
            // Proportional distribution
            for (const w of wants) {
                if (w.want > 0) add(w.id, remaining * (w.want / totalWant));
            }
        }
    }

    // Phase 1: fill to TOR
    fillPhase(s => s.bufferZone.tor - pos(s));

    // Phase 2: fill to TOY
    fillPhase(s => s.bufferZone.toy - pos(s));

    // Phase 3: distribute remaining proportionally by green zone size (TOG − TOY)
    if (remaining > 0) {
        const greenSizes = slots.map(s => ({
            id: s.id,
            greenSize: Math.max(0, s.bufferZone.tog - s.bufferZone.toy),
            roomLeft: Math.max(0, s.bufferZone.tog - pos(s)),
        }));
        const totalGreen = greenSizes.reduce((sum, g) => sum + g.greenSize, 0);
        if (totalGreen > 0) {
            for (const g of greenSizes) {
                if (g.greenSize > 0 && g.roomLeft > 0) {
                    const share = Math.min(
                        remaining * (g.greenSize / totalGreen),
                        g.roomLeft,
                    );
                    add(g.id, share);
                }
            }
        }
    }

    return allocated;
}

// =============================================================================
// 15. capacityInTime — drum ceiling translation
// =============================================================================

/**
 * Translate a buffer's TOG quantity into work center time consumed per replenishment cycle.
 *
 * Drum ceiling = (TOG / batchSize) × hasDuration
 *
 * When RecipeProcess.minimumBatchQuantity is absent, assumes one unit per run.
 * Returns 0 when no hasDuration is set on the process.
 *
 * @param togQty      Top-of-Green quantity (in aduUnit)
 * @param rp          RecipeProcess that produces this item
 * @param targetUnit  Output unit ('minutes' | 'hours' | 'days'), default 'minutes'
 */
export function capacityInTime(
    togQty: number,
    rp: RecipeProcess,
    targetUnit: 'minutes' | 'hours' | 'days' = 'minutes',
): number {
    if (!rp.hasDuration) return 0;

    const batchQty = rp.minimumBatchQuantity?.hasNumericalValue ?? 1;
    const runs = batchQty > 0 ? Math.ceil(togQty / batchQty) : togQty;
    const totalDays = runs * durationToDays(rp.hasDuration);

    switch (targetUnit) {
        case 'minutes': return totalDays * 1440;
        case 'hours':   return totalDays * 24;
        case 'days':    return totalDays;
    }
}

// =============================================================================
// 16. sortByPriorityAndSequence — WIP dispatch ordering
// =============================================================================

/**
 * Sort a list of scheduling slots by DDMRP priority:
 *   Primary:   sequenceGroup ASC (allergen/regulatory constraint groups)
 *   Secondary: nfpPct ASC (lowest priority% = deepest in red = most urgent)
 *
 * Slots without a sequenceGroup are treated as group 0 (scheduled first by NFP only).
 *
 * Does not mutate the input array — returns a new sorted array.
 *
 * @param slots  Pre-computed scheduling slots with nfpPct and optional sequenceGroup
 */
export function sortByPriorityAndSequence(slots: SchedulingSlot[]): SchedulingSlot[] {
    return [...slots].sort((a, b) => {
        const ga = a.sequenceGroup ?? 0;
        const gb = b.sequenceGroup ?? 0;
        if (ga !== gb) return ga - gb;
        return a.nfpPct - b.nfpPct;
    });
}

// =============================================================================
// 17. generateReplenishmentSignal
// =============================================================================

/**
 * Wrap an NFP result + buffer zone into a complete ReplenishmentSignal.
 *
 * Recommended quantity:
 *   raw = TOG − NFP
 *   if raw ≤ 0: recommendedQty = MOQ  (minimum order)
 *   else: ceil(raw / MOQ) × MOQ       (round up to MOQ multiple)
 *
 * Due date = today + DLT days (ISO YYYY-MM-DD).
 *
 * Callers should check nfp.zone !== 'excess' before calling. The function
 * handles excess defensively via the MOQ clamp on recommendedQty.
 *
 * @param specId      ResourceSpecification ID
 * @param atLocation  Optional SpatialThing ID
 * @param bufferZone  Provides TOG, MOQ, DLT for order sizing
 * @param nfp         Output of computeNFP()
 * @param today       Reference date
 * @param genId       ID generator (e.g. () => nanoid())
 */
export function generateReplenishmentSignal(
    specId: string,
    atLocation: string | undefined,
    bufferZone: BufferZone,
    nfp: NFPResult,
    today: Date,
    genId: () => string,
): ReplenishmentSignal {
    const moq = bufferZone.moq > 0 ? bufferZone.moq : 1;
    const raw = bufferZone.tog - nfp.nfp;
    const recommendedQty = raw <= 0
        ? moq
        : Math.ceil(raw / moq) * moq;

    const offsetDays = bufferZone.supplyOffsetDays ?? 0;
    const dueMs  = today.getTime() + (bufferZone.dltDays + offsetDays) * 86_400_000;
    const dueDate = new Date(dueMs).toISOString().slice(0, 10);

    return {
        id: genId(),
        specId,
        ...(atLocation !== undefined ? { atLocation } : {}),
        bufferZoneId: bufferZone.id,
        onhand: nfp.onhand,
        onorder: nfp.onorder,
        qualifiedDemand: nfp.qualifiedDemand,
        nfp: nfp.nfp,
        priority: nfp.priority,
        zone: nfp.zone,
        recommendedQty,
        dueDate,
        status: 'open',
        createdAt: today.toISOString(),
    };
}

// =============================================================================
// 18. signalIntegrityReport
// =============================================================================

/**
 * Map each ReplenishmentSignal to its approved Commitment and Observer fulfillment
 * state, producing a recommendation-vs-actual comparison per signal.
 *
 * Signals without an approved Commitment (still 'open' or 'rejected') are included
 * with `commitment` and `fulfillmentState` undefined.
 *
 * Deviation is computed when a Commitment is found:
 *   qtyDiff = approvedQty − signal.recommendedQty (positive = over-ordered)
 *   late    = Commitment.due > signal.dueDate (approved due date is later than recommended)
 *
 * @param signals   ReplenishmentSignals to evaluate (caller filters by spec/location as needed)
 * @param planStore Source of approved Commitments
 * @param observer  Source of FulfillmentState per Commitment
 */
export function signalIntegrityReport(
    signals: ReplenishmentSignal[],
    planStore: PlanStore,
    observer: Observer,
): SignalIntegrityEntry[] {
    return signals.map(signal => {
        if (!signal.approvedCommitmentId) {
            return { signal };
        }

        const commitment = planStore.getCommitment(signal.approvedCommitmentId);
        if (!commitment) {
            return { signal };
        }

        const fulfillmentState = observer.getFulfillment(commitment.id);

        const approvedQty = commitment.resourceQuantity?.hasNumericalValue ?? 0;
        const qtyDiff = approvedQty - signal.recommendedQty;

        // late: commitment due date (YYYY-MM-DD prefix) is after signal.dueDate
        const commitmentDue = commitment.due ? commitment.due.slice(0, 10) : undefined;
        const late = commitmentDue !== undefined && commitmentDue > signal.dueDate;

        return { signal, commitment, fulfillmentState, deviation: { qtyDiff, late } };
    });
}

// =============================================================================
// 19. averageOnHandTarget — working capital reference level
// =============================================================================

/**
 * Average on-hand target for working capital and DDS&OP calibration.
 *
 * DDMRP formula (Ptak & Smith Ch 8):
 *   average target = TOR + green/2  =  TOR + (TOG − TOY) / 2
 *
 * This is the EXPECTED average inventory level over many replenishment cycles,
 * not an operating setpoint. Used for investment planning and D2 analysis.
 */
export function averageOnHandTarget(bz: BufferZone): number {
    return bz.tor + (bz.tog - bz.toy) / 2;
}

// =============================================================================
// 20. onHandAlert — configurable threshold execution alert
// =============================================================================

/**
 * Display-friendly entry for the OnHandAlert component.
 * One entry per monitored ResourceSpecification.
 */
export interface OnhandAlertEntry {
    specId: string;
    /** Buffer zone the on-hand is currently in */
    zone: 'red' | 'yellow' | 'green';
    /** On-hand as a percentage of TOR (0–100) */
    pct: number;
    /** Optional location context for display */
    location?: string;
}

export interface OnHandAlertResult {
    onhand: number;
    bufferStatus: BufferStatusResult;
    /**
     * Severity:
     *   'critical' — on-hand is at or below zero (stockout)
     *   'warning'  — on-hand penetrated the configurable alert threshold
     *   null       — on-hand is above the alert threshold (no alert)
     */
    alertLevel: 'critical' | 'warning' | null;
    alertThreshold: number;  // fraction of TOR (0–1)
    thresholdQty: number;    // TOR × alertThreshold (absolute quantity)
}

/**
 * On-hand execution alert (DDMRP C5 alert type (a)).
 *
 * Fires when physical on-hand (custody-based `onhandQuantity`) penetrates a
 * configurable fraction of TOR. Typical DDMRP practice: 50 % of TOR.
 *
 * @param onhand          Sum of EconomicResource.onhandQuantity for the spec
 * @param bz              BufferZone providing TOR/TOY/TOG boundaries
 * @param alertThreshold  Fraction of TOR that triggers the warning (default 0.5)
 */
export function onHandAlert(
    onhand: number,
    bz: BufferZone,
    alertThreshold: number = 0.5,
): OnHandAlertResult {
    const status       = bufferStatus(onhand, bz);
    const thresholdQty = bz.tor * alertThreshold;

    const alertLevel: OnHandAlertResult['alertLevel'] =
        onhand <= 0           ? 'critical'
        : onhand <= thresholdQty ? 'warning'
        : null;

    return { onhand, bufferStatus: status, alertLevel, alertThreshold, thresholdQty };
}

// =============================================================================
// 21. legLeadTime — DLT for one decoupled routing leg
// =============================================================================

/**
 * Critical-path length in days for ONE decoupled routing leg.
 *
 * A routing leg is the sub-sequence of RecipeProcesses between two decoupling
 * points in a recipe DAG:
 *   - Starts at processes that CONSUME from `upstreamStageId`
 *     (RecipeFlow input with stage = upstreamStageId)
 *   - Ends at the process that PRODUCES INTO `downstreamStageId`
 *     (RecipeFlow output with stage = downstreamStageId)
 *
 * Uses the same forward-pass critical-path logic as recipeLeadTime(), restricted
 * to the reachable sub-DAG between the two stage markers.
 *
 * Pass `undefined` for either bound to use the natural recipe start/end:
 *   legLeadTime(id, undefined, 'stageB', …) → start of recipe to stageB
 *   legLeadTime(id, 'stageA', undefined, …) → stageA to end of recipe
 *   Both undefined                           → identical to recipeLeadTime()
 *
 * @returns Critical-path length in calendar days (0 if leg is empty)
 */
export function legLeadTime(
    recipeId: string,
    upstreamStageId: string | undefined,
    downstreamStageId: string | undefined,
    recipeStore: RecipeStore,
): number {
    if (!upstreamStageId && !downstreamStageId) {
        return recipeLeadTime(recipeId, recipeStore);
    }

    const chain = recipeStore.getProcessChain(recipeId);
    if (chain.length === 0) return 0;

    const { predecessors, successors } = buildRecipePredecessors(chain, recipeStore);

    // Identify start processes (consume from upstreamStageId) and
    // end processes (produce into downstreamStageId) via their flows.
    const startIds = new Set<string>();
    const endIds   = new Set<string>();

    for (const rp of chain) {
        const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);
        if (upstreamStageId && inputs.some(f => f.stage === upstreamStageId)) {
            startIds.add(rp.id);
        }
        if (downstreamStageId && outputs.some(f => f.stage === downstreamStageId)) {
            endIds.add(rp.id);
        }
    }

    if (upstreamStageId   && startIds.size === 0) return 0;
    if (downstreamStageId && endIds.size   === 0) return 0;

    // Forward reachability from the start set (topological order → single scan).
    const forwardReach = new Set<string>();
    const naturalStarts = !upstreamStageId
        ? new Set(chain.filter(rp => (predecessors.get(rp.id)?.length ?? 0) === 0).map(rp => rp.id))
        : startIds;

    for (const rp of chain) {
        if (
            naturalStarts.has(rp.id) ||
            (predecessors.get(rp.id) ?? []).some(p => forwardReach.has(p))
        ) {
            forwardReach.add(rp.id);
        }
    }

    // Backward reachability from the end set (reverse topological order → single scan).
    const backwardReach = new Set<string>();
    const naturalEnds = !downstreamStageId
        ? new Set(chain.filter(rp => (successors.get(rp.id)?.length ?? 0) === 0).map(rp => rp.id))
        : endIds;

    for (let i = chain.length - 1; i >= 0; i--) {
        const rp = chain[i];
        if (
            naturalEnds.has(rp.id) ||
            (successors.get(rp.id) ?? []).some(s => backwardReach.has(s))
        ) {
            backwardReach.add(rp.id);
        }
    }

    // Leg = intersection: reachable both from start and back from end.
    const legChain = chain.filter(rp => forwardReach.has(rp.id) && backwardReach.has(rp.id));
    const legIds   = new Set(legChain.map(rp => rp.id));

    // Forward pass on leg sub-chain (already in topological order).
    const EF = new Map<string, number>();
    for (const rp of legChain) {
        const preds = (predecessors.get(rp.id) ?? []).filter(p => legIds.has(p));
        const latestPredEF = preds.length === 0 ? 0 : Math.max(...preds.map(p => EF.get(p) ?? 0));
        EF.set(rp.id, latestPredEF + (rp.hasDuration ? durationToDays(rp.hasDuration) : 0));
    }

    return Math.max(0, ...Array.from(EF.values()));
}

// =============================================================================
// 22. bufferHealthHistory — time-series buffer health reconstruction
// =============================================================================

/**
 * Display-friendly entry for the LTM (Lead Time Monitor) alert component.
 * One entry per open supply Commitment that is inside the LTM alert horizon.
 */
export interface LTMAlertEntry {
    /** Commitment / supply order ID */
    orderId: string;
    /** ResourceSpecification ID */
    specId: string;
    /** ISO datetime — due date of the commitment */
    due?: string;
    /** Calendar days remaining until due (can be negative if overdue) */
    daysRemaining?: number;
    /** LTM zone classification from ltmAlertZoneFull() */
    ltmZone: 'early' | 'green' | 'yellow' | 'red' | 'late';
}

export interface BufferHealthEntry {
    /** YYYY-MM-DD */
    date: string;
    onhand: number;
    zone: 'red' | 'yellow' | 'green' | 'excess';
    /** onhand / TOG × 100 */
    pct: number;
}

/**
 * Reconstruct daily on-hand buffer status over a historical date range.
 *
 * Replays qualifying EconomicEvents in [fromDate, toDate] to produce a
 * day-by-day buffer zone classification. The caller provides `currentOnHand`
 * (today's physical balance); the function back-computes the starting balance
 * at `fromDate` by subtracting the total window delta.
 *
 * Event matching uses two paths:
 *   • Simple actions (increment/decrement): matched by `resourceConformsTo`.
 *     When `bz.atLocation` is set, `atLocation` must match to exclude synthetic
 *     ADU-only events that carry no physical location.
 *   • Transfer-style actions (decrementIncrement — transfer, move, transferCustody):
 *     matched via `resourceInventoriedAs` → resource conformsTo lookup.
 *     Source side (atLocation === bz.atLocation) contributes −qty;
 *     destination side (toLocation === bz.atLocation) contributes +qty.
 *
 * Used for DDS&OP calibration: identifies chronic red-zone penetrations,
 * excess inventory trends, and seasonal patterns (resolves M10).
 *
 * @param specId          ResourceSpecification ID
 * @param events          Caller-supplied EconomicEvents (any date range)
 * @param resources       EconomicResources — used to resolve transfer events
 * @param currentOnHand   Physical on-hand as of `toDate` (today's balance)
 * @param bz              BufferZone providing TOR/TOY/TOG and atLocation
 * @param fromDate        Start date (YYYY-MM-DD, inclusive)
 * @param toDate          End date (YYYY-MM-DD, inclusive)
 */
export function bufferHealthHistory(
    specId: string,
    events: EconomicEvent[],
    resources: EconomicResource[],
    currentOnHand: number,
    bz: BufferZone,
    fromDate: string,
    toDate: string,
): BufferHealthEntry[] {
    // Build a resource-id → conformsTo map for resolving transfer events
    const resourceSpec = new Map(resources.map(r => [r.id, r.conformsTo]));

    // Bucket net OH delta per calendar day within the window
    const dailyNet = new Map<string, number>();

    for (const e of events) {
        const tStr = e.hasPointInTime ?? e.hasBeginning ?? e.created;
        if (!tStr) continue;
        const d = tStr.slice(0, 10);
        if (d < fromDate || d > toDate) continue;

        const qty = e.resourceQuantity?.hasNumericalValue ?? 0;
        if (!qty) continue;

        const def = ACTION_DEFINITIONS[e.action];
        if (!def) continue;

        let delta = 0;

        if (def.onhandEffect === 'decrementIncrement') {
            // Transfer / move / transferCustody: resolve each side via resource lookup.
            // Only one side will match our location (or either if no location constraint).
            const fromSpec = e.resourceInventoriedAs ? resourceSpec.get(e.resourceInventoriedAs) : undefined;
            const toSpec   = e.toResourceInventoriedAs ? resourceSpec.get(e.toResourceInventoriedAs) : undefined;

            if (bz.atLocation) {
                if (toSpec === specId && e.toLocation === bz.atLocation)   delta =  qty; // incoming
                else if (fromSpec === specId && e.atLocation === bz.atLocation) delta = -qty; // outgoing
            } else {
                // No location constraint: track from source if it matches spec
                if (fromSpec === specId || e.resourceConformsTo === specId) delta = -qty;
            }
        } else {
            // Simple increment / decrement
            if (e.resourceConformsTo !== specId) continue;
            // When the buffer zone has a location, exclude events that lack a matching
            // atLocation (this filters out synthetic ADU-only history events).
            if (bz.atLocation && e.atLocation !== bz.atLocation) continue;

            if (def.onhandEffect === 'increment') delta =  qty;
            else if (def.onhandEffect === 'decrement') delta = -qty;
        }

        if (delta !== 0) dailyNet.set(d, (dailyNet.get(d) ?? 0) + delta);
    }

    // Back-compute on-hand at the start of the window from today's known balance.
    // startOH + totalDelta = currentOnHand  →  startOH = currentOnHand − totalDelta
    let totalDelta = 0;
    for (const v of dailyNet.values()) totalDelta += v;
    let oh = currentOnHand - totalDelta;

    const result: BufferHealthEntry[] = [];
    const from = new Date(fromDate);
    const to   = new Date(toDate);
    for (
        let cur = new Date(from.getTime());
        cur <= to;
        cur = new Date(cur.getTime() + 86_400_000)
    ) {
        const d = cur.toISOString().slice(0, 10);
        oh += dailyNet.get(d) ?? 0;

        const zone: BufferHealthEntry['zone'] =
            oh <= bz.tor ? 'red'
            : oh <= bz.toy ? 'yellow'
            : oh <= bz.tog ? 'green'
            : 'excess';

        result.push({ date: d, onhand: oh, zone, pct: bz.tog > 0 ? (oh / bz.tog) * 100 : 0 });
    }

    return result;
}

// =============================================================================
// 23. materialSyncShortfall — non-decoupled component supply shortfall
// =============================================================================

export interface SyncShortfallEntry {
    specId: string;
    /** Total demand quantity (Commitments + Intents) within the planning horizon */
    demand: number;
    /** Physical on-hand (custody-based) */
    onhand: number;
    /** Confirmed supply (outputOf Commitments) within the planning horizon */
    supply: number;
    /** max(0, demand − onhand − supply) */
    shortfall: number;
    /**
     * Buffer status of the PARENT decoupled item this component feeds —
     * conveys urgency: a shortfall feeding a red-zone parent is most critical.
     * Provided only when `parentZoneBySpec` is supplied by the caller.
     */
    parentBufferStatus?: BufferStatusResult;
}

/**
 * Material synchronization shortfall for non-decoupled items (DDMRP C5 alert (c)).
 *
 * Identifies sub-assembly components whose supply is insufficient to meet
 * known demand allocations within the planning horizon.
 *
 * Unlike buffer status (which applies to decoupled items with a BufferZone),
 * this alert is for DEPENDENT components that have no independent buffer.
 *
 * Shortfall = max(0, demand − onhand − supply)
 *
 * Demand: consuming Commitments + Intents (inputOf set, not NON_CONSUMING_ACTIONS)
 *         with `due ≤ today + planHorizonDays`.
 * Supply: supply Commitments (outputOf set) with `due ≤ today + planHorizonDays`.
 *
 * @param specIds          Non-decoupled ResourceSpecification IDs to evaluate
 * @param planStore        Source of Commitments and Intents
 * @param observer         Source of on-hand inventory
 * @param today            Reference date
 * @param planHorizonDays  Planning horizon in days (default 30)
 * @param parentZoneBySpec Optional: caller-supplied parent BufferZone per specId
 *                         (derived from BOM structure; conveys urgency context)
 */
export function materialSyncShortfall(
    specIds: string[],
    planStore: PlanStore,
    observer: Observer,
    today: Date,
    planHorizonDays: number = 30,
    parentZoneBySpec?: Map<string, BufferZone>,
): SyncShortfallEntry[] {
    const cutoff = new Date(today.getTime() + planHorizonDays * 86_400_000);

    return specIds.map(specId => {
        // Physical on-hand (custody-based)
        const onhand = observer
            .conformingResources(specId)
            .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);

        // Demand: consuming Commitments + Intents due within horizon
        let demand = 0;
        for (const c of planStore.allCommitments()) {
            if (
                c.resourceConformsTo === specId &&
                c.inputOf !== undefined &&
                !NON_CONSUMING_ACTIONS.has(c.action) &&
                !c.finished &&
                c.due && new Date(c.due) <= cutoff
            ) {
                demand += c.resourceQuantity?.hasNumericalValue ?? 0;
            }
        }
        for (const i of planStore.allIntents()) {
            if (
                i.resourceConformsTo === specId &&
                i.inputOf !== undefined &&
                !NON_CONSUMING_ACTIONS.has(i.action) &&
                !i.finished &&
                i.due && new Date(i.due) <= cutoff
            ) {
                demand += i.resourceQuantity?.hasNumericalValue ?? 0;
            }
        }

        // Supply: outputOf Commitments due within horizon
        let supply = 0;
        for (const c of planStore.allCommitments()) {
            if (
                c.resourceConformsTo === specId &&
                c.outputOf !== undefined &&
                !NON_CONSUMING_ACTIONS.has(c.action) &&
                !c.finished &&
                c.due && new Date(c.due) <= cutoff
            ) {
                supply += c.resourceQuantity?.hasNumericalValue ?? 0;
            }
        }

        const shortfall = Math.max(0, demand - onhand - supply);

        // Parent buffer status for urgency context (caller-supplied)
        let parentBufferStatus: BufferStatusResult | undefined;
        const parentZone = parentZoneBySpec?.get(specId);
        if (parentZone) {
            const parentOnHand = observer
                .conformingResources(parentZone.specId)
                .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
            parentBufferStatus = bufferStatus(parentOnHand, parentZone);
        }

        return { specId, demand, onhand, supply, shortfall, parentBufferStatus };
    });
}

// =============================================================================
// 24. orderActivitySummary — unified execution dashboard
// =============================================================================

export interface OrderActivityEntry {
    commitment: Commitment;
    /**
     * DDMRP order type derived from Commitment.action:
     *   'MO' — Manufacturing Order (produce)
     *   'PO' — Purchase Order (transferAllRights | transfer)
     *   'TO' — Transfer Order (transferCustody | move)
     *   'other' — any other supply action
     */
    orderType: 'MO' | 'PO' | 'TO' | 'other';
    /**
     * Buffer status for this commitment's ResourceSpecification.
     * Undefined when no BufferZone is configured for the spec.
     */
    bufferStatus?: BufferStatusResult;
    /** Observer fulfillment state for this commitment */
    fulfillmentState?: FulfillmentState;
}

/**
 * Unified execution summary: all open supply Commitments with order type
 * classification, buffer status %, and fulfillment progress.
 *
 * Covers DDMRP §4.3 "Order Activity Summary Screen":
 *   Columns: Order#, Part#, Order Type, Due Date, Qty, Buffer Status %, Progress
 *
 * Filters to supply-side only: `outputOf` set + `!finished`.
 * Buffer status uses physical `onhandQuantity` (custody-based), not accounting.
 *
 * @param planStore  Source of open Commitments
 * @param observer   Source of on-hand inventory and fulfillment state
 * @param zoneStore  Source of BufferZone records for buffer status lookup
 */
export function orderActivitySummary(
    planStore: PlanStore,
    observer: Observer,
    zoneStore: BufferZoneStore,
): OrderActivityEntry[] {
    function classifyOrderType(action: string): OrderActivityEntry['orderType'] {
        switch (action) {
            case 'produce':          return 'MO';
            case 'transferAllRights':
            case 'transfer':         return 'PO';
            case 'transferCustody':
            case 'move':             return 'TO';
            default:                 return 'other';
        }
    }

    return planStore
        .allCommitments()
        .filter(c => c.outputOf !== undefined && !c.finished)
        .map(c => {
            const orderType        = classifyOrderType(c.action);
            const fulfillmentState = observer.getFulfillment(c.id);

            let bs: BufferStatusResult | undefined;
            if (c.resourceConformsTo) {
                const zone = zoneStore.findZone(c.resourceConformsTo, c.atLocation);
                if (zone) {
                    const onhand = observer
                        .conformingResources(c.resourceConformsTo)
                        .reduce((sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
                    bs = bufferStatus(onhand, zone);
                }
            }

            return { commitment: c, orderType, bufferStatus: bs, fulfillmentState };
        });
}

// =============================================================================
// 25. ltmAlertZoneFull — 5-zone LTM alert (Early / Green / Yellow / Red / Late)
// =============================================================================

/**
 * Full 5-zone Lead Time Managed alert for an open supply order.
 *
 * Extends `ltmAlertZone()` to distinguish the two edge cases the DDI image
 * material (yet-to-be-received.jpg, time-buffers-2.jpg) treats as distinct:
 *
 *   'early' — order is outside the LTM alert horizon (tracking not yet started)
 *   'green' — entered the alert horizon; on track
 *   'yellow' — second third of alert horizon; expediting attention needed
 *   'red'   — final third of alert horizon; immediate action required
 *   'late'  — past due (daysRemaining < 0); escalate immediately
 *   null    — commitment has no due date; not applicable
 *
 * Alert horizon = last third of DLT (= dltDays / 3).
 * Sub-zones within the alert horizon = equal thirds of that horizon.
 *
 * @param commitment  Open supply Commitment to assess
 * @param dltDays     Decoupled Lead Time for this item in calendar days
 * @param today       Reference date
 */
export function ltmAlertZoneFull(
    commitment: Commitment,
    dltDays: number,
    today: Date,
): 'early' | 'green' | 'yellow' | 'red' | 'late' | null {
    if (!commitment.due) return null;

    const daysRemaining = (new Date(commitment.due).getTime() - today.getTime()) / 86_400_000;

    if (daysRemaining < 0) return 'late';

    const alertHorizon = dltDays / 3;
    if (daysRemaining > alertHorizon) return 'early';

    const third = alertHorizon / 3;
    if (daysRemaining > third * 2) return 'green';
    if (daysRemaining > third)     return 'yellow';
    return 'red';
}

// =============================================================================
// 26. timeBufferState — two-state WO tracking for DDOM stability column
// =============================================================================

/**
 * Two-state Work Order position for the DDOM "Yet to Be Received" / "Received"
 * stability board (time-buffers-2.jpg).
 *
 * States:
 *   'yet-to-be-received' — no fulfilling EconomicEvents recorded yet
 *   'in-process'         — partially fulfilled (totalFulfilled > 0 but not finished)
 *   'completed'          — fulfillment is finished (totalFulfilled >= totalCommitted)
 *
 * Combine with `ltmAlertZoneFull()` to produce the full DDOM stability column entry.
 *
 * @param fulfillmentState  From Observer.getFulfillment(commitment.id); undefined
 *                          when no events have been recorded yet (→ 'yet-to-be-received')
 */
export function timeBufferState(
    fulfillmentState: FulfillmentState | undefined,
): 'yet-to-be-received' | 'in-process' | 'completed' {
    if (!fulfillmentState || fulfillmentState.totalFulfilled.hasNumericalValue <= 0) {
        return 'yet-to-be-received';
    }
    return fulfillmentState.finished ? 'completed' : 'in-process';
}

// =============================================================================
// 27. capacityBufferStatus — work center load G/Y/R zone
// =============================================================================

export interface CapacityBufferResult {
    load: number;
    totalCapacity: number;
    /** load / totalCapacity × 100 */
    utilizationPct: number;
    /**
     * Flow-centric capacity buffer zone (capacity-buffers.jpg):
     *   'green'  — load within normal operating band (below greenThreshold)
     *   'yellow' — load entering sprint headroom (greenThreshold → yellowThreshold)
     *   'red'    — sprint capacity being consumed (yellowThreshold → totalCapacity)
     *   'excess' — over-capacity; cannot absorb further variability
     */
    zone: 'green' | 'yellow' | 'red' | 'excess';
}

/**
 * Capacity buffer zone status for a work center (DDOM Stability column).
 *
 * The DDOM flow-centric capacity model (flow-centric.jpg) places G/Y/R buffer
 * zones at the TOP of the capacity range, not the bottom. Normal load occupies
 * the green zone; variability spikes absorb into yellow → red → excess.
 *
 * This is the OPPOSITE of stock buffers (where red is the danger zone at the
 * bottom representing low stock). For capacity, the danger is HIGH load.
 *
 * Default thresholds reflect typical DDI practice (20 % sprint headroom):
 *   greenThreshold  = 0.80  (up to 80 % utilisation → normal operating band)
 *   yellowThreshold = 0.95  (80–95 % → using sprint headroom; investigate)
 *   above 95 %  → 'red' (full sprint; act); above 100 % → 'excess' (over-capacity)
 *
 * @param load             Current committed load (minutes, hours, or any unit)
 * @param totalCapacity    Total available capacity in the same unit
 * @param greenThreshold   Fraction of totalCapacity that defines green/yellow boundary (default 0.80)
 * @param yellowThreshold  Fraction of totalCapacity that defines yellow/red boundary (default 0.95)
 */
export function capacityBufferStatus(
    load: number,
    totalCapacity: number,
    greenThreshold: number  = 0.80,
    yellowThreshold: number = 0.95,
): CapacityBufferResult {
    const utilizationPct = totalCapacity > 0 ? (load / totalCapacity) * 100 : 0;

    const zone: CapacityBufferResult['zone'] =
        load > totalCapacity                  ? 'excess'
        : load > totalCapacity * yellowThreshold ? 'red'
        : load > totalCapacity * greenThreshold  ? 'yellow'
        : 'green';

    return { load, totalCapacity, utilizationPct, zone };
}

// =============================================================================
// 28. materialReleaseDate — synchronized WO release gate
// =============================================================================

/**
 * Latest acceptable work order release date for synchronized material release
 * (sync-material-release.jpg, Ptak & Smith Ch 11).
 *
 * Rule: release at the LATEST acceptable date — not as early as possible.
 *   - Early release ← raises WIP levels unnecessarily
 *   - Late  release → jeopardizes control point schedule
 *
 * Formula: latestRelease = controlPointDueDate − legDays
 *
 * `legDays` should come from `legLeadTime()` for the routing leg from this
 * work order's current stage to the upstream control point.
 *
 * @param controlPointDueDate  ISO date (YYYY-MM-DD) of the target control point
 * @param legDays              Lead time in days from this WO's stage to the CP
 * @returns ISO date string (YYYY-MM-DD) — latest acceptable release date
 */
export function materialReleaseDate(controlPointDueDate: string, legDays: number): string {
    const releaseMs = new Date(controlPointDueDate).getTime() - legDays * 86_400_000;
    return new Date(releaseMs).toISOString().slice(0, 10);
}

// =============================================================================
// 29. signalComplianceHistory — DDOM reliability dashboard compliance grid
// =============================================================================

export interface ComplianceCell {
    /** YYYY-MM-DD */
    date: string;
    specId: string;
    /**
     * Compliance status of signals generated on this date for this spec:
     *   'compliant' — signal was approved and commitment was not late
     *   'late'      — signal was approved but commitment due > signal.dueDate
     *   'rejected'  — signal was rejected
     *   'open'      — signal is still open (not yet acted on)
     *   'none'      — no signal was generated on this date for this spec
     */
    status: 'compliant' | 'late' | 'rejected' | 'open' | 'none';
    signalCount: number;
}

/**
 * Time-series signal compliance grid for the DDOM Reliability dashboard
 * (DDOM-Dashboard.jpg Column 1 — "Signal Integrity" grid).
 *
 * For each (date, specId) cell in [fromDate, toDate]:
 *   - 'compliant': all signals approved without due-date overrun
 *   - 'late':      any approved signal has commitment.due > signal.dueDate
 *   - 'rejected':  any signal was rejected (and none compliant)
 *   - 'open':      signal exists but still awaiting approval
 *   - 'none':      no signal was generated on this date for this spec
 *
 * Cell priority when multiple signals exist on the same date:
 *   compliant < late < rejected < open  (most concerning wins)
 *
 * @param signals   ReplenishmentSignals to evaluate (caller filters by spec/location)
 * @param planStore Source of approved Commitments (for due-date comparison)
 * @param fromDate  Start date (YYYY-MM-DD, inclusive)
 * @param toDate    End date (YYYY-MM-DD, inclusive)
 */
export function signalComplianceHistory(
    signals: ReplenishmentSignal[],
    planStore: PlanStore,
    fromDate: string,
    toDate: string,
): ComplianceCell[] {
    // Group signals by (date, specId)
    const buckets = new Map<string, ReplenishmentSignal[]>();

    for (const s of signals) {
        const d = s.createdAt.slice(0, 10);
        if (d < fromDate || d > toDate) continue;
        const key = `${d}::${s.specId}`;
        const list = buckets.get(key) ?? [];
        list.push(s);
        buckets.set(key, list);
    }

    // Enumerate every (date, specId) combination that had a signal
    const cells: ComplianceCell[] = [];

    for (const [key, signalList] of buckets) {
        const [date, specId] = key.split('::');

        // Priority order (most concerning wins): open > rejected > late > compliant
        let worstStatus: ComplianceCell['status'] = 'compliant';

        for (const s of signalList) {
            let cellStatus: ComplianceCell['status'];
            if (s.status === 'open') {
                cellStatus = 'open';
            } else if (s.status === 'rejected') {
                cellStatus = 'rejected';
            } else if (s.approvedCommitmentId) {
                const commitment = planStore.getCommitment(s.approvedCommitmentId);
                const commitmentDue = commitment?.due?.slice(0, 10);
                cellStatus = (commitmentDue && commitmentDue > s.dueDate) ? 'late' : 'compliant';
            } else {
                cellStatus = 'open';  // approved but no commitmentId yet
            }

            // Escalate to worse status
            const priority: Record<ComplianceCell['status'], number> = {
                compliant: 0, late: 1, rejected: 2, open: 3, none: -1,
            };
            if (priority[cellStatus] > priority[worstStatus]) {
                worstStatus = cellStatus;
            }
        }

        cells.push({ date, specId, status: worstStatus, signalCount: signalList.length });
    }

    return cells.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.specId < b.specId ? -1 : 1);
}

// =============================================================================
// 24. deriveVariabilityFactor — VRD × VRS → numeric VF
// =============================================================================

type VariabilityLevel = 'low' | 'medium' | 'high';

/**
 * Derive the numeric Variability Factor (VF) from VRD and VRS classifications.
 *
 * Lookup table (Ptak & Smith typical values):
 *
 *   VRD \ VRS | low  | medium | high
 *   ----------|------|--------|-----
 *   low       | 0.10 |  0.25  | 0.50
 *   medium    | 0.25 |  0.50  | 0.75
 *   high      | 0.50 |  0.75  | 1.00
 *
 * The result is the authoritative variabilityFactor for a BufferProfile when
 * both VRD and VRS are known. Callers may still override with a manual value.
 *
 * DDMRP ref: Ptak & Smith Ch 6 §"External Variability", Ch 7 §"Factor 3: Variability".
 */
export function deriveVariabilityFactor(vrd: VariabilityLevel, vrs: VariabilityLevel): number {
    const table: Record<VariabilityLevel, Record<VariabilityLevel, number>> = {
        low:    { low: 0.10, medium: 0.25, high: 0.50 },
        medium: { low: 0.25, medium: 0.50, high: 0.75 },
        high:   { low: 0.50, medium: 0.75, high: 1.00 },
    };
    return table[vrd][vrs];
}

// =============================================================================
// 25a. Ch 8 — cascadeComponentDAF + computeADUDifferential
// =============================================================================

/**
 * Compute the effective DAF for a shared component whose parents have different DAFs
 * applied (Ch 8 §8.2.1 Fig 8-24).
 *
 * Formula:
 *   componentAdjustedADU = Σ(parentAdjustedADU_i × usageQtyPerParent_i)
 *   componentDAF = componentAdjustedADU / componentBaseADU
 *
 * @param componentBaseADU      Component's base (unadjusted) ADU
 * @param parentContributions   Array of { parentAdjustedADU, usageQty } — one entry per
 *                              parent BOM line that consumes this component.
 *                              `parentAdjustedADU` = parentBaseADU × parentDAF
 *                              `usageQty` = qty of component per one parent unit (from RecipeProcess ingredient)
 * @returns Effective DAF for the component (≥ 0)
 *
 * @example
 * // Fig 8-24: FPA (ADU=100, DAF=2) and FPB (ADU=200, DAF=1) each use 2 of ICB.
 * // ICB base ADU = (100×2) + (200×2) = 600.
 * cascadeComponentDAF(600, [
 *   { parentAdjustedADU: 200, usageQty: 2 },  // FPA: 100 × 2 × 2 = 400
 *   { parentAdjustedADU: 200, usageQty: 2 },  // FPB: 200 × 1 × 2 = 400
 * ]);
 * // → 800 / 600 = 1.333…
 */
export function cascadeComponentDAF(
    componentBaseADU: number,
    parentContributions: Array<{ parentAdjustedADU: number; usageQty: number }>,
): number {
    const componentAdjustedADU = parentContributions.reduce(
        (sum, { parentAdjustedADU, usageQty }) => sum + parentAdjustedADU * usageQty,
        0,
    );
    return componentBaseADU > 0 ? componentAdjustedADU / componentBaseADU : 0;
}

/**
 * ADU Differential — ratio of short-window ADU to long-window ADU (Ch 8 §8.2.1).
 *
 * Used as an explicit trigger for evaluating when to apply a DAF.
 * A value significantly above 1.0 indicates a recent demand increase;
 * below 1.0 indicates a recent demand decrease.
 *
 * @param shortWindowADU ADU computed over a short rolling window (e.g. 7 days)
 * @param longWindowADU  ADU computed over the standard long window (e.g. 84 days)
 * @returns Ratio of short / long ADU (≥ 0). Returns 0 when longWindowADU is 0.
 */
export function computeADUDifferential(shortWindowADU: number, longWindowADU: number): number {
    return longWindowADU > 0 ? shortWindowADU / longWindowADU : 0;
}

// =============================================================================
// 25b. G-6/G-7 — validateBufferProfile (LTF + VF range checks)
// =============================================================================

/**
 * LTF valid ranges per lead time band (Ch 7 §"Buffer Profile and Levels").
 * Short: 61–100%, Medium: 41–60%, Long: 20–40%.
 */
export const LTF_RANGES: Record<'short' | 'medium' | 'long', [number, number]> = {
    short:  [0.61, 1.00],
    medium: [0.41, 0.60],
    long:   [0.20, 0.40],
};

/**
 * VF valid ranges per variability band (Ch 7 §"Buffer Profile and Levels").
 * Low: 0–40%, Medium: 41–60%, High: 61%+.
 */
export const VF_RANGES: Record<'low' | 'medium' | 'high', [number, number]> = {
    low:    [0.00, 0.40],
    medium: [0.41, 0.60],
    high:   [0.61, Infinity],
};

/**
 * Validate that a BufferProfile's LTF and VF values fall within their declared bands.
 * Returns a list of warning strings (empty = all in range).
 * Callers decide whether to surface warnings as errors or informational notes.
 * DDMRP ref: Ptak & Smith Ch 7 §"Buffer Profile and Levels".
 */
export function validateBufferProfile(profile: BufferProfile): string[] {
    const warnings: string[] = [];
    if (profile.leadTimeCategory) {
        const [lo, hi] = LTF_RANGES[profile.leadTimeCategory];
        if (profile.leadTimeFactor < lo || profile.leadTimeFactor > hi) {
            warnings.push(
                `leadTimeFactor ${profile.leadTimeFactor} outside ${profile.leadTimeCategory} range [${lo}, ${hi}]`,
            );
        }
    }
    if (profile.variabilityCategory) {
        const [lo, hi] = VF_RANGES[profile.variabilityCategory];
        if (profile.variabilityFactor < lo || profile.variabilityFactor > hi) {
            warnings.push(
                `variabilityFactor ${profile.variabilityFactor} outside ${profile.variabilityCategory} range [${lo}, ${hi === Infinity ? '∞' : hi}]`,
            );
        }
    }
    return warnings;
}

// =============================================================================
// 25c. G-9 — buildProfileCode / parseProfileCode
// =============================================================================

const ITEM_TYPE_LETTER: Record<BufferProfile['itemType'], string> = {
    Manufactured: 'M', Purchased: 'P', Distributed: 'D', Intermediate: 'I',
};
const LT_CATEGORY_LETTER: Record<'short' | 'medium' | 'long', string> = {
    short: 'S', medium: 'M', long: 'L',
};
const VAR_CATEGORY_LETTER: Record<'low' | 'medium' | 'high', string> = {
    low: 'L', medium: 'M', high: 'H',
};

/**
 * Build the 3-letter Ch 7 profile code: ItemType + LTCategory + VariabilityCategory.
 * Example: buildProfileCode('Manufactured', 'medium', 'low') → 'MML'
 * DDMRP ref: Ptak & Smith Ch 7 §"Buffer Profile Naming Convention".
 */
export function buildProfileCode(
    itemType: BufferProfile['itemType'],
    ltCategory: 'short' | 'medium' | 'long',
    varCategory: 'low' | 'medium' | 'high',
): string {
    return `${ITEM_TYPE_LETTER[itemType]}${LT_CATEGORY_LETTER[ltCategory]}${VAR_CATEGORY_LETTER[varCategory]}`;
}

/**
 * Parse a 3-letter Ch 7 profile code back into its components.
 * Returns null when the code does not match the expected pattern.
 * Example: parseProfileCode('MML') → { itemType: 'Manufactured', ltCategory: 'medium', varCategory: 'low' }
 * DDMRP ref: Ptak & Smith Ch 7 §"Buffer Profile Naming Convention".
 */
export function parseProfileCode(code: string): {
    itemType: BufferProfile['itemType'];
    ltCategory: 'short' | 'medium' | 'long';
    varCategory: 'low' | 'medium' | 'high';
} | null {
    if (!/^[MPDI][SML][LMH]$/.test(code)) return null;
    const itemTypeMap: Record<string, BufferProfile['itemType']> = {
        M: 'Manufactured', P: 'Purchased', D: 'Distributed', I: 'Intermediate',
    };
    const ltMap: Record<string, 'short' | 'medium' | 'long'> = {
        S: 'short', M: 'medium', L: 'long',
    };
    const vrMap: Record<string, 'low' | 'medium' | 'high'> = {
        L: 'low', M: 'medium', H: 'high',
    };
    return { itemType: itemTypeMap[code[0]], ltCategory: ltMap[code[1]], varCategory: vrMap[code[2]] };
}

// =============================================================================
// 25d. G-8 — Standard 36-profile registry
// =============================================================================

/** Mid-point LTF values for each lead time band (Ch 7 starting-point defaults). */
export const STANDARD_LTF: Record<'short' | 'medium' | 'long', number> = {
    short: 0.80, medium: 0.50, long: 0.30,
};

/** Mid-point VF values for each variability band (Ch 7 starting-point defaults). */
export const STANDARD_VF: Record<'low' | 'medium' | 'high', number> = {
    low: 0.10, medium: 0.50, high: 1.00,
};

/**
 * Returns a template BufferProfile for any of the 36 Ch 7 standard profiles.
 * Callers must supply id and name; all other fields are set to book mid-points.
 * DDMRP ref: Ptak & Smith Ch 7 §"Standard Profile Registry".
 */
export function standardProfile(
    itemType: BufferProfile['itemType'],
    ltCategory: 'short' | 'medium' | 'long',
    varCategory: 'low' | 'medium' | 'high',
): Omit<BufferProfile, 'id' | 'name'> {
    const code = buildProfileCode(itemType, ltCategory, varCategory);
    return {
        itemType,
        leadTimeFactor: STANDARD_LTF[ltCategory],
        variabilityFactor: STANDARD_VF[varCategory],
        leadTimeCategory: ltCategory,
        variabilityCategory: varCategory,
        code,
    };
}

// =============================================================================
// 25e. G-2 — scorePositioningAnalysis
// =============================================================================

/**
 * Translate the six Ch 7 positioning factors into a 0–100 score.
 * Higher score = stronger case for placing a decoupling buffer here.
 *
 * Scoring breakdown (max pts):
 *   CTT vs DLT (20), SOVH vs DLT (15), ILF (20), VRD (15), VRS (15), COP (15)
 *
 * @param pa                  PositioningAnalysis record for the item
 * @param totalLeadTimeDays   Full end-to-end lead time without buffering
 * DDMRP ref: Ptak & Smith Ch 7 §"Strategic Inventory Positioning Factors".
 */
export function scorePositioningAnalysis(
    pa: PositioningAnalysis,
    totalLeadTimeDays: number,
): { score: number; recommendation: 'buffer' | 'consider' | 'skip'; factors: Record<string, number> } {
    const factors: Record<string, number> = {};

    // CTT vs DLT: if CTT < DLT customer can't wait — strong buffer case (0–20 pts)
    if (pa.customerToleranceTimeDays != null) {
        const ratio = pa.customerToleranceTimeDays / Math.max(totalLeadTimeDays, 1);
        factors.ctt = ratio < 0.5 ? 20 : ratio < 1.0 ? 12 : 0;
    }
    // SOVH: shorter horizon = less forward visibility = stronger buffer need (0–15 pts)
    if (pa.salesOrderVisibilityHorizonDays != null) {
        const ratio = pa.salesOrderVisibilityHorizonDays / Math.max(totalLeadTimeDays, 1);
        factors.sovh = ratio < 0.5 ? 15 : ratio < 1.0 ? 8 : 0;
    }
    // ILF: high leverage = many options = strong buffer case (0–20 pts)
    const ilfScore: Record<string, number> = { high: 20, medium: 10, low: 0 };
    if (pa.inventoryLeverageFlexibility) factors.ilf = ilfScore[pa.inventoryLeverageFlexibility];
    // VRD: high demand variability = need buffer (0–15 pts)
    const vrdScore: Record<string, number> = { high: 15, medium: 8, low: 0 };
    if (pa.vrd) factors.vrd = vrdScore[pa.vrd];
    // VRS: high supply variability = need buffer (0–15 pts)
    const vrsScore: Record<string, number> = { high: 15, medium: 8, low: 0 };
    if (pa.vrs) factors.vrs = vrsScore[pa.vrs];
    // COP: feeds critical operation = buffer strongly recommended (0–15 pts)
    if (pa.criticalOperationProtection != null) {
        factors.cop = pa.criticalOperationProtection ? 15 : 0;
    }

    const score = Math.min(100, Object.values(factors).reduce((a, b) => a + b, 0));
    const recommendation = score >= 60 ? 'buffer' : score >= 30 ? 'consider' : 'skip';
    return { score, recommendation, factors };
}

// =============================================================================
// 25f. G-4 — bufferEligibility
// =============================================================================

/**
 * Check whether an item is eligible for a DDMRP buffer.
 * Returns { eligible: true } when all checks pass; otherwise lists disqualifying reasons.
 *
 * @param pa                  PositioningAnalysis for the item (optional)
 * @param adu                 Average Daily Usage (positive → demand exists)
 * @param totalLeadTimeDays   Full end-to-end lead time without buffering
 * @param opts.isMTO          True if item is Make-to-Order (no buffer appropriate)
 * @param opts.aduThreshold   Minimum ADU to justify a buffer (default 0.01)
 * DDMRP ref: Ptak & Smith Ch 7 §"Strategic Inventory Positioning".
 */
export function bufferEligibility(
    pa: PositioningAnalysis | undefined,
    adu: number,
    totalLeadTimeDays: number,
    opts?: { isMTO?: boolean; aduThreshold?: number },
): { eligible: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const aduThreshold = opts?.aduThreshold ?? 0.01;

    if (adu < aduThreshold) {
        reasons.push(`ADU ${adu} below threshold ${aduThreshold} — demand too low to justify buffer`);
    }
    if (opts?.isMTO) {
        reasons.push('Make-to-order item — buffer not appropriate');
    }
    if (pa?.customerToleranceTimeDays != null && pa.customerToleranceTimeDays >= totalLeadTimeDays) {
        reasons.push(
            `CTT (${pa.customerToleranceTimeDays}d) ≥ total lead time (${totalLeadTimeDays}d) — customer can wait; no buffer benefit`,
        );
    }

    return { eligible: reasons.length === 0, reasons };
}

// =============================================================================
// 25g. G-5 — checkItemTypeConsistency
// =============================================================================

/**
 * Infer an item's type from recipe flows and compare it against the BufferProfile declaration.
 * Warns when the profile's itemType contradicts what the recipe graph implies.
 *
 * Logic:
 *   hasProduceOutput + hasExternalInput  → Intermediate
 *   hasProduceOutput only               → Manufactured
 *   hasExternalInput only               → Purchased
 *   neither                             → cannot infer (possibly Distributed or no flows)
 *
 * @param specId       ResourceSpecification ID to scan
 * @param profile      BufferProfile whose itemType to validate
 * @param recipeStore  Recipe store to query for flows
 * DDMRP ref: Ptak & Smith Ch 7 §"Item Type Classification".
 */
export function checkItemTypeConsistency(
    specId: string,
    profile: BufferProfile,
    recipeStore: RecipeStore,
): { consistent: boolean; inferredType: BufferProfile['itemType'] | null; note: string } {
    let hasProduceOutput = false;
    let hasExternalInput  = false;

    for (const recipe of recipeStore.allRecipes()) {
        for (const rp of recipeStore.getProcessChain(recipe.id)) {
            const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);
            for (const f of outputs) {
                if (f.resourceConformsTo === specId && f.action === 'produce') {
                    hasProduceOutput = true;
                }
            }
            for (const f of inputs) {
                if (
                    f.resourceConformsTo === specId &&
                    (f.action === 'transfer' || f.action === 'transferAllRights')
                ) {
                    hasExternalInput = true;
                }
            }
        }
    }

    let inferredType: BufferProfile['itemType'] | null = null;
    if (hasProduceOutput && hasExternalInput) inferredType = 'Intermediate';
    else if (hasProduceOutput) inferredType = 'Manufactured';
    else if (hasExternalInput) inferredType = 'Purchased';

    if (inferredType === null) {
        return {
            consistent: true,
            inferredType: null,
            note: 'Cannot infer item type from recipe flows (possibly Distributed or no flows found)',
        };
    }

    const consistent = profile.itemType === inferredType;
    const note = consistent
        ? `Confirmed: profile itemType '${profile.itemType}' matches inferred type`
        : `Mismatch: profile itemType '${profile.itemType}' but recipe flows suggest '${inferredType}'`;

    return { consistent, inferredType, note };
}

// =============================================================================
// 25h. G-11 — recommendBufferType
// =============================================================================

/**
 * Recommend the appropriate buffer classification for a new DDMRP zone.
 *
 * Rules (in priority order):
 *   1. isContractual  → replenished_override (user-managed zones)
 *   2. Low VF + stable ADU (CoV < 0.20) → min_max
 *   3. Default → replenished
 *
 * @param variabilityFactor  VF value from the BufferProfile
 * @param opts.isContractual True when zones are set by contract or executive override
 * @param opts.aduCoV        Coefficient of variation of daily demand (optional)
 * DDMRP ref: Ptak & Smith Ch 7 §"Buffer Type Selection".
 */
export function recommendBufferType(
    variabilityFactor: number,
    opts?: { isContractual?: boolean; aduCoV?: number },
): BufferZone['bufferClassification'] {
    if (opts?.isContractual) return 'replenished_override';
    // Low variability AND stable ADU (CoV < 0.2) → min-max
    if (variabilityFactor <= 0.20 && (opts?.aduCoV == null || opts.aduCoV < 0.20)) return 'min_max';
    return 'replenished';
}

// =============================================================================
// 30. orchestrateBufferRecalibration — pre-planning ADU refresh + zone update
// =============================================================================

/**
 * Pre-planning orchestrator: refresh ADU from historical events and recalibrate
 * all BufferZones in the store before planForScope / planForRegion runs.
 *
 * Call this once per planning cycle (before any planFor* invocation) so that
 * buffer zone sizes reflect current demand patterns rather than stale estimates.
 *
 * Workflow for each zone:
 *   1. computeADU() from the provided events slice
 *   2. recalibrateBufferZone() with fresh ADU + DLT from zone.dltDays
 *      (DLT segmentation — Gap 6 — would provide a segmented DLT here)
 *   3. Store the updated zone back via bufferZoneStore.replaceZone()
 *
 * Zones without a matching profile in profileMap are skipped.
 *
 * DDMRP ref: Ptak & Smith Ch 10 — DDS&OP; Ch 7 §"Recalibration Process".
 *
 * @param bufferZoneStore  Store of all active buffer zones
 * @param profileMap       profileId → BufferProfile mapping
 * @param events           Historical EconomicEvents for ADU computation
 * @param adjustments      Active DemandAdjustmentFactors for the period
 * @param asOf             Reference date (today)
 * @param opts.windowDays  ADU rolling window in days (default 84 — 12 weeks)
 */
export function orchestrateBufferRecalibration(
    bufferZoneStore: BufferZoneStore,
    profileMap: Map<string, BufferProfile>,
    events: EconomicEvent[],
    adjustments: DemandAdjustmentFactor[],
    asOf: Date,
    opts?: { windowDays?: number },
): void {
    const windowDays = opts?.windowDays ?? 84;
    for (const zone of bufferZoneStore.allBufferZones()) {
        const profile = profileMap.get(zone.profileId);
        if (!profile) continue;
        const { adu } = computeADU(events, zone.specId, windowDays, asOf);
        const updated = recalibrateBufferZone(zone, adu, zone.dltDays, profile, adjustments, asOf);
        bufferZoneStore.replaceZone(updated);
    }
}

// =============================================================================
// 25i. G-13 — adjustVFForCapacity
// =============================================================================

/**
 * Advisory: suggests a VF multiplier based on capacity buffer zone colour.
 * Red-zone capacity → recommend higher VF on stock buffer (more safety stock).
 * Green-zone capacity → recommend lower VF (capacity absorbs variability).
 *
 * Result is capped at 1.0 (maximum meaningful VF).
 * This is advisory only — callers must decide whether to apply the result.
 *
 * @param baseVF        Starting variabilityFactor from the BufferProfile
 * @param capacityZone  Current colour of the associated capacity buffer
 * DDMRP ref: Ptak & Smith Ch 7 §"Interplay of Buffer Types".
 */
export function adjustVFForCapacity(
    baseVF: number,
    capacityZone: 'red' | 'yellow' | 'green',
): number {
    const multiplier: Record<'red' | 'yellow' | 'green', number> = {
        red:    1.25,  // capacity in sprint mode — stock buffer needs more cushion
        yellow: 1.00,  // neutral
        green:  0.85,  // healthy capacity — stock buffer can be leaner
    };
    return Math.min(1.0, baseVF * multiplier[capacityZone]);
}

// =============================================================================
// 25h. N-1 — aduDriftAlert
// =============================================================================

/**
 * Compares a freshly computed ADU against the zone's stored ADU and returns
 * an alert level based on the zone's configured alert thresholds.
 *
 * @param previousADU   ADU stored on the BufferZone before this recalibration
 * @param newADU        Freshly computed ADU value
 * @param highThreshold Fraction (e.g. 0.20 = 20%) above which fires 'high' alert
 * @param lowThreshold  Fraction (e.g. 0.20 = 20%) below which fires 'low' alert
 * @returns 'high' | 'low' | null
 * DDMRP ref: Ptak & Smith Ch 7 §"ADU Exceptions".
 */
export function aduDriftAlert(
    previousADU: number,
    newADU: number,
    highThreshold: number,
    lowThreshold: number,
): 'high' | 'low' | null {
    if (previousADU <= 0) return null;
    const ratio = newADU / previousADU;
    if (ratio > 1 + highThreshold) return 'high';
    if (ratio < 1 - lowThreshold)  return 'low';
    return null;
}

// =============================================================================
// 25i. N-2 — bootstrapADU
// =============================================================================

/**
 * Computes a blended ADU for items with incomplete demand history.
 *
 * Formula (Ptak & Smith Ch 7 Fig 7-16):
 *   blended = (actualADU × daysActual + estimatedADU × daysEstimated) / windowDays
 *
 * Where daysEstimated = windowDays − daysActual.
 * Once daysActual ≥ windowDays, returns actualADU unchanged (bootstrap complete).
 *
 * @param actualADU    ADU computed from real demand events so far
 * @param daysActual   Number of days of real demand history accumulated
 * @param estimatedADU Management-estimated ADU for the remaining window
 * @param windowDays   Full ADU computation window (e.g. 30, 60, 90 days)
 * @returns { blendedADU, bootstrapComplete, effectiveDaysActual }
 * DDMRP ref: Ptak & Smith Ch 7 §"Establishing ADU with No History".
 */
export function bootstrapADU(
    actualADU: number,
    daysActual: number,
    estimatedADU: number,
    windowDays: number,
): { blendedADU: number; bootstrapComplete: boolean; effectiveDaysActual: number } {
    if (daysActual >= windowDays) {
        return { blendedADU: actualADU, bootstrapComplete: true, effectiveDaysActual: windowDays };
    }
    const daysEstimated = windowDays - daysActual;
    const blendedADU = (actualADU * daysActual + estimatedADU * daysEstimated) / windowDays;
    return { blendedADU, bootstrapComplete: false, effectiveDaysActual: daysActual };
}

// =============================================================================
// 25. analyzeRecipeTopology — divergent/convergent point detection
// =============================================================================

/**
 * Results of a recipe topology analysis.
 *
 * DDMRP ref: Ptak & Smith Ch 6 §"Advanced Inventory Positioning Considerations".
 */
export interface TopologyAnalysis {
    /**
     * ResourceSpecification IDs produced by exactly one process but consumed by
     * two or more downstream processes. These are ideal decoupling candidates:
     * stocking here maximises flexibility for all downstream users.
     */
    divergentSpecIds: string[];
    /**
     * RecipeProcess IDs that receive inputs from two or more distinct supply
     * chains (i.e. have ≥2 immediate predecessors with no common ancestor).
     * Convergent points are higher-risk and often warrant time/capacity buffers.
     */
    convergentProcIds: string[];
    /**
     * Suggested decoupling-point candidates: divergent spec producers union-ed
     * with any process whose leg DLT exceeds the supplied CTT threshold.
     * Array of RecipeProcess IDs.
     */
    decouplingCandidates: string[];
    /** Total critical-path length in calendar days (= recipeLeadTime result). */
    criticalPathDays: number;
    /**
     * Per-process leg DLT: critical-path duration from the recipe start to the
     * end of that process (its Earliest Finish time), in calendar days.
     */
    legLeadTimes: Map<string, number>;
}

/**
 * Analyse a recipe's flow graph for divergent points, convergent points, and
 * decoupling candidates.
 *
 * Purely analytical — no side effects. Callers can use the result to:
 *   - Auto-suggest isDecouplingPoint placements on ProcessSpecification
 *   - Warn about convergent points that lack time/capacity buffers
 *   - Populate positioningAnalysis.decouplingRecommended on ResourceSpecification
 *
 * @param recipeId      Recipe to analyse
 * @param recipeStore   Knowledge store (provides process chain + flows)
 * @param cttDays       Optional Customer Tolerance Time threshold in days.
 *                      Processes whose leg DLT exceeds this are added to
 *                      decouplingCandidates.
 */
export function analyzeRecipeTopology(
    recipeId: string,
    recipeStore: RecipeStore,
    cttDays?: number,
): TopologyAnalysis {
    const chain = recipeStore.getProcessChain(recipeId);
    const criticalPathDays = recipeLeadTime(recipeId, recipeStore);

    if (chain.length === 0) {
        return {
            divergentSpecIds: [],
            convergentProcIds: [],
            decouplingCandidates: [],
            criticalPathDays,
            legLeadTimes: new Map(),
        };
    }

    const { predecessors } = buildRecipePredecessors(chain, recipeStore);

    // --- Leg lead times: EF (Earliest Finish) per process ---
    const EF = new Map<string, number>();
    for (const rp of chain) {
        const preds = predecessors.get(rp.id) ?? [];
        const latestPredEF = preds.length === 0 ? 0 : Math.max(...preds.map(p => EF.get(p) ?? 0));
        EF.set(rp.id, latestPredEF + (rp.hasDuration ? durationToDays(rp.hasDuration) : 0));
    }

    // --- Build spec→producing processes and spec→consuming processes maps ---
    // Key: resourceConformsTo ID (stage omitted — we track the resource spec itself)
    const specProducers = new Map<string, string[]>(); // specId → [procId, ...]
    const specConsumers = new Map<string, string[]>(); // specId → [procId, ...]

    for (const rp of chain) {
        const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);
        for (const f of outputs) {
            if (!f.resourceConformsTo) continue;
            const list = specProducers.get(f.resourceConformsTo) ?? [];
            if (!list.includes(rp.id)) list.push(rp.id);
            specProducers.set(f.resourceConformsTo, list);
        }
        for (const f of inputs) {
            if (!f.resourceConformsTo) continue;
            const list = specConsumers.get(f.resourceConformsTo) ?? [];
            if (!list.includes(rp.id)) list.push(rp.id);
            specConsumers.set(f.resourceConformsTo, list);
        }
    }

    // --- Divergent specs: produced by exactly 1 process, consumed by 2+ ---
    const divergentSpecIds: string[] = [];
    for (const [specId, producers] of specProducers) {
        if (producers.length === 1) {
            const consumers = specConsumers.get(specId) ?? [];
            if (consumers.length >= 2) {
                divergentSpecIds.push(specId);
            }
        }
    }

    // --- Convergent processes: process with 2+ immediate predecessors ---
    const convergentProcIds: string[] = [];
    for (const rp of chain) {
        if ((predecessors.get(rp.id)?.length ?? 0) >= 2) {
            convergentProcIds.push(rp.id);
        }
    }

    // --- Decoupling candidates: producers of divergent specs + CTT-exceeding processes ---
    const candidateSet = new Set<string>();

    // Producers of divergent specs are natural decoupling candidates
    for (const specId of divergentSpecIds) {
        for (const procId of specProducers.get(specId) ?? []) {
            candidateSet.add(procId);
        }
    }

    // Processes whose leg DLT exceeds CTT are upstream decoupling candidates
    if (cttDays !== undefined) {
        for (const rp of chain) {
            if ((EF.get(rp.id) ?? 0) > cttDays) {
                candidateSet.add(rp.id);
            }
        }
    }

    return {
        divergentSpecIds,
        convergentProcIds,
        decouplingCandidates: Array.from(candidateSet),
        criticalPathDays,
        legLeadTimes: EF,
    };
}

// =============================================================================
// 26. flowIndex / classifyFlowSpeed — Ch 12 fast/slow mover classification
// =============================================================================

/**
 * Flow Index = ADU / TOG. Ch 12 metric for fast/slow mover classification.
 * Returns 0 if tog === 0 (safe default, avoids divide-by-zero).
 */
export function flowIndex(adu: number, tog: number): number {
    return tog === 0 ? 0 : adu / tog;
}

/**
 * Classify an item as 'fast' or 'slow' mover at a given location.
 * threshold defaults to 0.10 — items with FI below this are slow movers
 * (buffer turns over less than once every 10 periods).
 */
export function classifyFlowSpeed(
    adu: number,
    tog: number,
    threshold: number = 0.10,
): 'fast' | 'slow' {
    return flowIndex(adu, tog) >= threshold ? 'fast' : 'slow';
}
