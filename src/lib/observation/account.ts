/**
 * Commune & Account — elastic SNLT labor-credit system.
 *
 * A faithful implementation of the deduction cascade described in Marx's
 * Critique of the Gotha Programme, extended with elastic purchasing power.
 *
 * ## The Deduction Cascade (Marx)
 *
 * From the total social product (working_day_snlt), deductions are made in
 * strict priority order before any individual distribution can occur:
 *
 *   Tier 1 — Reproduction of production (economic necessity, pre-pool):
 *     replacement  (0) — wear/replacement of means of production
 *     expansion    (1) — growth of productive capacity
 *     reserve      (2) — contingency/insurance against disruption
 *
 *   Tier 2 — Communal consumption (from what remains):
 *     administration (3) — general costs of running society (shrinks over time)
 *     welfare        (4) — support for those unable to work
 *     common         (5) — schools, health, culture (grows over time)
 *
 *   Tier 3 — Individual distribution (what remains after Tier 1 + Tier 2)
 *
 * "These deductions from the 'undiminished' proceeds of labor are an economic
 *  necessity... in no way calculable by equity." — Marx
 *
 * ## Communal Orders — No Manual Validation
 *
 * Placing a communal Order is itself the act of social validation. The kind
 * determines priority; no separate validate() call is needed. The commune
 * does not choose whether to validate soil replacement before building parks —
 * priority is structurally determined by category.
 *
 * `commune.satisfyNext()` always satisfies the highest-priority pending
 * communal order from the pool.
 *
 * ## Individual Orders — Explicit Validation
 *
 * Individual agents still explicitly validate orders, committing their
 * purchasing power. This IS a matter of individual preference (equity).
 * `account.validate(id)` / `account.invalidate(id)` express and revise
 * priority freely. Unvalidated orders remain as expressed but unbacked needs.
 *
 * ## Elastic Purchasing Power
 *
 *   communal_deduction_rate = committed_rate_per_day / planning_day_snlt
 *   net_claim_capacity      = gross_labor_credited × (1 - communal_deduction_rate)
 *   current_share_of_claims = this_agent's potential / social_total_potential
 *   current_actual_claim    = share × current_pool
 *
 * The individual receives back from society — after deductions — exactly what
 * they gave to it, in proportion to their labor contribution.
 *
 * ## Integration with VF
 *   - Labor credited via `work` EconomicEvents → `account.creditFromEvent(e)`.
 *   - Goods produced → `commune.addToPool(snltValue)`.
 *   - Communal obligations → `commune.placeOrder({ kind: 'replacement', ... })`.
 *   - Satisfy next obligation → `commune.satisfyNext()`.
 *   - Individual preference → `account.validate(id)` / `account.invalidate(id)`.
 *   - Individual satisfaction → `account.satisfy(id)`.
 *
 * Usage:
 *   const commune = new Commune({ planning_day_snlt: 800 }); // 100w × 8h
 *   const alice = commune.ensureAccount('alice');
 *
 *   // Communal obligations — placed = socially validated, priority by kind:
 *   commune.placeOrder({ label: 'tool:replacement', snlt: 100, kind: 'replacement' });
 *   commune.placeOrder({ label: 'health:clinic',    snlt: 80,  kind: 'common' });
 *   commune.placeOrder({ label: 'park:east-wing',   snlt: 60,  kind: 'common' });
 *
 *   // Satisfy in priority order (replacement before health clinic):
 *   commune.satisfyNext(); // → tool:replacement
 *   commune.satisfyNext(); // → health:clinic
 *
 *   // Individual labor and preference:
 *   alice.creditFromEvent(workEvent);
 *   const chair = alice.placeOrder({ label: 'chair', snlt: 8 });
 *   alice.validate(chair.id);
 *   alice.satisfy(chair.id);
 */

import type { EconomicEvent } from '../schemas';

// =============================================================================
// COMMUNAL KIND PRIORITY — the deduction cascade
// =============================================================================

/**
 * Priority ranking for communal order kinds, reflecting Marx's deduction tiers.
 * Lower number = satisfied first. Kinds not listed default to Infinity.
 *
 * Tier 1 — Reproduction of production (economic necessity, pre-individual):
 *   replacement, expansion, reserve
 *
 * Tier 2 — Communal consumption (social determination, pre-individual):
 *   administration, welfare, common
 */
export const COMMUNAL_KIND_PRIORITY: Readonly<Record<string, number>> = {
    // Tier 1 — reproduction of production conditions
    replacement:    0,   // wear/replacement of means of production
    expansion:      1,   // growth of productive capacity
    reserve:        2,   // contingency/insurance against disruption
    // Tier 2 — communal consumption
    administration: 3,   // general costs of running society
    welfare:        4,   // support for those unable to work
    common:         5,   // schools, health, culture
    // Catch-all
    other:          10,
};

