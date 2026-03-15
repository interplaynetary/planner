/**
 * Custody Protocol — pure-function implementation of the custody state machine.
 *
 * Every valuable thing in the social plan has an identifiable, personally-liable
 * individual custodian. This module implements:
 *   - The custody state machine (held → transferring → settled)
 *   - Entrustment limit calculation
 *   - Incentive-compatibility checks
 *   - Hierarchy-level routing
 *   - Penalty mechanics
 *   - Tranche-based loss coverage
 *
 * Style: pure-function module matching ddmrp.ts / SNE.ts patterns.
 * No classes, no side effects. CustodyLedger is a plain record passed in/out.
 */

import type { EconomicEvent } from '../schemas';

// =============================================================================
// TYPES
// =============================================================================

/** The resource's lifecycle in the custody ledger. */
export type CustodyStatus =
    | { status: 'held';         holder: string; since: string }
    | { status: 'transferring'; from: string;   to: string; initiatedAt: string }
    | { status: 'settled' };

/** Per-individual custody accounting record. */
export interface CustodyRecord {
    agentId: string;
    currentLiabilityValue: number;  // Σ market_value of items currently held
    pendingPenalty: number;         // accumulated, deducted from future total_claim_capacity
}

/** Scope/federation-level pooled capacity entry for hierarchy routing. */
export interface HierarchyEntry {
    level: CustodyHierarchyLevel;
    entrustmentCapacity: number;    // pooled entrustment at this level
}

export type CustodyHierarchyLevel =
    | 'individual'
    | 'scope'
    | 'universal_commune';

/** Mutable ledger passed through custody functions. */
export interface CustodyLedger {
    states:  Map<string, CustodyStatus>;    // resourceId → state
    records: Map<string, CustodyRecord>;    // agentId    → record
}

/** One tranche in a loss-coverage cascade. */
export interface TrancheCoverage {
    level: string;
    poolAvailable: number;
    absorbed: number;
    remaining: number;   // remaining loss after this tranche
}

// =============================================================================
// LEDGER FACTORY
// =============================================================================

