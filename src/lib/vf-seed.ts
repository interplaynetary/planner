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

import { computeBufferZone, computeMinMaxBuffer, recipeLeadTime, legLeadTime, deriveVariabilityFactor } from '$lib/algorithms/ddmrp';
import type { BufferProfile } from '$lib/schemas';
import {
    registry, recipes, bufferZones, capacityBuffers, agents, planner, observer, refresh,
    locations, upsertBufferProfile,
} from '$lib/vf-stores.svelte';

export function seedExample(): void {
    // ── AGENTS ────────────────────────────────────────────────────────────────
    agents.addAgent({ id: 'ose',       type: 'Organization', name: 'OSE Fab Lab'       });
    agents.addAgent({ id: 'steel-co',  type: 'Organization', name: 'Midwest Steel'     });

    // ── KNOWLEDGE: Resource Specifications ────────────────────────────────────
    // Raw materials
    recipes.addResourceSpec({ id: 'rs-steel',     name: 'Steel Tubing',    defaultUnitOfResource: 'm'    });
    recipes.addResourceSpec({ id: 'rs-weld-rod',  name: 'Welding Rod',     defaultUnitOfResource: 'kg'   });
    recipes.addResourceSpec({ id: 'rs-engine',    name: 'Engine 18HP',     defaultUnitOfResource: 'units' });
    recipes.addResourceSpec({ id: 'rs-hyd-pump',  name: 'Hydraulic Pump',  defaultUnitOfResource: 'units' });
    recipes.addResourceSpec({ id: 'rs-hyd-hose',  name: 'Hydraulic Hose',  defaultUnitOfResource: 'm'    });
    recipes.addResourceSpec({ id: 'rs-hyd-fluid', name: 'Hydraulic Fluid', defaultUnitOfResource: 'L'    });
    recipes.addResourceSpec({ id: 'rs-wheel',     name: 'Wheel Assembly',  defaultUnitOfResource: 'units' });
    // Intermediate assemblies (decoupling points — DDMRP buffers)
    recipes.addResourceSpec({
        id: 'rs-frame', name: 'Welded Frame', defaultUnitOfResource: 'units', replenishmentRequired: true,
        positioningAnalysis: {
            customerToleranceTimeDays: 1,      // customer expects same-day frame availability
            salesOrderVisibilityHorizonDays: 3,
            vrd: 'medium', vrs: 'low',
            inventoryLeverageFlexibility: 'medium',
            decouplingRecommended: true,
            note: 'Decoupling point: isolates frame fabrication from final assembly variability.',
        },
    });
    recipes.addResourceSpec({ id: 'rs-pu',        name: 'Power Unit',      defaultUnitOfResource: 'units', replenishmentRequired: true });
    recipes.addResourceSpec({ id: 'rs-hyd-assy',  name: 'Hyd Assembly',    defaultUnitOfResource: 'units' });
    // Finished goods
    recipes.addResourceSpec({
        id: 'rs-lifetrac', name: 'LifeTrac', defaultUnitOfResource: 'units', replenishmentRequired: true,
        positioningAnalysis: {
            customerToleranceTimeDays: 7,      // customer will wait up to one week
            marketPotentialLeadTimeDays: 14,   // competitor lead time (benchmark)
            salesOrderVisibilityHorizonDays: 5,
            vrd: 'low', vrs: 'low',
            inventoryLeverageFlexibility: 'low', // finished good — no downstream flexibility
            decouplingRecommended: true,
            note: 'Finished-goods buffer; demand is project-driven with low variability.',
        },
    });

    // ── KNOWLEDGE: Process Specifications ─────────────────────────────────────
    recipes.addProcessSpec({ id: 'ps-fab-frame',  name: 'Frame Fabrication',    isDecouplingPoint: true,                         bufferType: 'stock'    });
    recipes.addProcessSpec({ id: 'ps-pu-assy',    name: 'Power Unit Assembly',  isControlPoint: true,                            bufferType: 'capacity' });
    recipes.addProcessSpec({ id: 'ps-hyd-assy',   name: 'Hydraulics Assembly'                                                                          });
    recipes.addProcessSpec({ id: 'ps-final-assy', name: 'Final Assembly',       isDecouplingPoint: true,                         bufferType: 'stock'    });

    // ── KNOWLEDGE: Recipe Processes ───────────────────────────────────────────
    recipes.addRecipeProcess({ id: 'rp-fab',   name: 'Fab Frame',         processConformsTo: 'ps-fab-frame',  hasDuration: { hasNumericalValue: 8, hasUnit: 'h' } });
    recipes.addRecipeProcess({ id: 'rp-pu',    name: 'Assemble PU',       processConformsTo: 'ps-pu-assy',    hasDuration: { hasNumericalValue: 4, hasUnit: 'h' } });
    recipes.addRecipeProcess({ id: 'rp-hyd',   name: 'Assemble Hyd',      processConformsTo: 'ps-hyd-assy',   hasDuration: { hasNumericalValue: 3, hasUnit: 'h' } });
    recipes.addRecipeProcess({ id: 'rp-final', name: 'Final Assembly',    processConformsTo: 'ps-final-assy', hasDuration: { hasNumericalValue: 6, hasUnit: 'h' } });

    // ── KNOWLEDGE: Recipe Flows ───────────────────────────────────────────────
    // 1. Frame Fabrication: steel + weld-rod → frame
    // stage on output + matching input marks the decoupling-point boundary for legLeadTime()
    recipes.addRecipeFlow({ id: 'rf-fab-steel',    action: 'consume', resourceConformsTo: 'rs-steel',    resourceQuantity: { hasNumericalValue: 20, hasUnit: 'm'    }, recipeInputOf:  'rp-fab'   });
    recipes.addRecipeFlow({ id: 'rf-fab-rod',      action: 'consume', resourceConformsTo: 'rs-weld-rod', resourceQuantity: { hasNumericalValue: 2,  hasUnit: 'kg'   }, recipeInputOf:  'rp-fab'   });
    recipes.addRecipeFlow({ id: 'rf-fab-out',      action: 'produce', resourceConformsTo: 'rs-frame',    resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeOutputOf: 'rp-fab',   stage: 'ps-fab-frame' });
    // 2. Power Unit Assembly: engine + hyd-pump → power-unit
    recipes.addRecipeFlow({ id: 'rf-pu-engine',    action: 'consume', resourceConformsTo: 'rs-engine',   resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeInputOf:  'rp-pu'    });
    recipes.addRecipeFlow({ id: 'rf-pu-pump',      action: 'consume', resourceConformsTo: 'rs-hyd-pump', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeInputOf:  'rp-pu'    });
    recipes.addRecipeFlow({ id: 'rf-pu-out',       action: 'produce', resourceConformsTo: 'rs-pu',       resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeOutputOf: 'rp-pu'    });
    // 3. Hydraulics Assembly: hoses + fluid → hyd-assy
    recipes.addRecipeFlow({ id: 'rf-hyd-hose',     action: 'consume', resourceConformsTo: 'rs-hyd-hose', resourceQuantity: { hasNumericalValue: 10, hasUnit: 'm'    }, recipeInputOf:  'rp-hyd'   });
    recipes.addRecipeFlow({ id: 'rf-hyd-fluid',    action: 'consume', resourceConformsTo: 'rs-hyd-fluid',resourceQuantity: { hasNumericalValue: 20, hasUnit: 'L'    }, recipeInputOf:  'rp-hyd'   });
    recipes.addRecipeFlow({ id: 'rf-hyd-out',      action: 'produce', resourceConformsTo: 'rs-hyd-assy', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeOutputOf: 'rp-hyd'   });
    // 4. Final Assembly: frame + PU + hyd-assy + 4×wheels → LifeTrac
    // stage on rf-final-frame matches rf-fab-out so recipeLeadTime can trace the predecessor edge
    recipes.addRecipeFlow({ id: 'rf-final-frame',  action: 'consume', resourceConformsTo: 'rs-frame',    resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeInputOf:  'rp-final', stage: 'ps-fab-frame' });
    recipes.addRecipeFlow({ id: 'rf-final-pu',     action: 'consume', resourceConformsTo: 'rs-pu',       resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeInputOf:  'rp-final' });
    recipes.addRecipeFlow({ id: 'rf-final-hyd',    action: 'consume', resourceConformsTo: 'rs-hyd-assy', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeInputOf:  'rp-final' });
    recipes.addRecipeFlow({ id: 'rf-final-wheels', action: 'consume', resourceConformsTo: 'rs-wheel',    resourceQuantity: { hasNumericalValue: 4,  hasUnit: 'units' }, recipeInputOf:  'rp-final' });
    recipes.addRecipeFlow({ id: 'rf-final-out',    action: 'produce', resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, recipeOutputOf: 'rp-final' });

    // ── KNOWLEDGE: Recipe ─────────────────────────────────────────────────────
    recipes.addRecipe({
        id: 'lifetrac-recipe',
        name: 'LifeTrac Build',
        primaryOutput: 'rs-lifetrac',
        recipeProcesses: ['rp-fab', 'rp-pu', 'rp-hyd', 'rp-final'],
    });

    // ── KNOWLEDGE: Buffer Zones (DDMRP) ──────────────────────────────────────
    // VRD=medium/VRS=low for manufactured intermediates → VF = 0.25
    const mfgProfile: BufferProfile = {
        id: 'mfg-medium',
        name: 'Manufactured Medium',
        itemType: 'Manufactured',
        leadTimeFactor: 1.0,
        vrd: 'medium',
        vrs: 'low',
        variabilityFactor: deriveVariabilityFactor('medium', 'low'), // 0.25
        leadTimeCategory: 'short',      // LTF 1.0 is within [0.61, 1.00]
        variabilityCategory: 'low',     // VF 0.25 is within [0.00, 0.40]
        code: 'MSL',
    };

    upsertBufferProfile(mfgProfile);

    // DLT from recipe graph — Frame leg: start of recipe → ps-fab-frame output
    // (fab is the only process before the first decoupling point)
    const frameDltDays = legLeadTime('lifetrac-recipe', undefined, 'ps-fab-frame', recipes);

    // DLT for LifeTrac = total recipe critical path (all four processes)
    const tractorDltDays = recipeLeadTime('lifetrac-recipe', recipes);

    // Welded Frame buffer — decoupling point, ADU 0.5/day, DLT computed from recipe
    const frameZone = computeBufferZone(mfgProfile, 0.5, 'units', frameDltDays, 1, 'units');
    bufferZones.addBufferZone({
        id: 'bz-frame', specId: 'rs-frame', profileId: 'mfg-medium',
        bufferClassification: 'replenished',
        adu: 0.5, aduUnit: 'units', dltDays: frameDltDays, moq: 1, moqUnit: 'units',
        tor: frameZone.tor, toy: frameZone.toy, tog: frameZone.tog,
        lastComputedAt: new Date().toISOString(),
    });
    // LifeTrac finished goods buffer — ADU 0.2/day, DLT = full critical-path days
    const tractorZone = computeBufferZone(mfgProfile, 0.2, 'units', tractorDltDays, 1, 'units');
    bufferZones.addBufferZone({
        id: 'bz-lifetrac', specId: 'rs-lifetrac', profileId: 'mfg-medium',
        bufferClassification: 'replenished',
        atLocation: 'loc-ose-fab',
        adu: 0.2, aduUnit: 'units', dltDays: tractorDltDays, moq: 1, moqUnit: 'units',
        tor: tractorZone.tor, toy: tractorZone.toy, tog: tractorZone.tog,
        lastComputedAt: new Date().toISOString(),
    });

    // ── KNOWLEDGE: Ch 7 Demo — Min-Max and Replenished-Override Zones ────────
    // Profile PSL: Purchased / Short LT / Low variability → LTF 0.7, VF ≈ 0.10
    const pslProfile: BufferProfile = {
        id: 'purch-short-low',
        name: 'Purchased Short Low',
        itemType: 'Purchased',
        leadTimeFactor: 0.7,
        vrd: 'low', vrs: 'low',
        variabilityFactor: deriveVariabilityFactor('low', 'low'),
        leadTimeCategory: 'short',
        variabilityCategory: 'low',
        code: 'PSL',
    };
    // Profile PLH: Purchased / Long LT / High variability → LTF 0.3, VF 0.6
    const plhProfile: BufferProfile = {
        id: 'purch-long-high',
        name: 'Purchased Long High',
        itemType: 'Purchased',
        leadTimeFactor: 0.3,
        vrd: 'high', vrs: 'medium',
        variabilityFactor: 0.6,
        leadTimeCategory: 'long',
        variabilityCategory: 'high',
        code: 'PLH',
    };

    upsertBufferProfile(pslProfile);
    upsertBufferProfile(plhProfile);

    // Min-max zone — Wheel Assembly (purchased, short LT, low variability → PSL)
    // TOY = TOR after computeMinMaxBuffer(); no yellow zone.
    recipes.addResourceSpec({ id: 'rs-wheel-asm', name: 'Wheel Assembly (Min-Max)', defaultUnitOfResource: 'units' });
    const wheelAsmZone = computeMinMaxBuffer(pslProfile, 8, 'units', 3, 0, 'units');
    bufferZones.addBufferZone({
        id: 'bz-wheel-asm', specId: 'rs-wheel-asm', profileId: 'purch-short-low',
        bufferClassification: 'min_max',
        adu: 8, aduUnit: 'units', dltDays: 3, moq: 0, moqUnit: 'units',
        tor: wheelAsmZone.tor, toy: wheelAsmZone.toy, tog: wheelAsmZone.tog,
        lastComputedAt: new Date().toISOString(),
    });

    // Replenished-override zone — Hydraulic Pump (contractual / constrained supply)
    // TOR/TOY/TOG are user-set and must not be overwritten by recalibrateBufferZone().
    recipes.addResourceSpec({ id: 'rs-hydraulic-pump', name: 'Hydraulic Pump (Contract)', defaultUnitOfResource: 'units' });
    bufferZones.addBufferZone({
        id: 'bz-hydraulic-pump', specId: 'rs-hydraulic-pump', profileId: 'purch-long-high',
        bufferClassification: 'replenished_override',
        adu: 2, aduUnit: 'units', dltDays: 14, moq: 5, moqUnit: 'units',
        tor: 10, toy: 25, tog: 40,  // user-defined; recalibrateBufferZone() will not touch these
        lastComputedAt: new Date().toISOString(),
    });

    // ── KNOWLEDGE: Capacity Buffers (DDMRP) ───────────────────────────────────
    // Utilisation = currentLoadHours / totalCapacityHours → varied zones for demo
    capacityBuffers.addBuffer({ id: 'cb-fab',   processSpecId: 'ps-fab-frame',  totalCapacityHours: 8, periodDays: 1, currentLoadHours: 8 }); // 100% → RED
    capacityBuffers.addBuffer({ id: 'cb-pu',    processSpecId: 'ps-pu-assy',    totalCapacityHours: 6, periodDays: 1, currentLoadHours: 4 }); //  67% → GREEN
    capacityBuffers.addBuffer({ id: 'cb-hyd',   processSpecId: 'ps-hyd-assy',   totalCapacityHours: 5, periodDays: 1, currentLoadHours: 3 }); //  60% → GREEN
    capacityBuffers.addBuffer({ id: 'cb-final', processSpecId: 'ps-final-assy', totalCapacityHours: 7, periodDays: 1, currentLoadHours: 6 }); //  86% → YELLOW

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
    const cFabOut   = planner.addCommitment({ id: 'c-fab-out',   action: 'produce', resourceConformsTo: 'rs-frame',    resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, outputOf: 'proc-fab',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    // proc-pu: consume engine + hyd-pump, produce power-unit
    const cPuEngine = planner.addCommitment({ id: 'c-pu-engine', action: 'consume', resourceConformsTo: 'rs-engine',   resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, inputOf:  'proc-pu',    provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cPuPump   = planner.addCommitment({ id: 'c-pu-pump',   action: 'consume', resourceConformsTo: 'rs-hyd-pump', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, inputOf:  'proc-pu',    provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cPuOut    = planner.addCommitment({ id: 'c-pu-out',    action: 'produce', resourceConformsTo: 'rs-pu',       resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, outputOf: 'proc-pu',    provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    // proc-hyd: consume hoses + fluid, produce hyd-assy
    const cHydHose  = planner.addCommitment({ id: 'c-hyd-hose',  action: 'consume', resourceConformsTo: 'rs-hyd-hose', resourceQuantity: { hasNumericalValue: 10, hasUnit: 'm'    }, inputOf:  'proc-hyd',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cHydFluid = planner.addCommitment({ id: 'c-hyd-fluid', action: 'consume', resourceConformsTo: 'rs-hyd-fluid',resourceQuantity: { hasNumericalValue: 20, hasUnit: 'L'    }, inputOf:  'proc-hyd',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    const cHydOut   = planner.addCommitment({ id: 'c-hyd-out',   action: 'produce', resourceConformsTo: 'rs-hyd-assy', resourceQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, outputOf: 'proc-hyd',   provider: 'ose',      receiver: 'ose', plannedWithin: 'sprint-1' });
    // proc-final: consume frame + PU + hyd-assy + 4×wheels, produce LifeTrac
    const cFinalFrame  = planner.addCommitment({ id: 'c-final-frame',  action: 'consume', resourceConformsTo: 'rs-frame',    resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, inputOf:  'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFinalPu     = planner.addCommitment({ id: 'c-final-pu',     action: 'consume', resourceConformsTo: 'rs-pu',       resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, inputOf:  'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFinalHyd    = planner.addCommitment({ id: 'c-final-hyd',    action: 'consume', resourceConformsTo: 'rs-hyd-assy', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, inputOf:  'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFinalWheels = planner.addCommitment({ id: 'c-final-wheels', action: 'consume', resourceConformsTo: 'rs-wheel',    resourceQuantity: { hasNumericalValue: 4, hasUnit: 'units' }, inputOf:  'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });
    const cFinalOut    = planner.addCommitment({ id: 'c-final-out',    action: 'produce', resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, outputOf: 'proc-final', provider: 'ose', receiver: 'ose', plannedWithin: 'sprint-1' });

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
    observer.seedResource({ id: 'res-engine',    conformsTo: 'rs-engine',    accountingQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, onhandQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-hyd-pump',  conformsTo: 'rs-hyd-pump',  accountingQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, onhandQuantity: { hasNumericalValue: 1,  hasUnit: 'units' }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-hyd-hose',  conformsTo: 'rs-hyd-hose',  accountingQuantity: { hasNumericalValue: 12, hasUnit: 'm'    }, onhandQuantity: { hasNumericalValue: 12, hasUnit: 'm'    }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-hyd-fluid', conformsTo: 'rs-hyd-fluid', accountingQuantity: { hasNumericalValue: 20, hasUnit: 'L'    }, onhandQuantity: { hasNumericalValue: 20, hasUnit: 'L'    }, primaryAccountable: 'ose' });
    observer.seedResource({ id: 'res-wheel',     conformsTo: 'rs-wheel',     accountingQuantity: { hasNumericalValue: 4,  hasUnit: 'units' }, onhandQuantity: { hasNumericalValue: 4,  hasUnit: 'units' }, primaryAccountable: 'ose' });
    // Intermediate output — frame starts at zero, gets produced by event below
    observer.seedResource({ id: 'res-frame',     conformsTo: 'rs-frame',     accountingQuantity: { hasNumericalValue: 0,  hasUnit: 'units' }, onhandQuantity: { hasNumericalValue: 0,  hasUnit: 'units' }, primaryAccountable: 'ose' });

    // ── OBSERVATION: Events ───────────────────────────────────────────────────
    // Frame fabrication is complete — proc-fab has delivered its output
    // Observer subscription auto-calls refresh() after record()
    observer.record({
        id: 'ev-frame',
        action: 'produce',
        resourceInventoriedAs: 'res-frame',
        resourceConformsTo:    'rs-frame',
        resourceQuantity:      { hasNumericalValue: 1, hasUnit: 'units' },
        outputOf:   'proc-fab',
        fulfills:   'c-fab-out',
        provider:   'ose',
        receiver:   'ose',
        hasPointInTime: new Date().toISOString(),
    });

    // ── DISTRIBUTION NETWORK ─────────────────────────────────────────────────
    // SpatialThings — physical locations for the hub-spoke network
    locations.addLocation({ id: 'loc-ose-fab',     name: 'OSE Fab Lab',           mappableAddress: 'Marcellus, MO' });
    locations.addLocation({ id: 'loc-hub-midwest',  name: 'Midwest Hub DC'         });
    locations.addLocation({ id: 'loc-region-east',  name: 'East Region Warehouse'  });
    locations.addLocation({ id: 'loc-region-west',  name: 'West Region Warehouse'  });

    // Distribution agents
    agents.addAgent({ id: 'hub-midwest', type: 'Organization', name: 'Midwest Hub DC'        });
    agents.addAgent({ id: 'wh-east',     type: 'Organization', name: 'East Region Warehouse' });
    agents.addAgent({ id: 'wh-west',     type: 'Organization', name: 'West Region Warehouse' });

    // Warehouse ResourceSpec — storage facilities are EconomicResources in VF.
    // Items in the warehouse use currentLocation (same SpatialThing) — NOT containedIn,
    // which would block transport-planning eligibility.
    recipes.addResourceSpec({
        id: 'rs-storage-facility',
        name: 'Distribution Storage Facility',
        defaultUnitOfResource: 'pallets',
    });

    // Warehouse EconomicResource instances
    observer.seedResource({
        id: 'res-hub-midwest', conformsTo: 'rs-storage-facility',
        name: 'Midwest Hub DC',
        accountingQuantity: { hasNumericalValue: 100, hasUnit: 'pallets' },
        onhandQuantity:     { hasNumericalValue: 0,   hasUnit: 'pallets' },
        currentLocation:    'loc-hub-midwest',
        primaryAccountable: 'hub-midwest',
    });
    observer.seedResource({
        id: 'res-wh-east', conformsTo: 'rs-storage-facility',
        name: 'East Region Warehouse',
        accountingQuantity: { hasNumericalValue: 50, hasUnit: 'pallets' },
        onhandQuantity:     { hasNumericalValue: 0,  hasUnit: 'pallets' },
        currentLocation:    'loc-region-east',
        primaryAccountable: 'wh-east',
    });
    observer.seedResource({
        id: 'res-wh-west', conformsTo: 'rs-storage-facility',
        name: 'West Region Warehouse',
        accountingQuantity: { hasNumericalValue: 50, hasUnit: 'pallets' },
        onhandQuantity:     { hasNumericalValue: 0,  hasUnit: 'pallets' },
        currentLocation:    'loc-region-west',
        primaryAccountable: 'wh-west',
    });

    // LifeTrac stock buffer inventory pools — one EconomicResource per stocking location.
    // Opening balances represent prior-period inventory; events below build current state.
    observer.seedResource({
        id: 'res-lifetrac-fab', conformsTo: 'rs-lifetrac',
        name: 'LifeTrac — OSE Fab Lab',
        accountingQuantity: { hasNumericalValue: 3, hasUnit: 'units' },
        onhandQuantity:     { hasNumericalValue: 3, hasUnit: 'units' },
        currentLocation: 'loc-ose-fab', primaryAccountable: 'ose',
    });
    observer.seedResource({
        id: 'res-lifetrac-hub', conformsTo: 'rs-lifetrac',
        name: 'LifeTrac — Midwest Hub DC',
        accountingQuantity: { hasNumericalValue: 0, hasUnit: 'units' },
        onhandQuantity:     { hasNumericalValue: 0, hasUnit: 'units' },
        currentLocation: 'loc-hub-midwest', primaryAccountable: 'hub-midwest',
    });
    observer.seedResource({
        id: 'res-lifetrac-east', conformsTo: 'rs-lifetrac',
        name: 'LifeTrac — East Region',
        accountingQuantity: { hasNumericalValue: 0, hasUnit: 'units' },
        onhandQuantity:     { hasNumericalValue: 0, hasUnit: 'units' },
        currentLocation: 'loc-region-east', primaryAccountable: 'wh-east',
    });
    observer.seedResource({
        id: 'res-lifetrac-west', conformsTo: 'rs-lifetrac',
        name: 'LifeTrac — West Region',
        accountingQuantity: { hasNumericalValue: 0, hasUnit: 'units' },
        onhandQuantity:     { hasNumericalValue: 0, hasUnit: 'units' },
        currentLocation: 'loc-region-west', primaryAccountable: 'wh-west',
    });

    // Transport recipes (pickup/dropoff pairs, no primaryOutput)
    // Sourcing unit → Hub (8h transit)
    const rpFabHub  = recipes.addRecipeProcess({ id: 'rp-tr-fab-hub',  name: 'Fab to Hub Leg',  hasDuration: { hasNumericalValue: 8, hasUnit: 'h' } });
    recipes.addRecipe({ id: 'tr-fab-to-hub',   name: 'LifeTrac: Fab→Hub',   recipeProcesses: [rpFabHub.id]  });
    recipes.addRecipeFlow({ action: 'pickup',  resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, recipeInputOf:  rpFabHub.id });
    recipes.addRecipeFlow({ action: 'dropoff', resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, recipeOutputOf: rpFabHub.id });

    // Hub → East (4h transit)
    const rpHubEast = recipes.addRecipeProcess({ id: 'rp-tr-hub-east', name: 'Hub to East Leg', hasDuration: { hasNumericalValue: 4, hasUnit: 'h' } });
    recipes.addRecipe({ id: 'tr-hub-to-east', name: 'LifeTrac: Hub→East', recipeProcesses: [rpHubEast.id] });
    recipes.addRecipeFlow({ action: 'pickup',  resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, recipeInputOf:  rpHubEast.id });
    recipes.addRecipeFlow({ action: 'dropoff', resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, recipeOutputOf: rpHubEast.id });

    // Hub → West (6h transit)
    const rpHubWest = recipes.addRecipeProcess({ id: 'rp-tr-hub-west', name: 'Hub to West Leg', hasDuration: { hasNumericalValue: 6, hasUnit: 'h' } });
    recipes.addRecipe({ id: 'tr-hub-to-west', name: 'LifeTrac: Hub→West', recipeProcesses: [rpHubWest.id] });
    recipes.addRecipeFlow({ action: 'pickup',  resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, recipeInputOf:  rpHubWest.id });
    recipes.addRecipeFlow({ action: 'dropoff', resourceConformsTo: 'rs-lifetrac', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' }, recipeOutputOf: rpHubWest.id });

    // DLT computation for distribution tiers
    const fabToHubDays  = recipeLeadTime('tr-fab-to-hub',  recipes); // 8h = 0.333d
    const hubToEastDays = recipeLeadTime('tr-hub-to-east', recipes); // 4h = 0.167d
    const hubToWestDays = recipeLeadTime('tr-hub-to-west', recipes); // 6h = 0.250d
    const hubDltDays    = tractorDltDays + fabToHubDays;             // mfg DLT + inbound transit

    // Distribution buffer profiles — split by tier (Ch 6 Fig 6-29: aggregation lowers CV at hub)
    // Hub: aggregated demand → lower CV → lower variabilityFactor
    const distProfileHub: BufferProfile = {
        id: 'dist-hub', name: 'Distribution Hub (Aggregated)',
        itemType: 'Distributed', leadTimeFactor: 0.5,
        vrd: 'low', vrs: 'low',
        variabilityFactor: deriveVariabilityFactor('low', 'low'), // 0.10
        leadTimeCategory: 'medium',     // LTF 0.5 is within [0.41, 0.60]
        variabilityCategory: 'low',     // VF 0.10 is within [0.00, 0.40]
        code: 'DML',
    };
    // Regional: local demand → higher CV → medium vrd
    const distProfileRegional: BufferProfile = {
        id: 'dist-regional', name: 'Distribution Regional',
        itemType: 'Distributed', leadTimeFactor: 0.5,
        vrd: 'medium', vrs: 'low',
        variabilityFactor: deriveVariabilityFactor('medium', 'low'), // 0.25
        leadTimeCategory: 'medium',     // LTF 0.5 is within [0.41, 0.60]
        variabilityCategory: 'low',     // VF 0.25 is within [0.00, 0.40]
        code: 'DML',
    };

    upsertBufferProfile(distProfileHub);
    upsertBufferProfile(distProfileRegional);

    // Location-scoped buffer zones
    // Hub (ADU 0.5/day, serves 2 regions; DLT = mfg + inbound transit)
    const hubZone  = computeBufferZone(distProfileHub, 0.5,  'units', hubDltDays,   1, 'units');
    bufferZones.addBufferZone({
        id: 'bz-lifetrac-hub', specId: 'rs-lifetrac', profileId: 'dist-hub',
        bufferClassification: 'replenished',
        atLocation: 'loc-hub-midwest',
        upstreamLocationId: 'loc-ose-fab',
        replenishmentRecipeId: 'tr-fab-to-hub',
        adu: 0.5, aduUnit: 'units', dltDays: hubDltDays, moq: 1, moqUnit: 'units',
        tor: hubZone.tor, toy: hubZone.toy, tog: hubZone.tog,
        lastComputedAt: new Date().toISOString(),
    });

    // East warehouse (ADU 0.2/day, DLT = hub→east transit only)
    const eastZone = computeBufferZone(distProfileRegional, 0.2,  'units', hubToEastDays, 1, 'units');
    bufferZones.addBufferZone({
        id: 'bz-lifetrac-east', specId: 'rs-lifetrac', profileId: 'dist-regional',
        bufferClassification: 'replenished',
        atLocation: 'loc-region-east',
        upstreamLocationId: 'loc-hub-midwest',
        replenishmentRecipeId: 'tr-hub-to-east',
        adu: 0.2, aduUnit: 'units', dltDays: hubToEastDays, moq: 1, moqUnit: 'units',
        tor: eastZone.tor, toy: eastZone.toy, tog: eastZone.tog,
        lastComputedAt: new Date().toISOString(),
    });

    // West warehouse (ADU 0.15/day, DLT = hub→west transit only)
    const westZone = computeBufferZone(distProfileRegional, 0.15, 'units', hubToWestDays, 1, 'units');
    bufferZones.addBufferZone({
        id: 'bz-lifetrac-west', specId: 'rs-lifetrac', profileId: 'dist-regional',
        bufferClassification: 'replenished',
        atLocation: 'loc-region-west',
        upstreamLocationId: 'loc-hub-midwest',
        replenishmentRecipeId: 'tr-hub-to-west',
        adu: 0.15, aduUnit: 'units', dltDays: hubToWestDays, moq: 1, moqUnit: 'units',
        tor: westZone.tor, toy: westZone.toy, tog: westZone.tog,
        lastComputedAt: new Date().toISOString(),
    });

    // Distribution movement events — observer.record() decrements source, increments dest.
    observer.record({
        id: 'ev-fab-to-hub',
        action: 'transfer',
        resourceInventoriedAs:   'res-lifetrac-fab',
        toResourceInventoriedAs: 'res-lifetrac-hub',
        resourceQuantity: { hasNumericalValue: 3, hasUnit: 'units' },
        provider: 'ose', receiver: 'hub-midwest',
        atLocation: 'loc-ose-fab', toLocation: 'loc-hub-midwest',
        hasPointInTime: new Date().toISOString(),
    });
    observer.record({
        id: 'ev-hub-to-east',
        action: 'transfer',
        resourceInventoriedAs:   'res-lifetrac-hub',
        toResourceInventoriedAs: 'res-lifetrac-east',
        resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' },
        provider: 'hub-midwest', receiver: 'wh-east',
        atLocation: 'loc-hub-midwest', toLocation: 'loc-region-east',
        hasPointInTime: new Date().toISOString(),
    });

    // ── ADU HISTORY: Synthetic consumption events (past 52 weeks) ─────────────
    // These events have no resourceInventoriedAs so they don't affect current
    // inventory; they exist purely to give computeADU() historical data to plot.
    //
    // LifeTrac ADU ≈ 0.20/day  → ~1.4 units/week, but as discrete integer sales
    // Welded Frame ADU ≈ 0.50/day → ~3.5 units/week (used in frame fabrication runs)
    const msPerDay = 86_400_000;
    const now = Date.now();

    // Seed pattern: each week pick a random-ish day for each sale.
    // Use a deterministic pseudo-random sequence (LCG) so the chart looks natural
    // but doesn't change between page loads.
    let rng = 0x5eed_beef;
    function nextRng(): number {
        rng = (Math.imul(rng, 0x19660d) + 0x3c6ef35f) >>> 0;
        return rng / 0xffff_ffff;
    }

    for (let week = 52; week >= 1; week--) {
        const weekStart = now - week * 7 * msPerDay;

        // LifeTrac sales: 0–2 per week (avg ≈ 1.4)
        const ltracCount = nextRng() < 0.6 ? 1 : nextRng() < 0.5 ? 2 : 0;
        for (let s = 0; s < ltracCount; s++) {
            const dayOffset = Math.floor(nextRng() * 7);
            observer.record({
                id: `ev-hist-lt-w${week}-s${s}`,
                action: 'consume',
                resourceConformsTo: 'rs-lifetrac',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' },
                provider: 'ose', receiver: 'ose',
                hasPointInTime: new Date(weekStart + dayOffset * msPerDay).toISOString(),
            });
        }

        // Frame consumption: 3–4 per week (avg ≈ 3.5)
        const frameCount = 3 + (nextRng() < 0.5 ? 1 : 0);
        for (let s = 0; s < frameCount; s++) {
            const dayOffset = Math.floor(nextRng() * 7);
            observer.record({
                id: `ev-hist-fr-w${week}-s${s}`,
                action: 'consume',
                resourceConformsTo: 'rs-frame',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'units' },
                provider: 'ose', receiver: 'ose',
                hasPointInTime: new Date(weekStart + dayOffset * msPerDay).toISOString(),
            });
        }
    }

    refresh();
}
