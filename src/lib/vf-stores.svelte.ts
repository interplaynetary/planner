import { ProcessRegistry }      from '$lib/process-registry';
import { RecipeStore }           from '$lib/knowledge/recipes';
import { BufferZoneStore }       from '$lib/knowledge/buffer-zones';
import { CapacityBufferStore }   from '$lib/knowledge/capacity-buffers';
import { SpatialThingStore }     from '$lib/knowledge/spatial-things';
import { AgentStore }            from '$lib/agents';
import { PlanStore }             from '$lib/planning/planning';
import { Observer }              from '$lib/observation/observer';
import { Commune }               from '$lib/observation/account';
import type { DemandEntry }      from '$lib/observation/account';
import { HypercertStore }        from '$lib/observation/hypercerts';
import type { PlanHypercert }    from '$lib/observation/hypercerts';
import type { CommuneDemandPolicy, DerivedDependentPolicy } from '$lib/observation/demand-policy';
import { buildMembershipIndex, type MembershipIndex } from '$lib/indexes/membership';
import type {
    ResourceSpecification,
    ProcessSpecification,
    Recipe,
    Plan,
    Process,
    Commitment,
    Intent,
    EconomicResource,
    EconomicEvent,
    Agent,
    AgentRelationship,
    BufferZone,
    BufferProfile,
    CapacityBuffer,
    SpatialThing,
    DemandAdjustmentFactor,
} from '$lib/schemas';

// ── Underlying class instances (module-level singletons) ──────────────────
// These are plain let exports (not $state) — can be reassigned in resetStores()
export let registry              = new ProcessRegistry();
export let recipes               = new RecipeStore();
export let bufferZones           = new BufferZoneStore();
export let capacityBuffers       = new CapacityBufferStore();
export let locations             = new SpatialThingStore();
export let agents                = new AgentStore();
export let planner               = new PlanStore(registry);
export let observer              = new Observer(registry);
export let commune               = new Commune({ observer });
export let hypercertStore         = new HypercertStore();
export const resourcePriceSvc    = new Map<string, number>(); // specId → SVC per unit

export const communeState = $state({
    activeAgentId: null as string | null,
    welfareAllocationRate: 0,
    pools: {} as Record<string, number>,
    totalSocialSvc: 0,
    individual_claimable_pool_svc: 0,
    social_welfare_fund: 0,
    available_claimable_pool: 0,
});

export const accountState = $state({
    loaded: false,
    agentId: '',
    gross_contribution_credited: 0,
    claimed_capacity: 0,
    contribution_capacity_factor: 1,
    contribution_claim: 0,
    solidarity_supplement: 0,
    total_claim_capacity: 0,
    current_potential_claim_capacity: 0,
    current_share_of_claims: 0,
    current_actual_claim_capacity: 0,
});

// ── Reactive $state arrays (Svelte 5) ────────────────────────────────────
// Declared as const to satisfy Svelte's "no reassignment of exported state" rule.
// Updated in-place via splice(), which Svelte's reactive proxy tracks.
// Knowledge layer
export const resourceSpecs  = $state<ResourceSpecification[]>([]);
export const processSpecs   = $state<ProcessSpecification[]>([]);
export const recipeList     = $state<Recipe[]>([]);
// Plan layer
export const planList       = $state<Plan[]>([]);
export const processList    = $state<Process[]>([]);
export const commitmentList = $state<Commitment[]>([]);
export const intentList     = $state<Intent[]>([]);
// Observation layer
export const resourceList   = $state<EconomicResource[]>([]);
export const eventList      = $state<EconomicEvent[]>([]);
export const agentList               = $state<Agent[]>([]);
export const bufferZoneList          = $state<BufferZone[]>([]);
export const capacityBufferList      = $state<CapacityBuffer[]>([]);
export const locationList            = $state<SpatialThing[]>([]);
export const adjustmentFactorList    = $state<DemandAdjustmentFactor[]>([]);
export const bufferProfileList       = $state<BufferProfile[]>([]);
export const hypercertList           = $state<PlanHypercert[]>([]);
export const communeDemandState      = $state<DemandEntry[]>([]);
export const communeDemandPolicies      = $state<CommuneDemandPolicy[]>([]);
export const derivedDependentPolicies   = $state<DerivedDependentPolicy[]>([]);

