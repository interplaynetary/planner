/**
 * Planning — Instantiate recipes into scheduled Plans.
 *
 * The full VF lifecycle:
 *   Recipe (template) → Plan (schedule) → Events (observation)
 *
 * Key VF subtleties captured:
 *
 *   1. INTENTS vs COMMITMENTS
 *      - Intent: unilateral desire (provider OR receiver, not both)
 *      - Commitment: bilateral agreement (provider AND receiver)
 *      - Events either fulfill Commitments, or satisfy Intents directly
 *      - Intents can be published via Proposals for matching
 *
 *   2. RECIPE EXCHANGES
 *      - Recipes include RecipeExchange nodes (not just processes)
 *      - RecipeExchange → Agreement + reciprocal Commitments
 *
 *   3. SHARED PROCESSES
 *      - Process is the SAME instance in planning and observation
 *      - Uses shared ProcessRegistry, not a local map
 *
 *   4. PROPOSALS
 *      - Publish Intents (offers/requests) for matching
 *      - Primary + reciprocal intents grouped together
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import type {
    Plan,
    Process,
    Commitment,
    Intent,
    Claim,
    Measure,
    RecipeFlow,
    RecipeProcess,
    Agreement,
    AgreementBundle,
    Proposal,
    ProposalList,
    Scenario,
    ScenarioDefinition,
    VfAction,
} from '../schemas';
import { ACTION_DEFINITIONS } from '../schemas';
import type { TemporalExpression } from '../utils/time';
import { RecipeStore } from '../knowledge/recipes';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';

// =============================================================================
// SHARED CONSTANTS
// =============================================================================

/** Canonical tag strings used on planning Intents and ResourceSpecs. */
/** ProcessSpecification ID for planning processes (VF traceability). */
export const PLANNING_PROCESS_SPEC = 'spec:planning';

export const PLAN_TAGS = {
    DEFICIT: 'tag:plan:deficit',
    SURPLUS: 'tag:plan:surplus',
    LATERAL_TRANSFER: 'tag:plan:lateral-transfer',
    METABOLIC_DEBT: 'tag:plan:metabolic-debt',
    CONSERVATION: 'tag:plan:conservation',
    REPLENISHMENT: 'tag:plan:replenishment',
    SOFT_ALLOCATION: 'tag:plan:soft-allocation',
    BUFFER_RESERVATION: 'tag:plan:buffer-reservation',
} as const;

/** VF actions that do not consume inventory (no quantity decrement). */
export const NON_CONSUMING_ACTIONS = new Set(['use', 'work', 'cite', 'deliverService']);

// =============================================================================
// SIGNAL INTENT HELPERS
// =============================================================================

/** Current remaining shortfall on a deficit Intent. */
export function deficitShortfall(i: Intent): number {
    return i.resourceQuantity?.hasNumericalValue ?? 0;
}

/** True when the deficit was fully resolved (shortfall reduced to 0 from a positive original). */
export function isDeficitResolved(i: Intent, planStore: PlanStore): boolean {
    const meta = planStore.getMetaOfKind(i.id, 'deficit');
    return deficitShortfall(i) === 0 && (meta?.originalShortfall ?? 0) > 0;
}

/** Read the provider scope from a lateral-transfer Intent or Commitment. */
export function tradeFrom(t: { provider?: string }): string { return t.provider ?? ''; }

/** Read the receiver scope from a lateral-transfer Intent or Commitment. */
export function tradeTo(t: { receiver?: string; inScopeOf?: string[] }): string { return t.receiver ?? t.inScopeOf?.[0] ?? ''; }

/** Read the resource spec from a lateral-transfer Intent or Commitment. */
export function tradeSpec(t: { resourceConformsTo?: string }): string { return t.resourceConformsTo ?? ''; }

/** Read the quantity from a lateral-transfer Intent or Commitment. */
export function tradeQty(t: { resourceQuantity?: { hasNumericalValue: number } }): number { return t.resourceQuantity?.hasNumericalValue ?? 0; }

// =============================================================================
// TYPED SIGNAL METADATA
// =============================================================================

export const DeficitMetaSchema = z.object({
    kind: z.literal('deficit'),
    originalShortfall: z.number(),
    resolvedAt: z.array(z.string()),
});
export type DeficitMeta = z.infer<typeof DeficitMetaSchema>;

export const ConservationMetaSchema = z.object({
    kind: z.literal('conservation'),
    onhand: z.number(), tor: z.number(), toy: z.number(), tog: z.number(),
    zone: z.enum(['red', 'yellow']),
    tippingPointBreached: z.boolean().optional(),
});
export type ConservationMeta = z.infer<typeof ConservationMetaSchema>;

export const ReplenishmentMetaSchema = z.object({
    kind: z.literal('replenishment'),
    onhand: z.number(), onorder: z.number(), qualifiedDemand: z.number(), nfp: z.number(),
    priority: z.number(), zone: z.enum(['red', 'yellow', 'green', 'excess']),
    recommendedQty: z.number(), dueDate: z.string(),
    bufferZoneId: z.string(), createdAt: z.string(),
    status: z.enum(['open', 'approved', 'rejected']),
    approvedCommitmentId: z.string().optional(),
});
export type ReplenishmentMeta = z.infer<typeof ReplenishmentMetaSchema>;

export const PlanningMetaSchema = z.object({
    kind: z.literal('planning'),
    processId: z.string(),
    demandInputIds: z.array(z.string()),   // demand Intent IDs consumed
});
export type PlanningMeta = z.infer<typeof PlanningMetaSchema>;

export const SignalMetaSchema = z.discriminatedUnion('kind', [
    DeficitMetaSchema,
    ConservationMetaSchema,
    ReplenishmentMetaSchema,
    PlanningMetaSchema,
]);
export type SignalMeta = z.infer<typeof SignalMetaSchema>;

/** Type predicate: narrows SignalMeta to a specific kind variant. */
export function isMetaOfKind<K extends SignalMeta['kind']>(
    meta: SignalMeta | undefined,
    kind: K,
): meta is Extract<SignalMeta, { kind: K }> {
    return meta?.kind === kind;
}

// =============================================================================
// SIGNAL ALGEBRA — typed PlanSignal discriminated union
// =============================================================================

export const DeficitSignalSchema = z.object({
    kind: z.literal('deficit'),
    specId: z.string(), qty: z.number(), unit: z.string(),
    scope: z.string().optional(), originalShortfall: z.number(), resolvedAt: z.array(z.string()),
    due: z.string().optional(), location: z.string().optional(),
    source: z.enum(['unmet_demand', 'metabolic_debt']).optional(),
});
export type DeficitSignal = z.infer<typeof DeficitSignalSchema>;

export const SurplusSignalSchema = z.object({
    kind: z.literal('surplus'),
    specId: z.string(), qty: z.number(), unit: z.string(),
    scope: z.string().optional(), availableFrom: z.string().optional(), location: z.string().optional(),
});
export type SurplusSignal = z.infer<typeof SurplusSignalSchema>;

export const ConservationSignalSchema = z.object({
    kind: z.literal('conservation'),
    specId: z.string(), scope: z.string().optional(),
    onhand: z.number(), tor: z.number(), toy: z.number(), tog: z.number(),
    zone: z.enum(['red', 'yellow']), tippingPointBreached: z.boolean().optional(),
});
export type ConservationSignal = z.infer<typeof ConservationSignalSchema>;

export const ReplenishmentPlanSignalSchema = z.object({
    kind: z.literal('replenishment'),
    specId: z.string(), qty: z.number(), unit: z.string(),
    onhand: z.number(), onorder: z.number(), qualifiedDemand: z.number(), nfp: z.number(),
    priority: z.number(), zone: z.enum(['red', 'yellow', 'green', 'excess']),
    dueDate: z.string(), bufferZoneId: z.string(),
});
export type ReplenishmentPlanSignal = z.infer<typeof ReplenishmentPlanSignalSchema>;

export const PlanSignalSchema = z.discriminatedUnion('kind', [
    DeficitSignalSchema,
    SurplusSignalSchema,
    ConservationSignalSchema,
    ReplenishmentPlanSignalSchema,
]);
export type PlanSignal = z.infer<typeof PlanSignalSchema>;

const SIGNAL_KIND_TO_TAG: Record<PlanSignal['kind'], string> = {
    deficit: PLAN_TAGS.DEFICIT,
    surplus: PLAN_TAGS.SURPLUS,
    conservation: PLAN_TAGS.CONSERVATION,
    replenishment: PLAN_TAGS.REPLENISHMENT,
};

