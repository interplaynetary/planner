/**
 * Scope Transition Economics — pure functions for Scope Committees navigating
 * from capitalist to social-plan production.
 *
 * Implements the Observer Procedure equations from docs/social/spec.md:
 *   - Physical flow fractions (social/confirmed), transition_depth, commitment_gap
 *   - Per-worker labor validation (hours → validated_hours → claim_capacity)
 *   - Dollar wage computation (federation_hourly_dollar_rate × hours, phase-out factor)
 *   - Communal need coverage (effective_net_market_wage, communal_need_coverage)
 *   - Purchasing power terms and real wages
 *   - Per-worker entitlement composition (social vs. market channel split)
 *   - Composite ratios (substitution_ratio, communal_satisfaction_ratio)
 *
 * All functions are pure. Callers own the social/market boundary classification
 * of events (no Set<agentId> logic here).
 */

import type { EconomicEvent } from '../schemas';

// =============================================================================
// Section 1 — Input types
// =============================================================================

/** Purchasing power: goods obtainable per unit of each currency. */
export interface PurchasingPower {
    claim_purchasing_power: number;   // goods per 1 SVC unit in local claim pool
    dollar_purchasing_power: number;  // goods per $1 in local markets
    import_purchasing_power: number;  // goods per $1 in international markets (default 1.0)
}

/** Dollar wages and operational costs for a scope in one period. */
export interface ScopeFinancials {
    // Inflows
    market_revenue: number;
    social_cash_revenue: number;     // cash received from social plan for outputs
    subsidy_received: number;        // federation bridge (Mechanism C)
    // Outflows
    market_input_cost: number;
    social_input_cash_cost: number;  // cash paid for social-plan inputs
    total_dollar_wages: number;
    other_costs: number;
    contribution_sent: number;       // federation levy / solidarity contribution
}

/** Dollar hourly rate for one worker (external payroll data, not VF). */
export interface WorkerRate {
    agentId: string;
    hourly_rate: number;             // dollar/hour
}

/** Communal provision data per worker (external social-plan data). */
export interface WorkerCommunalCoverage {
    agentId: string;
    communal_need_coverage: number;        // market cost equivalent of communally provided essentials
    uncovered_essential_expenses: number;  // remaining market cost of essentials not yet covered
}

/** Everything needed to compute the full scope transition report. */
export interface ScopeTransitionConfig {
    // Event arrays (caller-classified)
    workEvents: EconomicEvent[];               // action='work', provider=agentId
    inputConsumeEvents: EconomicEvent[];       // all consume events (scope inputs)
    socialInputConsumeEvents: EconomicEvent[]; // subset: inputs from social-plan providers
    outputEvents: EconomicEvent[];             // all produce/transfer events (scope outputs)
    socialOutputEvents: EconomicEvent[];       // subset: dispatched to social agents
    confirmedReceiptEvents: EconomicEvent[];   // confirmed by social recipients (receiver recorded)
    // Worker data
    workerRates: WorkerRate[];
    communalCoverage: WorkerCommunalCoverage[];
    solidaritySupplements: Map<string, number>; // agentId → SVC (from Commune)
    // Commune snapshot (from account.ts Commune)
    available_claimable_pool: number;           // Commune.available_claimable_pool
    total_social_svc: number;                   // Commune.total_social_svc
    // Market context
    purchasingPower: PurchasingPower;
    financials: ScopeFinancials;
    target_communal_ratio: number;  // policy threshold; when CSR reaches this, wages phase out
}

// =============================================================================
// Section 2 — Output types
// =============================================================================

export interface FlowFractions {
    social_input_fraction: number;
    social_output_fraction: number;
    confirmed_output_fraction: number;
    /** How far the scope has actually moved: social_output_fraction × confirmed_output_fraction */
    transition_depth: number;
    /** Gap between social dispatches and confirmed receipts: social_output_fraction − confirmed_output_fraction */
    commitment_gap: number;
}

export interface WorkerTransitionState {
    agentId: string;
    // Inputs
    hours_worked: number;
    hourly_rate: number;
    // Derived labor
    wage_rate_normalized: number;
    validated_hours: number;
    // Compensation
    dollar_wage: number;
    claim_capacity: number;
    // Communal coverage
    communal_need_coverage: number;
    uncovered_essential_expenses: number;
    effective_net_market_wage: number;
    // Social channel value (claim goods + communal provision)
    total_social_value: number;
    communal_satisfaction_ratio: number;
    // Entitlement composition: real goods accessible via each channel
    market_entitlement_value: number;       // dollar_wage × dollar_purchasing_power
    total_real_entitlement: number;         // total_social_value + market_entitlement_value
    social_fraction_of_entitlement: number; // total_social_value / total_real_entitlement
}

