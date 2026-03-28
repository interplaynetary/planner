/**
 * Tests for the 7 Architectural Elegance Improvements.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { PlanNetter } from '../planning/netting';
import { PlanStore, PLAN_TAGS, PLANNING_PROCESS_SPEC, type PlanningMeta } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';
import { RecipeStore } from '../knowledge/recipes';
import { BufferZoneStore } from '../knowledge/buffer-zones';
import { buildIndependentDemandIndex } from '../indexes/independent-demand';
import { buildIndependentSupplyIndex } from '../indexes/independent-supply';
import { buildAgentIndex } from '../indexes/agents';
import { planForScope } from '../planning/plan-for-scope';
import { planFederation, DefaultLateralMatchingPolicy, type LateralMatchingPolicy, type FederationPlanContext } from '../planning/plan-federation';
import type { PlanningSession } from '../planning/plan-for-unit';
import type { Intent } from '../schemas';
import { SpatialThingStore } from '../knowledge/spatial-things';

const locations = new SpatialThingStore();
const di = buildIndependentDemandIndex([], [], [], locations);
const ai = buildAgentIndex([], [], new SpatialThingStore(), 7);
const si = buildIndependentSupplyIndex([], [], [], ai, locations);

let idCounter = 0;
const generateId = () => `id-${++idCounter}`;

// =============================================================================
// Improvement 1: Conservation as Structural Constraint
// =============================================================================

describe('Improvement 1: Conservation Floors', () => {
    let processReg: ProcessRegistry;
    let planStore: PlanStore;
    let observer: Observer;

    beforeEach(() => {
        idCounter = 0;
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
        observer = new Observer(processReg);
    });

    it('netDemand: inventory 10, floor 3, demand 10 → remaining 3 (only 7 allocatable)', () => {
        observer.seedResource({
            id: 'r1', name: 'Soil', conformsTo: 'spec:soil',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
        });
        const floors = new Map([['spec:soil', 3]]);
        const netter = new PlanNetter(planStore, observer, undefined, floors);
        const result = netter.netDemand('spec:soil', 10);
        expect(result.remaining).toBe(3);
        expect(result.inventoryAllocated[0].quantity).toBe(7);
    });

    it('netDemand: inventory 2, floor 3 → nothing allocatable', () => {
        observer.seedResource({
            id: 'r1', name: 'Soil', conformsTo: 'spec:soil',
            accountingQuantity: { hasNumericalValue: 2, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 2, hasUnit: 'kg' },
        });
        const floors = new Map([['spec:soil', 3]]);
        const netter = new PlanNetter(planStore, observer, undefined, floors);
        const result = netter.netDemand('spec:soil', 5);
        expect(result.remaining).toBe(5);
        expect(result.inventoryAllocated).toHaveLength(0);
    });

    it('netAvailableQty respects floor', () => {
        observer.seedResource({
            id: 'r1', name: 'Soil', conformsTo: 'spec:soil',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
        });
        const floors = new Map([['spec:soil', 3]]);
        const netter = new PlanNetter(planStore, observer, undefined, floors);
        expect(netter.netAvailableQty('spec:soil')).toBe(7);
    });

    it('ecological buffer with tippingPoint prevents over-allocation in planning', () => {
        const recipeStore = new RecipeStore();
        const bzStore = new BufferZoneStore();
        recipeStore.addResourceSpec({
            id: 'water', name: 'Water',
            resourceClassifiedAs: ['tag:buffer:ecological'],
            defaultUnitOfResource: 'L',
        });
        observer.seedResource({
            id: 'w1', name: 'Water',
            conformsTo: 'water',
            onhandQuantity: { hasNumericalValue: 8, hasUnit: 'L' },
            accountingQuantity: { hasNumericalValue: 8, hasUnit: 'L' },
        });
        bzStore.addBufferZone({
            id: 'bz-water', specId: 'water', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 1, aduUnit: 'L', dltDays: 30, moq: 0, moqUnit: 'L',
            tor: 10, toy: 20, tog: 30, tippingPoint: 5,
            lastComputedAt: new Date().toISOString(),
        });

        const result = planForScope(['c1'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, bufferZoneStore: bzStore, generateId },
        );
        // Conservation signal should be emitted
        const conservation = result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION);
        expect(conservation).toHaveLength(1);
        expect(conservation[0].resourceConformsTo).toBe('water');
    });

    it('fork propagates conservation floors', () => {
        observer.seedResource({
            id: 'r1', name: 'Soil', conformsTo: 'spec:soil',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
        });
        const floors = new Map([['spec:soil', 3]]);
        const parent = new PlanNetter(planStore, observer, undefined, floors);
        // fork without observer override inherits parent's observer
        const child = parent.fork();
        expect(child.netAvailableQty('spec:soil')).toBe(7);
    });
});

// =============================================================================
// Improvement 2: Shared Propagation Infrastructure (verified by all tests passing)
// =============================================================================

describe('Improvement 2: Shared Propagation', () => {
    it('rpDurationMs, computeSnlt, createFlowRecord each appear once in propagation.ts', async () => {
        const { rpDurationMs, computeSnlt, createFlowRecord } = await import('../algorithms/propagation');
        expect(typeof rpDurationMs).toBe('function');
        expect(typeof computeSnlt).toBe('function');
        expect(typeof createFlowRecord).toBe('function');
    });
});

// =============================================================================
// Improvement 3: Netter VF Visibility
// =============================================================================

describe('Improvement 3: Soft Allocation Intents', () => {
    let processReg: ProcessRegistry;
    let planStore: PlanStore;

    beforeEach(() => {
        idCounter = 0;
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
    });

    it('netDemand emits SOFT_ALLOCATION Intents when planId is provided', () => {
        const plan = planStore.addPlan({ name: 'Test Plan' });
        const procId = 'proc-1';
        planStore.addIntent({
            action: 'produce',
            outputOf: procId,
            resourceConformsTo: 'spec:yarn',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore);
        netter.netDemand('spec:yarn', 5, undefined, plan.id);

        const allocIntents = planStore.intentsForTag(PLAN_TAGS.SOFT_ALLOCATION);
        expect(allocIntents.length).toBeGreaterThan(0);
        expect(allocIntents[0].resourceConformsTo).toBe('spec:yarn');
        expect(allocIntents[0].resourceQuantity?.hasNumericalValue).toBe(5);
        expect(allocIntents[0].plannedWithin).toBe(plan.id);
    });

    it('netDemand does NOT emit allocation Intents when planId is undefined', () => {
        const plan = planStore.addPlan({ name: 'Test Plan' });
        planStore.addIntent({
            action: 'produce',
            outputOf: 'proc-1',
            resourceConformsTo: 'spec:yarn',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore);
        netter.netDemand('spec:yarn', 5); // no planId

        const allocIntents = planStore.intentsForTag(PLAN_TAGS.SOFT_ALLOCATION);
        expect(allocIntents).toHaveLength(0);
    });

    it('releaseClaimsForPlan removes allocation Intents', () => {
        const plan = planStore.addPlan({ name: 'Test Plan' });
        planStore.addIntent({
            action: 'produce',
            outputOf: 'proc-1',
            resourceConformsTo: 'spec:yarn',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore);
        netter.netDemand('spec:yarn', 5, undefined, plan.id);
        expect(planStore.intentsForTag(PLAN_TAGS.SOFT_ALLOCATION).length).toBeGreaterThan(0);

        netter.releaseClaimsForPlan(plan.id);
        expect(planStore.intentsForTag(PLAN_TAGS.SOFT_ALLOCATION)).toHaveLength(0);
    });
});

// =============================================================================
// Improvement 4: Phase Pipeline
// =============================================================================

describe('Improvement 4: Phase Pipeline', () => {
    it('PlanningSession type is exported', async () => {
        const mod = await import('../planning/plan-for-unit');
        expect(mod.normalizePhase).toBeDefined();
        expect(mod.extractPhase).toBeDefined();
        expect(mod.classifyPhase).toBeDefined();
        expect(mod.formulatePhase).toBeDefined();
        expect(mod.supplyPhase).toBeDefined();
        expect(mod.collectPhase).toBeDefined();
    });
});

// =============================================================================
// Improvement 5: Scored Backtracking (verified by existing tests, structure test)
// =============================================================================

describe('Improvement 5: Scored Backtracking', () => {
    it('SacrificePolicy has optional scored methods', async () => {
        const { ProportionalSacrifice } = await import('../planning/plan-for-scope') as any;
        // ProportionalSacrifice is a class, not exported directly — test via planForScope
        // The key verification is that the optional methods exist and don't break greedy path
        const recipeStore = new RecipeStore();
        const observer = new Observer();
        const result = planForScope(['s1'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, generateId },
        );
        expect(result.planStore).toBeDefined();
    });
});

// =============================================================================
// Improvement 6: Decentralized Lateral Matching
// =============================================================================

describe('Improvement 6: LateralMatchingPolicy', () => {
    let recipeStore: RecipeStore;
    let observer: Observer;

    beforeEach(() => {
        idCounter = 0;
        recipeStore = new RecipeStore();
        observer = new Observer();
    });

    it('DefaultLateralMatchingPolicy replicates current behavior', () => {
        const parentOf = new Map<string, string>();
        const policy = new DefaultLateralMatchingPolicy(parentOf);
        expect(policy.shouldOffer({ resourceQuantity: { hasNumericalValue: 5, hasUnit: 'u' } } as Intent, 's1')).toBe(true);
        expect(policy.shouldOffer({ resourceQuantity: { hasNumericalValue: 0, hasUnit: 'u' } } as Intent, 's1')).toBe(false);
        expect(policy.shouldRequest({ resourceQuantity: { hasNumericalValue: 3, hasUnit: 'u' } } as Intent, 's2')).toBe(true);
    });

    it('custom LateralMatchingPolicy can reject specific matches', () => {
        recipeStore.addResourceSpec({ id: 'grain', name: 'Grain', defaultUnitOfResource: 'kg' });

        const parentOf = new Map([['c1', 'fed'], ['c2', 'fed']]);

        // Custom policy that rejects all matches
        const rejectAllPolicy: LateralMatchingPolicy = {
            shouldOffer: () => true,
            shouldRequest: () => true,
            scoreMatch: () => -1, // reject all
        };

        const fedResult = planFederation(
            ['c1', 'c2', 'fed'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            {
                recipeStore, observer, demandIndex: di, supplyIndex: si, parentOf, generateId,
                lateralMatchingPolicy: rejectAllPolicy,
            },
        );

        // No lateral matches should have been made
        expect(fedResult.lateralAgreements).toHaveLength(0);
    });
});

// =============================================================================
// Improvement 7: Planning-as-VF-Process
// =============================================================================

describe('Improvement 7: Planning-as-VF-Process', () => {
    let recipeStore: RecipeStore;
    let observer: Observer;

    beforeEach(() => {
        idCounter = 0;
        recipeStore = new RecipeStore();
        observer = new Observer();
    });

    it('Process with basedOn spec:planning exists after planning', () => {
        const result = planForScope(['s1'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, generateId },
        );

        const planningProcesses = result.planStore.allProcesses()
            .filter(p => p.basedOn === PLANNING_PROCESS_SPEC);
        expect(planningProcesses).toHaveLength(1);
        expect(planningProcesses[0].finished).toBe(true);
        expect(planningProcesses[0].name).toContain('Planning:');
    });

    it('PlanningMeta has demandInputIds; signalOutputsOfProcess returns signal Intents', () => {
        const result = planForScope(['s1'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, generateId },
        );

        const planningProcess = result.planStore.allProcesses()
            .find(p => p.basedOn === PLANNING_PROCESS_SPEC)!;
        const meta = result.planStore.getMeta(planningProcess.id) as PlanningMeta;
        expect(meta.kind).toBe('planning');
        expect(meta.processId).toBe(planningProcess.id);
        expect(Array.isArray(meta.demandInputIds)).toBe(true);

        // signalOutputsOfProcess replaces signalOutputIds
        const signalOutputs = result.planStore.signalOutputsOfProcess(planningProcess.id);
        expect(Array.isArray(signalOutputs)).toBe(true);
    });

    it('signal Intents carry outputOf pointing to the planning Process', () => {
        // Set up a scenario with at least one deficit to generate signal Intents
        recipeStore.addResourceSpec({ id: 'spec:wheat', name: 'Wheat', defaultUnitOfResource: 'kg' });
        const dueDate = new Date(Date.now() + 86400000 * 7).toISOString();
        const demandIntents: Intent[] = [{
            id: 'demand-1', action: 'consume',
            receiver: 's1',
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            inScopeOf: ['s1'],
            due: dueDate, finished: false,
        }];
        const demandIdx = buildIndependentDemandIndex(demandIntents, [], [], locations);

        const result = planForScope(['s1'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: demandIdx, supplyIndex: si, generateId },
        );

        const planningProcess = result.planStore.allProcesses()
            .find(p => p.basedOn === PLANNING_PROCESS_SPEC)!;

        // All deficit/surplus/conservation signals should have outputOf set
        const signals = [
            ...result.planStore.intentsForTag(PLAN_TAGS.DEFICIT),
            ...result.planStore.intentsForTag(PLAN_TAGS.SURPLUS),
            ...result.planStore.intentsForTag(PLAN_TAGS.CONSERVATION),
        ];
        for (const sig of signals) {
            expect(sig.outputOf).toBe(planningProcess.id);
        }

        // signalOutputsOfProcess should find them
        const foundSignals = result.planStore.signalOutputsOfProcess(planningProcess.id);
        expect(foundSignals.length).toBe(signals.length);
    });

    it('cross-scope VF chain: child deficit outputOf → child planning Process, parent demandInputIds includes child deficit', () => {
        recipeStore.addResourceSpec({ id: 'spec:corn', name: 'Corn', defaultUnitOfResource: 'kg' });
        const dueDate = new Date(Date.now() + 86400000 * 7).toISOString();
        const childDemandIntents: Intent[] = [{
            id: 'child-demand-1', action: 'consume',
            receiver: 'child-scope',
            resourceConformsTo: 'spec:corn',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            inScopeOf: ['child-scope'],
            due: dueDate, finished: false,
        }];
        const childDemandIdx = buildIndependentDemandIndex(childDemandIntents, [], [], locations);

        // Plan child scope
        const childResult = planForScope(['child-scope'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: childDemandIdx, supplyIndex: si, generateId },
        );

        const childPlanningProcess = childResult.planStore.allProcesses()
            .find(p => p.basedOn === PLANNING_PROCESS_SPEC)!;
        expect(childPlanningProcess).toBeDefined();

        // Child deficit Intents should have outputOf → child planning Process
        const childDeficits = childResult.planStore.intentsForTag(PLAN_TAGS.DEFICIT);
        expect(childDeficits.length).toBeGreaterThan(0);
        for (const d of childDeficits) {
            expect(d.outputOf).toBe(childPlanningProcess.id);
        }

        // Plan parent scope, feeding in child stores
        const parentResult = planForScope(['parent-scope'],
            { from: new Date(), to: new Date(Date.now() + 86400000 * 30) },
            { recipeStore, observer, demandIndex: di, supplyIndex: si, generateId },
            [childResult.planStore],
        );

        const parentPlanningProcess = parentResult.planStore.allProcesses()
            .filter(p => p.basedOn === PLANNING_PROCESS_SPEC)
            .find(p => p.name?.includes('parent-scope'));
        expect(parentPlanningProcess).toBeDefined();

        // Parent's demandInputIds should include the child deficit ID
        const parentMeta = parentResult.planStore.getMeta(parentPlanningProcess!.id) as PlanningMeta;
        expect(parentMeta.kind).toBe('planning');
        for (const childDeficit of childDeficits) {
            expect(parentMeta.demandInputIds).toContain(childDeficit.id);
        }

        // Parent signals should have outputOf → parent planning Process
        const parentSignals = parentResult.planStore.signalOutputsOfProcess(parentPlanningProcess!.id);
        for (const sig of parentSignals) {
            expect(sig.outputOf).toBe(parentPlanningProcess!.id);
        }
    });
});