const TAG_TO_SIGNAL_KIND: Record<string, PlanSignal['kind']> = {
    [PLAN_TAGS.DEFICIT]: 'deficit',
    [PLAN_TAGS.SURPLUS]: 'surplus',
    [PLAN_TAGS.CONSERVATION]: 'conservation',
    [PLAN_TAGS.REPLENISHMENT]: 'replenishment',
};

/** Convert a typed PlanSignal into Intent fields + metadata for PlanStore. */
export function signalToIntent(
    signal: PlanSignal,
    planId: string,
): { intentFields: Omit<Intent, 'id'> & { id?: string }; meta: SignalMeta } {
    const tag = SIGNAL_KIND_TO_TAG[signal.kind];
    switch (signal.kind) {
        case 'deficit': {
            const tags = [tag, ...(signal.source === 'metabolic_debt' ? [PLAN_TAGS.METABOLIC_DEBT] : [])];
            return {
                intentFields: {
                    action: 'transfer',
                    resourceConformsTo: signal.specId,
                    resourceQuantity: { hasNumericalValue: signal.qty, hasUnit: signal.unit },
                    due: signal.due,
                    atLocation: signal.location,
                    inScopeOf: signal.scope ? [signal.scope] : undefined,
                    plannedWithin: planId,
                    resourceClassifiedAs: tags,
                    finished: false,
                },
                meta: {
                    kind: 'deficit',
                    originalShortfall: signal.originalShortfall,
                    resolvedAt: signal.resolvedAt,
                },
            };
        }
        case 'surplus': {
            return {
                intentFields: {
                    action: 'transfer',
                    provider: signal.scope,
                    resourceConformsTo: signal.specId,
                    resourceQuantity: { hasNumericalValue: signal.qty, hasUnit: signal.unit },
                    hasPointInTime: signal.availableFrom,
                    atLocation: signal.location,
                    plannedWithin: planId,
                    resourceClassifiedAs: [tag],
                    finished: false,
                },
                meta: { kind: 'planning', processId: '', demandInputIds: [] },
            };
        }
        case 'conservation': {
            return {
                intentFields: {
                    action: 'cite',
                    resourceConformsTo: signal.specId,
                    resourceClassifiedAs: [tag],
                    plannedWithin: planId,
                    finished: false,
                },
                meta: {
                    kind: 'conservation',
                    onhand: signal.onhand, tor: signal.tor,
                    toy: signal.toy, tog: signal.tog,
                    zone: signal.zone,
                    tippingPointBreached: signal.tippingPointBreached,
                },
            };
        }
        case 'replenishment': {
            return {
                intentFields: {
                    action: 'produce',
                    resourceConformsTo: signal.specId,
                    resourceQuantity: { hasNumericalValue: signal.qty, hasUnit: signal.unit },
                    due: signal.dueDate + 'T00:00:00.000Z',
                    resourceClassifiedAs: [tag],
                    plannedWithin: planId,
                    finished: false,
                },
                meta: {
                    kind: 'replenishment',
                    onhand: signal.onhand, onorder: signal.onorder,
                    qualifiedDemand: signal.qualifiedDemand, nfp: signal.nfp,
                    priority: signal.priority, zone: signal.zone,
                    recommendedQty: signal.qty, dueDate: signal.dueDate,
                    bufferZoneId: signal.bufferZoneId,
                    createdAt: new Date().toISOString(),
                    status: 'open',
                },
            };
        }
    }
}

/** Convert an Intent + metadata back to a typed PlanSignal, or null if not a signal. */
export function intentToSignal(intent: Intent, meta: SignalMeta | undefined): PlanSignal | null {
    const tags = intent.resourceClassifiedAs ?? [];
    let kind: PlanSignal['kind'] | undefined;
    for (const t of tags) {
        if (TAG_TO_SIGNAL_KIND[t]) { kind = TAG_TO_SIGNAL_KIND[t]; break; }
    }
    if (!kind) return null;

    switch (kind) {
        case 'deficit': {
            const dm = isMetaOfKind(meta, 'deficit') ? meta : undefined;
            return {
                kind: 'deficit',
                specId: intent.resourceConformsTo ?? '',
                qty: intent.resourceQuantity?.hasNumericalValue ?? 0,
                unit: intent.resourceQuantity?.hasUnit ?? 'unit',
                scope: intent.inScopeOf?.[0],
                originalShortfall: dm?.originalShortfall ?? intent.resourceQuantity?.hasNumericalValue ?? 0,
                resolvedAt: dm?.resolvedAt ?? [],
                due: intent.due,
                location: intent.atLocation,
                source: tags.includes(PLAN_TAGS.METABOLIC_DEBT) ? 'metabolic_debt' : 'unmet_demand',
            };
        }
        case 'surplus': {
            return {
                kind: 'surplus',
                specId: intent.resourceConformsTo ?? '',
                qty: intent.resourceQuantity?.hasNumericalValue ?? 0,
                unit: intent.resourceQuantity?.hasUnit ?? 'unit',
                scope: intent.provider,
                availableFrom: intent.hasPointInTime,
                location: intent.atLocation,
            };
        }
        case 'conservation': {
            const cm = isMetaOfKind(meta, 'conservation') ? meta : undefined;
            if (!cm) return null;
            return {
                kind: 'conservation',
                specId: intent.resourceConformsTo ?? '',
                scope: intent.inScopeOf?.[0],
                onhand: cm.onhand, tor: cm.tor, toy: cm.toy, tog: cm.tog,
                zone: cm.zone,
                tippingPointBreached: cm.tippingPointBreached,
            };
        }
        case 'replenishment': {
            const rm = isMetaOfKind(meta, 'replenishment') ? meta : undefined;
            if (!rm) return null;
            return {
                kind: 'replenishment',
                specId: intent.resourceConformsTo ?? '',
                qty: intent.resourceQuantity?.hasNumericalValue ?? 0,
                unit: intent.resourceQuantity?.hasUnit ?? 'unit',
                onhand: rm.onhand, onorder: rm.onorder,
                qualifiedDemand: rm.qualifiedDemand, nfp: rm.nfp,
                priority: rm.priority, zone: rm.zone,
                dueDate: rm.dueDate, bufferZoneId: rm.bufferZoneId,
            };
        }
    }
}

// =============================================================================
// ECONOMIC CONTEXT
// =============================================================================

/** Bundles the 4 stores passed to every algorithm function. */
export interface EconomicContext {
    recipeStore: RecipeStore;
    planStore: PlanStore;
    processes: ProcessRegistry;
    observer?: Observer;
}

// =============================================================================
// PLAN STORE
// =============================================================================

export class PlanStore {
    private plans = new Map<string, Plan>();
    private commitments = new Map<string, Commitment>();
    private intents = new Map<string, Intent>();
    private claims = new Map<string, Claim>();
    private agreements = new Map<string, Agreement>();
    private agreementBundles = new Map<string, AgreementBundle>();
    private proposals = new Map<string, Proposal>();
    private proposalLists = new Map<string, ProposalList>();
    private scenarios = new Map<string, Scenario>();
    private scenarioDefinitions = new Map<string, ScenarioDefinition>();
    private _meta = new Map<string, SignalMeta>();

    // Secondary indexes — maintained on add/remove/merge for O(k) lookups
    private _tagIndex = new Map<string, Set<string>>();
    private _intentsBySpec = new Map<string, Set<string>>();
    private _commitmentsBySpec = new Map<string, Set<string>>();

    constructor(
        readonly processes: ProcessRegistry,
        private generateId: () => string = () => nanoid(),
    ) {}

    // =========================================================================
    // CRUD — Plans
    // =========================================================================

    addPlan(plan: Omit<Plan, 'id'> & { id?: string }): Plan {
        const p: Plan = { id: plan.id ?? this.generateId(), ...plan };
        this.plans.set(p.id, p);
        return p;
    }

    getPlan(id: string): Plan | undefined { return this.plans.get(id); }
    allPlans(): Plan[] { return Array.from(this.plans.values()); }

    // =========================================================================
    // CRUD — Commitments
    // =========================================================================