export interface ScopeTransitionReport {
    // Flow
    fractions: FlowFractions;
    // Dollar solvency
    dollar_balance: number;
    is_solvent: boolean;
    // Scope aggregates
    total_hours_worked: number;
    total_dollar_wages: number;
    total_validated_hours: number;
    average_dollar_wage_per_hour: number;
    average_claim_per_validated_hour: number;
    // Real wages
    social_real_wage_per_hour: number;
    market_real_wage_per_hour: number;
    // Ratios
    /** Channel mix: social vs. market compensation per confirmed hour (same formula as substitution_ratio, reframed). */
    composition_ratio: number;
    communal_satisfaction_ratio: number; // hours-weighted average across workers
    // Phase-out
    dollar_wage_phase_out_factor: number;
    // Collective trade metrics
    scope_net_external_contribution: number;
    local_provision_value_per_worker: number;
    // Per-worker
    workers: WorkerTransitionState[];
}

// =============================================================================
// Section 3 — Pure functions
// =============================================================================

// --- Flow fractions ---

function sumResourceQty(events: EconomicEvent[]): number {
    let total = 0;
    for (const e of events) {
        total += e.resourceQuantity?.hasNumericalValue ?? 0;
    }
    return total;
}

/**
 * Compute flow fractions, transition_depth, and commitment_gap.
 * Returns 0 for any fraction whose denominator is 0.
 */
export function computeFlowFractions(
    inputConsumeEvents: EconomicEvent[],
    socialInputConsumeEvents: EconomicEvent[],
    outputEvents: EconomicEvent[],
    socialOutputEvents: EconomicEvent[],
    confirmedReceiptEvents: EconomicEvent[],
): FlowFractions {
    const totalInputQty = sumResourceQty(inputConsumeEvents);
    const socialInputQty = sumResourceQty(socialInputConsumeEvents);
    const totalOutputQty = sumResourceQty(outputEvents);
    const socialOutputQty = sumResourceQty(socialOutputEvents);
    const confirmedQty = sumResourceQty(confirmedReceiptEvents);

    const social_input_fraction = totalInputQty > 0 ? socialInputQty / totalInputQty : 0;
    const social_output_fraction = totalOutputQty > 0 ? socialOutputQty / totalOutputQty : 0;
    const confirmed_output_fraction = totalOutputQty > 0 ? confirmedQty / totalOutputQty : 0;

    return {
        social_input_fraction,
        social_output_fraction,
        confirmed_output_fraction,
        transition_depth: social_output_fraction * confirmed_output_fraction,
        commitment_gap: social_output_fraction - confirmed_output_fraction,
    };
}

// --- Per-worker hours ---

/**
 * Sum effortQuantity hours across work events, grouped by provider agentId.
 */
export function extractWorkerHours(
    workEvents: EconomicEvent[],
): Map<string, number> {
    const result = new Map<string, number>();
    for (const e of workEvents) {
        if (!e.provider) continue;
        const hours = e.effortQuantity?.hasNumericalValue ?? 0;
        result.set(e.provider, (result.get(e.provider) ?? 0) + hours);
    }
    return result;
}

// --- Wage normalization ---

/**
 * Normalize each worker's hourly rate relative to the group average.
 * When all rates are equal, all normalized values = 1.0.
 */
export function computeWageRateNormalized(
    hourlyRates: Map<string, number>,
): Map<string, number> {
    const rates = Array.from(hourlyRates.values());
    const n = rates.length;
    if (n === 0) return new Map();
    const average = rates.reduce((s, r) => s + r, 0) / n;
    const result = new Map<string, number>();
    for (const [agentId, rate] of hourlyRates) {
        result.set(agentId, average > 0 ? rate / average : 0);
    }
    return result;
}

// --- Dollar wages ---

/**
 * Distribute total dollar wages across workers by weighted hours share.
 * dollar_wage[i] = total × (hours[i] × rate_norm[i]) / Σ(hours[j] × rate_norm[j])
 */
