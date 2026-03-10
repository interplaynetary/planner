import type { TemporalExpression } from '$lib/utils/time';

export type PolicyFactorType = 'per_member' | 'fixed';

export interface CommuneDemandPolicy {
    id: string;
    name: string;
    specId: string;
    unit: string;
    factorType: PolicyFactorType;
    qtyPerMember?: number;   // used when factorType === 'per_member'
    fixedQty?: number;       // used when factorType === 'fixed'
    note?: string;
    availability_window?: TemporalExpression;
}

export interface CommunalDemandEntry {
    policyId: string;
    policyName: string;
    specId: string;
    unit: string;
    factorType: PolicyFactorType;
    memberCount: number;
    derivedQty: number;
    qtyPerMember?: number;   // raw per-member quantity (for formula label display)
    formulaLabel: string;    // "10 doses × 5 members = 50 doses"
    availability_window?: TemporalExpression;
}

export type DerivedDependentFactorType = 'replenishment_rate' | 'buffer_fraction' | 'fixed';

export interface DerivedDependentPolicy {
    id: string;
    specId: string;
    unit: string;
    factorType: DerivedDependentFactorType;
    rate?: number;      // 0–1: fraction of consumed/independent qty
    fixedQty?: number;  // used when factorType === 'fixed'
    note?: string;
}

export function deriveDependentDemand(
    policy: DerivedDependentPolicy,
    dependentTotal: number,
    independentTotal: number,
): { qty: number; formulaLabel: string } {
    if (policy.factorType === 'replenishment_rate') {
        const qty = (policy.rate ?? 0) * dependentTotal;
        return { qty, formulaLabel: `${((policy.rate ?? 0) * 100).toFixed(0)}% × ${dependentTotal} ${policy.unit} dependent = ${qty.toFixed(1)} ${policy.unit}` };
    }
    if (policy.factorType === 'buffer_fraction') {
        const qty = (policy.rate ?? 0) * independentTotal;
        return { qty, formulaLabel: `${((policy.rate ?? 0) * 100).toFixed(0)}% × ${independentTotal} ${policy.unit} independent = ${qty.toFixed(1)} ${policy.unit}` };
    }
    const qty = policy.fixedQty ?? 0;
    return { qty, formulaLabel: `${qty} ${policy.unit} (fixed)` };
}

export function deriveCommunalDemand(
    policies: CommuneDemandPolicy[],
    memberCount: number,
): CommunalDemandEntry[] {
    return policies.map(p => {
        let derivedQty: number;
        let formulaLabel: string;

        if (p.factorType === 'per_member') {
            const qpm = p.qtyPerMember ?? 0;
            derivedQty = qpm * memberCount;
            formulaLabel = `${qpm} ${p.unit} × ${memberCount} members = ${derivedQty} ${p.unit}`;
        } else {
            derivedQty = p.fixedQty ?? 0;
            formulaLabel = `${derivedQty} ${p.unit} (fixed)`;
        }

        return {
            policyId: p.id,
            policyName: p.name,
            specId: p.specId,
            unit: p.unit,
            factorType: p.factorType,
            memberCount,
            derivedQty,
            qtyPerMember: p.qtyPerMember,
            formulaLabel,
            availability_window: p.availability_window,
        };
    });
}
