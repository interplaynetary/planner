/**
 * Commune & Account — SNLT-based communal labor-credit system.
 *
 * This implements a Social Necessary Labor Time (SNLT) elastic claim model
 * as an application-layer extension ON TOP of ValueFlows, not instead of it.
 *
 * Integration with VF:
 *   - Labor is credited via `work` EconomicEvents recorded in the Observer.
 *   - `Account.creditFromEvent(event)` reads effortQuantity from a work event.
 *   - `Account.claimGoods(event)` can be tied to consume/transfer events.
 *   - The `Commune` holds the global consumption pool, updated as events flow.
 *
 * Usage:
 *   const commune = new Commune();
 *   const account = new Account(commune, agentId);
 *   observer.subscribe(e => {
 *     if (e.type === 'recorded' && e.event.action === 'work') {
 *       const account = commune.accountFor(e.event.provider);
 *       account?.creditFromEvent(e.event);
 *     }
 *   });
 */

import type { EconomicEvent } from '../schemas';
import type { Observer } from './observer';
import type { SNEIndex } from '../algorithms/SNE';
import { computeRecipeSNE } from '../algorithms/SNE';
import type { RecipeStore } from '../knowledge/recipes';

// =============================================================================
// COMMUNE — global pool and deduction parameters
// =============================================================================

export interface CommuneOptions {
    /** Initial  individual claimable pool SVC. */
    initialClaimablePool?: number;

    /** Observer for dynamic SVC calculation of resource pools. */
    observer?: Observer;
    /** SNE index for calculating value of resources. */
    sneIndex?: SNEIndex;
    /** Recipe store to fetch ResourceSpecifications (to check default classifications) and compute SNE. */
    recipeStore?: RecipeStore;
}

export class Commune {
    /**
     * Pool tracking for various resource classifications.
     * Pool Examples: 'individual-claimable', 'replenishment', 'reserve', 'administration' etc.
     */
    public pools: Record<string, number> = {};

    public observer?: Observer;
    public sneIndex?: SNEIndex;
    public recipeStore?: RecipeStore;

    private accounts = new Map<string, Account>();

    constructor(options: CommuneOptions = {}) {
        this.pools['individual-claimable'] = options.initialClaimablePool ?? 0;
        this.observer = options.observer;
        this.sneIndex = options.sneIndex;
        this.recipeStore = options.recipeStore;
    }

    /** Register or retrieve the Account for a given VF agent ID. */
    accountFor(agentId: string): Account | undefined {
        return this.accounts.get(agentId);
    }

    /** Ensure an Account exists for this agent. */
    ensureAccount(agentId: string): Account {
        let account = this.accounts.get(agentId);
        if (!account) {
            account = new Account(this, agentId);
            this.accounts.set(agentId, account);
        }
        return account;
    }

    allAccounts(): Account[] {
        return Array.from(this.accounts.values());
    }

    /**
     * Total Socially Validated Contribution:
     * total_social_svc = Σ(all socially-validated effort)
     */
    get total_social_svc(): number {
        let total = 0;
        for (const account of this.accounts.values()) {
            total += account.gross_contribution_credited;
        }
        return total;
    }

    /**
     * Total Pool Validated Contribution:
     * <pool>_svc = Σ(SVC of all resources classified as <pool>)
     */
    getPoolSvc(poolName: string): number {
        let totalSvc = this.pools[poolName] || 0;

        if (this.observer && this.sneIndex) {
            for (const resource of this.observer.allResources()) {
                let matchesPool = resource.classifiedAs?.includes(poolName);
                
                // If not explicitly on the resource, check the resource specification
                if (!matchesPool && this.recipeStore) {
                    const spec = this.recipeStore.getResourceSpec(resource.conformsTo);
                    if (spec?.resourceClassifiedAs?.includes(poolName)) {
                        matchesPool = true;
                    }
                }

                if (matchesPool) {
                    const qty = resource.onhandQuantity?.hasNumericalValue ?? 0;
                    let sne = this.sneIndex.get(resource.conformsTo);

                    // Compute on the fly if not in index and we have a recipe store
                    if (sne === undefined && this.recipeStore) {
                        sne = computeRecipeSNE(resource.conformsTo, this.recipeStore, this.sneIndex);
                    }

                    totalSvc += qty * (sne ?? 0);
                }
            }
        }

        return totalSvc;
    }


    /**
     * Individual Claimable Resource Price = SNE/unit cost
     */
    getResourcePrice(specId: string): number {
        if (!this.sneIndex) return 0;
        let sne = this.sneIndex.get(specId);
        if (sne === undefined && this.recipeStore) {
            sne = computeRecipeSNE(specId, this.recipeStore, this.sneIndex);
        }
        return sne ?? 0;
    }

    /** Backwards-compatibility/convenience getter for individual-claimable pool */
    get individual_claimable_pool_svc(): number {
        return this.getPoolSvc('individual-claimable');
    }

    /**
     * Social Welfare Fund:
     * social_welfare_fund = individual_claimable_pool_svc × welfare_allocation_rate
     */
    get social_welfare_fund(): number {
        return this.individual_claimable_pool_svc * this.welfare_allocation_rate;
    }

    /**
     * available_claimable_pool = individual_claimable_pool_svc - social_welfare_fund
     */
    get available_claimable_pool(): number {
        return this.individual_claimable_pool_svc - this.social_welfare_fund;
    }

    /** Alias for available_claimable_pool */
    get available_claimable_svc(): number {
        return this.available_claimable_pool;
    }