    addCommitment(commitment: Omit<Commitment, 'id'> & { id?: string }): Commitment {
        const c: Commitment = { id: commitment.id ?? this.generateId(), ...commitment };
        this.commitments.set(c.id, c);
        // Maintain spec index
        if (c.resourceConformsTo) {
            let set = this._commitmentsBySpec.get(c.resourceConformsTo);
            if (!set) { set = new Set(); this._commitmentsBySpec.set(c.resourceConformsTo, set); }
            set.add(c.id);
        }
        return c;
    }

    getCommitment(id: string): Commitment | undefined { return this.commitments.get(id); }

    allCommitments(): Commitment[] { return Array.from(this.commitments.values()); }

    commitmentsForProcess(processId: string): Commitment[] {
        return Array.from(this.commitments.values())
            .filter(c => c.inputOf === processId || c.outputOf === processId);
    }

    commitmentsForAgreement(agreementId: string): Commitment[] {
        return Array.from(this.commitments.values())
            .filter(c => c.clauseOf === agreementId);
    }

    commitmentsForPlan(planId: string): Commitment[] {
        return Array.from(this.commitments.values())
            .filter(c => c.plannedWithin === planId);
    }

    // =========================================================================
    // CRUD — Intents
    // =========================================================================

    /**
     * Create an Intent.
     *
     * VF rule: An Intent has a provider OR a receiver, but not both initially.
     * Provider means "I will provide this" (offer).
     * Receiver means "I need this" (request).
     */
    addIntent(intent: Omit<Intent, 'id'> & { id?: string }): Intent {
        if (intent.provider && intent.receiver) {
            throw new Error(
                `VF constraint violation: Intent cannot have both provider and receiver. ` +
                `Use addCommitment() for bilateral flows.`
            );
        }
        const i: Intent = { id: intent.id ?? this.generateId(), ...intent };
        this.intents.set(i.id, i);
        // Maintain tag index
        if (i.resourceClassifiedAs) {
            for (const tag of i.resourceClassifiedAs) {
                let set = this._tagIndex.get(tag);
                if (!set) { set = new Set(); this._tagIndex.set(tag, set); }
                set.add(i.id);
            }
        }
        // Maintain spec index
        if (i.resourceConformsTo) {
            let set = this._intentsBySpec.get(i.resourceConformsTo);
            if (!set) { set = new Set(); this._intentsBySpec.set(i.resourceConformsTo, set); }
            set.add(i.id);
        }
        return i;
    }

    getIntent(id: string): Intent | undefined { return this.intents.get(id); }

    allIntents(): Intent[] { return Array.from(this.intents.values()); }

    intentsForPlan(planId: string): Intent[] {
        return Array.from(this.intents.values())
            .filter(i => i.plannedWithin === planId);
    }

    /**
     * Get all open (unfinished) intents.
     */
    openIntents(): Intent[] {
        return Array.from(this.intents.values()).filter(i => !i.finished);
    }

    /**
     * Get all intents classified with a given tag.
     * Used to query signal artifacts (tag:plan:deficit, tag:plan:surplus, tag:plan:lateral-transfer, etc.)
     */
    intentsForTag(tag: string): Intent[] {
        const ids = this._tagIndex.get(tag);
        if (!ids) return [];
        const result: Intent[] = [];
        for (const id of ids) {
            const intent = this.intents.get(id);
            if (intent) result.push(intent);
        }
        return result;
    }

    /** Get all intents conforming to a given resource specification. O(k_spec). */
    intentsForSpec(specId: string): Intent[] {
        const ids = this._intentsBySpec.get(specId);
        if (!ids) return [];
        const result: Intent[] = [];
        for (const id of ids) {
            const intent = this.intents.get(id);
            if (intent) result.push(intent);
        }
        return result;
    }

    /** Get all commitments conforming to a given resource specification. O(k_spec). */
    commitmentsForSpec(specId: string): Commitment[] {
        const ids = this._commitmentsBySpec.get(specId);
        if (!ids) return [];
        const result: Commitment[] = [];
        for (const id of ids) {
            const commitment = this.commitments.get(id);
            if (commitment) result.push(commitment);
        }
        return result;
    }

    /** Return all signal Intents that are outputs of the given planning Process. */
    signalOutputsOfProcess(processId: string): Intent[] {
        return Array.from(this.intents.values()).filter(i =>
            i.outputOf === processId &&
            i.resourceClassifiedAs?.some(t => t.startsWith('tag:plan:'))
        );
    }

    /**
     * Get all offers (intents with a provider but no receiver).
     */
    offers(): Intent[] {
        return Array.from(this.intents.values())
            .filter(i => i.provider && !i.receiver && !i.finished);
    }

    /**
     * Get all requests (intents with a receiver but no provider).
     */
    requests(): Intent[] {
        return Array.from(this.intents.values())
            .filter(i => i.receiver && !i.provider && !i.finished);
    }

    // =========================================================================
    // SIGNAL METADATA
    // =========================================================================

    setMeta(intentId: string, meta: SignalMeta): void { this._meta.set(intentId, meta); }
    getMeta(intentId: string): SignalMeta | undefined { return this._meta.get(intentId); }
    allMeta(): ReadonlyMap<string, SignalMeta> { return this._meta; }

    /** Type-safe metadata accessor: returns the meta only if it matches the requested kind. */
    getMetaOfKind<K extends SignalMeta['kind']>(intentId: string, kind: K): Extract<SignalMeta, { kind: K }> | undefined {
        const meta = this._meta.get(intentId);
        if (isMetaOfKind(meta, kind)) return meta;
        return undefined;
    }

    // =========================================================================
    // SIGNAL ALGEBRA — typed emit / query
    // =========================================================================

    /** Emit a typed PlanSignal as a VF Intent with metadata. */
    emitSignal(signal: PlanSignal, planId: string): Intent {
        const { intentFields, meta } = signalToIntent(signal, planId);
        const added = this.addIntent(intentFields);
        this.setMeta(added.id, meta);
        return added;
    }

    /** Query all signals of a given kind, returned as typed PlanSignal objects. */
    signalsOfKind<K extends PlanSignal['kind']>(kind: K): Extract<PlanSignal, { kind: K }>[] {
        const tag = SIGNAL_KIND_TO_TAG[kind];
        return this.intentsForTag(tag)
            .map(i => intentToSignal(i, this.getMeta(i.id)))
            .filter((s): s is Extract<PlanSignal, { kind: K }> => s?.kind === kind);
    }

    // =========================================================================
    // BULK OPERATIONS — merge / retract
    // =========================================================================

    /** All processes registered in the shared ProcessRegistry. */
    allProcesses(): Process[] { return this.processes.all(); }

    /**
     * Import all records from a sub-PlanStore into this one.
     * Caller is responsible for ensuring disjoint IDs.
     */
    merge(sub: PlanStore): void {
        for (const proc of sub.allProcesses()) this.processes.register(proc);
        for (const c of sub.allCommitments()) {
            this.commitments.set(c.id, c);
            if (c.resourceConformsTo) {
                let set = this._commitmentsBySpec.get(c.resourceConformsTo);
                if (!set) { set = new Set(); this._commitmentsBySpec.set(c.resourceConformsTo, set); }
                set.add(c.id);
            }
        }
        for (const i of sub.allIntents()) {
            this.intents.set(i.id, i);
            if (i.resourceClassifiedAs) {
                for (const tag of i.resourceClassifiedAs) {
                    let set = this._tagIndex.get(tag);
                    if (!set) { set = new Set(); this._tagIndex.set(tag, set); }
                    set.add(i.id);
                }
            }
            if (i.resourceConformsTo) {
                let set = this._intentsBySpec.get(i.resourceConformsTo);
                if (!set) { set = new Set(); this._intentsBySpec.set(i.resourceConformsTo, set); }
                set.add(i.id);
            }
        }
        for (const p of sub.allPlans()) this.plans.set(p.id, p);
        for (const [id, meta] of sub.allMeta()) this._meta.set(id, meta);
    }

    /**
     * Batch-delete records by ID. Used by backtracking and surgical retraction.
     * Missing IDs are silently ignored.
     */
    removeRecords(ids: {
        processIds?: string[];
        commitmentIds?: string[];
        intentIds?: string[];
    }): void {
        for (const id of ids.processIds ?? []) this.processes.unregister(id);
        for (const id of ids.commitmentIds ?? []) {
            const c = this.commitments.get(id);
            if (c?.resourceConformsTo) {
                this._commitmentsBySpec.get(c.resourceConformsTo)?.delete(id);
            }
            this.commitments.delete(id);
        }
        for (const id of ids.intentIds ?? []) {
            const i = this.intents.get(id);
            if (i) {
                if (i.resourceClassifiedAs) {
                    for (const tag of i.resourceClassifiedAs) {
                        this._tagIndex.get(tag)?.delete(id);
                    }
                }
                if (i.resourceConformsTo) {
                    this._intentsBySpec.get(i.resourceConformsTo)?.delete(id);
                }
            }
            this.intents.delete(id);
            this._meta.delete(id);
        }
    }

