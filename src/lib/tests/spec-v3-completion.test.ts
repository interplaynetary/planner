import { describe, it, expect, beforeEach } from 'bun:test';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';
import { BufferZoneStore } from '../knowledge/buffer-zones';
import { planForScope } from '../planning/plan-for-scope';
import { planFederation } from '../planning/plan-federation';
import { detectConflicts } from '../planning/plan-for-unit';
import { PlanStore, PLAN_TAGS } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { buildIndependentDemandIndex } from '../indexes/independent-demand';
import { buildIndependentSupplyIndex } from '../indexes/independent-supply';
import { buildSNEIndex, type SNEIndex } from '../algorithms/SNE';
import { buildBufferHealthReport, computeDecoupledLeadTime, recipeLeadTime, orchestrateBufferRecalibration } from '../algorithms/ddmrp';
import type { BufferProfile, Intent } from '../schemas';
import { SpatialThingStore } from '../knowledge/spatial-things';

const locations = new SpatialThingStore();

function makeProfile(id: string): BufferProfile {
    return {
        id, name: id,
        itemType: 'Purchased',
        leadTimeFactor: 1.0,
        variabilityFactor: 0.3,
    };
}

function makeDemandIndex(intents: Intent[]) {
    return buildIndependentDemandIndex(intents, [], [], locations);
}

const horizon = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };

// =============================================================================
// SNE WIRING TESTS
// =============================================================================