export interface MemberSnapshot {
    agentId: string;
    contribution_capacity_factor: number;
    gross_contribution_credited: number;
    contribution_claim: number;
    solidarity_supplement: number;
    total_claim_capacity: number;
    claimed_capacity: number;
    current_potential_claim_capacity: number;
    current_actual_claim_capacity: number;
    current_share_of_claims: number;
}
export const communeMembersState = $state<MemberSnapshot[]>([]);

// ── Membership index (agent-derived federation hierarchy) ─────────────────
export const relationshipList = $state<AgentRelationship[]>([]);
export const membershipIndex = $state<MembershipIndex>({
    citizens: new Set(),
    personToScope: new Map(),
    scopeParent: new Map(),
    scopeToDescendantCitizens: new Map(),
});

// ── Derived federation inputs ─────────────────────────────────────────────

/** All scopes reachable via membership relationships. */
export function getFederationScopeIds(): string[] {
    const idx = membershipIndex;
    const ids = new Set<string>();
    for (const scope of idx.personToScope.values()) ids.add(scope);
    for (const [child, parent] of idx.scopeParent) { ids.add(child); ids.add(parent); }
    return [...ids];
}

/** scopeParent as a Map (ready for planFederation ctx.parentOf). */
export function getFederationParentOf(): Map<string, string> {
    return new Map(membershipIndex.scopeParent);
}

/** Leaf member counts: persons directly assigned to each scope. */
export function getFederationMemberCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const scope of membershipIndex.personToScope.values())
        counts.set(scope, (counts.get(scope) ?? 0) + 1);
    return counts;
}

// ── refresh() — sync all $state arrays from the current store instances ──
function syncArr<T>(target: T[], items: T[]): void {
    target.splice(0, target.length, ...items);
}

export function syncCommune() {
    communeState.welfareAllocationRate = commune.welfare_allocation_rate;
    communeState.pools = { ...commune.pools };
    communeState.totalSocialSvc = commune.total_social_svc;
    communeState.individual_claimable_pool_svc = commune.individual_claimable_pool_svc;
    communeState.social_welfare_fund = commune.social_welfare_fund;
    communeState.available_claimable_pool = commune.available_claimable_pool;

    communeMembersState.splice(0, communeMembersState.length, ...commune.allAccounts().map(a => ({
        agentId:                          a.agentId,
        contribution_capacity_factor:     a.contribution_capacity_factor,
        gross_contribution_credited:      a.gross_contribution_credited,
        contribution_claim:               a.contribution_claim,
        solidarity_supplement:            a.solidarity_supplement,
        total_claim_capacity:             a.total_claim_capacity,
        claimed_capacity:                 a.claimed_capacity,
        current_potential_claim_capacity: a.current_potential_claim_capacity,
        current_actual_claim_capacity:    a.current_actual_claim_capacity,
        current_share_of_claims:          a.current_share_of_claims,
    })));

    const claimableSpecs = recipes.allResourceSpecs()
        .filter(s => s.resourceClassifiedAs?.includes('individual-claimable'))
        .map(s => ({
            id: s.id,
            unit: s.defaultUnitOfResource ?? 'units',
            pricePerUnit: resourcePriceSvc.get(s.id) ?? commune.getResourcePrice(s.id),
        }));
    communeDemandState.splice(0, communeDemandState.length, ...commune.communeDemand(claimableSpecs));

    if (communeState.activeAgentId) {
        const acct = commune.accountFor(communeState.activeAgentId);
        if (acct) {
            accountState.loaded                          = true;
            accountState.agentId                         = acct.agentId;
            accountState.gross_contribution_credited     = acct.gross_contribution_credited;
            accountState.claimed_capacity                = acct.claimed_capacity;
            accountState.contribution_capacity_factor    = acct.contribution_capacity_factor;
            accountState.contribution_claim              = acct.contribution_claim;
            accountState.solidarity_supplement           = acct.solidarity_supplement;
            accountState.total_claim_capacity            = acct.total_claim_capacity;
            accountState.current_potential_claim_capacity = acct.current_potential_claim_capacity;
            accountState.current_share_of_claims         = acct.current_share_of_claims;
            accountState.current_actual_claim_capacity   = acct.current_actual_claim_capacity;
        } else {
            accountState.loaded = false;
        }
    } else {
        accountState.loaded = false;
    }
}