    removeRecordsForPlan(planId: string): void {
        for (const p of this.processes.forPlan(planId)) this.processes.unregister(p.id);
        for (const c of this.commitmentsForPlan(planId)) {
            if (c.resourceConformsTo) {
                this._commitmentsBySpec.get(c.resourceConformsTo)?.delete(c.id);
            }
            this.commitments.delete(c.id);
        }
        for (const i of this.intentsForPlan(planId)) {
            if (i.resourceClassifiedAs) {
                for (const tag of i.resourceClassifiedAs) {
                    this._tagIndex.get(tag)?.delete(i.id);
                }
            }
            if (i.resourceConformsTo) {
                this._intentsBySpec.get(i.resourceConformsTo)?.delete(i.id);
            }
            this.intents.delete(i.id);
        }
    }

    // =========================================================================
    // CRUD — Claims
    // =========================================================================

    /**
     * Add a Claim — a receiver-initiated obligation triggered by an event.
     * Typically auto-created after recording the triggering EconomicEvent.
     * The `triggeredBy` field links back to the event that generated this claim.
     */
    addClaim(claim: Omit<Claim, 'id'> & { id?: string }): Claim {
        const c: Claim = { id: claim.id ?? this.generateId(), ...claim };
        this.claims.set(c.id, c);
        return c;
    }

    getClaim(id: string): Claim | undefined { return this.claims.get(id); }

    allClaims(): Claim[] { return Array.from(this.claims.values()); }

    /** Claims where agentId is provider or receiver. */
    claimsForAgent(agentId: string): Claim[] {
        return Array.from(this.claims.values()).filter(c =>
            c.provider === agentId || c.receiver === agentId,
        );
    }

    // =========================================================================
    // CRUD — Intent promotion
    // =========================================================================

    /**
     * Promote an Intent to a Commitment.
     *
     * When an Intent finds its match (offer meets request), the two agents
     * agree and the Intent becomes a Commitment with both provider and receiver.
     * The Commitment's `satisfies` field links back to the Intent.
     */
    promoteToCommitment(
        intentId: string,
        counterparty: { provider?: string; receiver?: string },
        observer?: Observer,
    ): Commitment {
        const intent = this.intents.get(intentId);
        if (!intent) throw new Error(`Intent ${intentId} not found`);

        const provider = intent.provider ?? counterparty.provider;
        const receiver = intent.receiver ?? counterparty.receiver;
        if (!provider || !receiver) {
            throw new Error(`Cannot promote: need both provider and receiver`);
        }

        // --- minimumQuantity validation ---
        const committedQty = intent.resourceQuantity ?? intent.effortQuantity;
        if (intent.minimumQuantity && committedQty) {
            if (committedQty.hasNumericalValue < intent.minimumQuantity.hasNumericalValue) {
                throw new Error(
                    `Quantity ${committedQty.hasNumericalValue} is below minimum ` +
                    `${intent.minimumQuantity.hasNumericalValue} ${intent.minimumQuantity.hasUnit} ` +
                    `for Intent ${intentId}`,
                );
            }
        }

        // --- availableQuantity check (no mutation yet — ATP gate must pass first) ---
        if (intent.availableQuantity && committedQty) {
            if (committedQty.hasNumericalValue > intent.availableQuantity.hasNumericalValue) {
                throw new Error(
                    `Requested quantity ${committedQty.hasNumericalValue} exceeds available ` +
                    `${intent.availableQuantity.hasNumericalValue} ${intent.availableQuantity.hasUnit} ` +
                    `for Intent ${intentId}`,
                );
            }
        }

        // --- Capacity ATP gate: prevent overcommitment of agent capacity ---
        // The action type 'work' is the discriminator — no tags needed.
        // unitOfEffort on the resource confirms it's a capacity resource.
        if (observer && intent.action === 'work' && intent.resourceInventoriedAs) {
            const capacityResource = observer.getResource(intent.resourceInventoriedAs);
            if (capacityResource?.unitOfEffort) {
                const onhand = capacityResource.onhandQuantity?.hasNumericalValue ?? 0;
                const effortQty = committedQty?.hasNumericalValue ?? 0;
                const alreadyCommitted = this.allCommitments()
                    .filter(c =>
                        c.action === 'work' &&
                        c.resourceInventoriedAs === intent.resourceInventoriedAs &&
                        !c.finished,
                    )
                    .reduce((sum, c) => sum + (c.effortQuantity?.hasNumericalValue ?? 0), 0);

                if (alreadyCommitted + effortQty > onhand) {
                    throw new Error(
                        `Capacity overcommitment: ${effortQty} hours would exceed ` +
                        `${capacityResource.id} on-hand ${onhand} hours ` +
                        `(${alreadyCommitted} already committed)`,
                    );
                }
            }
        }

        // --- availableQuantity decrement (all validation passed) ---
        if (intent.availableQuantity && committedQty) {
            intent.availableQuantity.hasNumericalValue -= committedQty.hasNumericalValue;
        }

        const commitment = this.addCommitment({
            action: intent.action,
            inputOf: intent.inputOf,
            outputOf: intent.outputOf,
            resourceInventoriedAs: intent.resourceInventoriedAs,
            resourceConformsTo: intent.resourceConformsTo,
            resourceClassifiedAs: intent.resourceClassifiedAs,
            resourceQuantity: intent.resourceQuantity,
            effortQuantity: intent.effortQuantity,
            stage: intent.stage,
            state: intent.state,
            provider,
            receiver,
            atLocation: intent.atLocation,
            due: intent.due,
            hasBeginning: intent.hasBeginning,
            hasEnd: intent.hasEnd,
            hasPointInTime: intent.hasPointInTime,
            plannedWithin: intent.plannedWithin,
            satisfies: intentId,
            availability_window: intent.availability_window,
            finished: false,
        });

        // Mark intent as satisfied only when it is NOT recurring.
        // If availableQuantity is tracked, only finish when it's depleted.
        // A recurring Intent (availability_window set) always stays open.
        if (!intent.availability_window) {
            const depleted = !intent.availableQuantity ||
                intent.availableQuantity.hasNumericalValue <= 0;
            if (depleted) intent.finished = true;
        }

        return commitment;
    }

    /**
     * Approve a replenishment Intent (tag:plan:replenishment) → Commitment.
     *
     * This is the VF-native approval path. The replenishment Intent was emitted
     * during planning when a buffer entered red/yellow zone. Approval promotes it
     * to a bilateral Commitment via the standard Intent → Commitment lifecycle.
     *
     * The Intent's note is updated with status='approved' and the commitment ID
     * for audit trail. The Intent is marked finished.
     *
     * @param intentId  ID of the replenishment Intent to approve
     * @param provider  Agent ID providing the supply
     * @param receiver  Agent ID receiving the supply
     * @param opts      Optional: action override, outputOf, plannedWithin
     */
    approveReplenishment(
        intentId: string,
        provider: string,
        receiver: string,
        opts?: {
            action?: VfAction;
            outputOf?: string;
            plannedWithin?: string;
        },
    ): Commitment {
        const intent = this.intents.get(intentId);
        if (!intent) throw new Error(`Replenishment Intent ${intentId} not found`);
        if (intent.finished) {
            throw new Error(`Replenishment Intent ${intentId} is already finished`);
        }
        if (!intent.resourceClassifiedAs?.includes(PLAN_TAGS.REPLENISHMENT)) {
            throw new Error(`Intent ${intentId} is not a replenishment signal`);
        }

        // Override the action if specified (MO=produce, PO=transfer, TO=transferCustody)
        const action = opts?.action ?? intent.action;

        const commitment = this.addCommitment({
            action,
            resourceConformsTo: intent.resourceConformsTo,
            resourceQuantity: intent.resourceQuantity,
            due: intent.due,
            ...(intent.atLocation ? { atLocation: intent.atLocation } : {}),
            provider,
            receiver,
            ...(opts?.outputOf ? { outputOf: opts.outputOf } : {}),
            ...(opts?.plannedWithin ? { plannedWithin: opts.plannedWithin } : {}),
            satisfies: intentId,
            finished: false,
        });

        // Update meta with approval status, mark finished
        const meta = this.getMetaOfKind(intentId, 'replenishment');
        if (meta) {
            meta.status = 'approved';
            meta.approvedCommitmentId = commitment.id;
        }
        intent.finished = true;

        return commitment;
    }