function kindRank(kind?: string): number {
    if (!kind) return Infinity;
    return COMMUNAL_KIND_PRIORITY[kind] ?? Infinity;
}

// =============================================================================
// ORDER — the single abstraction for any expressed need
// =============================================================================

export type OrderScope = 'communal' | 'individual';

/**
 * A need expressed by either the Commune or an individual agent.
 *
 * For communal orders: placing IS social validation. Kind determines priority.
 * For individual orders: placing is free; validation is an explicit act.
 */
export interface Order {
    readonly id: string;
    readonly scope: OrderScope;
    /** Matches VF Agent.id for individual orders. */
    readonly agentId?: string;
    readonly label: string;
    /** Total SNLT cost to fully satisfy this order. */
    readonly snlt: number;
    /**
     * How many days this order runs continuously.
     * Determines the daily SNLT rate: snlt / duration_days.
     *
     * Default (undefined or 1): instantaneous — full SNLT consumed on day 1.
     * Longer durations spread the labor commitment over time, consuming less
     * of the daily rate per day.
     *
     * Example:
     *   bridge: snlt=10000, duration_days=200  → 50 SNLT/day rate
     *   vaccine: snlt=800,  duration_days=1    → 800 SNLT/day rate (immediate)
     */
    readonly duration_days?: number;
    /**
     * Physical ceiling on how much SNLT can be drawn per tick, regardless of
     * accumulated credit or available capacity.
     *
     * Models real-world constraints that can't be rushed: concrete cure time,
     * harvest cycles, ecological recovery rates, etc.
     *
     * Without this: an order with 4 days of backlog could draw 4× its daily rate
     * on a productive day. With this: catch-up is bounded physically.
     *
     * Default (undefined): uncapped — order can draw any amount of accumulated credit.
     *
     * Example:
     *   bridge: duration_days=200, max_rate_per_day=60
     *   → earns 50/day planning rate, can catch up at most 60/day (20% buffer)
     *   → will never draw 200 in one day regardless of backlog or capacity
     */
    readonly max_rate_per_day?: number;
    /**
     * Simulation tick number on which this order becomes physically available
     * to start drawing SNLT.
     * Before this tick, the order is 'waiting': it cannot draw from the pool,
     * and it does *not* accrue `accumulated_snlt` credit.
     */
    readonly start_tick?: number;
    /**
     * Simulation tick number by which this order MUST be fully satisfied.
     * If `_remainingSnlt(order) > 0` when the commune ticks past this deadline,
     * the order fails.
     *
     * Combined with `max_rate_per_day`, this creates a physical envelope:
     * If catching up becomes physically impossible, the order is doomed and
     * fails immediately, spawning consequences.
     */
    readonly deadline_tick?: number;
    /**
     * The secondary order automatically placed if the deadline is missed.
     * Encodes the societal cost of failing this necessary task.
     */
    readonly consequence_on_fail?: OrderParams;
    /**
     * Semantic category.
     * For communal orders, governs priority in the deduction cascade.
     * Use: 'replacement' | 'expansion' | 'reserve' | 'administration' | 'welfare' | 'common' | 'other'
     */
    readonly kind?: string;
    readonly createdAt: string;
    /**
     * SNLT currently backed by resources.
     * Communal orders: set to snlt when the order can fit within daily rate capacity;
     *                  0 when rate-preempted by higher-priority orders.
     * Individual orders: 0 = unvalidated; > 0 = validated by agent.
     */
    validated_snlt: number;
    /**
     * Unspent rate entitlement credit (communal pending orders only).
     *
     * A pending order accrues `orderRate` SNLT of credit per day regardless
     * of whether the pool could cover it. On productive days, accumulated
     * credit is spent toward satisfying the order, allowing catch-up.
     *
     * Key distinction:
     *   Preempted orders (validated_snlt = 0): no credit accrues —
     *     no labor time was allocated politically.
     *   Pool-starved orders (validated_snlt > 0, pool dry): credit accrues —
     *     labor time IS allocated, material conditions just haven't caught up.
     *
     * Bounded per tick by planning_day_snlt, so catch-up cannot exceed
     * the planned working day capacity.
     */
    accumulated_snlt: number;
    /** System tracking for whether this order failed its min_rate_per_day constraints. */
    is_failed?: boolean;
}

/**
 * Parameters for placing any order — the fields the caller must provide.
 * `id`, `scope`, `agentId`, `createdAt`, `validated_snlt`, `accumulated_snlt`,
 * and `is_failed` are set internally.
 */
export type OrderParams = Omit<Order, 'id' | 'scope' | 'agentId' | 'createdAt' | 'validated_snlt' | 'accumulated_snlt' | 'is_failed'>;


