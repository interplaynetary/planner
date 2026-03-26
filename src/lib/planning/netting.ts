/**
 * PlanNetter — shared netting state for supply/demand planning.
 *
 * Extracts all inventory + scheduled-flow netting logic from the individual
 * algorithm files so it can be shared across multiple algorithm calls in one
 * planning session (Mode C: demand explosion then supply explosion over the
 * same planStore).
 *
 * Netting sources:
 *   1. Observer inventory (conformingResources)
 *   2. Scheduled output flows (Intents/Commitments with outputOf set)
 *   3. Scheduled consumption flows (Intents/Commitments with inputOf set)
 *
 * The `allocated` Set tracks soft-allocations across calls so the same
 * flow is never double-counted.
 */

import { type PlanStore, PLAN_TAGS } from './planning';
import type { Observer } from '../observation/observer';
import type { ScheduleBook } from './schedule-book';
import { isWithinTemporalExpression } from '../utils/time';

/**
 * Actions that record usage/effort but do NOT reduce resource inventory
 * (onhandEffect = 'noEffect' in VF spec: use, work, cite, deliverService).
 * Consumption loops must skip these to avoid counting tool reservations and
 * labour records as inventory drawdowns.
 */
const NON_CONSUMING_ACTIONS = new Set(['use', 'work', 'cite', 'deliverService']);

/** Planning signals are NOT scheduled production — skip them when scanning for outputOf supply. */
function isPlanningSignal(classified?: string[]): boolean {
    if (!classified) return false;
    return classified.some(t => t.startsWith('tag:plan:'));
}

// =============================================================================
// TYPES
// =============================================================================

export interface DemandAllocation {
    resourceId: string;
    quantity: number;
}

export interface NetDemandResult {
    remaining: number;
    inventoryAllocated: DemandAllocation[];
}

// =============================================================================
// NETTING TRANSACTION
// =============================================================================

export class NettingTransaction {
    private snapshot: Set<string>;
    private newAllocations = new Set<string>();
    private committed = false;
    private rolledBack = false;

    constructor(private netter: PlanNetter) {
        this.snapshot = new Set(netter.allocated);
    }

    /** Track a new allocation added after this transaction began. */
    track(id: string): void {
        if (!this.snapshot.has(id)) this.newAllocations.add(id);
    }

    /** Commit the transaction — allocations persist. */
    commit(): void {
        if (this.rolledBack) throw new Error('Cannot commit a rolled-back transaction');
        if (this.committed) throw new Error('Transaction already committed');
        this.committed = true;
    }

    /** Rollback the transaction — remove allocations added since begin(). */
    rollback(): void {
        if (this.committed) throw new Error('Cannot rollback a committed transaction');
        if (this.rolledBack) throw new Error('Transaction already rolled back');
        for (const id of this.newAllocations) this.netter.allocated.delete(id);
        this.rolledBack = true;
    }

    get isCommitted(): boolean { return this.committed; }
    get isRolledBack(): boolean { return this.rolledBack; }
}

// =============================================================================
// PLAN NETTER
// =============================================================================

export class PlanNetter {
    /** Soft-allocated flow IDs (shared across all calls on this netter instance). */
    readonly allocated: Set<string> = new Set();

    /**
     * Within-session use-slot reservations.
     * Keyed by resourceId → list of booked [from, to) windows.
     * Separate from `allocated` because time-slot conflicts require interval
     * arithmetic, not just Set membership.
     */
    private readonly useReservations: Map<string, Array<{ from: Date; to: Date }>> = new Map();

    /** Per-plan attribution: planId → set of flow IDs claimed by that plan's explosion. */
    private readonly claimedByPlan: Map<string, Set<string>> = new Map();

    /** Soft-allocation Intent IDs emitted by this netter for VF provenance. */
    private readonly allocationIntentIds = new Set<string>();

    constructor(
        private readonly planStore: PlanStore,
        private readonly observer?: Observer,
        private readonly scheduleBook?: ScheduleBook,
        private readonly conservationFloors?: Map<string, number>,
    ) {}

    /** Start a named transaction. Allocations can be committed or rolled back. */
    begin(): NettingTransaction {
        return new NettingTransaction(this);
    }