    /**
     * Reject a replenishment Intent. Marks it finished with status='rejected'.
     */
    rejectReplenishment(intentId: string): void {
        const intent = this.intents.get(intentId);
        if (!intent) throw new Error(`Replenishment Intent ${intentId} not found`);
        if (!intent.resourceClassifiedAs?.includes(PLAN_TAGS.REPLENISHMENT)) {
            throw new Error(`Intent ${intentId} is not a replenishment signal`);
        }
        const meta = this.getMetaOfKind(intentId, 'replenishment');
        if (meta) {
            meta.status = 'rejected';
        }
        intent.finished = true;
    }

    // =========================================================================
    // CRUD — Agreements
    // =========================================================================

    addAgreement(agreement: Omit<Agreement, 'id'> & { id?: string }): Agreement {
        const a: Agreement = { id: agreement.id ?? this.generateId(), ...agreement };
        this.agreements.set(a.id, a);
        return a;
    }

    getAgreement(id: string): Agreement | undefined { return this.agreements.get(id); }

    allAgreements(): Agreement[] { return Array.from(this.agreements.values()); }

    // =========================================================================
    // CRUD — AgreementBundles (GAP-J)
    // =========================================================================

    /**
     * Add an AgreementBundle — groups multiple agreements for a single transaction
     * (e.g. all line items in an order).
     * VF spec: exchanges.md, model-text.md §vf:AgreementBundle.
     */
    addAgreementBundle(bundle: Omit<AgreementBundle, 'id'> & { id?: string }): AgreementBundle {
        const b: AgreementBundle = { id: bundle.id ?? this.generateId(), ...bundle };
        this.agreementBundles.set(b.id, b);
        return b;
    }

    getAgreementBundle(id: string): AgreementBundle | undefined { return this.agreementBundles.get(id); }
    allAgreementBundles(): AgreementBundle[] { return Array.from(this.agreementBundles.values()); }

    /** Get all agreements that belong to a bundle. */
    agreementsInBundle(bundleId: string): Agreement[] {
        const bundle = this.agreementBundles.get(bundleId);
        if (!bundle) return [];
        return (bundle.bundles ?? [])
            .map(id => this.agreements.get(id))
            .filter((a): a is Agreement => a !== undefined);
    }

    // =========================================================================
    // CRUD — Proposals (publish Intents)
    // =========================================================================

    /**
     * Create a Proposal that publishes Intents for matching.
     *
     * A Proposal groups:
     *   - Primary Intents: what we're offering/requesting
     *   - Reciprocal Intents: what we want in return
     */
    addProposal(proposal: Omit<Proposal, 'id'> & { id?: string }): Proposal {
        const p: Proposal = { id: proposal.id ?? this.generateId(), ...proposal };
        this.proposals.set(p.id, p);
        return p;
    }

    getProposal(id: string): Proposal | undefined { return this.proposals.get(id); }

    allProposals(): Proposal[] { return Array.from(this.proposals.values()); }

    // =========================================================================
    // CRUD — ProposalLists (GAP-K)
    // =========================================================================

    /**
     * Add a ProposalList — groups proposals into a user-defined set
     * (e.g. a price list, or all proposals for a given event/fair).
     * VF spec: proposals.md, model-text.md §vf:ProposalList.
     */
    addProposalList(list: Omit<ProposalList, 'id'> & { id?: string }): ProposalList {
        const pl: ProposalList = { id: list.id ?? this.generateId(), ...list };
        this.proposalLists.set(pl.id, pl);
        return pl;
    }

    getProposalList(id: string): ProposalList | undefined { return this.proposalLists.get(id); }
    allProposalLists(): ProposalList[] { return Array.from(this.proposalLists.values()); }

    /** Get all proposals that belong to a list. */
    proposalsInList(listId: string): Proposal[] {
        const list = this.proposalLists.get(listId);
        if (!list) return [];
        return (list.lists ?? [])
            .map(id => this.proposals.get(id))
            .filter((p): p is Proposal => p !== undefined);
    }

    // =========================================================================
    // CRUD — Scenarios (GAP-E)
    // =========================================================================

    /**
     * Add a ScenarioDefinition — a named type/template for a category of scenarios.
     * VF spec: model-text.md §vf:ScenarioDefinition, estimates.md.
     */
    addScenarioDefinition(def: Omit<ScenarioDefinition, 'id'> & { id?: string }): ScenarioDefinition {
        const sd: ScenarioDefinition = { id: def.id ?? this.generateId(), ...def };
        this.scenarioDefinitions.set(sd.id, sd);
        return sd;
    }

    getScenarioDefinition(id: string): ScenarioDefinition | undefined { return this.scenarioDefinitions.get(id); }
    allScenarioDefinitions(): ScenarioDefinition[] { return Array.from(this.scenarioDefinitions.values()); }

    /** Get all scenarios defined by a ScenarioDefinition. */
    scenariosForDefinition(definitionId: string): Scenario[] {
        return Array.from(this.scenarios.values()).filter(s => s.definedAs === definitionId);
    }

    /**
     * Add a Scenario — high-level grouping for analysis, budgeting, or pre-planning.
     * Plans, processes, and intents associate themselves via back-references
     * (Plan.refinementOf, Process.nestedIn, Intent.plannedWithin).
     * VF spec: model-text.md §vf:Scenario, estimates.md.
     */
    addScenario(scenario: Omit<Scenario, 'id'> & { id?: string }): Scenario {
        const s: Scenario = { id: scenario.id ?? this.generateId(), ...scenario };
        this.scenarios.set(s.id, s);
        return s;
    }

    getScenario(id: string): Scenario | undefined { return this.scenarios.get(id); }
    allScenarios(): Scenario[] { return Array.from(this.scenarios.values()); }

    /** Get all scenarios that are refinements (sub-scenarios) of the given scenario. */
    scenarioRefinements(scenarioId: string): Scenario[] {
        return Array.from(this.scenarios.values()).filter(s => s.refinementOf === scenarioId);
    }

    /** Get all plans that refine (are operational implementations of) a given scenario. */
    plansForScenario(scenarioId: string): Plan[] {
        return Array.from(this.plans.values()).filter(p => p.refinementOf === scenarioId);
    }

    /**
     * Convenience: create an offer proposal.
     *
     * Creates an Intent with a provider (the offerer) and wraps it in a Proposal.
     */
    publishOffer(params: {
        provider: string;
        action: Intent['action'];
        resourceConformsTo?: string;
        resourceClassifiedAs?: string[];
        resourceQuantity?: Measure;
        effortQuantity?: Measure;
        note?: string;
        atLocation?: string;
        availability_window?: TemporalExpression;
        reciprocal?: {
            action: Intent['action'];
            resourceConformsTo?: string;
            resourceQuantity?: Measure;
        };
    }): { proposal: Proposal; primaryIntent: Intent; reciprocalIntent?: Intent } {
        const primaryIntent = this.addIntent({
            action: params.action,
            provider: params.provider,
            resourceConformsTo: params.resourceConformsTo,
            resourceClassifiedAs: params.resourceClassifiedAs,
            resourceQuantity: params.resourceQuantity,
            effortQuantity: params.effortQuantity,
            note: params.note,
            atLocation: params.atLocation,
            availability_window: params.availability_window,
            finished: false,
        });

        let reciprocalIntent: Intent | undefined;
        if (params.reciprocal) {
            reciprocalIntent = this.addIntent({
                action: params.reciprocal.action,
                receiver: params.provider, // offerer expects to receive
                resourceConformsTo: params.reciprocal.resourceConformsTo,
                resourceQuantity: params.reciprocal.resourceQuantity,
                finished: false,
            });
        }

        const proposal = this.addProposal({
            purpose: 'offer',
            publishes: [primaryIntent.id],
            reciprocal: reciprocalIntent ? [reciprocalIntent.id] : undefined,
        });

        return { proposal, primaryIntent, reciprocalIntent };
    }