export function computeDollarWagesPerWorker(
    total_dollar_wages: number,
    hours_worked: Map<string, number>,
    wage_rate_normalized: Map<string, number>,
): Map<string, number> {
    const result = new Map<string, number>();
    let weightedSum = 0;
    for (const [agentId, hours] of hours_worked) {
        weightedSum += hours * (wage_rate_normalized.get(agentId) ?? 0);
    }
    for (const [agentId, hours] of hours_worked) {
        const weight = hours * (wage_rate_normalized.get(agentId) ?? 0);
        result.set(agentId, weightedSum > 0 ? total_dollar_wages * (weight / weightedSum) : 0);
    }
    return result;
}

// --- Validated hours ---

/**
 * validated_hours[i] = confirmed_output_fraction × hours_worked[i]
 */
export function computeValidatedHours(
    hours_worked: Map<string, number>,
    confirmed_output_fraction: number,
): Map<string, number> {
    const result = new Map<string, number>();
    for (const [agentId, hours] of hours_worked) {
        result.set(agentId, confirmed_output_fraction * hours);
    }
    return result;
}

// --- Claim capacity ---

/**
 * claim_capacity[i] = validated_hours[i] × (available_claimable_pool / total_social_svc)
 *                     + solidarity_supplement[i]
 */
export function computeClaimCapacities(
    validated_hours: Map<string, number>,
    available_claimable_pool: number,
    total_social_svc: number,
    solidarity_supplements: Map<string, number>,
): Map<string, number> {
    const result = new Map<string, number>();
    const svcRate = total_social_svc > 0 ? available_claimable_pool / total_social_svc : 0;
    for (const [agentId, hours] of validated_hours) {
        const supplement = solidarity_supplements.get(agentId) ?? 0;
        result.set(agentId, hours * svcRate + supplement);
    }
    return result;
}

// --- Communal coverage ---

/**
 * effective_net_market_wage = dollar_wage − uncovered_essential_expenses
 */
export function computeEffectiveNetMarketWage(
    dollar_wage: number,
    uncovered_essential_expenses: number,
): number {
    return dollar_wage - uncovered_essential_expenses;
}

// --- Purchasing power and real wages ---

/**
 * social_real_wage_per_hour = average_claim_per_validated_hour × claim_purchasing_power
 * market_real_wage_per_hour = average_dollar_wage_per_hour × dollar_purchasing_power
 */
export function computeRealWages(
    average_claim_per_validated_hour: number,
    average_dollar_wage_per_hour: number,
    pp: PurchasingPower,
): { social_real_wage_per_hour: number; market_real_wage_per_hour: number } {
    return {
        social_real_wage_per_hour: average_claim_per_validated_hour * pp.claim_purchasing_power,
        market_real_wage_per_hour: average_dollar_wage_per_hour * pp.dollar_purchasing_power,
    };
}

// --- Substitution ratio ---

/**
 * composition_ratio = (social_rw × confirmed_output_fraction) / market_rw
 *
 * Answers: per total hour worked, how do confirmed social goods compare to
 * federation dollar goods? Returns 0 when denominator is 0.
 */
export function computeSubstitutionRatio(
    social_real_wage_per_hour: number,
    confirmed_output_fraction: number,
    market_real_wage_per_hour: number,
): number {
    if (market_real_wage_per_hour === 0) return 0;
    return (social_real_wage_per_hour * confirmed_output_fraction) / market_real_wage_per_hour;
}

// --- Dollar wage phase-out factor ---

/**
 * Phase-out factor reduces formula-path wages as CSR approaches the policy target.
 * Returns 0 when CSR >= target (fully phased out), 1 when target = 0.
 */
export function computeDollarWagePhaseOutFactor(
    communal_satisfaction_ratio: number,
    target_communal_ratio: number,
): number {
    if (target_communal_ratio <= 0) return 1;
    return Math.max(0, 1 - communal_satisfaction_ratio / target_communal_ratio);
}

// --- Collective trade metrics ---

/**
 * Scope-level signals for the assembly deliberating on labor allocation between exports and local production.
 *
 * scope_net_external_contribution = market_revenue − market_input_cost − subsidy_received
 *   Positive: scope contributes net external currency to the federation fund.
 *   Negative: scope draws subsidies from the federation fund.
 */
export function computeCollectiveMetrics(
    market_revenue: number,
    market_input_cost: number,
    subsidy_received: number,
    avg_claim_capacity: number,
    avg_communal_coverage: number,
    claim_purchasing_power: number,
): { scope_net_external_contribution: number; local_provision_value_per_worker: number } {
    const scope_net_external_contribution = market_revenue - market_input_cost - subsidy_received;
    const local_provision_value_per_worker =
        avg_claim_capacity * claim_purchasing_power + avg_communal_coverage;
    return { scope_net_external_contribution, local_provision_value_per_worker };
}