describe('SNE wiring', () => {
    let recipeStore: RecipeStore;
    let observer: Observer;
    let idCounter: number;
    const generateId = () => `id-${++idCounter}`;

    beforeEach(() => {
        recipeStore = new RecipeStore();
        observer = new Observer();
        idCounter = 0;
    });

    it('planForScope with sneIndex ranks recipes by embodied labor', () => {
        // Output spec
        recipeStore.addResourceSpec({ id: 'widget', name: 'Widget', defaultUnitOfResource: 'unit' });
        // Input specs
        recipeStore.addResourceSpec({ id: 'cheap-input', name: 'Cheap Input', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'expensive-input', name: 'Expensive Input', defaultUnitOfResource: 'unit' });

        // Recipe A: low SNE — 1h direct work, consumes 1 cheap-input (0 SNE = raw material)
        const recipeA = recipeStore.addRecipe({ name: 'Recipe A', primaryOutput: 'widget', recipeProcesses: [] });
        const procA = recipeStore.addRecipeProcess({ name: 'Recipe A (cheap)' });
        (recipeA.recipeProcesses ??= []).push(procA.id);
        recipeStore.addRecipeFlow({
            action: 'work', recipeInputOf: procA.id,
            effortQuantity: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        recipeStore.addRecipeFlow({
            action: 'consume', recipeInputOf: procA.id,
            resourceConformsTo: 'cheap-input',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: procA.id,
            resourceConformsTo: 'widget',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });

        // Recipe B: high SNE — 5h direct work, consumes 1 expensive-input
        const recipeB = recipeStore.addRecipe({ name: 'Recipe B', primaryOutput: 'widget', recipeProcesses: [] });
        const procB = recipeStore.addRecipeProcess({ name: 'Recipe B (expensive)' });
        (recipeB.recipeProcesses ??= []).push(procB.id);
        recipeStore.addRecipeFlow({
            action: 'work', recipeInputOf: procB.id,
            effortQuantity: { hasNumericalValue: 5, hasUnit: 'hours' },
        });
        recipeStore.addRecipeFlow({
            action: 'consume', recipeInputOf: procB.id,
            resourceConformsTo: 'expensive-input',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: procB.id,
            resourceConformsTo: 'widget',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });

        // Provide SNE index — recipe A should score lower (better)
        const sneIndex = buildSNEIndex(recipeStore);
        expect(sneIndex.get('widget')).toBeLessThan(5); // should pick recipe A's SNE (~1)

        // Demand for 2 widgets
        const demandIntent: Intent = {
            id: 'demand-widget', action: 'transfer', resourceConformsTo: 'widget',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'unit' },
            due: '2026-01-15T00:00:00.000Z', inScopeOf: ['c1'],
        };
        const di = makeDemandIndex([demandIntent]);
        const si = buildIndependentSupplyIndex([], [], [], new Observer(), locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            generateId, sneIndex,
        });

        // Verify processes were created using the cheaper recipe
        const processes = result.planStore.allProcesses();
        const recipeAUsed = processes.some(p => p.name?.includes('Recipe A'));
        expect(recipeAUsed).toBe(true);
    });

    it('planForScope without sneIndex falls back to SNLT', () => {
        recipeStore.addResourceSpec({ id: 'gizmo', name: 'Gizmo', defaultUnitOfResource: 'unit' });

        // One recipe with 2h work
        const recipe = recipeStore.addRecipe({ name: 'Gizmo Recipe', primaryOutput: 'gizmo', recipeProcesses: [] });
        const proc = recipeStore.addRecipeProcess({ name: 'Gizmo Recipe' });
        (recipe.recipeProcesses ??= []).push(proc.id);
        recipeStore.addRecipeFlow({
            action: 'work', recipeInputOf: proc.id,
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: proc.id,
            resourceConformsTo: 'gizmo',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });

        const demandIntent: Intent = {
            id: 'demand-gizmo', action: 'transfer', resourceConformsTo: 'gizmo',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
            due: '2026-01-15T00:00:00.000Z', inScopeOf: ['c1'],
        };
        const di = makeDemandIndex([demandIntent]);
        const si = buildIndependentSupplyIndex([], [], [], new Observer(), locations);

        // No sneIndex provided — should still work (SNLT fallback)
        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si, generateId,
        });

        const processes = result.planStore.allProcesses();
        expect(processes.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// LABOR CAPACITY TESTS
// =============================================================================

describe('labor capacity ceiling', () => {
    it('detectConflicts emits capacity-contention when agent overbooked', () => {
        const generateId = (() => { let n = 0; return () => `id-${++n}`; })();
        const processes = new ProcessRegistry(generateId);
        const planStore = new PlanStore(processes, generateId);
        const observer = new Observer();

        const planId = 'p1';
        planStore.addPlan({ id: planId, name: 'Test plan' });

        // Agent "alice" has 8h capacity via capacity resource
        observer.seedCapacityResource({ agentId: 'alice', hoursAvailable: 8 });

        // Add 12h of work commitments for alice
        const proc = processes.register({ id: 'proc-1', name: 'Work process', plannedWithin: planId });
        planStore.addCommitment({
            id: 'c1', action: 'work', provider: 'alice', inputOf: proc.id,
            effortQuantity: { hasNumericalValue: 7, hasUnit: 'hours' },
            plannedWithin: planId, finished: false,
        });
        planStore.addCommitment({
            id: 'c2', action: 'work', provider: 'alice', inputOf: proc.id,
            effortQuantity: { hasNumericalValue: 5, hasUnit: 'hours' },
            plannedWithin: planId, finished: false,
        });

        const conflicts = detectConflicts(planStore, observer);
        const capacityConflicts = conflicts.filter(c => c.type === 'capacity-contention');
        expect(capacityConflicts).toHaveLength(1);
        expect(capacityConflicts[0].resourceOrAgentId).toBe('alice');
        expect(capacityConflicts[0].overclaimed).toBe(12);
    });

    it('detectConflicts skips capacity check when no capacity resource exists', () => {
        const generateId = (() => { let n = 0; return () => `id-${++n}`; })();
        const processes = new ProcessRegistry(generateId);
        const planStore = new PlanStore(processes, generateId);
        const observer = new Observer();

        const planId = 'p1';
        planStore.addPlan({ id: planId, name: 'Test plan' });

        const proc = processes.register({ id: 'proc-1', name: 'Work process', plannedWithin: planId });
        planStore.addCommitment({
            id: 'c1', action: 'work', provider: 'alice', inputOf: proc.id,
            effortQuantity: { hasNumericalValue: 100, hasUnit: 'hours' },
            plannedWithin: planId, finished: false,
        });

        // No capacity resource → no capacity-contention conflict
        const conflicts = detectConflicts(planStore, observer);
        const capacityConflicts = conflicts.filter(c => c.type === 'capacity-contention');
        expect(capacityConflicts).toHaveLength(0);
    });
});

// =============================================================================
// PHASE B ROUTING TESTS
// =============================================================================

describe('Phase B supply routing to buffers', () => {
    let recipeStore: RecipeStore;
    let observer: Observer;
    let bzStore: BufferZoneStore;
    let idCounter: number;
    let bufferProfiles: Map<string, BufferProfile>;
    const generateId = () => `id-${++idCounter}`;

    beforeEach(() => {
        recipeStore = new RecipeStore();
        observer = new Observer();
        bzStore = new BufferZoneStore();
        bufferProfiles = new Map();
        idCounter = 0;
    });

    it('surplus routed to red buffer instead of becoming SurplusSignal', () => {
        recipeStore.addResourceSpec({
            id: 'steel', name: 'Steel',
            resourceClassifiedAs: [],
            defaultUnitOfResource: 'kg',
        });

        // Red buffer: onhand=5, tor=30, toy=60, tog=100
        observer.seedResource({
            id: 'r-steel', name: 'Steel stock',
            conformsTo: 'steel', onhandQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            custodianScope: 'c1',
        });
        bzStore.addBufferZone({
            id: 'bz-steel', specId: 'steel', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p1', makeProfile('p1'));

        // Extra supply: 50kg steel as inventory (no demand to consume it → surplus via dependentSupply)
        observer.seedResource({
            id: 'r-steel-extra', name: 'Steel surplus stock',
            conformsTo: 'steel', onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            custodianScope: 'c1',
        });

        const di = makeDemandIndex([]);
        const si = buildIndependentSupplyIndex([], [], [], new Observer(), locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, bufferProfiles, generateId,
        });

        // With buffer-first active, a replenishment signal should be emitted for the red buffer,
        // and/or Phase B routing should route surplus to the stressed buffer.
        const replenSignals = result.planStore.intentsForTag(PLAN_TAGS.REPLENISHMENT)
            .filter(i => i.resourceConformsTo === 'steel');
        const routePlans = result.planStore.allPlans().filter(p => p.name?.startsWith('Route surplus to buffer'));
        expect(replenSignals.length + routePlans.length).toBeGreaterThan(0);
    });

    it('surplus not routed when buffer is green', () => {
        recipeStore.addResourceSpec({
            id: 'copper', name: 'Copper',
            resourceClassifiedAs: [],
            defaultUnitOfResource: 'kg',
        });

        // Green buffer: onhand=80, tor=30, toy=60, tog=100
        observer.seedResource({
            id: 'r-copper', name: 'Copper stock',
            conformsTo: 'copper', onhandQuantity: { hasNumericalValue: 80, hasUnit: 'kg' },
            custodianScope: 'c1',
        });
        bzStore.addBufferZone({
            id: 'bz-copper', specId: 'copper', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        bufferProfiles.set('p1', makeProfile('p1'));

        // No demand, no external supply — just the resource above.
        // Buffer is green → no buffer-route plans should be created.
        const di = makeDemandIndex([]);
        const si = buildIndependentSupplyIndex([], [], [], new Observer(), locations);

        const result = planForScope(['c1'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            bufferZoneStore: bzStore, bufferProfiles, generateId,
        });

        // No buffer-route plans (green buffer doesn't need routing)
        const routePlans = result.planStore.allPlans().filter(p => p.name?.startsWith('Route surplus to buffer'));
        expect(routePlans).toHaveLength(0);

        // No Pass 0 replenishment (buffer is healthy)
        const pass0Plans = result.planStore.allPlans().filter(p => p.name?.startsWith('Buffer-first replenishment'));
        expect(pass0Plans).toHaveLength(0);
    });
});

// =============================================================================
// BUFFER HEALTH REPORT TESTS
// =============================================================================

describe('BufferHealthReport', () => {
    let observer: Observer;
    let bzStore: BufferZoneStore;

    beforeEach(() => {
        observer = new Observer();
        bzStore = new BufferZoneStore();
    });

    it('buildBufferHealthReport aggregates zone counts', () => {
        const generateId = (() => { let n = 0; return () => `id-${++n}`; })();
        const processes = new ProcessRegistry(generateId);
        const planStore = new PlanStore(processes, generateId);

        // Red buffer 1: onhand=5, tor=30
        bzStore.addBufferZone({
            id: 'bz1', specId: 'spec-red1', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        observer.seedResource({
            id: 'r1', name: 'R1', conformsTo: 'spec-red1',
            onhandQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
        });

        // Red buffer 2: onhand=10, tor=30
        bzStore.addBufferZone({
            id: 'bz2', specId: 'spec-red2', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        observer.seedResource({
            id: 'r2', name: 'R2', conformsTo: 'spec-red2',
            onhandQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
        });

        // Yellow buffer: onhand=50, tor=30, toy=60
        bzStore.addBufferZone({
            id: 'bz3', specId: 'spec-yellow', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        observer.seedResource({
            id: 'r3', name: 'R3', conformsTo: 'spec-yellow',
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });

        // Green buffer: onhand=80, toy=60, tog=100
        bzStore.addBufferZone({
            id: 'bz4', specId: 'spec-green', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        observer.seedResource({
            id: 'r4', name: 'R4', conformsTo: 'spec-green',
            onhandQuantity: { hasNumericalValue: 80, hasUnit: 'kg' },
        });

        const report = buildBufferHealthReport(bzStore, undefined, planStore, observer);

        expect(report.summary.redCount).toBe(2);
        expect(report.summary.yellowCount).toBe(1);
        expect(report.summary.greenCount).toBe(1);
        expect(report.summary.excessCount).toBe(0);
        expect(report.buffers).toHaveLength(4);
    });

    it('buildBufferHealthReport uses computeNFP when profile available', () => {
        const generateId = (() => { let n = 0; return () => `id-${++n}`; })();
        const processes = new ProcessRegistry(generateId);
        const planStore = new PlanStore(processes, generateId);

        const profiles = new Map<string, BufferProfile>();
        profiles.set('p1', makeProfile('p1'));

        // Buffer with onhand=50 (yellow by raw status) but on-order supply
        // might shift zone when NFP is computed
        bzStore.addBufferZone({
            id: 'bz-nfp', specId: 'spec-nfp', profileId: 'p1',
            bufferClassification: 'replenished_override',
            adu: 5, aduUnit: 'kg', dltDays: 7, moq: 0, moqUnit: 'kg',
            tor: 30, toy: 60, tog: 100, ostHorizonDays: 30,
            lastComputedAt: new Date().toISOString(),
        });
        observer.seedResource({
            id: 'r-nfp', name: 'NFP resource', conformsTo: 'spec-nfp',
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });

        // With profiles → uses computeNFP
        const reportWithProfile = buildBufferHealthReport(bzStore, profiles, planStore, observer);
        // Without profiles → uses raw bufferStatus
        const reportWithout = buildBufferHealthReport(bzStore, undefined, planStore, observer);

        // Both should produce a report with 1 buffer
        expect(reportWithProfile.buffers).toHaveLength(1);
        expect(reportWithout.buffers).toHaveLength(1);
        // The zone classification should be present in both
        expect(reportWithProfile.buffers[0].zone).toBeDefined();
        expect(reportWithout.buffers[0].zone).toBeDefined();
    });
});

// =============================================================================
// DLT SEGMENTATION TESTS
// =============================================================================

describe('DLT segmentation', () => {
    let recipeStore: RecipeStore;

    beforeEach(() => {
        recipeStore = new RecipeStore();
    });

    it('computeDecoupledLeadTime returns full CLT when no buffers exist', () => {
        // Chain: rawMat → processA(2d) → intermed → processB(3d) → final
        recipeStore.addResourceSpec({ id: 'raw', name: 'Raw', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'intermed', name: 'Intermediate', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'final', name: 'Final', defaultUnitOfResource: 'unit' });

        const recipe = recipeStore.addRecipe({ name: 'Full chain', primaryOutput: 'final', recipeProcesses: [] });
        const procA = recipeStore.addRecipeProcess({
            name: 'Process A', hasDuration: { hasNumericalValue: 2, hasUnit: 'days' },
        });
        const procB = recipeStore.addRecipeProcess({
            name: 'Process B', hasDuration: { hasNumericalValue: 3, hasUnit: 'days' },
        });
        (recipe.recipeProcesses ??= []).push(procA.id, procB.id);

        recipeStore.addRecipeFlow({
            action: 'consume', recipeInputOf: procA.id,
            resourceConformsTo: 'raw',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: procA.id,
            resourceConformsTo: 'intermed',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'consume', recipeInputOf: procB.id,
            resourceConformsTo: 'intermed',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: procB.id,
            resourceConformsTo: 'final',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });

        // No buffered specs → full CLT = 2 + 3 = 5 days
        const dlt = computeDecoupledLeadTime('final', new Set(), recipeStore);
        expect(dlt).toBe(5);

        // Verify matches recipeLeadTime
        expect(dlt).toBe(recipeLeadTime(recipe.id, recipeStore));
    });

    it('computeDecoupledLeadTime segments at buffer boundary', () => {
        // Chain: raw → procA(2d) → intermed → procB(3d) → final
        // Buffer on 'intermed' → DLT for 'final' should be 3d (only procB)
        recipeStore.addResourceSpec({ id: 'raw', name: 'Raw', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'intermed', name: 'Intermediate', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'final', name: 'Final', defaultUnitOfResource: 'unit' });

        const recipe = recipeStore.addRecipe({ name: 'Full chain', primaryOutput: 'final', recipeProcesses: [] });
        const procA = recipeStore.addRecipeProcess({
            name: 'Process A', hasDuration: { hasNumericalValue: 2, hasUnit: 'days' },
        });
        const procB = recipeStore.addRecipeProcess({
            name: 'Process B', hasDuration: { hasNumericalValue: 3, hasUnit: 'days' },
        });
        (recipe.recipeProcesses ??= []).push(procA.id, procB.id);

        recipeStore.addRecipeFlow({
            action: 'consume', recipeInputOf: procA.id,
            resourceConformsTo: 'raw',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: procA.id,
            resourceConformsTo: 'intermed',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'consume', recipeInputOf: procB.id,
            resourceConformsTo: 'intermed',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: procB.id,
            resourceConformsTo: 'final',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });

        // Buffer on 'intermed' — DLT for 'final' = 3d (procB only, intermed is decoupled)
        const dlt = computeDecoupledLeadTime('final', new Set(['intermed']), recipeStore);
        expect(dlt).toBe(3);

        // DLT for 'intermed' itself = 2d (procA only, raw is a leaf)
        const dltIntermed = computeDecoupledLeadTime('intermed', new Set(['intermed']), recipeStore);
        expect(dltIntermed).toBe(2);
    });

    it('computeDecoupledLeadTime handles multi-level buffering', () => {
        // Chain: raw → procA(1d) → part1 → procB(2d) → part2 → procC(4d) → final
        // Buffers on part1 AND part2
        // DLT(final) = 4d, DLT(part2) = 2d, DLT(part1) = 1d
        recipeStore.addResourceSpec({ id: 'raw', name: 'Raw', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'part1', name: 'Part 1', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'part2', name: 'Part 2', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'final', name: 'Final', defaultUnitOfResource: 'unit' });

        const recipe = recipeStore.addRecipe({ name: 'Three-stage', primaryOutput: 'final', recipeProcesses: [] });
        const procA = recipeStore.addRecipeProcess({ name: 'A', hasDuration: { hasNumericalValue: 1, hasUnit: 'days' } });
        const procB = recipeStore.addRecipeProcess({ name: 'B', hasDuration: { hasNumericalValue: 2, hasUnit: 'days' } });
        const procC = recipeStore.addRecipeProcess({ name: 'C', hasDuration: { hasNumericalValue: 4, hasUnit: 'days' } });
        (recipe.recipeProcesses ??= []).push(procA.id, procB.id, procC.id);

        recipeStore.addRecipeFlow({ action: 'consume', recipeInputOf: procA.id, resourceConformsTo: 'raw', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });
        recipeStore.addRecipeFlow({ action: 'produce', recipeOutputOf: procA.id, resourceConformsTo: 'part1', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });
        recipeStore.addRecipeFlow({ action: 'consume', recipeInputOf: procB.id, resourceConformsTo: 'part1', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });
        recipeStore.addRecipeFlow({ action: 'produce', recipeOutputOf: procB.id, resourceConformsTo: 'part2', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });
        recipeStore.addRecipeFlow({ action: 'consume', recipeInputOf: procC.id, resourceConformsTo: 'part2', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });
        recipeStore.addRecipeFlow({ action: 'produce', recipeOutputOf: procC.id, resourceConformsTo: 'final', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });

        const buffered = new Set(['part1', 'part2']);
        expect(computeDecoupledLeadTime('final', buffered, recipeStore)).toBe(4);
        expect(computeDecoupledLeadTime('part2', buffered, recipeStore)).toBe(2);
        expect(computeDecoupledLeadTime('part1', buffered, recipeStore)).toBe(1);

        // Full CLT for reference
        expect(recipeLeadTime(recipe.id, recipeStore)).toBe(7);
    });

    it('orchestrateBufferRecalibration uses DLT segmentation automatically', () => {
        // Setup same chain: raw → procA(2d) → intermed → procB(3d) → final
        recipeStore.addResourceSpec({ id: 'raw', name: 'Raw', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'intermed', name: 'Intermediate', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'final', name: 'Final', defaultUnitOfResource: 'unit' });

        const recipe = recipeStore.addRecipe({ name: 'Chain', primaryOutput: 'final', recipeProcesses: [] });
        const procA = recipeStore.addRecipeProcess({ name: 'A', hasDuration: { hasNumericalValue: 2, hasUnit: 'days' } });
        const procB = recipeStore.addRecipeProcess({ name: 'B', hasDuration: { hasNumericalValue: 3, hasUnit: 'days' } });
        (recipe.recipeProcesses ??= []).push(procA.id, procB.id);

        recipeStore.addRecipeFlow({ action: 'consume', recipeInputOf: procA.id, resourceConformsTo: 'raw', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });
        recipeStore.addRecipeFlow({ action: 'produce', recipeOutputOf: procA.id, resourceConformsTo: 'intermed', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });
        recipeStore.addRecipeFlow({ action: 'consume', recipeInputOf: procB.id, resourceConformsTo: 'intermed', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });
        recipeStore.addRecipeFlow({ action: 'produce', recipeOutputOf: procB.id, resourceConformsTo: 'final', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' } });

        const bzStore = new BufferZoneStore();
        const profiles = new Map<string, BufferProfile>();
        profiles.set('p1', makeProfile('p1'));

        // Buffer on 'intermed' with initial dltDays=99 (wrong, should be corrected)
        bzStore.addBufferZone({
            id: 'bz-intermed', specId: 'intermed', profileId: 'p1',
            bufferClassification: 'replenished',
            adu: 10, aduUnit: 'unit', dltDays: 99, moq: 0, moqUnit: 'unit',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });
        // Buffer on 'final' with initial dltDays=99
        bzStore.addBufferZone({
            id: 'bz-final', specId: 'final', profileId: 'p1',
            bufferClassification: 'replenished',
            adu: 10, aduUnit: 'unit', dltDays: 99, moq: 0, moqUnit: 'unit',
            tor: 30, toy: 60, tog: 100,
            lastComputedAt: new Date().toISOString(),
        });

        const asOf = new Date('2026-03-01');
        orchestrateBufferRecalibration(bzStore, profiles, [], [], recipeStore, asOf);

        // After recalibration, DLT should be segmented:
        // 'intermed' DLT = 2d (only procA, raw is a leaf)
        // 'final' DLT = 3d (only procB, intermed is buffered)
        const intermedZone = bzStore.getBufferZone('bz-intermed')!;
        const finalZone = bzStore.getBufferZone('bz-final')!;
        expect(intermedZone.dltDays).toBe(2);
        expect(finalZone.dltDays).toBe(3);
    });
});

// =============================================================================
// FEDERATION CONTEXT THREADING TESTS
// =============================================================================

describe('planFederation threads sneIndex and agentIndex to scopes', () => {
    let recipeStore: RecipeStore;
    let observer: Observer;
    let idCounter: number;
    const generateId = () => `id-${++idCounter}`;

    beforeEach(() => {
        recipeStore = new RecipeStore();
        observer = new Observer();
        idCounter = 0;
    });

    it('federation uses SNE-preferred recipe when sneIndex provided', () => {
        // Output spec
        recipeStore.addResourceSpec({ id: 'widget', name: 'Widget', defaultUnitOfResource: 'unit' });
        // Input specs
        recipeStore.addResourceSpec({ id: 'cheap-input', name: 'Cheap Input', defaultUnitOfResource: 'unit' });
        recipeStore.addResourceSpec({ id: 'expensive-input', name: 'Expensive Input', defaultUnitOfResource: 'unit' });

        // Recipe A: low SNE — 1h direct work, consumes 1 cheap-input
        const recipeA = recipeStore.addRecipe({ name: 'Recipe A', primaryOutput: 'widget', recipeProcesses: [] });
        const procA = recipeStore.addRecipeProcess({ name: 'Recipe A (cheap)' });
        (recipeA.recipeProcesses ??= []).push(procA.id);
        recipeStore.addRecipeFlow({
            action: 'work', recipeInputOf: procA.id,
            effortQuantity: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        recipeStore.addRecipeFlow({
            action: 'consume', recipeInputOf: procA.id,
            resourceConformsTo: 'cheap-input',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: procA.id,
            resourceConformsTo: 'widget',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });

        // Recipe B: high SNE — 5h direct work, consumes 1 expensive-input
        const recipeB = recipeStore.addRecipe({ name: 'Recipe B', primaryOutput: 'widget', recipeProcesses: [] });
        const procB = recipeStore.addRecipeProcess({ name: 'Recipe B (expensive)' });
        (recipeB.recipeProcesses ??= []).push(procB.id);
        recipeStore.addRecipeFlow({
            action: 'work', recipeInputOf: procB.id,
            effortQuantity: { hasNumericalValue: 5, hasUnit: 'hours' },
        });
        recipeStore.addRecipeFlow({
            action: 'consume', recipeInputOf: procB.id,
            resourceConformsTo: 'expensive-input',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });
        recipeStore.addRecipeFlow({
            action: 'produce', recipeOutputOf: procB.id,
            resourceConformsTo: 'widget',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });

        const sneIndex = buildSNEIndex(recipeStore);

        // 2-scope federation: c1 (leaf) → c2 (root)
        const parentOf = new Map([['c1', 'c2']]);

        // Demand for 2 widgets in scope c1
        const demandIntent: Intent = {
            id: 'demand-widget', action: 'transfer', resourceConformsTo: 'widget',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'unit' },
            due: '2026-01-15T00:00:00.000Z', inScopeOf: ['c1'],
        };
        const di = makeDemandIndex([demandIntent]);
        const si = buildIndependentSupplyIndex([], [], [], new Observer(), locations);

        const result = planFederation(['c1', 'c2'], horizon, {
            recipeStore, observer, demandIndex: di, supplyIndex: si,
            parentOf, generateId, sneIndex,
        });

        // Verify scope c1 was planned and used Recipe A (cheaper by SNE)
        const c1Result = result.byScope.get('c1')!;
        const processes = c1Result.planStore.allProcesses();
        const recipeAUsed = processes.some(p => p.name?.includes('Recipe A'));
        expect(recipeAUsed).toBe(true);
    });
});