/**
 * Calculates the daily SNLT rate for an order.
 * If duration_days is not specified or 0, it defaults to 1 (instantaneous).
 */
function orderRate(order: Order): number {
    const duration = order.duration_days && order.duration_days > 0 ? order.duration_days : 1;
    return order.snlt / duration;
}

// =============================================================================
// SATISFACTION — immutable execution record
// =============================================================================

export interface Satisfaction {
    readonly id: string;
    readonly orderId: string;
    readonly snlt: number;
    readonly satisfiedAt: string;
}

// =============================================================================
// DAY REPORT — result of a single simulation tick
// =============================================================================

/** Describes the outcome status of a single communal order within one tick. */
export type OrderStatus =
    | 'running'         // drew exactly its planned rate — steady state
    | 'catching_up'     // drew more than planned rate (spending accumulated credit)
    | 'pool_starved'    // drew less than planned — pool was the limiting constraint
    | 'capacity_capped' // drew less than planned — planning_day_snlt was exhausted
    | 'rate_capped'     // drew less than accumulated — max_rate_per_day was the limit
    | 'preempted'       // not in pending this tick; no accrual, no draw
    | 'waiting'         // current_tick < start_tick; neither accruing nor drawing
    | 'deadline_failed' // order crossed deadline or became physically impossible to finish
    | 'completed';      // remaining SNLT hit 0 this tick

/**
 * Per-order breakdown of planned vs actual work within a single tick.
 * Exposes the gap between what was allocated and what actually happened.
 */
export interface OrderOutcome {
    readonly order: Order;
    /** Planned daily rate: orderRate(order) = snlt / duration_days. */
    readonly planned_snlt: number;
    /** Physical cap per tick: order.max_rate_per_day (null = uncapped). */
    readonly max_snlt: number | null;
    /** SNLT actually drawn from pool this tick. */
    readonly actual_snlt: number;
    /** Accumulated credit remaining after this tick. */
    readonly accumulated_after: number;
    readonly status: OrderStatus;
}

/**
 * The result of advancing the commune by one day via `commune.tick()`.
 * Provides a complete picture of what changed in this period.
 */
export interface DayReport {
    /** SNLT added to pool from production this tick. */
    production_added: number;
    pool_before: number;
    pool_after: number;
    /** Total SNLT drawn from pool toward communal orders this tick. */
    communal_drawn: number;
    /** Raw satisfaction records created this tick. */
    satisfactions: readonly Satisfaction[];
    /** Orders whose remaining SNLT hit 0 this tick (fully satisfied). */
    completed_orders: readonly Order[];
    /** Orders that transitioned from pending → preempted this tick. */
    newly_preempted: readonly Order[];
    /** Orders that transitioned from preempted → pending this tick (resumed). */
    newly_resumed: readonly Order[];
    /** Orders that missed their deadline this tick and were permanently closed. */
    failed_orders: readonly Order[];
    /** Consequence orders automatically spawned this tick because of failures. */
    consequence_orders: readonly Order[];
    /** Per-order outcome breakdown: planned vs actual, with status. */
    order_outcomes: readonly OrderOutcome[];
}

// =============================================================================
// COMMUNE
// =============================================================================

export interface CommuneOptions {
    /**
     * Normative planning constraint: the maximum SNLT the commune intends to
     * commit to communal obligations per period (e.g. 8h × N members).
     *
     * Distinct from `social_working_day_snlt` (the observed sum of labor already
     * worked). This cap governs feasibility of communal order placement during
     * planning — it is a forward-looking ceiling, not a record of past labor.
     *
     * When 0 or unset, falls back to ratio-based deduction rate.
     */
    planning_day_snlt?: number;
    /** Initial consumption pool (SNLT units). */
    initialConsumptionPool?: number;
}

export class Commune {
    /**
     * Normative planning cap: maximum communal SNLT committable per period.
     * Set this to constrain planning feasibility (e.g. 8h × active members).
     * Not the same as `social_working_day_snlt`, which is observed from actual labor.
     */
    public planning_day_snlt: number;
    public current_pool: number;
    /** The current simulation day. Increments on every tick(). */
    public current_tick: number = 0;

    private _orders: Order[] = [];
    private _satisfactions: Satisfaction[] = [];
    private _accounts = new Map<string, Account>();

    constructor(options: CommuneOptions = {}) {
        this.planning_day_snlt = options.planning_day_snlt ?? 0;
        this.current_pool = options.initialConsumptionPool ?? 0;
    }

    // -------------------------------------------------------------------------
    // ORDER PLACEMENT
    // -------------------------------------------------------------------------