// --- Communal satisfaction ratio ---

/**
 * total_social_value = (claim_capacity × claim_purchasing_power) + communal_need_coverage
 */
export function computeTotalSocialValue(
    claim_capacity: number,
    claim_purchasing_power: number,
    communal_need_coverage: number,
): number {
    return claim_capacity * claim_purchasing_power + communal_need_coverage;
}

/**
 * communal_satisfaction_ratio = total_social_value / effective_net_market_wage
 * Returns 0 when effective_net_market_wage ≤ 0.
 */
export function computeCommunalSatisfactionRatio(
    total_social_value: number,
    effective_net_market_wage: number,
): number {
    if (effective_net_market_wage <= 0) return 0;
    return total_social_value / effective_net_market_wage;
}

// --- Dollar solvency ---

/**
 * Scope-level dollar balance — dollar wages are a federation responsibility and
 * are excluded from the scope's own accounts.
 *
 * scope_balance = (market_revenue + social_cash_revenue + subsidy_received)
 *               − (market_input_cost + social_input_cash_cost
 *                  + other_costs + contribution_sent)
 */
export function computeDollarBalance(financials: ScopeFinancials): number {
    const inflows = financials.market_revenue
        + financials.social_cash_revenue
        + financials.subsidy_received;
    const outflows = financials.market_input_cost
        + financials.social_input_cash_cost
        + financials.other_costs
        + financials.contribution_sent;
    return inflows - outflows;
}

// =============================================================================
// Section 4 — Top-level assembler
// =============================================================================

/**
 * Compute the full scope transition report by calling all granular functions
 * in dependency order.
 */