    /**
     * Convenience: create a request proposal.
     */
    publishRequest(params: {
        receiver: string;
        action: Intent['action'];
        resourceConformsTo?: string;
        resourceClassifiedAs?: string[];
        resourceQuantity?: Measure;
        effortQuantity?: Measure;
        note?: string;
        atLocation?: string;
        availability_window?: TemporalExpression;
    }): { proposal: Proposal; primaryIntent: Intent } {
        const primaryIntent = this.addIntent({
            action: params.action,
            receiver: params.receiver,
            resourceConformsTo: params.resourceConformsTo,
            resourceClassifiedAs: params.resourceClassifiedAs,
            resourceQuantity: params.resourceQuantity,
            effortQuantity: params.effortQuantity,
            note: params.note,
            atLocation: params.atLocation,
            availability_window: params.availability_window,
            finished: false,
        });

        const proposal = this.addProposal({
            purpose: 'request',
            publishes: [primaryIntent.id],
        });

        return { proposal, primaryIntent };
    }

    // =========================================================================
    // PROPOSAL ACCEPTANCE — Proposal → Agreement → Commitment lifecycle
    // =========================================================================

    /**
     * Accept a Proposal, turning its Intents into Commitments and linking
     * them under a new Agreement. Closes the proposal→agreement→commitment
     * lifecycle loop.
     *
     * Validations (all throw on failure):
     *   - Proposal must exist
     *   - Proposal must not be expired (hasEnd) or not yet open (hasBeginning)
     *   - If proposedTo is set, options.acceptingAgentId must be in the list
     *
     * @param proposalId   - The Proposal being accepted
     * @param counterparty - Fills provider/receiver gaps on Intents
     * @param options.due              - Optional due date for all generated Commitments
     * @param options.acceptingAgentId - Identity of the accepting agent (required when proposedTo is set)
     * @param options.unitQuantity     - For unitBased proposals: scales all commitment quantities
     */
    acceptProposal(
        proposalId: string,
        counterparty: { provider?: string; receiver?: string },
        options?: { due?: string; acceptingAgentId?: string; unitQuantity?: number },
    ): { agreement: Agreement; commitments: Commitment[] } {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

        // --- Temporal validation ---
        const now = new Date().toISOString();
        if (proposal.hasEnd && now > proposal.hasEnd) {
            throw new Error(`Proposal ${proposalId} expired on ${proposal.hasEnd}`);
        }
        if (proposal.hasBeginning && now < proposal.hasBeginning) {
            throw new Error(`Proposal ${proposalId} not yet open (opens ${proposal.hasBeginning})`);
        }

        // --- proposedTo enforcement ---
        if (proposal.proposedTo?.length) {
            const acceptingId = options?.acceptingAgentId;
            if (!acceptingId || !proposal.proposedTo.includes(acceptingId)) {
                throw new Error(
                    `Proposal ${proposalId} is restricted to: ${proposal.proposedTo.join(', ')}`,
                );
            }
        }

        // --- unitBased scaling ---
        const unitScale = proposal.unitBased && options?.unitQuantity != null
            ? options.unitQuantity
            : 1;

        const scaleCommitment = (c: Commitment): void => {
            if (unitScale !== 1) {
                if (c.resourceQuantity) {
                    c.resourceQuantity = {
                        hasNumericalValue: c.resourceQuantity.hasNumericalValue * unitScale,
                        hasUnit: c.resourceQuantity.hasUnit,
                    };
                }
                if (c.effortQuantity) {
                    c.effortQuantity = {
                        hasNumericalValue: c.effortQuantity.hasNumericalValue * unitScale,
                        hasUnit: c.effortQuantity.hasUnit,
                    };
                }
            }
            if (options?.due) c.due = options.due;
        };

        const primaryIds: string[] = [];
        const reciprocalIds: string[] = [];
        const allCommitments: Commitment[] = [];

        // Primary Intents → stipulates
        for (const intentId of proposal.publishes ?? []) {
            const c = this.promoteToCommitment(intentId, counterparty);
            scaleCommitment(c);
            primaryIds.push(c.id);
            allCommitments.push(c);
        }

        // Reciprocal Intents → stipulatesReciprocal
        // Flip counterparty: accepting agent provides the reciprocal flow
        const flipped = { provider: counterparty.receiver, receiver: counterparty.provider };
        for (const intentId of proposal.reciprocal ?? []) {
            const c = this.promoteToCommitment(intentId, flipped);
            scaleCommitment(c);
            reciprocalIds.push(c.id);
            allCommitments.push(c);
        }

        const agreement = this.addAgreement({
            name: proposal.name,
            created: new Date().toISOString(),
            stipulates: primaryIds.length > 0 ? primaryIds : undefined,
            stipulatesReciprocal: reciprocalIds.length > 0 ? reciprocalIds : undefined,
        });

        for (const c of allCommitments) {
            c.clauseOf = agreement.id;
        }

        return { agreement, commitments: allCommitments };
    }

    // =========================================================================
    // NON-PROCESS FLOWS — Standalone transfer commitments in a Plan
    // =========================================================================

    /**
     * Add a standalone Commitment directly to a Plan (no Process).
     *
     * VF supports non-process flows: transfers, exchanges, and other flows
     * that happen outside of any production process but are still part of
     * a plan's execution.
     */
    addNonProcessCommitment(params: {
        planId: string;
        action: Commitment['action'];
        provider: string;
        receiver: string;
        resourceConformsTo?: string;
        resourceQuantity?: Measure;
        effortQuantity?: Measure;
        due?: string;
        clauseOf?: string;
        note?: string;
    }): Commitment {
        return this.addCommitment({
            action: params.action,
            provider: params.provider,
            receiver: params.receiver,
            resourceConformsTo: params.resourceConformsTo,
            resourceQuantity: params.resourceQuantity,
            effortQuantity: params.effortQuantity,
            due: params.due,
            clauseOf: params.clauseOf,
            plannedWithin: params.planId,
            note: params.note,
            created: new Date().toISOString(),
            finished: false,
        });
    }

    // =========================================================================
    // RECIPE INSTANTIATION
    // =========================================================================

    /**
     * Pure (no persistence) recipe graph builder — the search-phase counterpart
     * of instantiateRecipe().
     *
     * Returns Process and Commitment objects with pre-generated IDs but does NOT
     * write anything to PlanStore or ProcessRegistry.  `plannedWithin` is left
     * undefined on all objects; promoteToPlan() sets it via scenarioToPlan().
     *
     * If `intentId` is provided, the primary output Commitment (the one outputOf
     * the last process whose resourceConformsTo matches the primary output spec)
     * gets `satisfies: intentId` so that scoreScenario() can count it.
     *
     * RecipeExchanges are intentionally skipped — they represent bilateral
     * commercial agreements that are irrelevant during speculative search.
     * Observer-based inventory allocation is also skipped — the planner's
     * `remaining` map already accounts for available stock.
     */
    buildRecipeGraph(
        recipeStore: RecipeStore,
        recipeId: string,
        quantity: number,
        dueDate: Date,
        intentId?: string,
    ): { processes: Process[]; commitments: Commitment[] } {
        const recipe = recipeStore.getRecipe(recipeId);
        if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

        const chain = recipeStore.getProcessChain(recipeId);
        if (chain.length === 0) throw new Error(`Recipe ${recipeId} has no processes`);

        const scaleFactor = this.computeScaleFactor(recipeStore, chain, recipe.primaryOutput, quantity);

        const processes: Process[] = [];
        const commitments: Commitment[] = [];

        const orderedChain = [...chain].reverse(); // back-schedule from dueDate
        let cursor = dueDate;

        for (const rp of orderedChain) {
            const durationHours = rp.hasDuration
                ? rp.hasDuration.hasNumericalValue * (rp.hasDuration.hasUnit === 'days' ? 24 : 1)
                : 1;

            const processEnd   = new Date(cursor);
            const processBegin = new Date(processEnd.getTime() - durationHours * 3600000);
            cursor = processBegin;

            // Construct Process in-memory (no processes.register() call)
            const process: Process = {
                id: this.generateId(),
                name: rp.name,
                note: rp.note,
                basedOn: rp.processConformsTo,
                classifiedAs: rp.processClassifiedAs,
                hasBeginning: processBegin.toISOString(),
                hasEnd: processEnd.toISOString(),
                finished: false,
                // plannedWithin: intentionally omitted — set by scenarioToPlan()
            };
            processes.push(process);

            const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);

            for (const flow of inputs) {
                const commitment: Commitment = {
                    id: this.generateId(),
                    action: flow.action,
                    inputOf: process.id,
                    resourceConformsTo: flow.resourceConformsTo,
                    resourceClassifiedAs: flow.resourceClassifiedAs,
                    resourceQuantity: this.scaleQuantity(flow.resourceQuantity, scaleFactor),
                    effortQuantity:   this.scaleQuantity(flow.effortQuantity, scaleFactor),
                    stage: flow.stage,
                    state: flow.state,
                    due: processBegin.toISOString(),
                    finished: false,
                };
                commitments.push(commitment);
            }

            for (const flow of outputs) {
                const commitment: Commitment = {
                    id: this.generateId(),
                    action: flow.action,
                    outputOf: process.id,
                    resourceConformsTo: flow.resourceConformsTo,
                    resourceClassifiedAs: flow.resourceClassifiedAs,
                    resourceQuantity: this.scaleQuantity(flow.resourceQuantity, scaleFactor),
                    effortQuantity:   this.scaleQuantity(flow.effortQuantity, scaleFactor),
                    stage: flow.stage,
                    state: flow.state,
                    due: dueDate.toISOString(),
                    finished: false,
                };
                commitments.push(commitment);
            }
        }