    /**
     * Place a communal order — placing IS social validation.
     *
     * The order is immediately recognised as a collective obligation and
     * scheduled into the priority queue. `_rebalanceCommunal()` runs
     * automatically: the order will be rate-validated if daily capacity allows,
     * or rate-preempted (validated_snlt = 0) if higher-priority orders are
     * already consuming all available rate.
     */
    placeOrder(params: OrderParams): Order {
        const order: Order = {
            ...params,
            id: crypto.randomUUID(),
            scope: 'communal',
            validated_snlt: 0,
            accumulated_snlt: 0,
            is_failed: false,
            createdAt: new Date().toISOString(),
        };
        this._orders.push(order);
        this._rebalanceCommunal();
        return order;
    }

    // -------------------------------------------------------------------------
    // SIMULATION TICK
    // -------------------------------------------------------------------------

    /**
     * Advance the commune by one simulation day.
     *
     * The tick is the heartbeat of the feasibility simulator:
     *
     *   1. Add today's production to the pool.
     *   2. Accrue daily rate entitlement to all pending (rate-allocated) communal
     *      orders. Preempted orders do NOT accrue — no labor was politically
     *      allocated to them today.
     *   3. Distribute pool toward pending orders in priority order.
     *      Each order may draw up to its accumulated credit, bounded by:
     *        - remaining pool,
     *        - remaining order SNLT,
     *        - remaining daily capacity (planning_day_snlt total per tick).
     *      Pool-starved orders carry forward unspent credit and catch up on
     *      productive days — without exceeding the working day constraint.
     *   4. Rebalance rate allocation (completed orders free capacity).
     *   5. Report everything that changed.
     */
    tick(productionSnlt: number): DayReport {
        this.current_tick++;
        const pool_before = this.current_pool;
        const preempted_before = new Set(this.preempted_communal_orders.map(o => o.id));

        // 1. Production flows in:
        this.addToPool(productionSnlt);

        // 2. Snapshot pending/preempted BEFORE satisfaction changes state:
        const pending = this.pending_communal_orders;
        const preempted_now = this.preempted_communal_orders;

        // 3. Accrue entitlement for pending orders only (if they are available):
        for (const order of pending) {
            if (order.start_tick === undefined || this.current_tick >= order.start_tick) {
                order.accumulated_snlt += orderRate(order);
            }
        }

        // 4. Distribute pool with catch-up, bounded by planning_day_snlt per tick:
        let capacityLeft = this.planning_day_snlt > 0 ? this.planning_day_snlt : Infinity;
        const satisfactions: Satisfaction[] = [];
        const completed_orders: Order[] = [];
        const failed_orders: Order[] = [];
        const consequenceParamsToPlace: OrderParams[] = [];
        const order_outcomes: OrderOutcome[] = [];

        const failOrder = (order: Order) => {
            order.is_failed = true;
            failed_orders.push(order);
            if (order.consequence_on_fail) consequenceParamsToPlace.push(order.consequence_on_fail);
        };

        for (const order of pending) {
            const planned = orderRate(order);
            const physCap = order.max_rate_per_day ?? null;

            // 1. Check if the order has failed its physical deadline constraints:
            let doomed = false;
            if (order.deadline_tick !== undefined) {
                const ticksLeft = Math.max(0, order.deadline_tick - this.current_tick + 1);
                if (ticksLeft === 0) {
                    doomed = true; // Passed deadline literally
                } else if (physCap !== null) {
                    // Is it physically impossible to finish even running at max rate?
                    const maxPossibleGain = ticksLeft * physCap;
                    if (maxPossibleGain < this._remainingSnlt(order)) doomed = true;
                }
            }

            if (doomed) {
                let status: OrderStatus = 'deadline_failed';
                failOrder(order);
                order_outcomes.push({ order, planned_snlt: planned, max_snlt: physCap,
                    actual_snlt: 0, accumulated_after: order.accumulated_snlt, status });
                continue;
            }

            // 2. Is it even available to start?
            if (order.start_tick !== undefined && this.current_tick < order.start_tick) {
                order_outcomes.push({ order, planned_snlt: planned, max_snlt: physCap,
                    actual_snlt: 0, accumulated_after: order.accumulated_snlt, status: 'waiting' });
                continue;
            }

            if (capacityLeft <= 0) {
                // No capacity left for this order or any that follow:
                order_outcomes.push({ order, planned_snlt: planned, max_snlt: physCap,
                    actual_snlt: 0, accumulated_after: order.accumulated_snlt, status: 'capacity_capped' });
                continue;
            }

            const draw = Math.min(
                order.accumulated_snlt,             // can't spend unearned credit
                physCap ?? Infinity,                // physical rushing limit
                this._remainingSnlt(order),         // can't overshoot total
                this.current_pool,                  // can't overdraw pool
                capacityLeft                        // can't exceed today's working day
            );

            let status: OrderStatus;

            if (draw > 0) {
                satisfactions.push(this._record(order.id, draw));
                order.accumulated_snlt -= draw;
                capacityLeft -= draw;
                if (this._remainingSnlt(order) === 0) {
                    completed_orders.push(order);
                    status = 'completed';
                } else if (physCap !== null && draw >= physCap) {
                    status = 'rate_capped';    // hit physical ceiling
                } else if (draw > planned) {
                    status = 'catching_up';    // spent accumulated backlog
                } else {
                    status = 'running';        // steady state
                }
            } else {
                // draw === 0: determine which constraint caused it
                if (this.current_pool <= 0) {
                    status = 'pool_starved';
                } else {
                    status = 'capacity_capped'; // capacityLeft exhausted between orders
                }
            }

            order_outcomes.push({
                order,
                planned_snlt:    planned,
                max_snlt:        physCap,
                actual_snlt:     draw,
                accumulated_after: order.accumulated_snlt,
                status,
            });
        }

        // Preempted orders: no accrual, no draw — check failure and record standing:
        for (const order of preempted_now) {
            if (order.start_tick !== undefined && this.current_tick < order.start_tick) {
                order_outcomes.push({
                    order,
                    planned_snlt:    orderRate(order),
                    max_snlt:        order.max_rate_per_day ?? null,
                    actual_snlt:     0,
                    accumulated_after: order.accumulated_snlt,
                    status:          'waiting',
                });
                continue;
            }

            let doomed = this._isDoomed(order, this.current_tick);

            let status: OrderStatus = 'preempted';
            if (doomed) {
                status = 'deadline_failed';
                failOrder(order);
            }
            order_outcomes.push({
                order,
                planned_snlt:    orderRate(order),
                max_snlt:        order.max_rate_per_day ?? null,
                actual_snlt:     0,
                accumulated_after: order.accumulated_snlt,
                status,
            });
        }

        // 5. Spawn consequences of failed orders:
        const consequence_orders: Order[] = [];
        for (const params of consequenceParamsToPlace) {
            const newOrder = this.placeOrder(params); // this also runs _rebalanceCommunal()
            consequence_orders.push(newOrder);
        }

        // 6. Rebalance: completed/failed orders free rate for preempted ones:
        this._rebalanceCommunal();

        // 6. Diff preemption state to surface transitions:
        const newly_preempted = this.preempted_communal_orders
            .filter(o => !preempted_before.has(o.id));
        const newly_resumed = this.pending_communal_orders
            .filter(o => preempted_before.has(o.id));

        return {
            production_added: productionSnlt,
            pool_before,
            pool_after: this.current_pool,
            communal_drawn: satisfactions.reduce((s, sat) => s + sat.snlt, 0),
            satisfactions,
            completed_orders,
            newly_preempted,
            newly_resumed,
            failed_orders,
            consequence_orders,
            order_outcomes,
        };
    }

