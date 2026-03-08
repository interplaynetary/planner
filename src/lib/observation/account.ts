/**
 * Commune & Account — SNLT-based communal labor-credit system.
 *
 * ## Core Abstractions (minimal)
 *
 *   Order        — any expressed need, communal or individual. Placing is free.
 *   Validation   — a reversible commitment of purchasing power to back an Order.
 *   Satisfaction — the execution of a validated Order, drawn from the pool.
 *
 * ## Order Lifecycle
 *
 *   place → [validate ↔ invalidate] → satisfy
 *
 *   Placing   is always free. Any agent or the Commune can place any order.
 *   Validating commits the agent's (or Commune's) resources to back the order.
 *   Invalidating releases that commitment, freeing resources for other orders.
 *   Satisfying draws from the pool and closes the order. Requires validation.
 *
 *   This applies identically to communal and individual orders. The Commune
 *   backs its own orders with pool capacity; individuals back theirs with
 *   purchasing power.
 *
 * ## Communal Priority (elastic)
 *
 *   communal_deduction_rate = active_communal_snlt / (active_communal_snlt + active_individual_snlt)
 *
 * As communal obligations grow, individual purchasing power contracts, making
 * fewer individual orders validatable. No hard block — scarcity is felt through
 * reduced capacity to validate, not a prohibition on ordering.
 *
 * ## Preference as Validation
 *
 * Validation is the prioritization mechanism. An agent backs their most
 * important orders first. In times of scarcity, they invalidate lower-priority
 * orders, freeing power to validate the ones that matter most. Standing
 * unvalidated orders remain as expressed needs without consuming any budget.
 *
 * ## Integration with VF
 *   - Labor credited via `work` EconomicEvents → `account.creditFromEvent(e)`.
 *   - Goods produced → `commune.addToPool(snltValue)`.
 *   - Debt observed/generated → `commune.placeOrder({ ... })`.
 *   - Validate → `commune.validate(id)` / `account.validate(id)`.
 *   - Invalidate → `commune.invalidate(id)` / `account.invalidate(id)`.
 *   - Satisfy → `commune.satisfy(id)` / `account.satisfy(id)`.
 *
 * Usage:
 *   const commune = new Commune();
 *   const alice   = commune.ensureAccount('alice');
 *
 *   // Metabolic debt — Commune places and validates it (backs with pool):
 *   const debt = commune.placeOrder({ label: 'metabolic:water', snlt: 120, kind: 'metabolic' });
 *   commune.validate(debt.id);
 *
 *   // Alice places orders freely:
 *   const chair = alice.placeOrder({ label: 'chair', snlt: 8 });
 *   const coat  = alice.placeOrder({ label: 'coat',  snlt: 12 });
 *
 *   // Alice backs chair with her purchasing power:
 *   alice.validate(chair.id);   // succeeds if she has ≥ 8 SNLT capacity
 *   alice.validate(coat.id);    // succeeds if remaining capacity ≥ 12
 *
 *   // In scarcity she can only back chair — coat sits as expressed-but-unvalidated:
 *   alice.invalidate(coat.id);  // frees 12 SNLT of capacity
 *
 *   // Commune satisfies its debt:
 *   commune.satisfy(debt.id);   // pool decreases, communal_deduction_rate falls
 *
 *   // Alice satisfies her validated order:
 *   alice.satisfy(chair.id);
 */

import type { EconomicEvent } from '../schemas';

// =============================================================================
// ORDER — the single abstraction for any expressed need
// =============================================================================

export type OrderScope = 'communal' | 'individual';

/**
 * A need expressed by either the Commune or an individual agent.
 *
 * Placing an order is always free — it expresses intent without committing
 * any resources. Resources are committed separately via `validate()`.
 */
export interface Order {
    readonly id: string;
    readonly scope: OrderScope;
    /** Matches VF Agent.id for individual orders. */
    readonly agentId?: string;
    readonly label: string;
    /** Total SNLT cost to fully satisfy this order. */
    readonly snlt: number;
    /** Semantic category: 'metabolic' | 'reparation' | 'consumption' | etc. */
    readonly kind?: string;
    readonly createdAt: string;
    /**
     * SNLT currently committed to back this order.
     * 0 = placed but unvalidated (no resources behind it).
     * > 0 = validated (this much purchasing power / pool is reserved).
     * Mutable — validation and invalidation update this directly.
     */
    validated_snlt: number;
}

// =============================================================================
// SATISFACTION — the execution record for a validated Order
// =============================================================================

/**
 * An immutable record that an Order was executed against the pool.
 * Created by `satisfy()`. Partial satisfaction = multiple records per Order.
 */
export interface Satisfaction {
    readonly id: string;
    readonly orderId: string;
    /** SNLT drawn from the pool. */
    readonly snlt: number;
    readonly satisfiedAt: string;
}

// =============================================================================
// COMMUNE — global pool, order registry, derived deduction rate
// =============================================================================