        // Tag the primary output Commitment with satisfies: intentId so that
        // scoreScenario() can count this intent as satisfied.
        if (intentId) {
            const lastProcess = processes[processes.length - 1];
            const primarySpec = recipe.primaryOutput;
            const primaryOut = commitments.find(c =>
                c.outputOf === lastProcess?.id &&
                (!primarySpec || c.resourceConformsTo === primarySpec),
            );
            if (!primaryOut) {
                throw new Error(
                    `buildRecipeGraph: intentId '${intentId}' provided but primary output ` +
                    `'${primarySpec}' not found in recipe '${recipe.name}' outputs. ` +
                    `Cannot set satisfies link.`
                );
            }
            primaryOut.satisfies = intentId;
        }

        return { processes, commitments };
    }

    /**
     * Instantiate a recipe into a Plan with Processes, Commitments,
     * Intents (for unassigned flows), and Agreements (from RecipeExchanges).
     *
     * @param recipeStore - The knowledge base
     * @param recipeId - Which recipe to instantiate
     * @param quantity - Desired output quantity (will scale)
     * @param dueDate - When the final output is needed
     * @param agents - Optional agents for commitments. Unassigned flows
     *                 become Intents (with only provider or receiver).
     * @param scheduling - 'back' (default: from due date backwards)
     *                     or 'forward' (from start date forwards)
     * @param startDate - Required when scheduling='forward'
     * @param observer - Optional: if provided, checks inventory before creating
     *                   processes (VF dependent demand algorithm)
     */
    instantiateRecipe(
        recipeStore: RecipeStore,
        recipeId: string,
        quantity: number,
        dueDate: Date,
        agents?: { provider?: string; receiver?: string },
        scheduling: 'back' | 'forward' = 'back',
        startDate?: Date,
        observer?: Observer,
    ): {
        plan: Plan;
        processes: Process[];
        commitments: Commitment[];
        intents: Intent[];
        agreements: Agreement[];
        allocated: Array<{ specId: string; resourceId: string; quantity: number }>;
    } {
        const recipe = recipeStore.getRecipe(recipeId);
        if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

        const chain = recipeStore.getProcessChain(recipeId);
        if (chain.length === 0) throw new Error(`Recipe ${recipeId} has no processes`);

        const scaleFactor = this.computeScaleFactor(recipeStore, chain, recipe.primaryOutput, quantity);

        const plan = this.addPlan({
            name: `Plan: ${recipe.name} × ${quantity}`,
            note: `Instantiated from recipe ${recipe.name}`,
            due: dueDate.toISOString(),
            created: new Date().toISOString(),
        });

        // Schedule processes
        const processes: Process[] = [];
        const commitments: Commitment[] = [];
        const intents: Intent[] = [];
        const allocated: Array<{ specId: string; resourceId: string; quantity: number }> = [];

        // Determine ordering based on scheduling direction
        const orderedChain = scheduling === 'back' ? [...chain].reverse() : [...chain];
        let cursor = scheduling === 'back' ? dueDate : (startDate ?? new Date());

        for (const rp of orderedChain) {
            const durationHours = rp.hasDuration
                ? rp.hasDuration.hasNumericalValue * (rp.hasDuration.hasUnit === 'days' ? 24 : 1)
                : 1;

            let processBegin: Date;
            let processEnd: Date;

            if (scheduling === 'back') {
                processEnd = new Date(cursor);
                processBegin = new Date(processEnd.getTime() - durationHours * 3600000);
                cursor = processBegin;
            } else {
                processBegin = new Date(cursor);
                processEnd = new Date(processBegin.getTime() + durationHours * 3600000);
                cursor = processEnd;
            }

            // Create Process via shared registry
            const process = this.processes.register({
                name: rp.name,
                note: rp.note,
                basedOn: rp.processConformsTo,
                classifiedAs: rp.processClassifiedAs,
                plannedWithin: plan.id,
                hasBeginning: processBegin.toISOString(),
                hasEnd: processEnd.toISOString(),
                finished: false,
            });
            processes.push(process);

            // Create flows (Commitments or Intents)
            const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);

            for (const flow of inputs) {
                // --- Durable inputs: existence gate, not quantity netting ---
                // Actions with accountingEffect='noEffect' (use, cite) are existence gates:
                // the resource must be present but is not consumed.
                {
                    const actionDef = ACTION_DEFINITIONS[flow.action];
                    const isDurable = actionDef?.accountingEffect === 'noEffect';

                    if (isDurable && flow.resourceConformsTo) {
                        if (observer) {
                            const exists = observer.conformingResources(flow.resourceConformsTo)
                                .some(r => {
                                    if ((r.accountingQuantity?.hasNumericalValue ?? 0) <= 0) return false;
                                    if (flow.stage && r.stage !== flow.stage) return false;
                                    if (flow.state && r.state !== flow.state) return false;
                                    return true;
                                });
                            if (exists) continue; // Present — no demand created
                        }
                        // Not present — signal that this durable resource must be sourced
                        const durableResult = this.createFlowFromRecipe(
                            flow, process.id, 'input', scaleFactor, processBegin, plan.id, agents,
                        );
                        if (durableResult.type === 'commitment') {
                            commitments.push(durableResult.record);
                        } else {
                            intents.push(durableResult.record);
                        }
                        continue; // Do NOT fall through to quantity netting
                    }
                }

                // --- Inventory-aware demand (VF dependent demand) ---
                // If observer is provided, check if a resource already exists
                // that could satisfy this input. If so, allocate it instead
                // of demanding new production.
                let adjustedFlow = flow;
                if (observer && flow.resourceConformsTo) {
                    // VF spec (resources.md §Stage and state): dependent demand
                    // "will select only those resources that fit the specified stage and state".
                    const available = observer.conformingResources(flow.resourceConformsTo)
                        .filter(r => {
                            const qty = r.accountingQuantity?.hasNumericalValue ?? 0;
                            if (qty <= 0) return false;
                            if (flow.stage && r.stage !== flow.stage) return false;
                            if (flow.state && r.state !== flow.state) return false;
                            return true;
                        });

                    const needed = (flow.resourceQuantity?.hasNumericalValue ?? 0) * scaleFactor;
                    let remaining = needed;

                    for (const r of available) {
                        if (remaining <= 0) break;
                        const avail = r.accountingQuantity?.hasNumericalValue ?? 0;
                        const take = Math.min(avail, remaining);
                        allocated.push({
                            specId: flow.resourceConformsTo,
                            resourceId: r.id,
                            quantity: take,
                        });
                        remaining -= take;
                    }

                    // Only create demand for unmet portion
                    if (remaining <= 0) continue;
                    if (remaining < needed && flow.resourceQuantity) {
                        adjustedFlow = { ...flow, resourceQuantity: {
                            hasNumericalValue: remaining / scaleFactor,
                            hasUnit: flow.resourceQuantity.hasUnit,
                        }};
                    }
                }

                const result = this.createFlowFromRecipe(
                    adjustedFlow, process.id, 'input', scaleFactor, processBegin, plan.id, agents,
                );
                if (result.type === 'commitment') {
                    commitments.push(result.record);
                } else {
                    intents.push(result.record);
                }
            }

            for (const flow of outputs) {
                const result = this.createFlowFromRecipe(
                    flow, process.id, 'output', scaleFactor, processEnd, plan.id, agents,
                );
                if (result.type === 'commitment') {
                    commitments.push(result.record);
                } else {
                    intents.push(result.record);
                }
            }
        }

        // --- Generate Agreements from RecipeExchanges ---
        const agreements: Agreement[] = [];
        if (recipe.recipeExchanges) {
            for (const rexId of recipe.recipeExchanges) {
                const rex = recipeStore.getRecipeExchange(rexId);
                if (!rex) continue;

                const exchangeFlows = recipeStore.flowsForExchange(rexId);
                const primaryIds: string[] = [];
                const reciprocalIds: string[] = [];

                const hasAnyTag = exchangeFlows.some(f => f.isPrimary !== undefined);
                const isBilateral = exchangeFlows.length === 2;

                for (let i = 0; i < exchangeFlows.length; i++) {
                    const flow = exchangeFlows[i];
                    const commitment = this.createCommitmentFromFlow(
                        flow, undefined, undefined, scaleFactor, dueDate, plan.id, agents,
                    );
                    commitments.push(commitment);

                    if (flow.isPrimary === true) {
                        primaryIds.push(commitment.id);
                    } else if (flow.isPrimary === false) {
                        reciprocalIds.push(commitment.id);
                    } else if (!hasAnyTag && isBilateral && i === 0) {
                        primaryIds.push(commitment.id);   // bilateral: first = primary
                    } else if (!hasAnyTag && isBilateral) {
                        reciprocalIds.push(commitment.id); // bilateral: second = reciprocal
                    } else {
                        // Multilateral (3+ flows) with no tags: all go to stipulates.
                        // Caller must use isPrimary to specify sides explicitly.
                        primaryIds.push(commitment.id);
                    }
                }

                const agreement = this.addAgreement({
                    name: rex.name,
                    note: rex.note,
                    created: new Date().toISOString(),
                    stipulates: primaryIds,
                    stipulatesReciprocal: reciprocalIds.length > 0 ? reciprocalIds : undefined,
                });
                agreements.push(agreement);

                // Set clauseOf on each commitment
                for (const cId of [...primaryIds, ...reciprocalIds]) {
                    const c = this.getCommitment(cId);
                    if (c) c.clauseOf = agreement.id;
                }
            }
        }

        // --- Create independent demand (the plan's deliverable) ---
        // The final output commitment/intent represents what the plan is for
        const finalOutputs = commitments.filter(c => c.outputOf === processes[processes.length - 1]?.id);
        const independentDemandIds = finalOutputs.map(c => c.id);
        if (independentDemandIds.length > 0) {
            plan.hasIndependentDemand = independentDemandIds;
            for (const c of finalOutputs) {
                c.independentDemandOf = plan.id;
            }
        }

        return { plan, processes, commitments, intents, agreements, allocated };
    }

    /**
     * Connect all plan constructs to the Observer for tracking.
     */
    registerWithObserver(
        observer: Observer,
        result: { commitments: Commitment[]; intents: Intent[] },
    ): void {
        // Processes are already shared via ProcessRegistry
        for (const commitment of result.commitments) {
            observer.registerCommitment(commitment);
        }
        for (const intent of result.intents) {
            observer.registerIntent(intent);
        }
    }

    // =========================================================================
    // INTERNAL
    // =========================================================================

    private computeScaleFactor(
        recipeStore: RecipeStore,
        chain: RecipeProcess[],
        primaryOutputSpec: string | undefined,
        desiredQuantity: number,
    ): number {
        if (!primaryOutputSpec) return desiredQuantity;
        const lastProcess = chain[chain.length - 1];
        if (!lastProcess) return desiredQuantity;
        const { outputs } = recipeStore.flowsForProcess(lastProcess.id);
        const primaryFlow = outputs.find(f => f.resourceConformsTo === primaryOutputSpec);
        if (primaryFlow?.resourceQuantity) {
            return desiredQuantity / primaryFlow.resourceQuantity.hasNumericalValue;
        }
        throw new Error(
            `Recipe scale error: primaryOutput '${primaryOutputSpec}' not found in ` +
            `last process '${lastProcess.name}' outputs. ` +
            `Check that the recipe's primaryOutput matches a recipeOutputOf flow.`
        );
    }

    /**
     * Create a Commitment or Intent from a RecipeFlow.
     *
     * If both provider and receiver are known → Commitment.
     * If only one is known → Intent (unilateral, awaiting matching).
     */
    private createFlowFromRecipe(
        flow: RecipeFlow,
        processId: string,
        direction: 'input' | 'output',
        scaleFactor: number,
        dueDate: Date,
        planId: string,
        agents?: { provider?: string; receiver?: string },
    ): { type: 'commitment'; record: Commitment } | { type: 'intent'; record: Intent } {
        // Validate action direction against VF spec
        const def = ACTION_DEFINITIONS[flow.action];
        if (def && def.inputOutput !== 'outputInput' && def.inputOutput !== 'notApplicable') {
            if (direction === 'input' && def.inputOutput !== 'input') {
                throw new Error(
                    `Action '${flow.action}' (inputOutput='${def.inputOutput}') ` +
                    `cannot be used as a process input.`
                );
            }
            if (direction === 'output' && def.inputOutput !== 'output') {
                throw new Error(
                    `Action '${flow.action}' (inputOutput='${def.inputOutput}') ` +
                    `cannot be used as a process output.`
                );
            }
        }

        const scaledResourceQty = this.scaleQuantity(flow.resourceQuantity, scaleFactor);
        const scaledEffortQty = this.scaleQuantity(flow.effortQuantity, scaleFactor);

        const provider = agents?.provider;
        const receiver = agents?.receiver;

        // If we have both agents → Commitment. Otherwise → Intent.
        if (provider && receiver) {
            return { type: 'commitment', record: this.addCommitment({
                action: flow.action,
                inputOf: direction === 'input' ? processId : undefined,
                outputOf: direction === 'output' ? processId : undefined,
                resourceConformsTo: flow.resourceConformsTo,
                resourceClassifiedAs: flow.resourceClassifiedAs,
                resourceQuantity: scaledResourceQty,
                effortQuantity: scaledEffortQty,
                stage: flow.stage,
                state: flow.state,
                provider,
                receiver,
                due: dueDate.toISOString(),
                created: new Date().toISOString(),
                plannedWithin: planId,
                finished: false,
            }) };
        } else {
            // Create Intent: only provider or only receiver
            return { type: 'intent', record: this.addIntent({
                action: flow.action,
                inputOf: direction === 'input' ? processId : undefined,
                outputOf: direction === 'output' ? processId : undefined,
                resourceConformsTo: flow.resourceConformsTo,
                resourceClassifiedAs: flow.resourceClassifiedAs,
                resourceQuantity: scaledResourceQty,
                effortQuantity: scaledEffortQty,
                stage: flow.stage,
                state: flow.state,
                provider: provider,     // may be undefined
                receiver: receiver,     // may be undefined
                due: dueDate.toISOString(),
                plannedWithin: planId,
                finished: false,
            }) };
        }
    }

    private createCommitmentFromFlow(
        flow: RecipeFlow,
        processId: string | undefined,
        direction: 'input' | 'output' | undefined,
        scaleFactor: number,
        dueDate: Date,
        planId: string,
        agents?: { provider?: string; receiver?: string },
    ): Commitment {
        return this.addCommitment({
            action: flow.action,
            inputOf: direction === 'input' ? processId : undefined,
            outputOf: direction === 'output' ? processId : undefined,
            resourceConformsTo: flow.resourceConformsTo,
            resourceClassifiedAs: flow.resourceClassifiedAs,
            resourceQuantity: this.scaleQuantity(flow.resourceQuantity, scaleFactor),
            effortQuantity: this.scaleQuantity(flow.effortQuantity, scaleFactor),
            stage: flow.stage,
            state: flow.state,
            provider: agents?.provider,
            receiver: agents?.receiver,
            due: dueDate.toISOString(),
            created: new Date().toISOString(),
            plannedWithin: planId,
            finished: false,
        });
    }

    private scaleQuantity(qty: Measure | undefined, factor: number): Measure | undefined {
        if (!qty) return undefined;
        return {
            hasNumericalValue: qty.hasNumericalValue * factor,
            hasUnit: qty.hasUnit,
        };
    }
}