    /**
     * Net a demand quantity against:
     *   1. Observer inventory (resources conforming to specId)
     *   2. Scheduled output Intents/Commitments in planStore (outputOf set)
     * Marks consumed sources as soft-allocated.
     * Used by: dependent-demand (replaces its inline netting block)
     */
    netDemand(
        specId: string,
        qty: number,
        opts?: { stage?: string; state?: string; neededBy?: Date; atLocation?: string; containedIn?: string },
        planId?: string,
        tx?: NettingTransaction,
    ): NetDemandResult {
        let remaining = qty;
        const inventoryAllocated: DemandAllocation[] = [];

        // --- Step 1: Observer inventory ---
        if (this.observer && remaining > 0) {
            const available = this.observer.conformingResources(specId)
                .filter(r => {
                    if ((r.accountingQuantity?.hasNumericalValue ?? 0) <= 0) return false;
                    if (opts?.stage && r.stage !== opts.stage) return false;
                    if (opts?.state && r.state !== opts.state) return false;
                    // Containment guard: when containedIn is specified, only match
                    // resources inside that container (use-mediated resolution).
                    // Otherwise, contained resources are physically unavailable.
                    if (opts?.containedIn) {
                        if (r.containedIn !== opts.containedIn) return false;
                    } else {
                        if (r.containedIn !== undefined) return false;
                    }
                    // Location guard: only absorb inventory at the demand location
                    if (opts?.atLocation && r.currentLocation && r.currentLocation !== opts.atLocation) return false;
                    return true;
                });

            for (const r of available) {
                if (remaining <= 0) break;
                const avail = r.accountingQuantity?.hasNumericalValue ?? 0;
                const floor = this.conservationFloors?.get(specId) ?? 0;
                const allocatable = Math.max(0, avail - floor);
                const take = Math.min(allocatable, remaining);
                if (take <= 0) continue;
                inventoryAllocated.push({ resourceId: r.id, quantity: take });
                remaining -= take;
            }
        }

        // --- Step 2: Scheduled output Intents (outputOf set) ---
        // Skip when resolving from a container: scheduled outputs are free-standing
        // production, not targeted into a specific container instance.
        if (remaining > 0 && !opts?.containedIn) {
            for (const intent of this.planStore.intentsForSpec(specId)) {
                if (remaining <= 0) break;
                if (
                    intent.outputOf !== undefined &&
                    !intent.finished &&
                    !this.allocated.has(intent.id) &&
                    !isPlanningSignal(intent.resourceClassifiedAs) &&
                    (intent.resourceQuantity?.hasNumericalValue ?? 0) > 0
                ) {
                    // Temporal guard: output must be ready by neededBy
                    if (opts?.neededBy && intent.due && new Date(intent.due) > opts.neededBy) continue;
                    // Location guard: only absorb output at the demand location
                    if (opts?.atLocation && intent.atLocation && intent.atLocation !== opts.atLocation) continue;
                    const take = Math.min(intent.resourceQuantity!.hasNumericalValue, remaining);
                    this.allocated.add(intent.id);
                    tx?.track(intent.id);
                    if (planId) {
                        if (!this.claimedByPlan.has(planId)) this.claimedByPlan.set(planId, new Set());
                        this.claimedByPlan.get(planId)!.add(intent.id);
                        // VF provenance: emit a soft-allocation Intent linking to the claimed flow
                        const allocIntent = this.planStore.addIntent({
                            action: intent.action,
                            resourceConformsTo: specId,
                            resourceQuantity: { hasNumericalValue: take, hasUnit: intent.resourceQuantity!.hasUnit },
                            resourceClassifiedAs: [PLAN_TAGS.SOFT_ALLOCATION],
                            satisfies: intent.id,
                            plannedWithin: planId,
                            finished: false,
                        });
                        this.allocationIntentIds.add(allocIntent.id);
                    }
                    remaining -= take;
                }
            }
        }

        // --- Step 3: Scheduled output Commitments (outputOf set) ---
        // Same containedIn guard as Step 2.
        if (remaining > 0 && !opts?.containedIn) {
            for (const commitment of this.planStore.commitmentsForSpec(specId)) {
                if (remaining <= 0) break;
                if (
                    commitment.outputOf !== undefined &&
                    !commitment.finished &&
                    !this.allocated.has(commitment.id) &&
                    (commitment.resourceQuantity?.hasNumericalValue ?? 0) > 0
                ) {
                    // Temporal guard: output must be ready by neededBy
                    if (opts?.neededBy && commitment.due && new Date(commitment.due) > opts.neededBy) continue;
                    // Location guard: only absorb output at the demand location
                    if (opts?.atLocation && commitment.atLocation && commitment.atLocation !== opts.atLocation) continue;
                    const take = Math.min(commitment.resourceQuantity!.hasNumericalValue, remaining);
                    this.allocated.add(commitment.id);
                    tx?.track(commitment.id);
                    if (planId) {
                        if (!this.claimedByPlan.has(planId)) this.claimedByPlan.set(planId, new Set());
                        this.claimedByPlan.get(planId)!.add(commitment.id);
                        // VF provenance: emit a soft-allocation Intent linking to the claimed flow
                        const allocIntent = this.planStore.addIntent({
                            action: commitment.action,
                            resourceConformsTo: specId,
                            resourceQuantity: { hasNumericalValue: take, hasUnit: commitment.resourceQuantity!.hasUnit },
                            resourceClassifiedAs: [PLAN_TAGS.SOFT_ALLOCATION],
                            satisfies: commitment.id,
                            plannedWithin: planId,
                            finished: false,
                        });
                        this.allocationIntentIds.add(allocIntent.id);
                    }
                    remaining -= take;
                }
            }
        }

        return { remaining, inventoryAllocated };
    }