export interface CommuneOptions {
    /** Initial consumption pool (SNLT units). Grows as goods are produced. */
    initialConsumptionPool?: number;
}

export class Commune {
    /** Sum of SNLT of all goods currently available for order satisfaction. */
    public current_pool: number;

    private _orders: Order[] = [];
    private _satisfactions: Satisfaction[] = [];
    private _accounts = new Map<string, Account>();

    constructor(options: CommuneOptions = {}) {
        this.current_pool = options.initialConsumptionPool ?? 0;
    }

    // -------------------------------------------------------------------------
    // ORDER PLACEMENT — free for both scopes
    // -------------------------------------------------------------------------

    /**
     * Place a communal order (metabolic debt, reparation, infrastructure).
     * Placing is free — call `validate(id)` to commit pool capacity to it.
     */
    placeOrder(params: Omit<Order, 'id' | 'scope' | 'agentId' | 'createdAt' | 'validated_snlt'>): Order {
        const order: Order = {
            ...params,
            id: crypto.randomUUID(),
            scope: 'communal',
            validated_snlt: 0,
            createdAt: new Date().toISOString(),
        };
        this._orders.push(order);
        return order;
    }

    // -------------------------------------------------------------------------
    // VALIDATION — commit / release pool capacity to a communal order
    // -------------------------------------------------------------------------

    /**
     * Commit pool capacity to a communal order.
     *
     * The Commune backs an order by reserving the order's remaining SNLT from
     * the pool's unallocated balance. Returns false if the pool has insufficient
     * unallocated capacity, or if the order is already validated.
     */
    validate(orderId: string): boolean {
        const order = this._orders.find(o => o.id === orderId && o.scope === 'communal');
        if (!order || order.validated_snlt > 0) return false;

        const remaining = this._remainingSnlt(order);
        if (remaining <= 0) return false;
        if (this.unallocated_pool < remaining) return false;

        order.validated_snlt = remaining;
        return true;
    }

    /**
     * Release a communal order's pool commitment.
     * The freed capacity becomes available for other communal validations.
     */
    invalidate(orderId: string): boolean {
        const order = this._orders.find(o => o.id === orderId && o.scope === 'communal');
        if (!order || order.validated_snlt === 0) return false;
        order.validated_snlt = 0;
        return true;
    }

    // -------------------------------------------------------------------------
    // SATISFACTION — execute a validated communal order
    // -------------------------------------------------------------------------

    /**
     * Satisfy a communal order.
     * Requires prior validation. Draws from pool and records satisfaction.
     * Returns false if not validated, not found, or pool is insufficient.
     */
    satisfy(orderId: string): boolean {
        const order = this._orders.find(o => o.id === orderId && o.scope === 'communal');
        if (!order || order.validated_snlt === 0) return false;

        const remaining = this._remainingSnlt(order);
        if (remaining <= 0) return false;
        if (this.current_pool < remaining) return false;

        order.validated_snlt = 0; // release commitment on satisfaction
        this._record(orderId, remaining);
        return true;
    }

    // -------------------------------------------------------------------------
    // DERIVED STATE
    // -------------------------------------------------------------------------

    /** All active (unsatisfied) orders of any scope. */
    get active_orders(): Order[] {
        return this._orders.filter(o => this._remainingSnlt(o) > 0);
    }

    /** Active communal orders. */
    get active_communal_orders(): Order[] {
        return this.active_orders.filter(o => o.scope === 'communal');
    }

    /** Active individual orders across all accounts. */
    get active_individual_orders(): Order[] {
        return this.active_orders.filter(o => o.scope === 'individual');
    }

    /** Total unsatisfied SNLT across all active communal orders. */
    get active_communal_snlt(): number {
        return this.active_communal_orders.reduce((s, o) => s + this._remainingSnlt(o), 0);
    }

    /** Total unsatisfied SNLT across all active individual orders. */
    get active_individual_snlt(): number {
        return this.active_individual_orders.reduce((s, o) => s + this._remainingSnlt(o), 0);
    }

    /**
     * Derived communal deduction rate (0–1).
     *   active_communal_snlt / (active_communal_snlt + active_individual_snlt)
     *
     * Reflects the proportion of total expressed need that is communal.
     * Rises as communal debt accumulates → individual purchasing power shrinks.
     */
    get communal_deduction_rate(): number {
        const total = this.active_communal_snlt + this.active_individual_snlt;
        return total === 0 ? 0 : this.active_communal_snlt / total;
    }

    /** SNLT currently committed to validated communal orders. */
    get allocated_pool(): number {
        return this.active_communal_orders.reduce((s, o) => s + o.validated_snlt, 0);
    }

    /** Pool available for new communal validations (uncommitted). */
    get unallocated_pool(): number {
        return this.current_pool - this.allocated_pool;
    }

    // -------------------------------------------------------------------------
    // PRODUCTION POOL
    // -------------------------------------------------------------------------

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
    // INTERNAL HELPERS (used by Account)
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