export function refresh() {
    syncArr(resourceSpecs,  recipes.allResourceSpecs());
    syncArr(processSpecs,   recipes.allProcessSpecs());
    syncArr(recipeList,     recipes.allRecipes());
    syncArr(planList,       planner.allPlans());
    syncArr(processList,    planner.allProcesses());
    syncArr(commitmentList, planner.allCommitments());
    syncArr(intentList,     planner.allIntents());
    syncArr(resourceList,   observer.allResources());
    syncArr(eventList,      observer.allEvents());
    syncArr(agentList,               agents.allAgents());
    syncArr(relationshipList,        agents.allRelationships());
    const rebuilt = buildMembershipIndex(agents.allAgents(), agents.allRelationships());
    membershipIndex.citizens = rebuilt.citizens;
    membershipIndex.personToScope = rebuilt.personToScope;
    membershipIndex.scopeParent = rebuilt.scopeParent;
    membershipIndex.scopeToDescendantCitizens = rebuilt.scopeToDescendantCitizens;
    syncArr(hypercertList,           hypercertStore.allCerts());
    syncArr(bufferZoneList,          bufferZones.allBufferZones());
    syncArr(capacityBufferList,      capacityBuffers.allBuffers());
    syncArr(locationList,            locations.allLocations());
    // adjustmentFactorList is managed directly (no backing store class)
    syncCommune();
}

// Auto-refresh on any Observer event
observer.subscribe(() => refresh());

// ── resetStores() — replace all instances with fresh empty ones ───────────
export function resetStores() {
    registry             = new ProcessRegistry();
    recipes              = new RecipeStore();
    bufferZones          = new BufferZoneStore();
    capacityBuffers      = new CapacityBufferStore();
    locations            = new SpatialThingStore();
    agents               = new AgentStore();
    planner              = new PlanStore(registry);
    observer             = new Observer(registry);
    observer.subscribe(() => refresh());
    commune              = new Commune({ observer });
    hypercertStore       = new HypercertStore();
    resourcePriceSvc.clear();
    adjustmentFactorList.splice(0, adjustmentFactorList.length);
    bufferProfileList.splice(0, bufferProfileList.length);
    relationshipList.splice(0, relationshipList.length);
    membershipIndex.citizens = new Set();
    membershipIndex.personToScope = new Map();
    membershipIndex.scopeParent = new Map();
    membershipIndex.scopeToDescendantCitizens = new Map();
    communeDemandPolicies.splice(0, communeDemandPolicies.length);
    derivedDependentPolicies.splice(0, derivedDependentPolicies.length);
    communeState.activeAgentId = null;
    communeState.pools = {};
    communeState.totalSocialSvc = 0;
    communeState.individual_claimable_pool_svc = 0;
    communeState.social_welfare_fund = 0;
    communeState.available_claimable_pool = 0;
    accountState.loaded = false;
    refresh();
}

/** Set the active agent for commune account display. */
export function setActiveAgentId(id: string | null): void {
    communeState.activeAgentId = id;
    syncCommune();
}

/** Add or replace an adjustment factor by ID. */
export function upsertAdjustmentFactor(f: DemandAdjustmentFactor): void {
    const idx = adjustmentFactorList.findIndex(a => a.id === f.id);
    if (idx >= 0) adjustmentFactorList.splice(idx, 1, f);
    else adjustmentFactorList.push(f);
}

/** Add or replace a demand policy by ID. */
export function upsertDemandPolicy(p: CommuneDemandPolicy): void {
    const idx = communeDemandPolicies.findIndex(a => a.id === p.id);
    if (idx >= 0) communeDemandPolicies.splice(idx, 1, p);
    else communeDemandPolicies.push(p);
}

/** Remove a demand policy by ID. */
export function removeDemandPolicy(id: string): void {
    const idx = communeDemandPolicies.findIndex(a => a.id === id);
    if (idx >= 0) communeDemandPolicies.splice(idx, 1);
}

/** Add or replace a derived-dependent policy by ID. */
export function upsertDerivedDependentPolicy(p: DerivedDependentPolicy): void {
    const idx = derivedDependentPolicies.findIndex(a => a.id === p.id);
    if (idx >= 0) derivedDependentPolicies.splice(idx, 1, p);
    else derivedDependentPolicies.push(p);
}

/** Remove a derived-dependent policy by ID. */
export function removeDerivedDependentPolicy(id: string): void {
    const idx = derivedDependentPolicies.findIndex(a => a.id === id);
    if (idx >= 0) derivedDependentPolicies.splice(idx, 1);
}

/** Add or replace a buffer profile by ID. */
export function upsertBufferProfile(p: BufferProfile): void {
    const idx = bufferProfileList.findIndex(b => b.id === p.id);
    if (idx >= 0) bufferProfileList.splice(idx, 1, p);
    else bufferProfileList.push(p);
}
