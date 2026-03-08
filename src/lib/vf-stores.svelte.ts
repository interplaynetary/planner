import { ProcessRegistry }      from '$lib/process-registry';
import { RecipeStore }           from '$lib/knowledge/recipes';
import { BufferZoneStore }       from '$lib/knowledge/buffer-zones';
import { CapacityBufferStore }   from '$lib/knowledge/capacity-buffers';
import { SpatialThingStore }     from '$lib/knowledge/spatial-things';
import { AgentStore }            from '$lib/agents';
import { PlanStore }             from '$lib/planning/planning';
import { Observer }              from '$lib/observation/observer';
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

// ── refresh() — sync all $state arrays from the current store instances ──
function syncArr<T>(target: T[], items: T[]): void {
    target.splice(0, target.length, ...items);
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
    syncArr(bufferZoneList,          bufferZones.allBufferZones());
    syncArr(capacityBufferList,      capacityBuffers.allBuffers());
    syncArr(locationList,            locations.allLocations());
    // adjustmentFactorList is managed directly (no backing store class)
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
    adjustmentFactorList.splice(0, adjustmentFactorList.length);
    bufferProfileList.splice(0, bufferProfileList.length);
    refresh();
}

/** Add or replace an adjustment factor by ID. */
export function upsertAdjustmentFactor(f: DemandAdjustmentFactor): void {
    const idx = adjustmentFactorList.findIndex(a => a.id === f.id);
    if (idx >= 0) adjustmentFactorList.splice(idx, 1, f);
    else adjustmentFactorList.push(f);
}

/** Add or replace a buffer profile by ID. */
export function upsertBufferProfile(p: BufferProfile): void {
    const idx = bufferProfileList.findIndex(b => b.id === p.id);
    if (idx >= 0) bufferProfileList.splice(idx, 1, p);
    else bufferProfileList.push(p);
}