    // -------------------------------------------------------------------------
    // SATISFACTION — execute communal orders in priority order
    // -------------------------------------------------------------------------

    /**
     * Satisfy a specific communal order from the pool.
     * Returns false if not found, not communal, or pool is insufficient.
     */
    satisfy(orderId: string): boolean {
        const order = this._orders.find(o => o.id === orderId && o.scope === 'communal');
        if (!order) return false;

        const remaining = this._remainingSnlt(order);
        if (remaining <= 0) return false;
        if (this.current_pool < remaining) return false;

        order.validated_snlt = 0;
        this._record(orderId, remaining);
        // Re-evaluate which remaining orders can run now that rate has freed up:
        this._rebalanceCommunal();
        return true;
    }

    /**
     * Satisfy the next highest-priority pending communal order.
     *
     * Always processes the deduction cascade in kind priority order:
     * replacement → expansion → reserve → administration → welfare → common → other
     *
     * Returns the satisfied Order, or null if nothing is pending or the pool
     * cannot cover the next order.
     */
    satisfyNext(): Order | null {
        for (const order of this.pending_communal_orders) {
            if (this.satisfy(order.id)) return order;
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // DERIVED STATE
    // -------------------------------------------------------------------------

    /** All active (unsatisfied) orders of any scope. */
    get active_orders(): Order[] {
        return this._orders.filter(o => !o.is_failed && this._remainingSnlt(o) > 0);
    }

    get active_communal_orders(): Order[] {
        return this.active_orders.filter(o => o.scope === 'communal');
    }

    get active_individual_orders(): Order[] {
        return this.active_orders.filter(o => o.scope === 'individual');
    }

    /** Total remaining SNLT across all active communal orders. */
    get active_communal_snlt(): number {
        return this.active_communal_orders.reduce((s, o) => s + this._remainingSnlt(o), 0);
    }

    get active_individual_snlt(): number {
        return this.active_individual_orders.reduce((s, o) => s + this._remainingSnlt(o), 0);
    }

    /**
     * Total daily SNLT rate currently committed to validated communal orders.
     * This is the true constraint: not total SNLT, but daily throughput.
     *
     *   committed_rate_per_day = Σ (order.snlt / order.duration_days)
     *                            for all rate-validated communal orders
     */
    get committed_rate_per_day(): number {
        return this.active_communal_orders
            .filter(o => o.validated_snlt > 0)
            .reduce((s, o) => s + orderRate(o), 0);
    }

    /** Daily rate capacity not yet committed. */
    get remaining_rate_per_day(): number {
        return Math.max(0, this.planning_day_snlt - this.committed_rate_per_day);
    }

    /**
     * Observed social working day — the emergent sum of all actual labor
     * contributed by members to date (sum of gross_labor_credited).
     *
     * This is the Marxist social working day: not set, but derived from
     * the aggregate of individual labor certificates already issued.
     */
    get social_working_day_snlt(): number {
        let total = 0;
        for (const acc of this._accounts.values()) {
            total += acc.gross_labor_credited;
        }
        return total;
    }

    /**
     * Derived communal deduction rate (0–1).
     *
     * With planning cap (planning_day_snlt > 0):
     *   committed_rate_per_day / planning_day_snlt
     *   → fraction of daily capacity spoken for by validated communal orders.
     *   → rate-preempted (paused) orders do NOT contribute — only running ones.
     *   → if > 1, the plan is infeasible: communal rate exceeds daily capacity.
     *
     * Without cap (planning_day_snlt = 0):
     *   active_communal_snlt / (active_communal_snlt + active_individual_snlt)
     *   → ratio of expressed communal need to total expressed need.
     */
    get communal_deduction_rate(): number {
        if (this.planning_day_snlt > 0) {
            return Math.min(1, this.committed_rate_per_day / this.planning_day_snlt);
        }
        const total = this.active_communal_snlt + this.active_individual_snlt;
        return total === 0 ? 0 : this.active_communal_snlt / total;
    }

    /**
     * Communal orders currently rate-preempted — placed and recognised, but
     * unable to run because higher-priority orders consume all daily capacity.
     *
     * These are the orders that would "pause" in a feasibility simulation.
     * They resume automatically when a higher-priority order is satisfied.
     */
    get preempted_communal_orders(): Order[] {
        return this._communalByPriority().filter(o => o.validated_snlt === 0);
    }

    /**
     * Pending communal orders in deduction cascade priority order.
     * This is the queue that `satisfyNext()` processes.
     */
    get pending_communal_orders(): Order[] {
        return this._communalByPriority().filter(o => o.validated_snlt > 0);
    }

    // -------------------------------------------------------------------------
    // POOL
    // -------------------------------------------------------------------------

    /** Pool SNLT currently committed to individual validated orders. */
    get allocated_pool(): number {
        return this.active_individual_orders.reduce((s, o) => s + o.validated_snlt, 0);
    }

    get unallocated_pool(): number {
        return this.current_pool - this.allocated_pool;
    }

    /** Grow the pool when goods are produced. Tie to VF `produce` events. */
    addToPool(snltValue: number): void {
        this.current_pool += snltValue;
    }

    // -------------------------------------------------------------------------
    // ACCOUNT REGISTRY
    // -------------------------------------------------------------------------

    accountFor(agentId: string): Account | undefined {
        return this._accounts.get(agentId);
    }

    ensureAccount(agentId: string): Account {
        let acc = this._accounts.get(agentId);
        if (!acc) {
            acc = new Account(this, agentId);
            this._accounts.set(agentId, acc);
        }
        return acc;
    }

    allAccounts(): Account[] {
        return Array.from(this._accounts.values());
    }

    get social_total_potential_claims(): number {
        let total = 0;
        for (const acc of this._accounts.values()) {
            total += acc.current_potential_claim_capacity;
        }
        return total;
    }

    // -------------------------------------------------------------------------
    // INTERNAL HELPERS
    // -------------------------------------------------------------------------

    _remainingSnlt(order: Order): number {
        const satisfied = this._satisfactions
            .filter(s => s.orderId === order.id)
            .reduce((sum, s) => sum + s.snlt, 0);
        return Math.max(0, order.snlt - satisfied);
    }

    _record(orderId: string, snlt: number): Satisfaction {
        this.current_pool -= snlt;
        const sat: Satisfaction = {
            id: crypto.randomUUID(),
            orderId,
            snlt,
            satisfiedAt: new Date().toISOString(),
        };
        this._satisfactions.push(sat);
        return sat;
    }

    _placeIndividualOrder(params: Omit<OrderParams, 'agentId'> & { agentId: string }): Order {
        const order: Order = {
            ...params,
            id: crypto.randomUUID(),
            scope: 'individual',
            validated_snlt: 0,
            accumulated_snlt: 0,
            is_failed: false,
            createdAt: new Date().toISOString(),
        };
        this._orders.push(order);
        return order;
    }

    /**
     * Calculates the objective societal cost if this order were to fail.
     * Cost = [The SNLT debt of the consequence] + [Whatever accumulated progress is lost]
     */
    private _failureSeverity(order: Order): number {
        let consequenceDebt = 0;
        if (order.consequence_on_fail) {
            consequenceDebt = order.consequence_on_fail.snlt;
        }
        const lostProgress = order.snlt - this._remainingSnlt(order);
        return consequenceDebt + lostProgress;
    }

    /**
     * Checks if an order is physically doomed (or literally on the exact boundary where
     * it MUST run at max_rate_per_day to survive).
     * If evaluateForTick is provided, it simulates evaluating at that tick.
     */
    private _isDoomed(order: Order, evaluateAtTick: number): boolean {
        if (order.deadline_tick === undefined) return false;
        const ticksLeft = Math.max(0, order.deadline_tick - evaluateAtTick + 1);
        if (ticksLeft === 0) return true;
        if (order.max_rate_per_day !== undefined) {
            // Is it physically impossible to finish even running at max rate?
            // (or if maxPossible = remaining, it MUST run today to survive)
            const maxPossibleGain = ticksLeft * order.max_rate_per_day;
            if (maxPossibleGain <= this._remainingSnlt(order)) return true;
        }
        return false;
    }

    /** 
     * Active communal orders sorted by priority. Shared sort source.
     * Evaluates in two bands: Crisis Prevention (time-critical) > Elastic Progress (safe to pause).
     */
    private _communalByPriority(): Order[] {
        return [...this.active_communal_orders].sort((a, b) => {
            // 0. Waiting orders (not yet started) yield to everything else.
            const aWait = a.start_tick !== undefined && this.current_tick < a.start_tick;
            const bWait = b.start_tick !== undefined && this.current_tick < b.start_tick;
            if (aWait !== bWait) return aWait ? 1 : -1;

            // 1. Time-critical necessity. 
            // An order is in the Time-Critical Band if skipping it today would doom it.
            // We evaluate _isDoomed for TOMORROW. If missing today's tick pushes it
            // over the edge tomorrow, it is critical today.
            const aCrit = this._isDoomed(a, this.current_tick + 1);
            const bCrit = this._isDoomed(b, this.current_tick + 1);
            
            if (aCrit !== bCrit) return aCrit ? -1 : 1;

            // 2. If BOTH are in the Crisis Band, prioritize by severity of failure.
            // The disaster with the highest SNLT cost gets the capacity first.
            if (aCrit && bCrit) {
                const aSev = this._failureSeverity(a);
                const bSev = this._failureSeverity(b);
                if (aSev !== bSev) return bSev - aSev; // Descending (highest cost first)
            }
            
            // 3. Fallback to structural deduction cascade for elastic progress
            // (or to break ties between equal-severity crises)
            return kindRank(a.kind) - kindRank(b.kind);
        });
    }

    /**
     * Re-evaluate which communal orders can run given current rate capacity
     * and priority. Called automatically on placeOrder() and satisfy().
     *
     * Greedy algorithm: fills daily rate capacity from highest-priority orders
     * downward. Lower-priority orders are preempted (validated_snlt = 0) if
     * they don't fit. If rate frees up (e.g. a metabolic order is satisfied),
     * previously preempted orders may resume on the next rebalance.
     */
    private _rebalanceCommunal(): void {
        if (this.planning_day_snlt === 0) {
            // Unconstrained — all communal orders run
            for (const o of this.active_communal_orders) {
                o.validated_snlt = this._remainingSnlt(o);
            }
            return;
        }

        // Reset all communal validations, then greedily re-fill by priority:
        for (const o of this.active_communal_orders) {
            o.validated_snlt = 0;
        }

        let rateLeft = this.planning_day_snlt;
        for (const order of this._communalByPriority()) {
            const rate = orderRate(order);
            if (rate <= rateLeft) {
                order.validated_snlt = this._remainingSnlt(order);
                rateLeft -= rate;
            }
            // else: order is rate-preempted (validated_snlt stays 0)
        }
    }
}

// =============================================================================
// ACCOUNT — per-agent labor certificate and elastic individual distribution
// =============================================================================

export class Account {
    readonly agentId: string;

    /** Running total of SNLT hours credited (additive only). */
    public gross_labor_credited: number = 0;
    /** Running total of SNLT satisfied by this account (additive only). */
    public satisfied_snlt: number = 0;

    constructor(private commune: Commune, agentId: string) {
        this.agentId = agentId;
    }

    // -------------------------------------------------------------------------
    // ORDER PLACEMENT — always free
    // -------------------------------------------------------------------------

    /** Place an individual order. No purchasing power is committed here. */
    placeOrder(params: OrderParams): Order {
        return this.commune._placeIndividualOrder({ ...params, agentId: this.agentId });
    }

    // -------------------------------------------------------------------------
    // VALIDATION — commit / release purchasing power (individual preference)
    // -------------------------------------------------------------------------

    /**
     * Back an order with this account's purchasing power.
     *
     * This is the individual's act of preference — unlike communal orders,
     * individual orders require an explicit commitment. Returns false if the
     * order is not found, already validated, or purchasing power is insufficient.
     */
    validate(orderId: string): boolean {
        const order = this.commune.active_orders.find(
            o => o.id === orderId && o.agentId === this.agentId,
        );
        if (!order || order.validated_snlt > 0) return false;

        const remaining = this.commune._remainingSnlt(order);
        if (remaining <= 0) return false;
        if (this.unallocated_purchasing_power < remaining) return false;

        order.validated_snlt = remaining;
        return true;
    }

    /**
     * Release purchasing power from an order.
     * The order remains as an expressed-but-unbacked need.
     * Freed power is available to validate other orders.
     */
    invalidate(orderId: string): boolean {
        const order = this.commune.active_orders.find(
            o => o.id === orderId && o.agentId === this.agentId,
        );
        if (!order || order.validated_snlt === 0) return false;
        order.validated_snlt = 0;
        return true;
    }

    // -------------------------------------------------------------------------
    // SATISFACTION — execute a validated order
    // -------------------------------------------------------------------------

    /**
     * Satisfy a validated individual order. Draws from the pool.
     * Returns false if not validated, not found, or pool is insufficient.
     */
    satisfy(orderId: string): boolean {
        const order = this.commune.active_orders.find(
            o => o.id === orderId && o.scope === 'individual' && o.agentId === this.agentId,
        );
        if (!order || order.validated_snlt === 0) return false;

        const remaining = this.commune._remainingSnlt(order);
        if (remaining <= 0) return false;
        if (this.commune.current_pool < remaining) return false;

        order.validated_snlt = 0;
        this.commune._record(orderId, remaining);
        this.satisfied_snlt += remaining;
        return true;
    }

    // -------------------------------------------------------------------------
    // DERIVED PURCHASING POWER — the labor certificate
    // -------------------------------------------------------------------------

    /**
     * Labor credited after communal deductions have been made.
     * "The individual producer receives back from society — after the deductions
     *  have been made — exactly what he gives to it." — Marx
     */
    get net_claim_capacity(): number {
        return this.gross_labor_credited * (1 - this.commune.communal_deduction_rate);
    }

    get current_potential_claim_capacity(): number {
        return this.net_claim_capacity - this.satisfied_snlt;
    }

    /** Elastic share of the total social potential claims. */
    get current_share_of_claims(): number {
        const total = this.commune.social_total_potential_claims;
        return total === 0 ? 0 : this.current_potential_claim_capacity / total;
    }

    /** Actual purchasing power against the current pool. */
    get current_actual_claim_capacity(): number {
        return this.current_share_of_claims * this.commune.current_pool;
    }

    /** SNLT committed across validated individual orders. */
    get allocated_purchasing_power(): number {
        return this.commune.active_orders
            .filter(o => o.scope === 'individual' && o.agentId === this.agentId)
            .reduce((s, o) => s + o.validated_snlt, 0);
    }

    /** Purchasing power free for new validations. */
    get unallocated_purchasing_power(): number {
        return this.current_actual_claim_capacity - this.allocated_purchasing_power;
    }

    // -------------------------------------------------------------------------
    // ORDER VIEWS
    // -------------------------------------------------------------------------

    get active_orders(): Order[] {
        return this.commune.active_orders.filter(o => o.agentId === this.agentId);
    }

    get validated_orders(): Order[] {
        return this.active_orders.filter(o => o.validated_snlt > 0);
    }

    get unvalidated_orders(): Order[] {
        return this.active_orders.filter(o => o.validated_snlt === 0);
    }

    // -------------------------------------------------------------------------
    // VF-INTEGRATED LABOR CREDITING
    // -------------------------------------------------------------------------

    creditFromEvent(event: EconomicEvent): void {
        if (event.action !== 'work') return;
        this.gross_labor_credited += event.effortQuantity?.hasNumericalValue ?? 0;
    }

    addLabor(snltHours: number): void {
        this.gross_labor_credited += snltHours;
    }
}