    /**
     * Net available supply against scheduled consumptions in planStore
     * (Intents/Commitments with inputOf set that haven't been soft-allocated yet).
     * Returns remaining supply after deducting pre-claimed consumptions.
     * Marks consumption flows as soft-allocated.
     * Used by: dependent-supply (new — enables Mode C)
     */
    netSupply(specId: string, qty: number, availableFrom?: Date, atLocation?: string): number {
        let remaining = qty;

        // --- Scheduled consumption Intents (inputOf set) ---
        for (const intent of this.planStore.intentsForSpec(specId)) {
            if (remaining <= 0) break;
            if (
                intent.inputOf !== undefined &&
                !NON_CONSUMING_ACTIONS.has(intent.action) &&
                !intent.finished &&
                !this.allocated.has(intent.id) &&
                (intent.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: supply must be available before the consumption is due
                if (availableFrom && intent.due && new Date(intent.due) < availableFrom) continue;
                // Location guard: only absorb consumptions at the supply location
                if (atLocation && intent.atLocation && intent.atLocation !== atLocation) continue;
                const take = Math.min(intent.resourceQuantity!.hasNumericalValue, remaining);
                this.allocated.add(intent.id);
                remaining -= take;
            }
        }

        // --- Scheduled consumption Commitments (inputOf set) ---
        for (const commitment of this.planStore.commitmentsForSpec(specId)) {
            if (remaining <= 0) break;
            if (
                commitment.inputOf !== undefined &&
                !NON_CONSUMING_ACTIONS.has(commitment.action) &&
                !commitment.finished &&
                !this.allocated.has(commitment.id) &&
                (commitment.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: supply must be available before the consumption is due
                if (availableFrom && commitment.due && new Date(commitment.due) < availableFrom) continue;
                // Location guard: only absorb consumptions at the supply location
                if (atLocation && commitment.atLocation && commitment.atLocation !== atLocation) continue;
                const take = Math.min(commitment.resourceQuantity!.hasNumericalValue, remaining);
                this.allocated.add(commitment.id);
                remaining -= take;
            }
        }

        return remaining;
    }

    /**
     * Attempt to book a `use`-type time slot [from, to) for a specific resource instance.
     *
     * Does NOT check inventory existence — caller is responsible for finding a
     * conforming resource before calling this.
     *
     * Conflict checks (in order):
     *   1. Within-session reservations (useReservations) — catches double-booking
     *      within the same planning invocation before intents reach the PlanStore.
     *   2. Pre-existing use-blocks in PlanStore via scheduleBook — catches conflicts
     *      from merged leaf stores or prior planning sessions.
     *
     * On success: records the reservation and adds a namespaced key to `allocated`.
     * Returns false (without mutating) on any conflict.
     */
    netUse(resourceId: string, from: Date, to: Date, planId?: string): boolean {
        // 1. Within-session conflict
        const existing = this.useReservations.get(resourceId);
        if (existing) {
            for (const r of existing) {
                if (r.from < to && r.to > from) return false;
            }
        }
        // 2. Pre-existing conflict in PlanStore
        if (this.scheduleBook?.hasUseConflict(resourceId, from, to)) return false;
        // 3. Claim
        if (existing) {
            existing.push({ from, to });
        } else {
            this.useReservations.set(resourceId, [{ from, to }]);
        }
        const useKey = `use:${resourceId}:${from.toISOString()}`;
        this.allocated.add(useKey);
        if (planId) {
            if (!this.claimedByPlan.has(planId)) this.claimedByPlan.set(planId, new Set());
            this.claimedByPlan.get(planId)!.add(useKey);
        }
        return true;
    }

    /**
     * Remove from `allocated` any flow IDs that no longer exist in the planStore.
     * Called after planStore.removeRecords() to keep the allocated set consistent.
     *
     * use:* entries (time-slot reservations) are left intact — they are position-based
     * keys, not flow IDs, and freeing them requires knowing which scheduling intent they
     * belonged to (handled separately if needed).
     */
    pruneStale(): void {
        const validIds = new Set([
            ...this.planStore.allIntents().map(i => i.id),
            ...this.planStore.allCommitments().map(c => c.id),
        ]);
        for (const id of [...this.allocated]) {
            if (id.startsWith('use:')) continue;
            if (!validIds.has(id)) {
                this.allocated.delete(id);
                for (const set of this.claimedByPlan.values()) set.delete(id);
            }
        }
        // Prune orphaned allocation Intents whose satisfies target no longer exists
        const orphaned: string[] = [];
        for (const allocId of this.allocationIntentIds) {
            const allocIntent = this.planStore.getIntent(allocId);
            if (!allocIntent) { orphaned.push(allocId); continue; }
            if (allocIntent.satisfies && !validIds.has(allocIntent.satisfies)) {
                orphaned.push(allocId);
            }
        }
        if (orphaned.length > 0) {
            this.planStore.removeRecords({ intentIds: orphaned });
            for (const id of orphaned) this.allocationIntentIds.delete(id);
        }
    }

    /**
     * Release all soft-allocations that were attributed to the given planId.
     * Does not remove planStore records — call removeRecordsForPlan() separately,
     * or use retract() which does both.
     */
    releaseClaimsForPlan(planId: string): void {
        const claimed = this.claimedByPlan.get(planId);
        if (claimed) {
            for (const id of claimed) this.allocated.delete(id);
            this.claimedByPlan.delete(planId);
        }
        // Remove allocation Intents for the released plan
        const toRemove = this.planStore.intentsForTag(PLAN_TAGS.SOFT_ALLOCATION)
            .filter(i => i.plannedWithin === planId);
        if (toRemove.length > 0) {
            this.planStore.removeRecords({ intentIds: toRemove.map(i => i.id) });
            for (const i of toRemove) this.allocationIntentIds.delete(i.id);
        }
    }

    /**
     * Retract a demand explosion result: release its claims, remove its planStore
     * records, and prune any remaining stale allocations.
     * Accepts any object with a plan.id, so no import of DependentDemandResult needed.
     */
    retract(result: { plan: { id: string } }): void {
        this.releaseClaimsForPlan(result.plan.id);
        this.planStore.removeRecordsForPlan(result.plan.id);
        this.pruneStale();
    }

    /**
     * Create a child netter that inherits the current allocated set.
     * The child shares the same planStore and scheduleBook; observer can be
     * overridden (pass { observer: undefined } for production-only netting).
     */
    fork(opts?: { observer?: Observer }): PlanNetter {
        const child = new PlanNetter(
            this.planStore,
            opts ? opts.observer : this.observer,
            this.scheduleBook,
            this.conservationFloors,
        );
        for (const id of this.allocated) child.allocated.add(id);
        return child;
    }

    /**
     * Return the set of flow IDs (and use:* keys) that were attributed to planId
     * during netDemand / netUse calls. Live reference — safe to read after BFS
     * since each planId is unique per dependentDemand call.
     */
    claimedForPlan(planId: string): Set<string> {
        return this.claimedByPlan.get(planId) ?? new Set();
    }

    /**
     * READ-ONLY peek: net available quantity of specId.
     * = inventory + scheduled outputs (not yet allocated)
     *   - scheduled consumptions (not yet allocated)
     * Does NOT mutate state. Used for capacity ceiling in computeMaxByOtherMaterials.
     */
    netAvailableQty(specId: string, opts?: { stage?: string; state?: string; asOf?: Date; atLocation?: string; containedIn?: string }): number {
        let total = 0;

        // Inventory
        if (this.observer) {
            for (const r of this.observer.conformingResources(specId)) {
                if ((r.accountingQuantity?.hasNumericalValue ?? 0) <= 0) continue;
                if (opts?.stage && r.stage !== opts.stage) continue;
                if (opts?.state && r.state !== opts.state) continue;
                // Containment guard: when containedIn specified, only match inside that container.
                if (opts?.containedIn) {
                    if (r.containedIn !== opts.containedIn) continue;
                } else {
                    if (r.containedIn !== undefined) continue;
                }
                // Location guard: only count inventory at the queried location
                if (opts?.atLocation && r.currentLocation && r.currentLocation !== opts.atLocation) continue;
                // Availability guard: delegate to scheduleBook when available, else inline check
                if (opts?.asOf) {
                    if (this.scheduleBook) {
                        if (!this.scheduleBook.isResourceAvailable(r.id, opts.asOf)) continue;
                    } else if (r.availability_window) {
                        if (!isWithinTemporalExpression(opts.asOf, r.availability_window)) continue;
                    }
                }
                total += r.accountingQuantity?.hasNumericalValue ?? 0;
            }
        }

        // Scheduled outputs (not yet allocated).
        // Skip when resolving from a container: scheduled outputs are free-standing
        // production, not targeted into a specific container instance.
        if (opts?.containedIn) return Math.max(0, total - (this.conservationFloors?.get(specId) ?? 0));

        for (const intent of this.planStore.intentsForSpec(specId)) {
            if (
                intent.outputOf !== undefined &&
                !intent.finished &&
                !this.allocated.has(intent.id) &&
                !isPlanningSignal(intent.resourceClassifiedAs) &&
                (intent.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: only count outputs that are ready by asOf
                if (opts?.asOf && intent.due && new Date(intent.due) > opts.asOf) continue;
                // Location guard: only count output at the queried location
                if (opts?.atLocation && intent.atLocation && intent.atLocation !== opts.atLocation) continue;
                total += intent.resourceQuantity!.hasNumericalValue;
            }
        }
        for (const commitment of this.planStore.commitmentsForSpec(specId)) {
            if (
                commitment.outputOf !== undefined &&
                !commitment.finished &&
                !this.allocated.has(commitment.id) &&
                (commitment.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: only count outputs that are ready by asOf
                if (opts?.asOf && commitment.due && new Date(commitment.due) > opts.asOf) continue;
                // Location guard: only count output at the queried location
                if (opts?.atLocation && commitment.atLocation && commitment.atLocation !== opts.atLocation) continue;
                total += commitment.resourceQuantity!.hasNumericalValue;
            }
        }

        // Subtract scheduled consumptions (not yet allocated).
        // Skip non-consuming actions (use/work/cite/deliverService): they record usage
        // but don't reduce inventory (onhandEffect = 'noEffect').
        for (const intent of this.planStore.intentsForSpec(specId)) {
            if (
                intent.inputOf !== undefined &&
                !NON_CONSUMING_ACTIONS.has(intent.action) &&
                !intent.finished &&
                !this.allocated.has(intent.id) &&
                (intent.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: only deduct consumptions due by asOf (future ones haven't consumed yet)
                if (opts?.asOf && intent.due && new Date(intent.due) > opts.asOf) continue;
                // Location guard: only deduct consumptions at the queried location
                if (opts?.atLocation && intent.atLocation && intent.atLocation !== opts.atLocation) continue;
                total -= intent.resourceQuantity!.hasNumericalValue;
            }
        }
        for (const commitment of this.planStore.commitmentsForSpec(specId)) {
            if (
                commitment.inputOf !== undefined &&
                !NON_CONSUMING_ACTIONS.has(commitment.action) &&
                !commitment.finished &&
                !this.allocated.has(commitment.id) &&
                (commitment.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: only deduct consumptions due by asOf (future ones haven't consumed yet)
                if (opts?.asOf && commitment.due && new Date(commitment.due) > opts.asOf) continue;
                // Location guard: only deduct consumptions at the queried location
                if (opts?.atLocation && commitment.atLocation && commitment.atLocation !== opts.atLocation) continue;
                total -= commitment.resourceQuantity!.hasNumericalValue;
            }
        }

        const floor = this.conservationFloors?.get(specId) ?? 0;
        return Math.max(0, total - floor);
    }
}