    /** Alias for individual_claimable_pool_svc */
    get current_claimable_pool(): number {
        return this.individual_claimable_pool_svc;
    }

    /** Helper: Σ(1 - contribution_capacity_factor) */
    get sum_unmet_capacity(): number {
        let sum = 0;
        for (const account of this.accounts.values()) {
            sum += (1 - account.contribution_capacity_factor);
        }
        return sum;
    }

    /** Helper: Σ contribution_capacity_factor */
    private get sum_met_capacity(): number {
        let sum = 0;
        for (const account of this.accounts.values()) sum += account.contribution_capacity_factor;
        return sum;
    }

    /**
     * Welfare allocation rate derived from aggregate incapacity:
     *   rate = sum_unmet / (sum_met + sum_unmet)
     * Self-corrects: 0% when all CCF=1, 100% when all CCF=0.
     */
    get welfare_allocation_rate(): number {
        const total = this.sum_met_capacity + this.sum_unmet_capacity;
        return total > 0 ? this.sum_unmet_capacity / total : 0;
    }

    /**
     * Sum of all members' current potential claim capacities.
     * Used as the denominator for elastic share calculation.
     */
    get social_total_potential_claims(): number {
        let total = 0;
        for (const account of this.accounts.values()) {
            total += account.current_potential_claim_capacity;
        }
        return total;
    }

    /** Add SVC value to a specific pool when goods are produced. */
    addToPool(poolName: string, svcValue: number): void {
        this.pools[poolName] = (this.pools[poolName] || 0) + svcValue;
    }

    /** Backwards-compatible pool addition (defaults to individual-claimable) */
    addIndividualClaimable(svcValue: number): void {
        this.addToPool('individual-claimable', svcValue);
    }
}

// =============================================================================
// ACCOUNT — per-agent labor credits and claim capacity
// =============================================================================

export class Account {
    /** Agent ID this account belongs to (matches VF Agent.id). */
    readonly agentId: string;

    /** Running total of socially validated effort credited. */
    public gross_contribution_credited: number = 0;

    /** Running total of SVC claimed from the pool. */
    public claimed_capacity: number = 0;

    /**
     * Individual Contribution Capacity Factor: 
     * Ranges from 0 (unable to contribute) to 1 (full contribution capacity).
     */
    public contribution_capacity_factor: number = 1;

    constructor(private commune: Commune, agentId: string) {
        this.agentId = agentId;
    }

    // =========================================================================
    // DERIVED CLAIM PROPERTIES
    // =========================================================================

    /**
     * Contribution-Based Claim (from actual work):
     * contribution_claim = gross_contribution_credited × (available_claimable_pool / total_social_svc)
     */
    get contribution_claim(): number {
        const totalSocialSvc = this.commune.total_social_svc;
        if (totalSocialSvc === 0) return 0;
        return this.gross_contribution_credited * (this.commune.available_claimable_pool / totalSocialSvc);
    }

    /**
     * Solidarity Supplement:
     * solidarity_supplement = (1 - contribution_capacity_factor) × (social_welfare_fund / Σ(1 - contribution_capacity_factor))
     */
    get solidarity_supplement(): number {
        const sumUnmet = this.commune.sum_unmet_capacity;
        if (sumUnmet === 0) return 0;
        return (1 - this.contribution_capacity_factor) * (this.commune.social_welfare_fund / sumUnmet);
    }

    /**
     * Total Claim Capacity:
     * total_claim_capacity = contribution_claim + solidarity_supplement
     */
    get total_claim_capacity(): number {
        return this.contribution_claim + this.solidarity_supplement;
    }

    /**
     * Current Potential Claims:
     * current_potential_claim_capacity = total_claim_capacity - claimed_capacity
     */
    get current_potential_claim_capacity(): number {
        return Math.max(0, this.total_claim_capacity - this.claimed_capacity);
    }

    /** 
     * Social Share:
     * current_share_of_claims = current_potential_claim_capacity / social_total_potential_claims
     */
    get current_share_of_claims(): number {
        const totalPotential = this.commune.social_total_potential_claims;
        if (totalPotential === 0) return 0;
        return this.current_potential_claim_capacity / totalPotential;
    }

    /** 
     * Actual Claim Capacity:
     * current_actual_claim_capacity = current_share_of_claims × current_claimable_pool
     */
    get current_actual_claim_capacity(): number {
        return this.current_share_of_claims * this.commune.current_claimable_pool;
    }

    // =========================================================================
    // VF-INTEGRATED ACTIONS
    // =========================================================================

    /**
     * Credit labor from a VF `work` EconomicEvent.
     */
    creditFromEvent(event: EconomicEvent): void {
        if (event.action !== 'work') return;
        const hours = event.effortQuantity?.hasNumericalValue ?? 0;
        this.gross_contribution_credited += hours;
    }

    /** Directly credit a quantity of SVC (without a VF event). */
    addContribution(svcAmount: number): void {
        this.gross_contribution_credited += svcAmount;
    }

    /**
     * Claim goods from the communal pool.
     *
     * @param svcCostOfGoods - SVC cost/price of the goods being claimed.
     * @returns true if the claim succeeded, false if insufficient actual claim capacity.
     */
    claimGoods(svcCostOfGoods: number): boolean {
        if (this.current_actual_claim_capacity >= svcCostOfGoods) {
            this.claimed_capacity += svcCostOfGoods;
            // deduct from the individual claimable pool
            this.commune.pools['individual-claimable'] -= svcCostOfGoods;
            return true;
        }
        return false;
    }
}
