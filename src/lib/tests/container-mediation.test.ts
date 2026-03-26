/**
 * Container Mediation — resolveFromFlow tests.
 *
 * Verifies that a RecipeFlow with resolveFromFlow can consume resources
 * contained within a container that a sibling `use` flow resolved to.
 *
 * Primary scenario: ecological buffers (soil nutrients).
 *   - A harvesting process `use`s soil (durable)
 *   - The same process `consume`s nitrogen containedIn that soil
 *   - The consume flow has resolveFromFlow pointing to the use flow
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { dependentDemand, CONTAINER_BOUND_TAG } from '../algorithms/dependent-demand';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';

describe('Container Mediation (resolveFromFlow)', () => {
    let planStore: PlanStore;
    let recipes: RecipeStore;
    let processReg: ProcessRegistry;
    let observer: Observer;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
        recipes = new RecipeStore();
        observer = new Observer(processReg);
    });

    /** Helper: set up the soil/nitrogen/food harvesting recipe. */
    function setupHarvestRecipe() {
        recipes.addResourceSpec({ id: 'spec:topsoil', name: 'Topsoil', defaultUnitOfResource: 'plot' });
        recipes.addResourceSpec({ id: 'spec:nitrogen', name: 'Nitrogen', defaultUnitOfResource: 'kg' });
        recipes.addResourceSpec({ id: 'spec:food', name: 'Food', defaultUnitOfResource: 'kg' });

        const proc = recipes.addRecipeProcess({
            id: 'rp:harvest',
            name: 'Harvest',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });

        const recipe = recipes.addRecipe({
            name: 'Harvest Crop',
            primaryOutput: 'spec:food',
            recipeProcesses: [proc.id],
        });

        // Use soil (durable — soil persists)
        recipes.addRecipeFlow({
            id: 'rf:use-soil',
            action: 'use',
            resourceConformsTo: 'spec:topsoil',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
            recipeInputOf: proc.id,
        });

        // Consume nitrogen from within the soil (container-mediated)
        recipes.addRecipeFlow({
            id: 'rf:consume-nitrogen',
            action: 'consume',
            resourceConformsTo: 'spec:nitrogen',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            recipeInputOf: proc.id,
            resolveFromFlow: 'rf:use-soil',
        });

        // Produce food
        recipes.addRecipeFlow({
            id: 'rf:produce-food',
            action: 'produce',
            resourceConformsTo: 'spec:food',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            recipeOutputOf: proc.id,
        });

        return { recipe, proc };
    }

    // ─── T1: Basic use-mediated consumption ──────────────────────────────────

    test('consumes nitrogen from within the used soil container', () => {
        setupHarvestRecipe();

        // Seed soil and contained nitrogen
        observer.seedResource({
            id: 'res:field-a-soil',
            conformsTo: 'spec:topsoil',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
            onhandQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
        });
        observer.seedResource({
            id: 'res:field-a-nitrogen',
            conformsTo: 'spec:nitrogen',
            accountingQuantity: { hasNumericalValue: 20, hasUnit: 'kg' },
            containedIn: 'res:field-a-soil',
        });

        const plan = planStore.addPlan({ name: 'Harvest Plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:food',
            demandQuantity: 10,
            dueDate: new Date('2026-06-01T00:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Should have created 1 process (Harvest)
        expect(result.processes).toHaveLength(1);

        // Soil should be booked via use-Intent
        const useIntents = result.intents.filter(i => i.action === 'use');
        expect(useIntents).toHaveLength(1);
        expect(useIntents[0].resourceConformsTo).toBe('spec:topsoil');
        expect(useIntents[0].resourceInventoriedAs).toBe('res:field-a-soil');

        // Nitrogen should be allocated from contained inventory (not a purchase intent)
        const nitrogenAllocated = result.allocated.filter(a => a.specId === 'spec:nitrogen');
        expect(nitrogenAllocated).toHaveLength(1);
        expect(nitrogenAllocated[0].resourceId).toBe('res:field-a-nitrogen');
        expect(nitrogenAllocated[0].quantity).toBe(5);

        // No purchase intents for nitrogen
        const nitrogenPurchase = result.purchaseIntents.filter(
            i => i.resourceConformsTo === 'spec:nitrogen',
        );
        expect(nitrogenPurchase).toHaveLength(0);
    });

    // ─── T2: Anchor failure cascades to dependents ───────────────────────────

    test('when no soil available, both soil and nitrogen become purchase intents', () => {
        setupHarvestRecipe();

        // No resources seeded — soil unavailable

        const plan = planStore.addPlan({ name: 'Harvest Plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:food',
            demandQuantity: 10,
            dueDate: new Date('2026-06-01T00:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Soil use-slot conflict → purchase intent
        const soilPurchase = result.purchaseIntents.filter(
            i => i.resourceConformsTo === 'spec:topsoil',
        );
        expect(soilPurchase).toHaveLength(1);

        // Nitrogen dependent → purchase intent (anchor failed)
        const nitrogenPurchase = result.purchaseIntents.filter(
            i => i.resourceConformsTo === 'spec:nitrogen',
        );
        expect(nitrogenPurchase).toHaveLength(1);
        expect(nitrogenPurchase[0].note).toContain('anchor flow');
    });

    // ─── T3: Multiple containers — correct one selected ──────────────────────

    test('resolves nitrogen from the specific soil instance that was booked', () => {
        setupHarvestRecipe();

        // Two soil instances, each with different nitrogen levels
        observer.seedResource({
            id: 'res:field-a-soil',
            conformsTo: 'spec:topsoil',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
            onhandQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
        });
        observer.seedResource({
            id: 'res:field-a-nitrogen',
            conformsTo: 'spec:nitrogen',
            accountingQuantity: { hasNumericalValue: 3, hasUnit: 'kg' },
            containedIn: 'res:field-a-soil',
        });
        observer.seedResource({
            id: 'res:field-b-soil',
            conformsTo: 'spec:topsoil',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
            onhandQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
        });
        observer.seedResource({
            id: 'res:field-b-nitrogen',
            conformsTo: 'spec:nitrogen',
            accountingQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
            containedIn: 'res:field-b-soil',
        });

        const plan = planStore.addPlan({ name: 'Harvest Plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:food',
            demandQuantity: 10,
            dueDate: new Date('2026-06-01T00:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // A soil was booked
        const useIntents = result.intents.filter(i => i.action === 'use');
        expect(useIntents).toHaveLength(1);
        const bookedSoil = useIntents[0].resourceInventoriedAs!;

        // Nitrogen should come from the SAME soil that was booked
        const nitrogenAllocated = result.allocated.filter(a => a.specId === 'spec:nitrogen');
        expect(nitrogenAllocated).toHaveLength(1);
        expect(nitrogenAllocated[0].resourceId).toContain(
            bookedSoil.replace('-soil', '-nitrogen'),
        );
    });

    // ─── T4: Insufficient contained quantity ─────────────────────────────────

    test('partial allocation with purchase intent for shortfall', () => {
        setupHarvestRecipe();

        observer.seedResource({
            id: 'res:field-a-soil',
            conformsTo: 'spec:topsoil',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
            onhandQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
        });
        // Only 2 kg nitrogen, but recipe needs 5
        observer.seedResource({
            id: 'res:field-a-nitrogen',
            conformsTo: 'spec:nitrogen',
            accountingQuantity: { hasNumericalValue: 2, hasUnit: 'kg' },
            containedIn: 'res:field-a-soil',
        });

        const plan = planStore.addPlan({ name: 'Harvest Plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:food',
            demandQuantity: 10,
            dueDate: new Date('2026-06-01T00:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // 2 kg allocated from contained inventory
        const nitrogenAllocated = result.allocated.filter(a => a.specId === 'spec:nitrogen');
        expect(nitrogenAllocated).toHaveLength(1);
        expect(nitrogenAllocated[0].quantity).toBe(2);

        // 3 kg shortfall → purchase intent
        const nitrogenPurchase = result.purchaseIntents.filter(
            i => i.resourceConformsTo === 'spec:nitrogen',
        );
        expect(nitrogenPurchase).toHaveLength(1);
        expect(nitrogenPurchase[0].resourceQuantity?.hasNumericalValue).toBe(3);
    });

    // ─── T5: Scale factor ────────────────────────────────────────────────────

    test('scales contained consumption by demand factor', () => {
        setupHarvestRecipe();

        observer.seedResource({
            id: 'res:field-a-soil',
            conformsTo: 'spec:topsoil',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
            onhandQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
        });
        // 50 kg nitrogen — enough for 3x demand (3 * 5 = 15)
        observer.seedResource({
            id: 'res:field-a-nitrogen',
            conformsTo: 'spec:nitrogen',
            accountingQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            containedIn: 'res:field-a-soil',
        });

        const plan = planStore.addPlan({ name: 'Harvest Plan' });
        // Demand 30 kg food (recipe produces 10 per run → scale factor 3)
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:food',
            demandQuantity: 30,
            dueDate: new Date('2026-06-01T00:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // 3x scale → 15 kg nitrogen consumed
        const nitrogenAllocated = result.allocated.filter(a => a.specId === 'spec:nitrogen');
        expect(nitrogenAllocated).toHaveLength(1);
        expect(nitrogenAllocated[0].quantity).toBe(15);

        // No purchase intent for nitrogen (50 kg available, only 15 needed)
        const nitrogenPurchase = result.purchaseIntents.filter(
            i => i.resourceConformsTo === 'spec:nitrogen',
        );
        expect(nitrogenPurchase).toHaveLength(0);
    });

    // ─── T6: Validation ──────────────────────────────────────────────────────

    describe('validateRecipe', () => {
        test('error when resolveFromFlow points to non-sibling flow', () => {
            recipes.addResourceSpec({ id: 'spec:a', name: 'A', defaultUnitOfResource: 'ea' });
            recipes.addResourceSpec({ id: 'spec:b', name: 'B', defaultUnitOfResource: 'ea' });

            const proc = recipes.addRecipeProcess({
                id: 'rp:1', name: 'Proc1',
                hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
            });
            const recipe = recipes.addRecipe({
                name: 'Bad Recipe', primaryOutput: 'spec:a', recipeProcesses: [proc.id],
            });
            recipes.addRecipeFlow({
                id: 'rf:out', action: 'produce',
                resourceConformsTo: 'spec:a',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                recipeOutputOf: proc.id,
            });
            recipes.addRecipeFlow({
                id: 'rf:dep', action: 'consume',
                resourceConformsTo: 'spec:b',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                recipeInputOf: proc.id,
                resolveFromFlow: 'rf:nonexistent',
            });

            const errors = recipes.validateRecipe(recipe.id);
            expect(errors.some(e => e.includes('resolveFromFlow') && e.includes('not a sibling'))).toBe(true);
        });

        test('error when resolveFromFlow anchor is not a durable action', () => {
            recipes.addResourceSpec({ id: 'spec:a', name: 'A', defaultUnitOfResource: 'ea' });
            recipes.addResourceSpec({ id: 'spec:b', name: 'B', defaultUnitOfResource: 'ea' });
            recipes.addResourceSpec({ id: 'spec:c', name: 'C', defaultUnitOfResource: 'ea' });

            const proc = recipes.addRecipeProcess({
                id: 'rp:1', name: 'Proc1',
                hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
            });
            const recipe = recipes.addRecipe({
                name: 'Bad Recipe', primaryOutput: 'spec:a', recipeProcesses: [proc.id],
            });
            recipes.addRecipeFlow({
                id: 'rf:out', action: 'produce',
                resourceConformsTo: 'spec:a',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                recipeOutputOf: proc.id,
            });
            // Anchor is consume (not durable)
            recipes.addRecipeFlow({
                id: 'rf:anchor', action: 'consume',
                resourceConformsTo: 'spec:b',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                recipeInputOf: proc.id,
            });
            recipes.addRecipeFlow({
                id: 'rf:dep', action: 'consume',
                resourceConformsTo: 'spec:c',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                recipeInputOf: proc.id,
                resolveFromFlow: 'rf:anchor',
            });

            const errors = recipes.validateRecipe(recipe.id);
            expect(errors.some(e => e.includes('resolveFromFlow') && e.includes("only 'use'"))).toBe(true);
        });

        test('error when resolveFromFlow anchor is cite (not use)', () => {
            recipes.addResourceSpec({ id: 'spec:a', name: 'A', defaultUnitOfResource: 'ea' });
            recipes.addResourceSpec({ id: 'spec:b', name: 'B', defaultUnitOfResource: 'ea' });
            recipes.addResourceSpec({ id: 'spec:c', name: 'C', defaultUnitOfResource: 'ea' });

            const proc = recipes.addRecipeProcess({
                id: 'rp:1', name: 'Proc1',
                hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
            });
            const recipe = recipes.addRecipe({
                name: 'Bad Recipe', primaryOutput: 'spec:a', recipeProcesses: [proc.id],
            });
            recipes.addRecipeFlow({
                id: 'rf:out', action: 'produce',
                resourceConformsTo: 'spec:a',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                recipeOutputOf: proc.id,
            });
            // Anchor is cite — durable but not 'use'
            recipes.addRecipeFlow({
                id: 'rf:cite-anchor', action: 'cite',
                resourceConformsTo: 'spec:b',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                recipeInputOf: proc.id,
            });
            recipes.addRecipeFlow({
                id: 'rf:dep', action: 'consume',
                resourceConformsTo: 'spec:c',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                recipeInputOf: proc.id,
                resolveFromFlow: 'rf:cite-anchor',
            });

            const errors = recipes.validateRecipe(recipe.id);
            expect(errors.some(e => e.includes('resolveFromFlow') && e.includes("only 'use'"))).toBe(true);
        });

        test('no error for valid resolveFromFlow pointing to use anchor', () => {
            setupHarvestRecipe();
            const recipe = [...(recipes as any).recipes.values()][0];
            const errors = recipes.validateRecipe(recipe.id);
            expect(errors.filter(e => e.includes('resolveFromFlow'))).toHaveLength(0);
        });
    });

    // ─── T7: Backward compatibility — containment guard preserved ────────────

    test('contained resources without resolveFromFlow are still invisible to netting', () => {
        // Simple recipe that consumes nitrogen (no resolveFromFlow)
        recipes.addResourceSpec({ id: 'spec:nitrogen', name: 'Nitrogen', defaultUnitOfResource: 'kg' });
        recipes.addResourceSpec({ id: 'spec:fertilizer', name: 'Fertilizer', defaultUnitOfResource: 'kg' });

        const proc = recipes.addRecipeProcess({
            name: 'Make Fertilizer',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        recipes.addRecipe({
            name: 'Fertilizer Recipe',
            primaryOutput: 'spec:fertilizer',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:nitrogen',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            recipeInputOf: proc.id,
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:fertilizer',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            recipeOutputOf: proc.id,
        });

        // Nitrogen is contained in soil — should NOT be visible to normal netting
        observer.seedResource({
            id: 'res:soil',
            conformsTo: 'spec:topsoil',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
        });
        observer.seedResource({
            id: 'res:contained-nitrogen',
            conformsTo: 'spec:nitrogen',
            accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            containedIn: 'res:soil',
        });

        const plan = planStore.addPlan({ name: 'Fertilizer Plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:fertilizer',
            demandQuantity: 10,
            dueDate: new Date('2026-06-01T00:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Nitrogen is contained → invisible to normal netting → purchase intent
        const nitrogenPurchase = result.purchaseIntents.filter(
            i => i.resourceConformsTo === 'spec:nitrogen',
        );
        expect(nitrogenPurchase).toHaveLength(1);
        expect(nitrogenPurchase[0].resourceQuantity?.hasNumericalValue).toBe(5);

        // No nitrogen was allocated from inventory
        const nitrogenAllocated = result.allocated.filter(a => a.specId === 'spec:nitrogen');
        expect(nitrogenAllocated).toHaveLength(0);
    });

    // ─── T8: Scheduled output not absorbed for container-mediated demand ──────

    test('scheduled produce intent for nitrogen is NOT absorbed by container-mediated demand', () => {
        setupHarvestRecipe();

        // Soil with only 2 kg nitrogen (need 5)
        observer.seedResource({
            id: 'res:field-a-soil',
            conformsTo: 'spec:topsoil',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
            onhandQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
        });
        observer.seedResource({
            id: 'res:field-a-nitrogen',
            conformsTo: 'spec:nitrogen',
            accountingQuantity: { hasNumericalValue: 2, hasUnit: 'kg' },
            containedIn: 'res:field-a-soil',
        });

        // Pre-existing scheduled output: 10 kg nitrogen being produced (free-standing)
        const prePlan = planStore.addPlan({ name: 'Fertilizer Plan' });
        const preProc = processReg.register({
            name: 'Composting',
            plannedWithin: prePlan.id,
            finished: false,
        });
        planStore.addIntent({
            action: 'produce',
            resourceConformsTo: 'spec:nitrogen',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            outputOf: preProc.id,
            plannedWithin: prePlan.id,
            due: new Date('2026-05-01T00:00:00Z').toISOString(),
            finished: false,
        });

        const plan = planStore.addPlan({ name: 'Harvest Plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:food',
            demandQuantity: 10,
            dueDate: new Date('2026-06-01T00:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Only 2 kg allocated from contained inventory
        const nitrogenAllocated = result.allocated.filter(a => a.specId === 'spec:nitrogen');
        expect(nitrogenAllocated).toHaveLength(1);
        expect(nitrogenAllocated[0].quantity).toBe(2);

        // 3 kg shortfall → purchase intent (NOT absorbed from the scheduled 10 kg)
        const nitrogenPurchase = result.purchaseIntents.filter(
            i => i.resourceConformsTo === 'spec:nitrogen',
        );
        expect(nitrogenPurchase).toHaveLength(1);
        expect(nitrogenPurchase[0].resourceQuantity?.hasNumericalValue).toBe(3);
    });

    // ─── T10: Produce-into-container ─────────────────────────────────────────

    describe('produce-into-container', () => {
        /** Helper: cover cropping recipe that produces nitrogen INTO soil. */
        function setupCoverCropRecipe() {
            recipes.addResourceSpec({ id: 'spec:topsoil', name: 'Topsoil', defaultUnitOfResource: 'plot' });
            recipes.addResourceSpec({ id: 'spec:nitrogen', name: 'Nitrogen', defaultUnitOfResource: 'kg' });
            recipes.addResourceSpec({ id: 'spec:cover-crop', name: 'Cover Crop Biomass', defaultUnitOfResource: 'kg' });

            const proc = recipes.addRecipeProcess({
                id: 'rp:cover-crop',
                name: 'Cover Cropping',
                hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
            });

            const recipe = recipes.addRecipe({
                name: 'Cover Crop',
                primaryOutput: 'spec:nitrogen',
                recipeProcesses: [proc.id],
            });

            // Use soil (anchor)
            recipes.addRecipeFlow({
                id: 'rf:use-soil',
                action: 'use',
                resourceConformsTo: 'spec:topsoil',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
                recipeInputOf: proc.id,
            });

            // Consume cover crop biomass (normal input)
            recipes.addRecipeFlow({
                id: 'rf:consume-biomass',
                action: 'consume',
                resourceConformsTo: 'spec:cover-crop',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
                recipeInputOf: proc.id,
            });

            // Produce nitrogen INTO the soil (container-mediated output)
            recipes.addRecipeFlow({
                id: 'rf:produce-nitrogen',
                action: 'produce',
                resourceConformsTo: 'spec:nitrogen',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
                recipeOutputOf: proc.id,
                resolveFromFlow: 'rf:use-soil',
            });

            return { recipe, proc };
        }

        test('produce intent is tagged CONTAINER_BOUND when anchor resolves', () => {
            setupCoverCropRecipe();

            observer.seedResource({
                id: 'res:field-a-soil',
                conformsTo: 'spec:topsoil',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'plot' },
            });
            // Free-standing cover crop biomass
            observer.seedResource({
                id: 'res:biomass',
                conformsTo: 'spec:cover-crop',
                accountingQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            });

            const plan = planStore.addPlan({ name: 'Cover Crop Plan' });
            const result = dependentDemand({
                planId: plan.id,
                demandSpecId: 'spec:nitrogen',
                demandQuantity: 5,
                dueDate: new Date('2026-06-01T00:00:00Z'),
                recipeStore: recipes,
                planStore,
                processes: processReg,
                observer,
            });

            // Soil should be booked
            const useIntents = result.intents.filter(i => i.action === 'use');
            expect(useIntents).toHaveLength(1);
            expect(useIntents[0].resourceInventoriedAs).toBe('res:field-a-soil');

            // Produce intent for nitrogen should be tagged CONTAINER_BOUND
            const produceIntents = result.intents.filter(
                i => i.action === 'produce' && i.resourceConformsTo === 'spec:nitrogen',
            );
            expect(produceIntents).toHaveLength(1);
            expect(produceIntents[0].resourceClassifiedAs).toContain(CONTAINER_BOUND_TAG);
            expect(produceIntents[0].note).toContain('res:field-a-soil');
        });

        test('container-bound produce intent is NOT absorbed by free-standing nitrogen demand', () => {
            // Manually create a container-bound produce intent (simulating prior cover crop)
            recipes.addResourceSpec({ id: 'spec:nitrogen', name: 'Nitrogen', defaultUnitOfResource: 'kg' });
            recipes.addResourceSpec({ id: 'spec:fertilizer', name: 'Fertilizer', defaultUnitOfResource: 'kg' });

            const prePlan = planStore.addPlan({ name: 'Cover Crop Plan' });
            const preProc = processReg.register({
                name: 'Cover Cropping', plannedWithin: prePlan.id, finished: false,
            });
            planStore.addIntent({
                action: 'produce',
                resourceConformsTo: 'spec:nitrogen',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
                resourceClassifiedAs: [CONTAINER_BOUND_TAG],
                outputOf: preProc.id,
                plannedWithin: prePlan.id,
                due: new Date('2026-05-01T00:00:00Z').toISOString(),
                finished: false,
            });

            // Fertilizer recipe that needs nitrogen as input (no recipe to produce nitrogen)
            const fertProc = recipes.addRecipeProcess({
                name: 'Make Fertilizer',
                hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
            });
            recipes.addRecipe({
                name: 'Fertilizer',
                primaryOutput: 'spec:fertilizer',
                recipeProcesses: [fertProc.id],
            });
            recipes.addRecipeFlow({
                action: 'consume',
                resourceConformsTo: 'spec:nitrogen',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' },
                recipeInputOf: fertProc.id,
            });
            recipes.addRecipeFlow({
                action: 'produce',
                resourceConformsTo: 'spec:fertilizer',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
                recipeOutputOf: fertProc.id,
            });

            const plan2 = planStore.addPlan({ name: 'Fertilizer Plan' });
            const result2 = dependentDemand({
                planId: plan2.id,
                demandSpecId: 'spec:fertilizer',
                demandQuantity: 10,
                dueDate: new Date('2026-07-01T00:00:00Z'),
                recipeStore: recipes,
                planStore,
                processes: processReg,
                observer,
            });

            // Nitrogen should be a purchase intent — the container-bound produce
            // from the cover crop should NOT be absorbed as free-standing supply
            const nitrogenPurchase = result2.purchaseIntents.filter(
                i => i.resourceConformsTo === 'spec:nitrogen',
            );
            expect(nitrogenPurchase).toHaveLength(1);
            expect(nitrogenPurchase[0].resourceQuantity?.hasNumericalValue).toBe(3);
        });
    });
});