    _placeIndividualOrder(params: Omit<Order, 'id' | 'scope' | 'createdAt' | 'validated_snlt'>): Order {
        const order: Order = {
            ...params,
            id: crypto.randomUUID(),
            scope: 'individual',
            validated_snlt: 0,
            createdAt: new Date().toISOString(),
        };
        this._orders.push(order);
        return order;
    }
}

// =============================================================================
// ACCOUNT — per-agent labor credits, validation budget, and satisfaction
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

    /**
     * Place an individual order (personal consumption intent).
     * Placing is always free. No purchasing power is committed here.
     * Call `validate(id)` to back this order with purchasing power.
     */
    placeOrder(params: Omit<Order, 'id' | 'scope' | 'agentId' | 'createdAt' | 'validated_snlt'>): Order {
        return this.commune._placeIndividualOrder({ ...params, agentId: this.agentId });
    }

    // -------------------------------------------------------------------------
    // VALIDATION — commit / release purchasing power to an order
    // -------------------------------------------------------------------------

    /**
     * Back an individual order with this account's purchasing power.
     *
     * Reserves the order's remaining SNLT from the account's unallocated
     * purchasing power. This is the agent's expression of preference — only
     * validated orders can be satisfied. Returns false if:
     *   - The order is not found or not owned by this agent.
     *   - The order is already validated.
     *   - Available (unallocated) purchasing power is insufficient.
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
     * Release the purchasing power committed to an order.
     * The freed power becomes available to validate other orders.
     * The order itself remains standing as an expressed-but-unbacked need.
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
     * Satisfy a validated individual order.
     *
     * Requires prior validation. Draws the order's SNLT from the pool.
     * Returns false if the order is not validated, not found, or the pool
     * is currently insufficient (e.g. commune hasn't produced enough yet).
     */
    satisfy(orderId: string): boolean {
        const order = this.commune.active_orders.find(
            o => o.id === orderId && o.scope === 'individual' && o.agentId === this.agentId,
        );
        if (!order || order.validated_snlt === 0) return false;

        const remaining = this.commune._remainingSnlt(order);
        if (remaining <= 0) return false;
        if (this.commune.current_pool < remaining) return false;

        order.validated_snlt = 0; // release on satisfaction
        this.commune._record(orderId, remaining);
        this.satisfied_snlt += remaining;
        return true;
    }

    // -------------------------------------------------------------------------
    // DERIVED PURCHASING POWER
    // -------------------------------------------------------------------------

    /** Labor credited after communal deduction (elastic). */
    get net_claim_capacity(): number {
        return this.gross_labor_credited * (1 - this.commune.communal_deduction_rate);
    }

    /** Remaining unclaimed capacity. */
    get current_potential_claim_capacity(): number {
        return this.net_claim_capacity - this.satisfied_snlt;
    }

    /** This account's elastic share of total social potential claims (0–1). */
    get current_share_of_claims(): number {
        const total = this.commune.social_total_potential_claims;
        return total === 0 ? 0 : this.current_potential_claim_capacity / total;
    }

    /** Total purchasing power available right now from the current pool. */
    get current_actual_claim_capacity(): number {
        return this.current_share_of_claims * this.commune.current_pool;
    }

    /** SNLT currently committed across all validated individual orders. */
    get allocated_purchasing_power(): number {
        return this.commune.active_orders
            .filter(o => o.agentId === this.agentId)
            .reduce((s, o) => s + o.validated_snlt, 0);
    }

    /** Purchasing power free for new validations. */
    get unallocated_purchasing_power(): number {
        return this.current_actual_claim_capacity - this.allocated_purchasing_power;
    }

    // -------------------------------------------------------------------------
    // ORDER VIEWS
    // -------------------------------------------------------------------------

    /** All standing (unsatisfied) orders for this agent. */
    get active_orders(): Order[] {
        return this.commune.active_orders.filter(o => o.agentId === this.agentId);
    }

    /** Orders this agent has validated (backed with purchasing power). */
    get validated_orders(): Order[] {
        return this.active_orders.filter(o => o.validated_snlt > 0);
    }

    /** Orders placed but not yet backed — expressed need without commitment. */
    get unvalidated_orders(): Order[] {
        return this.active_orders.filter(o => o.validated_snlt === 0);
    }

    // -------------------------------------------------------------------------
    // VF-INTEGRATED LABOR CREDITING
    // -------------------------------------------------------------------------

    /**
     * Credit labor from a VF `work` EconomicEvent.
     * Reads effortQuantity.hasNumericalValue as SNLT hours.
     */
    creditFromEvent(event: EconomicEvent): void {
        if (event.action !== 'work') return;
        this.gross_labor_credited += event.effortQuantity?.hasNumericalValue ?? 0;
    }

    /** Directly credit SNLT hours. Use only for bootstrapping or testing. */
    addLabor(snltHours: number): void {
        this.gross_labor_credited += snltHours;
    }
}
