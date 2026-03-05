/**
 * vf-seed.ts — OSE LifeTrac example seed data for the VF inspector page.
 *
 * Models building one Open Source Ecology LifeTrac multipurpose tractor.
 * Four chained manufacturing processes:
 *   1. Frame Fabrication   — weld steel tubing into chassis
 *   2. Power Unit Assembly — combine engine + hydraulic pump
 *   3. Hydraulics Assembly — route hoses, fill fluid
 *   4. Final Assembly      — bolt frame + PU + hydraulics + wheels → LifeTrac
 *
 * Populates all three VF layers:
 *   Knowledge    → ResourceSpecs, ProcessSpecs, RecipeProcesses, RecipeFlows, Recipe, BufferZones
 *   Plan         → Plan, 4 Processes, Commitments, Intent
 *   Observation  → EconomicResources, EconomicEvent (frame fabrication complete)
 */

import { computeBufferZone } from '$lib/algorithms/ddmrp';
import type { BufferProfile } from '$lib/schemas';
import {
    registry, recipes, bufferZones, agents, planner, observer, refresh,
} from '$lib/vf-stores.svelte';

export function seedExample(): void {
    // ── AGENTS ────────────────────────────────────────────────────────────────
    agents.addAgent({ id: 'ose',       type: 'Organization', name: 'OSE Fab Lab'       });
    agents.addAgent({ id: 'steel-co',  type: 'Organization', name: 'Midwest Steel'     });

    // ── KNOWLEDGE: Resource Specifications ────────────────────────────────────
    // Raw materials
    recipes.addResourceSpec({ id: 'rs-steel',     name: 'Steel Tubing',    defaultUnitOfResource: 'm'    });
    recipes.addResourceSpec({ id: 'rs-weld-rod',  name: 'Welding Rod',     defaultUnitOfResource: 'kg'   });
    recipes.addResourceSpec({ id: 'rs-engine',    name: 'Engine 18HP',     defaultUnitOfResource: 'each' });
    recipes.addResourceSpec({ id: 'rs-hyd-pump',  name: 'Hydraulic Pump',  defaultUnitOfResource: 'each' });
    recipes.addResourceSpec({ id: 'rs-hyd-hose',  name: 'Hydraulic Hose',  defaultUnitOfResource: 'm'    });
    recipes.addResourceSpec({ id: 'rs-hyd-fluid', name: 'Hydraulic Fluid', defaultUnitOfResource: 'L'    });
    recipes.addResourceSpec({ id: 'rs-wheel',     name: 'Wheel Assembly',  defaultUnitOfResource: 'each' });
    // Intermediate assemblies (decoupling points — DDMRP buffers)
    recipes.addResourceSpec({ id: 'rs-frame',     name: 'Welded Frame',    defaultUnitOfResource: 'each', replenishmentRequired: true });
    recipes.addResourceSpec({ id: 'rs-pu',        name: 'Power Unit',      defaultUnitOfResource: 'each', replenishmentRequired: true });
    recipes.addResourceSpec({ id: 'rs-hyd-assy',  name: 'Hyd Assembly',    defaultUnitOfResource: 'each' });
    // Finished goods
    recipes.addResourceSpec({ id: 'rs-lifetrac',  name: 'LifeTrac',        defaultUnitOfResource: 'each', replenishmentRequired: true });

    // ── KNOWLEDGE: Process Specifications ─────────────────────────────────────
    recipes.addProcessSpec({ id: 'ps-fab-frame',  name: 'Frame Fabrication',    isDecouplingPoint: true  });
    recipes.addProcessSpec({ id: 'ps-pu-assy',    name: 'Power Unit Assembly'                           });
    recipes.addProcessSpec({ id: 'ps-hyd-assy',   name: 'Hydraulics Assembly'                           });
    recipes.addProcessSpec({ id: 'ps-final-assy', name: 'Final Assembly',       isDecouplingPoint: true  });

    // ── KNOWLEDGE: Recipe Processes ───────────────────────────────────────────
    recipes.addRecipeProcess({ id: 'rp-fab',   name: 'Fab Frame',         processConformsTo: 'ps-fab-frame',  hasDuration: { hasNumericalValue: 8, hasUnit: 'h' } });
    recipes.addRecipeProcess({ id: 'rp-pu',    name: 'Assemble PU',       processConformsTo: 'ps-pu-assy',    hasDuration: { hasNumericalValue: 4, hasUnit: 'h' } });
    recipes.addRecipeProcess({ id: 'rp-hyd',   name: 'Assemble Hyd',      processConformsTo: 'ps-hyd-assy',   hasDuration: { hasNumericalValue: 3, hasUnit: 'h' } });
    recipes.addRecipeProcess({ id: 'rp-final', name: 'Final Assembly',    processConformsTo: 'ps-final-assy', hasDuration: { hasNumericalValue: 6, hasUnit: 'h' } });

    // ── KNOWLEDGE: Recipe Flows ───────────────────────────────────────────────
    // 1. Frame Fabrication: steel + weld-rod → frame
    recipes.addRecipeFlow({ id: 'rf-fab-steel',    action: 'consume', resourceConformsTo: 'rs-steel',    resourceQuantity: { hasNumericalValue: 20, hasUnit: 'm'    }, recipeInputOf:  'rp-fab'   });
    recipes.addRecipeFlow({ id: 'rf-fab-rod',      action: 'consume', resourceConformsTo: 'rs-weld-rod', resourceQuantity: { hasNumericalValue: 2,  hasUnit: 'kg'   }, recipeInputOf:  'rp-fab'   });
    recipes.addRecipeFlow({ id: 'rf-fab-out',      action: 'produce', resourceConformsTo: 'rs-frame',    resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeOutputOf: 'rp-fab'   });
    // 2. Power Unit Assembly: engine + hyd-pump → power-unit
    recipes.addRecipeFlow({ id: 'rf-pu-engine',    action: 'consume', resourceConformsTo: 'rs-engine',   resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeInputOf:  'rp-pu'    });
    recipes.addRecipeFlow({ id: 'rf-pu-pump',      action: 'consume', resourceConformsTo: 'rs-hyd-pump', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeInputOf:  'rp-pu'    });
    recipes.addRecipeFlow({ id: 'rf-pu-out',       action: 'produce', resourceConformsTo: 'rs-pu',       resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeOutputOf: 'rp-pu'    });
    // 3. Hydraulics Assembly: hoses + fluid → hyd-assy
    recipes.addRecipeFlow({ id: 'rf-hyd-hose',     action: 'consume', resourceConformsTo: 'rs-hyd-hose', resourceQuantity: { hasNumericalValue: 10, hasUnit: 'm'    }, recipeInputOf:  'rp-hyd'   });
    recipes.addRecipeFlow({ id: 'rf-hyd-fluid',    action: 'consume', resourceConformsTo: 'rs-hyd-fluid',resourceQuantity: { hasNumericalValue: 20, hasUnit: 'L'    }, recipeInputOf:  'rp-hyd'   });
    recipes.addRecipeFlow({ id: 'rf-hyd-out',      action: 'produce', resourceConformsTo: 'rs-hyd-assy', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeOutputOf: 'rp-hyd'   });
    // 4. Final Assembly: frame + PU + hyd-assy + 4×wheels → LifeTrac
    recipes.addRecipeFlow({ id: 'rf-final-frame',  action: 'consume', resourceConformsTo: 'rs-frame',    resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeInputOf:  'rp-final' });
    recipes.addRecipeFlow({ id: 'rf-final-pu',     action: 'consume', resourceConformsTo: 'rs-pu',       resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeInputOf:  'rp-final' });
    recipes.addRecipeFlow({ id: 'rf-final-hyd',    action: 'consume', resourceConformsTo: 'rs-hyd-assy', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeInputOf:  'rp-final' });
    recipes.addRecipeFlow({ id: 'rf-final-wheels', action: 'consume', resourceConformsTo: 'rs-wheel',    resourceQuantity: { hasNumericalValue: 4,  hasUnit: 'each' }, recipeInputOf:  'rp-final' });
    recipes.addRecipeFlow({ id: 'rf-final-out',    action: 'produce', resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, recipeOutputOf: 'rp-final' });

    // ── KNOWLEDGE: Recipe ─────────────────────────────────────────────────────
    recipes.addRecipe({
        id: 'lifetrac-recipe',
        name: 'LifeTrac Build',
        primaryOutput: 'rs-lifetrac',
        recipeProcesses: ['rp-fab', 'rp-pu', 'rp-hyd', 'rp-final'],
    });

    // ── KNOWLEDGE: Buffer Zones (DDMRP) ──────────────────────────────────────
    const mfgProfile: BufferProfile = {
        id: 'mfg-medium',
        name: 'Manufactured Medium',
        itemType: 'Manufactured',
        leadTimeFactor: 1.0,
        variabilityFactor: 0.5,
    };
    // Welded Frame buffer — decoupling point, ADU 0.5/day, DLT 2 days
    const frameZone = computeBufferZone(mfgProfile, 0.5, 'each', 2, 1, 'each');
    bufferZones.addBufferZone({
        id: 'bz-frame', specId: 'rs-frame', profileId: 'mfg-medium',
        adu: 0.5, aduUnit: 'each', dltDays: 2, moq: 1, moqUnit: 'each',
        tor: frameZone.tor, toy: frameZone.toy, tog: frameZone.tog,
        lastComputedAt: new Date().toISOString(),
    });
    // LifeTrac finished goods buffer — ADU 0.2/day, DLT 5 days (total chain)
    const tractorZone = computeBufferZone(mfgProfile, 0.2, 'each', 5, 1, 'each');
    bufferZones.addBufferZone({
        id: 'bz-lifetrac', specId: 'rs-lifetrac', profileId: 'mfg-medium',
        adu: 0.2, aduUnit: 'each', dltDays: 5, moq: 1, moqUnit: 'each',
        tor: tractorZone.tor, toy: tractorZone.toy, tog: tractorZone.tog,
        lastComputedAt: new Date().toISOString(),
    });

    // ── PLAN ──────────────────────────────────────────────────────────────────
    planner.addPlan({ id: 'sprint-1', name: 'Build Sprint 1' });

    registry.register({ id: 'proc-fab',   name: 'Fab Frame',      basedOn: 'ps-fab-frame',  plannedWithin: 'sprint-1' });
    registry.register({ id: 'proc-pu',    name: 'Assemble PU',    basedOn: 'ps-pu-assy',    plannedWithin: 'sprint-1' });
    registry.register({ id: 'proc-hyd',   name: 'Assemble Hyd',   basedOn: 'ps-hyd-assy',   plannedWithin: 'sprint-1' });
    registry.register({ id: 'proc-final', name: 'Final Assembly', basedOn: 'ps-final-assy', plannedWithin: 'sprint-1' });

    // ── COMMITMENTS ───────────────────────────────────────────────────────────
    // proc-fab: consume steel + weld-rod, produce frame
    const cFabSteel = planner.addCommitment({ id: 'c-fab-steel', action: 'consume', resourceConformsTo: 'rs-steel',    resourceQuantity: { hasNumericalValue: 20, hasUnit: 'm'    }, inputOf:  'proc-fab',   provider: 'steel-co', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFabRod   = planner.addCommitment({ id: 'c-fab-rod',   action: 'consume', resourceConformsTo: 'rs-weld-rod', resourceQuantity: { hasNumericalValue: 2,  hasUnit: 'kg'   }, inputOf:  'proc-fab',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFabOut   = planner.addCommitment({ id: 'c-fab-out',   action: 'produce', resourceConformsTo: 'rs-frame',    resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, outputOf: 'proc-fab',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    // proc-pu: consume engine + hyd-pump, produce power-unit
    const cPuEngine = planner.addCommitment({ id: 'c-pu-engine', action: 'consume', resourceConformsTo: 'rs-engine',   resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, inputOf:  'proc-pu',    provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cPuPump   = planner.addCommitment({ id: 'c-pu-pump',   action: 'consume', resourceConformsTo: 'rs-hyd-pump', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, inputOf:  'proc-pu',    provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cPuOut    = planner.addCommitment({ id: 'c-pu-out',    action: 'produce', resourceConformsTo: 'rs-pu',       resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, outputOf: 'proc-pu',    provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    // proc-hyd: consume hoses + fluid, produce hyd-assy
    const cHydHose  = planner.addCommitment({ id: 'c-hyd-hose',  action: 'consume', resourceConformsTo: 'rs-hyd-hose', resourceQuantity: { hasNumericalValue: 10, hasUnit: 'm'    }, inputOf:  'proc-hyd',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cHydFluid = planner.addCommitment({ id: 'c-hyd-fluid', action: 'consume', resourceConformsTo: 'rs-hyd-fluid',resourceQuantity: { hasNumericalValue: 20, hasUnit: 'L'    }, inputOf:  'proc-hyd',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cHydOut   = planner.addCommitment({ id: 'c-hyd-out',   action: 'produce', resourceConformsTo: 'rs-hyd-assy', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, outputOf: 'proc-hyd',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    // proc-final: consume frame + PU + hyd-assy + 4×wheels, produce LifeTrac
    const cFinalFrame  = planner.addCommitment({ id: 'c-final-frame',  action: 'consume', resourceConformsTo: 'rs-frame',    resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, inputOf:  'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFinalPu     = planner.addCommitment({ id: 'c-final-pu',     action: 'consume', resourceConformsTo: 'rs-pu',       resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, inputOf:  'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFinalHyd    = planner.addCommitment({ id: 'c-final-hyd',    action: 'consume', resourceConformsTo: 'rs-hyd-assy', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, inputOf:  'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFinalWheels = planner.addCommitment({ id: 'c-final-wheels', action: 'consume', resourceConformsTo: 'rs-wheel',    resourceQuantity: { hasNumericalValue: 4, hasUnit: 'each' }, inputOf:  'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFinalOut    = planner.addCommitment({ id: 'c-final-out',    action: 'produce', resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, outputOf: 'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });

    // Register all commitments with observer for fulfillment tracking
    for (const c of [cFabSteel, cFabRod, cFabOut, cPuEngine, cPuPump, cPuOut,
                     cHydHose, cHydFluid, cHydOut, cFinalFrame, cFinalPu,
                     cFinalHyd, cFinalWheels, cFinalOut]) {
        observer.registerCommitment(c);
    }

    // ── INTENT ────────────────────────────────────────────────────────────────
    // Steel reorder: current stock (15m) is short of one full build (20m)
    planner.addIntent({
        id: 'i-steel',
        action: 'transfer',
        resourceConformsTo: 'rs-steel',
        resourceQuantity:   { hasNumericalValue: 25, hasUnit: 'm' },
        availableQuantity:  { hasNumericalValue: 25, hasUnit: 'm' },
        provider: 'steel-co',
    });

    // ── OBSERVATION: Seed on-hand inventory ───────────────────────────────────
    // Raw materials — steel is short (15m on hand vs 20m needed)
    observer.seedResource({ id: 'res-steel',     conformsTo: 'rs-steel',     accountingQuantity: { hasNumericalValue: 15, hasUnit: 'm'    }, onhandQuantity: { hasNumericalValue: 15, hasUnit: 'm'    }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-weld-rod',  conformsTo: 'rs-weld-rod',  accountingQuantity: { hasNumericalValue: 5,  hasUnit: 'kg'   }, onhandQuantity: { hasNumericalValue: 5,  hasUnit: 'kg'   }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-engine',    conformsTo: 'rs-engine',    accountingQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, onhandQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-hyd-pump',  conformsTo: 'rs-hyd-pump',  accountingQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, onhandQuantity: { hasNumericalValue: 1,  hasUnit: 'each' }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-hyd-hose',  conformsTo: 'rs-hyd-hose',  accountingQuantity: { hasNumericalValue: 12, hasUnit: 'm'    }, onhandQuantity: { hasNumericalValue: 12, hasUnit: 'm'    }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-hyd-fluid', conformsTo: 'rs-hyd-fluid', accountingQuantity: { hasNumericalValue: 20, hasUnit: 'L'    }, onhandQuantity: { hasNumericalValue: 20, hasUnit: 'L'    }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-wheel',     conformsTo: 'rs-wheel',     accountingQuantity: { hasNumericalValue: 4,  hasUnit: 'each' }, onhandQuantity: { hasNumericalValue: 4,  hasUnit: 'each' }, primaryAccountable: 'ose' });
    // Intermediate output — frame starts at zero, gets produced by event below
    observer.seedResource({ id: 'res-frame',     conformsTo: 'rs-frame',     accountingQuantity: { hasNumericalValue: 0,  hasUnit: 'each' }, onhandQuantity: { hasNumericalValue: 0,  hasUnit: 'each' }, primaryAccountable: 'ose' });

    // ── OBSERVATION: Events ───────────────────────────────────────────────────
    // Frame fabrication is complete — proc-fab has delivered its output
    // Observer subscription auto-calls refresh() after record()
    observer.record({
        id: 'ev-frame',
        action: 'produce',
        resourceInventoriedAs: 'res-frame',
        resourceConformsTo:    'rs-frame',
        resourceQuantity:      { hasNumericalValue: 1, hasUnit: 'each' },
        outputOf:   'proc-fab',
        fulfills:   'c-fab-out',
        provider:   'ose',
        receiver:   'ose',
        hasPointInTime: new Date().toISOString(),
    });

    refresh();
}