/** Create an empty ledger. */
export function makeCustodyLedger(): CustodyLedger {
    return {
        states:  new Map(),
        records: new Map(),
    };
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/** Ensure a CustodyRecord exists for agentId, creating zeroed record if absent. */
function ensureRecord(agentId: string, ledger: CustodyLedger): CustodyRecord {
    if (!ledger.records.has(agentId)) {
        ledger.records.set(agentId, {
            agentId,
            currentLiabilityValue: 0,
            pendingPenalty: 0,
        });
    }
    return ledger.records.get(agentId)!;
}

// =============================================================================
// ENTRUSTMENT LIMIT & INCENTIVE COMPATIBILITY
// =============================================================================

/**
 * entrustment_limit[i] = α × total_claim_capacity[i] × svc_market_equivalent
 * α ∈ (0,1], default 0.5 (democratically set safety factor).
 */
export function entrustmentLimit(
    totalClaimCapacity: number,
    svcMarketEquivalent: number,
    alpha = 0.5,
): number {
    return alpha * totalClaimCapacity * svcMarketEquivalent;
}

/**
 * Incentive compatibility check:
 *   value_accessible_solo / n_colluders_required < entrustment_limit[i]
 * Returns true when the custody arrangement is theft-irrational.
 */
export function incentiveCompatible(
    valueAccessibleSolo: number,
    nColludersRequired: number,
    individualEntrustmentLimit: number,
): boolean {
    return valueAccessibleSolo / nColludersRequired < individualEntrustmentLimit;
}

// =============================================================================
// HIERARCHY ROUTING
// =============================================================================

/**
 * custody_level(V) = min { L ∈ hierarchy : entrustment_limit[L] ≥ V }
 * Ordered from narrowest (individual) to broadest (universal_commune).
 * Returns null when no level can cover the value.
 */
export function custodyLevel(
    value: number,
    hierarchy: HierarchyEntry[],
): CustodyHierarchyLevel | null {
    for (const entry of hierarchy) {
        if (entry.entrustmentCapacity >= value) {
            return entry.level;
        }
    }
    return null;
}

// =============================================================================
// STATE MACHINE — transferCustody
// =============================================================================

/**
 * Apply a transferCustody EconomicEvent to the ledger (state-machine transition).
 * provider → 'transferring' → receiver on confirmation (= this call).
 * Updates currentLiabilityValue for both parties.
 * No-op and returns false if event.action !== 'transferCustody'.
 */
export function applyTransferCustody(
    event: EconomicEvent,
    marketValue: number,
    ledger: CustodyLedger,
): boolean {
    if (event.action !== 'transferCustody') return false;

    const resourceId = event.resourceInventoriedAs ?? event.toResourceInventoriedAs;
    if (!resourceId) return false;

    const since = event.hasPointInTime ?? event.created ?? new Date().toISOString();

    // Update provider's liability (release)
    if (event.provider) {
        const providerRecord = ensureRecord(event.provider, ledger);
        providerRecord.currentLiabilityValue = Math.max(
            0,
            providerRecord.currentLiabilityValue - marketValue,
        );
    }

    // Update receiver's liability (acquire)
    if (event.receiver) {
        const receiverRecord = ensureRecord(event.receiver, ledger);
        receiverRecord.currentLiabilityValue += marketValue;

        // Transition resource state to 'held' by receiver
        ledger.states.set(resourceId, {
            status: 'held',
            holder: event.receiver,
            since,
        });
    }

    return true;
}

// =============================================================================
// STATE MACHINE — settleCustody
// =============================================================================

/**
 * Mark a resource settled (consumed / destroyed).
 * Releases provider liability. Returns false if resource not found in ledger.
 */
export function settleCustody(
    resourceId: string,
    releasingAgentId: string,
    marketValue: number,
    ledger: CustodyLedger,
): boolean {
    if (!ledger.states.has(resourceId)) return false;

    ledger.states.set(resourceId, { status: 'settled' });

    const record = ledger.records.get(releasingAgentId);
    if (record) {
        record.currentLiabilityValue = Math.max(0, record.currentLiabilityValue - marketValue);
    }

    return true;
}

// =============================================================================
// QUERY
// =============================================================================

/** Who currently holds this resource? Returns agentId or null (settled / unknown). */
export function currentCustodian(
    resourceId: string,
    ledger: CustodyLedger,
): string | null {
    const state = ledger.states.get(resourceId);
    if (!state) return null;
    if (state.status === 'held') return state.holder;
    return null;
}

/**
 * Snapshot of all resources currently held by a given agent.
 * Returns array of { resourceId, status } for debugging / UI display.
 */
export function heldBy(
    agentId: string,
    ledger: CustodyLedger,
): { resourceId: string; status: CustodyStatus }[] {
    const result: { resourceId: string; status: CustodyStatus }[] = [];
    for (const [resourceId, status] of ledger.states) {
        if (status.status === 'held' && status.holder === agentId) {
            result.push({ resourceId, status });
        }
    }
    return result;
}

// =============================================================================
// PENALTY MECHANICS
// =============================================================================

/**
 * penalty_svc[i] = min(missing_value / svc_market_equivalent, total_claim_capacity[i])
 * Pure calculation — does not mutate any record.
 */
export function penaltySvc(
    missingValue: number,
    svcMarketEquivalent: number,
    totalClaimCapacity: number,
): number {
    return Math.min(missingValue / svcMarketEquivalent, totalClaimCapacity);
}

/**
 * Apply a penalty to a CustodyRecord (deduct from pendingPenalty accumulator).
 * Returns the amount applied.
 * Caller must apply the returned amount to Account.gross_contribution_credited
 * or equivalent at settlement time.
 */
export function applyPenalty(
    record: CustodyRecord,
    penaltyAmount: number,
): number {
    const applied = Math.max(0, penaltyAmount);
    record.pendingPenalty += applied;
    return applied;
}

// =============================================================================
// TRANCHE COVERAGE
// =============================================================================

/**
 * Distribute a loss through ordered tranches (each exhausted before the next).
 * Returns one TrancheCoverage entry per tranche, with absorbed / remaining.
 * The last entry's remaining > 0 means the loss exceeded all pooled capacity.
 */
export function trancheCoverage(
    lossValue: number,
    tranches: { level: string; pool: number }[],
): TrancheCoverage[] {
    const result: TrancheCoverage[] = [];
    let remaining = lossValue;

    for (const tranche of tranches) {
        const absorbed = Math.min(remaining, tranche.pool);
        remaining -= absorbed;
        result.push({
            level: tranche.level,
            poolAvailable: tranche.pool,
            absorbed,
            remaining,
        });
        if (remaining === 0) break;
    }

    return result;
}

// =============================================================================
// SCOPE-LEVEL ENTRUSTMENT AGGREGATION (spec §265)
// =============================================================================

/**
 * entrustment_capacity[scope[k]] = Σᵢ∈Sₖ entrustment_limit[i]
 *
 * Aggregates individual entrustment limits across all members of a scope.
 *
 * @param memberRecords          CustodyRecords for all members of the scope
 * @param totalClaimCapacities   agentId → total_claim_capacity
 * @param svcMarketEquivalent    SVC-to-market conversion factor
 * @param alpha                  Safety factor α ∈ (0,1] (default 0.5)
 */
export function scopeEntrustmentCapacity(
    memberRecords: CustodyRecord[],
    totalClaimCapacities: Map<string, number>,
    svcMarketEquivalent: number,
    alpha = 0.5,
): number {
    return memberRecords.reduce((sum, rec) => {
        const cap = totalClaimCapacities.get(rec.agentId) ?? 0;
        return sum + entrustmentLimit(cap, svcMarketEquivalent, alpha);
    }, 0);
}

// =============================================================================
// UNIVERSAL COMMUNE OWNERSHIP INVARIANT (spec §389)
// =============================================================================

import type { EconomicResource } from '../schemas';

/**
 * Check the UC ownership invariant: ∀ communal resource r,
 * r.primaryAccountable === universalCommuneId.
 *
 * Returns resources that VIOLATE the invariant (non-UC primaryAccountable).
 * An empty array means all resources are correctly attributed to the UC.
 */
export function checkOwnershipInvariant(
    resources: EconomicResource[],
    universalCommuneId: string,
): EconomicResource[] {
    return resources.filter(
        r => r.primaryAccountable && r.primaryAccountable !== universalCommuneId,
    );
}

// =============================================================================
// LEDGER BUILDER (replay from Observer history)
// =============================================================================

/**
 * Build a CustodyLedger by replaying all transferCustody events in order.
 * Primary factory for initializing ledger state from Observer history.
 *
 * @param events       EconomicEvents with action='transferCustody', chronological
 * @param marketValues Map of eventId → market_value (fallback when event.market_value absent)
 */
export function buildCustodyLedger(
    events: EconomicEvent[],
    marketValues?: Map<string, number>,
): CustodyLedger {
    const ledger = makeCustodyLedger();

    for (const event of events) {
        if (event.action !== 'transferCustody') continue;

        const mv =
            event.market_value ??
            (marketValues ? (marketValues.get(event.id) ?? 0) : 0);

        applyTransferCustody(event, mv, ledger);
    }

    return ledger;
}