export function computeScopeTransitionReport(
    config: ScopeTransitionConfig,
): ScopeTransitionReport {
    const {
        workEvents,
        inputConsumeEvents,
        socialInputConsumeEvents,
        outputEvents,
        socialOutputEvents,
        confirmedReceiptEvents,
        workerRates,
        communalCoverage,
        solidaritySupplements,
        available_claimable_pool,
        total_social_svc,
        purchasingPower,
        financials,
        target_communal_ratio,
    } = config;

    // 1. Extract hours per worker
    const hours_worked = extractWorkerHours(workEvents);

    // 2. Flow fractions (includes transition_depth, commitment_gap)
    const fractions = computeFlowFractions(
        inputConsumeEvents,
        socialInputConsumeEvents,
        outputEvents,
        socialOutputEvents,
        confirmedReceiptEvents,
    );

    // 3. Wage rate normalization (stored on per-worker state for display)
    const hourlyRatesMap = new Map<string, number>(
        workerRates.map(w => [w.agentId, w.hourly_rate]),
    );
    const wage_rate_normalized = computeWageRateNormalized(hourlyRatesMap);

    // 4. Validated hours (no dependency on dollar wages)
    const validated_hours = computeValidatedHours(hours_worked, fractions.confirmed_output_fraction);

    // 5. Claim capacities
    const claim_capacities = computeClaimCapacities(
        validated_hours,
        available_claimable_pool,
        total_social_svc,
        solidaritySupplements,
    );

    // 6. Communal coverage map (needed for per-worker states)
    const communalCoverageMap = new Map<string, WorkerCommunalCoverage>(
        communalCoverage.map(c => [c.agentId, c]),
    );

    // 7. Dollar wages: explicit rates (federation_hourly_dollar_rate × hours per worker)
    //    Phase-out factor is derived from CSR after per-worker states are built.
    const dollar_wages = new Map<string, number>();
    let total_dollar_wages = 0;
    let dollar_wage_phase_out_factor = 1;

    for (const [agentId, hours] of hours_worked) {
        const wage = hours * (hourlyRatesMap.get(agentId) ?? 0);
        dollar_wages.set(agentId, wage);
        total_dollar_wages += wage;
    }

    // 8. Scope aggregates
    const total_hours_worked = Array.from(hours_worked.values()).reduce((s, h) => s + h, 0);
    const total_validated_hours = Array.from(validated_hours.values()).reduce((s, h) => s + h, 0);
    const total_claims = Array.from(claim_capacities.values()).reduce((s, c) => s + c, 0);

    const average_dollar_wage_per_hour =
        total_hours_worked > 0 ? total_dollar_wages / total_hours_worked : 0;
    const average_claim_per_validated_hour =
        total_validated_hours > 0 ? total_claims / total_validated_hours : 0;

    // 9. Real wages
    const { social_real_wage_per_hour, market_real_wage_per_hour } = computeRealWages(
        average_claim_per_validated_hour,
        average_dollar_wage_per_hour,
        purchasingPower,
    );

    // 10. Composition ratio (social goods per confirmed hour vs. federation dollar goods per hour)
    const composition_ratio = computeSubstitutionRatio(
        social_real_wage_per_hour,
        fractions.confirmed_output_fraction,
        market_real_wage_per_hour,
    );

    // 11. Build per-worker states
    const workers: WorkerTransitionState[] = [];
    for (const [agentId, hours] of hours_worked) {
        const hourly_rate = hourlyRatesMap.get(agentId) ?? 0;
        const wageRateNorm = wage_rate_normalized.get(agentId) ?? 0;
        const validatedHrs = validated_hours.get(agentId) ?? 0;
        const dollarWage = dollar_wages.get(agentId) ?? 0;
        const claimCap = claim_capacities.get(agentId) ?? 0;
        const coverage = communalCoverageMap.get(agentId);
        const communalNeedCoverage = coverage?.communal_need_coverage ?? 0;
        const uncoveredExpenses = coverage?.uncovered_essential_expenses ?? 0;

        const effectiveNetMarketWage = computeEffectiveNetMarketWage(dollarWage, uncoveredExpenses);
        const totalSocialValue = computeTotalSocialValue(
            claimCap,
            purchasingPower.claim_purchasing_power,
            communalNeedCoverage,
        );
        const communalSatisfactionRatio = computeCommunalSatisfactionRatio(
            totalSocialValue,
            effectiveNetMarketWage,
        );

        const marketEntitlementValue = dollarWage * purchasingPower.dollar_purchasing_power;
        const totalRealEntitlement = totalSocialValue + marketEntitlementValue;
        const socialFractionOfEntitlement =
            totalRealEntitlement > 0 ? totalSocialValue / totalRealEntitlement : 0;

        workers.push({
            agentId,
            hours_worked: hours,
            hourly_rate,
            wage_rate_normalized: wageRateNorm,
            validated_hours: validatedHrs,
            dollar_wage: dollarWage,
            claim_capacity: claimCap,
            communal_need_coverage: communalNeedCoverage,
            uncovered_essential_expenses: uncoveredExpenses,
            effective_net_market_wage: effectiveNetMarketWage,
            total_social_value: totalSocialValue,
            communal_satisfaction_ratio: communalSatisfactionRatio,
            market_entitlement_value: marketEntitlementValue,
            total_real_entitlement: totalRealEntitlement,
            social_fraction_of_entitlement: socialFractionOfEntitlement,
        });
    }

    // 12. Scope-level communal_satisfaction_ratio (hours-weighted average)
    let weightedSatisfactionSum = 0;
    for (const w of workers) {
        weightedSatisfactionSum += w.communal_satisfaction_ratio * w.hours_worked;
    }
    const communal_satisfaction_ratio =
        total_hours_worked > 0 ? weightedSatisfactionSum / total_hours_worked : 0;

    // Derive phase-out factor from final CSR (report only; wages are the explicit federation rate)
    dollar_wage_phase_out_factor = computeDollarWagePhaseOutFactor(communal_satisfaction_ratio, target_communal_ratio);

    // 13. Scope solvency — wages are a federation cost; not included in scope balance
    const dollar_balance = computeDollarBalance(financials);

    // 14. Collective trade metrics
    const average_claim_capacity = total_claims / (workers.length || 1);
    const average_communal_need_coverage =
        workers.reduce((s, w) => s + w.communal_need_coverage, 0) / (workers.length || 1);
    const { scope_net_external_contribution, local_provision_value_per_worker } = computeCollectiveMetrics(
        financials.market_revenue,
        financials.market_input_cost,
        financials.subsidy_received,
        average_claim_capacity,
        average_communal_need_coverage,
        purchasingPower.claim_purchasing_power,
    );

    return {
        fractions,
        dollar_balance,
        is_solvent: dollar_balance >= 0,
        total_hours_worked,
        total_dollar_wages,
        total_validated_hours,
        average_dollar_wage_per_hour,
        average_claim_per_validated_hour,
        social_real_wage_per_hour,
        market_real_wage_per_hour,
        composition_ratio,
        communal_satisfaction_ratio,
        dollar_wage_phase_out_factor,
        scope_net_external_contribution,
        local_provision_value_per_worker,
        workers,
    };
}
