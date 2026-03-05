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
    Duration,
    BufferZone,
    BufferProfile,
    ReplenishmentSignal,
    DemandAdjustmentFactor,
    Intent,
    Commitment,
    RecipeProcess,
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
    demandAdjFactor: number;    // product of all active 'demand' type factors
    zoneAdjFactor: number;      // product of all active 'zone' type factors
    leadTimeAdjFactor: number;  // product of all active 'leadTime' type factors
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
        case 'minutes': return d.hasNumericalValue / 1440;
        case 'hours':   return d.hasNumericalValue / 24;
        case 'days':    return d.hasNumericalValue;
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
 * @param events     Caller-supplied event slice (decoupled from Observer)
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

    let demand   = 1;
    let zone     = 1;
    let leadTime = 1;

    for (const adj of adjustments) {
        if (adj.specId !== specId) continue;
        // Location match: if adj is location-scoped it must match caller's location.
        // Global adjustments (no atLocation) apply to all locations.
        if (adj.atLocation && adj.atLocation !== atLocation) continue;
        // Active window: validFrom ≤ asOf ≤ validTo (YYYY-MM-DD string comparison)
        if (adj.validFrom > asOfStr || adj.validTo < asOfStr) continue;

        switch (adj.type) {
            case 'demand':   demand   *= adj.factor; break;
            case 'zone':     zone     *= adj.factor; break;
            case 'leadTime': leadTime *= adj.factor; break;
        }
    }

    return { demandAdjFactor: demand, zoneAdjFactor: zone, leadTimeAdjFactor: leadTime };
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
 * @param opts            Optional dynamic adjustment factors
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
        zoneAdjFactor?: number;
    },
): BufferZoneComputation {
    const effectiveADU = adu * (opts?.demandAdjFactor ?? 1);
    const effectiveDLT = dltDays * (opts?.leadTimeAdjFactor ?? 1);

    const redBase   = effectiveADU * effectiveDLT * profile.leadTimeFactor;
    const redSafety = redBase * profile.variabilityFactor;
    const tor       = (redBase + redSafety) * (opts?.zoneAdjFactor ?? 1);
    const toy       = tor + effectiveADU * effectiveDLT;

    // Three-way max per Ptak & Smith Ch 8:
    //   order_cycle × ADU  (if cycle-based ordering)
    //   DLT × ADU × LTF    (minimum DLT coverage = redBase)
    //   MOQ                (minimum batch size)
    const greenBase = Math.max(
        profile.orderCycleDays != null ? effectiveADU * profile.orderCycleDays : 0,
        redBase,
        moq,
    );
    const tog = toy + greenBase;

    return { effectiveADU, effectiveDLT, redBase, redSafety, tor, toy, tog };
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
    const factors = aggregateAdjustmentFactors(
        adjustments, asOf, existing.specId, existing.atLocation,
    );

    const comp = computeBufferZone(
        profile,
        newADU,
        existing.aduUnit,
        newDLTDays,
        existing.moq,
        existing.moqUnit,
        factors,
    );

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
        adu: newADU,
        dltDays: newDLTDays,
        tor: comp.tor,
        toy: comp.toy,
        tog: comp.tog,
        demandAdjFactor: factors.demandAdjFactor,
        zoneAdjFactor: factors.zoneAdjFactor,
        leadTimeAdjFactor: factors.leadTimeAdjFactor,
        activeAdjustmentIds,
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

    return { onhand, pct, zone, redPct };
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

    const dueMs  = today.getTime() + bufferZone.dltDays * 86_400_000;
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
