<script lang="ts">
  import "$lib/components/ui/tokens.css";
  import FederationGraphView from "$lib/components/federation/FederationGraphView.svelte";
  import FederationEventLog from "$lib/components/federation/FederationEventLog.svelte";
  import InventoryBand from "$lib/components/federation/InventoryBand.svelte";
  import DeficitResidualBar from "$lib/components/federation/DeficitResidualBar.svelte";
  import ScopeNetworkDiagram from "$lib/components/federation/ScopeNetworkDiagram.svelte";
  import type { ScopePlanResult } from "$lib/planning/plan-for-scope";
  import type {
    TradeProposal,
    FederationEvent,
  } from "$lib/planning/plan-federation";
  import { StoreRegistry } from "$lib/planning/store-registry";
  import { PlanStore } from "$lib/planning/planning";
  import { ProcessRegistry } from "$lib/process-registry";
  import { Observer } from "$lib/observation/observer";
  import type { EconomicResource } from "$lib/schemas";

  // ---------------------------------------------------------------------------
  // Mock data — 16-scope federation (5 federations + UC):
  //
  //   universal-commune
  //   ├── northern-federation  ── commune-grain (wheat)  commune-dairy (dairy)
  //   ├── eastern-federation   ── commune-forge (tools)  commune-workshop (goods)
  //   ├── southern-federation  ── commune-olive (oil)    commune-citrus (fruit+fish)
  //   ├── western-federation   ── commune-mill (flour)   commune-bakery (bread)
  //   └── coastal-federation   ── commune-fisher (fish)  commune-salter (salt)
  //
  // 5 INTER-SCOPE SUPPORTs (cross-federation peer exchanges):
  //   commune-grain  (N) → commune-mill    (W): wheat × 200
  //   commune-forge  (E) → commune-grain   (N): tools × 15
  //   commune-dairy  (N) → commune-bakery  (W): dairy × 30
  //   commune-mill   (W) → commune-forge   (E): flour × 30
  //   commune-fisher (C) → commune-citrus  (S): fish  × 40
  // ---------------------------------------------------------------------------

  const specNames: Record<string, string> = {
    wheat: "Wheat",
    dairy: "Dairy",
    tools: "Tools",
    goods: "Goods",
    "olive-oil": "Olive Oil",
    citrus: "Citrus",
    flour: "Flour",
    bread: "Bread",
    fish: "Fish",
    salt: "Salt",
    "raw-flour": "Raw Flour",
    metal: "Iron Metal",
    ore: "Iron Ore",
    dough: "Dough",
    brine: "Brine",
  };

  // ---- Northern: commune-grain -----------------------------------------------
  const grainReg = new ProcessRegistry();
  const grainStore = new PlanStore(grainReg);
  const grainPlan = grainStore.addPlan({ name: "Grain Harvest 2026-Q1" });
  const grainProc = grainReg.register({
    name: "Wheat Harvest",
    plannedWithin: grainPlan.id,
  });
  grainStore.addCommitment({
    plannedWithin: grainPlan.id,
    action: "produce",
    outputOf: grainProc.id,
    provider: "commune-grain",
    resourceConformsTo: "wheat",
    resourceQuantity: { hasNumericalValue: 300, hasUnit: "kg" },
  });
  grainStore.addCommitment({
    plannedWithin: grainPlan.id,
    action: "work",
    inputOf: grainProc.id,
    provider: "agent-farmer",
    effortQuantity: { hasNumericalValue: 80, hasUnit: "hr" },
  });
  grainStore.addCommitment({
    plannedWithin: grainPlan.id,
    action: "transfer",
    provider: "commune-grain",
    receiver: "commune-mill",
    resourceConformsTo: "wheat",
    resourceQuantity: { hasNumericalValue: 200, hasUnit: "kg" },
  });

  // ---- Northern: commune-dairy -----------------------------------------------
  const dairyReg = new ProcessRegistry();
  const dairyStore = new PlanStore(dairyReg);
  const dairyPlan = dairyStore.addPlan({ name: "Dairy Production 2026-Q1" });
  const dairyProc = dairyReg.register({
    name: "Dairy Production",
    plannedWithin: dairyPlan.id,
  });
  dairyStore.addCommitment({
    plannedWithin: dairyPlan.id,
    action: "produce",
    outputOf: dairyProc.id,
    provider: "commune-dairy",
    resourceConformsTo: "dairy",
    resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" },
  });
  dairyStore.addCommitment({
    plannedWithin: dairyPlan.id,
    action: "transfer",
    provider: "commune-dairy",
    receiver: "commune-bakery",
    resourceConformsTo: "dairy",
    resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" },
  });

  // ---- Eastern: commune-forge (2-step: Ore Smelting → Smithing) --------------
  const forgeReg = new ProcessRegistry();
  const forgeStore = new PlanStore(forgeReg);
  const forgePlan = forgeStore.addPlan({ name: "Forge Output 2026-Q1" });
  const smeltProc = forgeReg.register({
    name: "Ore Smelting",
    plannedWithin: forgePlan.id,
  });
  const smithProc = forgeReg.register({
    name: "Smithing",
    plannedWithin: forgePlan.id,
  });
  // Smelting: ore + work → metal
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id,
    action: "consume",
    inputOf: smeltProc.id,
    resourceConformsTo: "ore",
    resourceQuantity: { hasNumericalValue: 120, hasUnit: "kg" },
  });
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id,
    action: "work",
    inputOf: smeltProc.id,
    provider: "agent-iron",
    effortQuantity: { hasNumericalValue: 32, hasUnit: "hr" },
  });
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id,
    action: "produce",
    outputOf: smeltProc.id,
    resourceConformsTo: "metal",
    resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" },
  });
  // Smithing: metal + work → tools
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id,
    action: "consume",
    inputOf: smithProc.id,
    resourceConformsTo: "metal",
    resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" },
  });
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id,
    action: "work",
    inputOf: smithProc.id,
    provider: "agent-smith",
    effortQuantity: { hasNumericalValue: 48, hasUnit: "hr" },
  });
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id,
    action: "produce",
    outputOf: smithProc.id,
    provider: "commune-forge",
    resourceConformsTo: "tools",
    resourceQuantity: { hasNumericalValue: 80, hasUnit: "unit" },
  });
  // Standalone transfers (inter-scope supports)
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id,
    action: "transfer",
    provider: "commune-forge",
    receiver: "commune-grain",
    resourceConformsTo: "tools",
    resourceQuantity: { hasNumericalValue: 15, hasUnit: "unit" },
  });
  // Lateral receipt: commune-mill supplies flour to commune-forge
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id,
    action: "transfer",
    provider: "commune-mill",
    receiver: "commune-forge",
    resourceConformsTo: "flour",
    resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" },
  });

  // ---- Eastern: commune-workshop ---------------------------------------------
  const workshopReg = new ProcessRegistry();
  const workshopStore = new PlanStore(workshopReg);
  const workshopPlan = workshopStore.addPlan({
    name: "Workshop Output 2026-Q1",
  });
  const workshopProc = workshopReg.register({
    name: "Manufacturing",
    plannedWithin: workshopPlan.id,
  });
  workshopStore.addCommitment({
    plannedWithin: workshopPlan.id,
    action: "produce",
    outputOf: workshopProc.id,
    provider: "commune-workshop",
    resourceConformsTo: "goods",
    resourceQuantity: { hasNumericalValue: 60, hasUnit: "unit" },
  });

  // ---- Southern: commune-olive -----------------------------------------------
  const oliveReg = new ProcessRegistry();
  const oliveStore = new PlanStore(oliveReg);
  const olivePlan = oliveStore.addPlan({ name: "Olive Harvest 2026-Q1" });
  const oliveProc = oliveReg.register({
    name: "Olive Pressing",
    plannedWithin: olivePlan.id,
  });
  oliveStore.addCommitment({
    plannedWithin: olivePlan.id,
    action: "produce",
    outputOf: oliveProc.id,
    provider: "commune-olive",
    resourceConformsTo: "olive-oil",
    resourceQuantity: { hasNumericalValue: 100, hasUnit: "liter" },
  });

  // ---- Southern: commune-citrus ----------------------------------------------
  const citrusReg = new ProcessRegistry();
  const citrusStore = new PlanStore(citrusReg);
  const citrusPlan = citrusStore.addPlan({ name: "Citrus Harvest 2026-Q1" });
  const citrusProc = citrusReg.register({
    name: "Citrus Harvest",
    plannedWithin: citrusPlan.id,
  });
  citrusStore.addCommitment({
    plannedWithin: citrusPlan.id,
    action: "produce",
    outputOf: citrusProc.id,
    provider: "commune-citrus",
    resourceConformsTo: "citrus",
    resourceQuantity: { hasNumericalValue: 150, hasUnit: "kg" },
  });
  // Lateral receipt: commune-fisher supplies fish to commune-citrus
  citrusStore.addCommitment({
    plannedWithin: citrusPlan.id,
    action: "transfer",
    provider: "commune-fisher",
    receiver: "commune-citrus",
    resourceConformsTo: "fish",
    resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" },
  });

  // ---- Western: commune-mill (2-step: Grain Milling → Flour Sifting) ---------
  const millReg = new ProcessRegistry();
  const millStore = new PlanStore(millReg);
  const millPlan = millStore.addPlan({ name: "Mill Production 2026-Q1" });
  const millingProc = millReg.register({
    name: "Grain Milling",
    plannedWithin: millPlan.id,
  });
  const siftingProc = millReg.register({
    name: "Flour Sifting",
    plannedWithin: millPlan.id,
  });
  // Milling: wheat + work → raw-flour
  millStore.addCommitment({
    plannedWithin: millPlan.id,
    action: "consume",
    inputOf: millingProc.id,
    resourceConformsTo: "wheat",
    resourceQuantity: { hasNumericalValue: 200, hasUnit: "kg" },
  });
  millStore.addCommitment({
    plannedWithin: millPlan.id,
    action: "work",
    inputOf: millingProc.id,
    provider: "agent-miller",
    effortQuantity: { hasNumericalValue: 24, hasUnit: "hr" },
  });
  millStore.addCommitment({
    plannedWithin: millPlan.id,
    action: "produce",
    outputOf: millingProc.id,
    resourceConformsTo: "raw-flour",
    resourceQuantity: { hasNumericalValue: 160, hasUnit: "kg" },
  });
  // Sifting: raw-flour → flour
  millStore.addCommitment({
    plannedWithin: millPlan.id,
    action: "consume",
    inputOf: siftingProc.id,
    resourceConformsTo: "raw-flour",
    resourceQuantity: { hasNumericalValue: 160, hasUnit: "kg" },
  });
  millStore.addCommitment({
    plannedWithin: millPlan.id,
    action: "produce",
    outputOf: siftingProc.id,
    resourceConformsTo: "flour",
    resourceQuantity: { hasNumericalValue: 150, hasUnit: "kg" },
  });
  // Standalone transfers (inter-scope supports)
  millStore.addCommitment({
    plannedWithin: millPlan.id,
    action: "transfer",
    provider: "commune-mill",
    receiver: "commune-bakery",
    resourceConformsTo: "flour",
    resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" },
  });
  millStore.addCommitment({
    plannedWithin: millPlan.id,
    action: "transfer",
    provider: "commune-mill",
    receiver: "commune-forge",
    resourceConformsTo: "flour",
    resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" },
  });

  // ---- Western: commune-bakery (2-step: Dough Proofing → Bread Baking) ------
  const bakeryReg = new ProcessRegistry();
  const bakeryStore = new PlanStore(bakeryReg);
  const bakeryPlan = bakeryStore.addPlan({ name: "Bakery Production 2026-Q1" });
  const proofProc = bakeryReg.register({
    name: "Dough Proofing",
    plannedWithin: bakeryPlan.id,
  });
  const bakingProc = bakeryReg.register({
    name: "Bread Baking",
    plannedWithin: bakeryPlan.id,
  });
  // Proofing: flour + dairy → dough
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id,
    action: "consume",
    inputOf: proofProc.id,
    resourceConformsTo: "flour",
    resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" },
  });
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id,
    action: "consume",
    inputOf: proofProc.id,
    resourceConformsTo: "dairy",
    resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" },
  });
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id,
    action: "produce",
    outputOf: proofProc.id,
    resourceConformsTo: "dough",
    resourceQuantity: { hasNumericalValue: 90, hasUnit: "kg" },
  });
  // Baking: dough + work → bread
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id,
    action: "consume",
    inputOf: bakingProc.id,
    resourceConformsTo: "dough",
    resourceQuantity: { hasNumericalValue: 90, hasUnit: "kg" },
  });
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id,
    action: "work",
    inputOf: bakingProc.id,
    provider: "agent-baker",
    effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" },
  });
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id,
    action: "produce",
    outputOf: bakingProc.id,
    resourceConformsTo: "bread",
    resourceQuantity: { hasNumericalValue: 200, hasUnit: "loaf" },
  });

  // ---- Coastal: commune-fisher -----------------------------------------------
  const fisherReg = new ProcessRegistry();
  const fisherStore = new PlanStore(fisherReg);
  const fisherPlan = fisherStore.addPlan({ name: "Fishing 2026-Q1" });
  const fishingProc = fisherReg.register({
    name: "Fishing",
    plannedWithin: fisherPlan.id,
  });
  fisherStore.addCommitment({
    plannedWithin: fisherPlan.id,
    action: "produce",
    outputOf: fishingProc.id,
    provider: "commune-fisher",
    resourceConformsTo: "fish",
    resourceQuantity: { hasNumericalValue: 120, hasUnit: "kg" },
  });
  fisherStore.addCommitment({
    plannedWithin: fisherPlan.id,
    action: "transfer",
    provider: "commune-fisher",
    receiver: "commune-citrus",
    resourceConformsTo: "fish",
    resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" },
  });

  // ---- Coastal: commune-salter (2-step: Brine Extraction → Solar Evaporation) -
  const salterReg = new ProcessRegistry();
  const salterStore = new PlanStore(salterReg);
  const salterPlan = salterStore.addPlan({ name: "Salt Production 2026-Q1" });
  const brineProc = salterReg.register({
    name: "Brine Extraction",
    plannedWithin: salterPlan.id,
  });
  const evapProc = salterReg.register({
    name: "Solar Evaporation",
    plannedWithin: salterPlan.id,
  });
  // Brine extraction
  salterStore.addCommitment({
    plannedWithin: salterPlan.id,
    action: "produce",
    outputOf: brineProc.id,
    resourceConformsTo: "brine",
    resourceQuantity: { hasNumericalValue: 500, hasUnit: "liter" },
  });
  // Evaporation: brine → salt
  salterStore.addCommitment({
    plannedWithin: salterPlan.id,
    action: "consume",
    inputOf: evapProc.id,
    resourceConformsTo: "brine",
    resourceQuantity: { hasNumericalValue: 500, hasUnit: "liter" },
  });
  salterStore.addCommitment({
    plannedWithin: salterPlan.id,
    action: "produce",
    outputOf: evapProc.id,
    resourceConformsTo: "salt",
    resourceQuantity: { hasNumericalValue: 200, hasUnit: "kg" },
  });
  // Standalone transfer (inter-scope support)
  salterStore.addCommitment({
    plannedWithin: salterPlan.id,
    action: "transfer",
    provider: "commune-salter",
    receiver: "commune-fisher",
    resourceConformsTo: "salt",
    resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" },
  });

  // ---- Per-scope observed resources ------------------------------------------
  const mockResources = new Map<string, EconomicResource[]>([
    [
      "commune-grain",
      [
        {
          id: "res-grain-wheat",
          name: "Wheat Reserve",
          conformsTo: "wheat",
          accountingQuantity: { hasNumericalValue: 100, hasUnit: "kg" },
          onhandQuantity: { hasNumericalValue: 100, hasUnit: "kg" },
          primaryAccountable: "commune-grain",
        },
      ],
    ],
    [
      "commune-dairy",
      [
        {
          id: "res-dairy-dairy",
          name: "Dairy Stock",
          conformsTo: "dairy",
          accountingQuantity: { hasNumericalValue: 50, hasUnit: "kg" },
          onhandQuantity: { hasNumericalValue: 50, hasUnit: "kg" },
          primaryAccountable: "commune-dairy",
        },
      ],
    ],
    [
      "commune-forge",
      [
        {
          id: "res-forge-tools",
          name: "Tool Stock",
          conformsTo: "tools",
          accountingQuantity: { hasNumericalValue: 65, hasUnit: "unit" },
          onhandQuantity: { hasNumericalValue: 65, hasUnit: "unit" },
          primaryAccountable: "commune-forge",
        },
      ],
    ],
    [
      "commune-workshop",
      [
        {
          id: "res-workshop-goods",
          name: "Goods Stock",
          conformsTo: "goods",
          accountingQuantity: { hasNumericalValue: 60, hasUnit: "unit" },
          onhandQuantity: { hasNumericalValue: 60, hasUnit: "unit" },
          primaryAccountable: "commune-workshop",
        },
      ],
    ],
    [
      "commune-olive",
      [
        {
          id: "res-olive-oil",
          name: "Olive Oil",
          conformsTo: "olive-oil",
          accountingQuantity: { hasNumericalValue: 100, hasUnit: "liter" },
          onhandQuantity: { hasNumericalValue: 100, hasUnit: "liter" },
          primaryAccountable: "commune-olive",
        },
      ],
    ],
    [
      "commune-citrus",
      [
        {
          id: "res-citrus-fruit",
          name: "Citrus Fruits",
          conformsTo: "citrus",
          accountingQuantity: { hasNumericalValue: 150, hasUnit: "kg" },
          onhandQuantity: { hasNumericalValue: 150, hasUnit: "kg" },
          primaryAccountable: "commune-citrus",
        },
      ],
    ],
    [
      "commune-mill",
      [
        {
          id: "res-mill-flour",
          name: "Flour Surplus",
          conformsTo: "flour",
          accountingQuantity: { hasNumericalValue: 40, hasUnit: "kg" },
          onhandQuantity: { hasNumericalValue: 40, hasUnit: "kg" },
          primaryAccountable: "commune-mill",
        },
      ],
    ],
    [
      "commune-bakery",
      [
        {
          id: "res-bakery-bread",
          name: "Bread Stock",
          conformsTo: "bread",
          accountingQuantity: { hasNumericalValue: 200, hasUnit: "loaf" },
          onhandQuantity: { hasNumericalValue: 200, hasUnit: "loaf" },
          primaryAccountable: "commune-bakery",
        },
      ],
    ],
    [
      "commune-fisher",
      [
        {
          id: "res-fisher-fish",
          name: "Fish Stock",
          conformsTo: "fish",
          accountingQuantity: { hasNumericalValue: 80, hasUnit: "kg" },
          onhandQuantity: { hasNumericalValue: 80, hasUnit: "kg" },
          primaryAccountable: "commune-fisher",
        },
      ],
    ],
    [
      "commune-salter",
      [
        {
          id: "res-salter-salt",
          name: "Salt Reserve",
          conformsTo: "salt",
          accountingQuantity: { hasNumericalValue: 150, hasUnit: "kg" },
          onhandQuantity: { hasNumericalValue: 150, hasUnit: "kg" },
          primaryAccountable: "commune-salter",
        },
      ],
    ],
  ]);

  // ---- Scope plan results ----------------------------------------------------
  const emptyResult = (): ScopePlanResult => ({
    planStore: new PlanStore(new ProcessRegistry()),
    purchaseIntents: [],
    surplus: [],
    unmetDemand: [],
    metabolicDebt: [],
    laborGaps: [],
    deficits: [],
  });

  const mockByScope = new Map<string, ScopePlanResult>([
    // Hubs — no direct signals
    ["universal-commune", emptyResult()],
    ["northern-federation", emptyResult()],
    ["eastern-federation", emptyResult()],
    ["southern-federation", emptyResult()],
    ["western-federation", emptyResult()],
    ["coastal-federation", emptyResult()],

    // Northern communes
    [
      "commune-grain",
      {
        planStore: grainStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: grainPlan.id,
            specId: "wheat",
            quantity: 100,
            availableFrom: "2026-03-18",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [
          {
            plannedWithin: grainPlan.id,
            intentId: "intent-grain-tools",
            specId: "tools",
            action: "transfer",
            shortfall: 0,
            originalShortfall: 15,
            resolvedAt: ["commune-forge"],
            source: "unmet_demand",
          },
        ],
      },
    ],
    [
      "commune-dairy",
      {
        planStore: dairyStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: dairyPlan.id,
            specId: "dairy",
            quantity: 50,
            availableFrom: "2026-03-17",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [],
      },
    ],

    // Eastern communes
    [
      "commune-forge",
      {
        planStore: forgeStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: forgePlan.id,
            specId: "tools",
            quantity: 65,
            availableFrom: "2026-03-20",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [
          {
            plannedWithin: forgePlan.id,
            intentId: "intent-forge-flour",
            specId: "flour",
            action: "transfer",
            shortfall: 0,
            originalShortfall: 30,
            resolvedAt: ["commune-mill"],
            source: "unmet_demand",
          },
        ],
      },
    ],
    [
      "commune-workshop",
      {
        planStore: workshopStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: workshopPlan.id,
            specId: "goods",
            quantity: 60,
            availableFrom: "2026-03-22",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [],
      },
    ],

    // Southern communes
    [
      "commune-olive",
      {
        planStore: oliveStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: olivePlan.id,
            specId: "olive-oil",
            quantity: 100,
            availableFrom: "2026-03-25",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [],
      },
    ],
    [
      "commune-citrus",
      {
        planStore: citrusStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: citrusPlan.id,
            specId: "citrus",
            quantity: 150,
            availableFrom: "2026-03-24",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [
          {
            plannedWithin: citrusPlan.id,
            intentId: "intent-citrus-fish",
            specId: "fish",
            action: "transfer",
            shortfall: 0,
            originalShortfall: 40,
            resolvedAt: ["commune-fisher"],
            source: "unmet_demand",
          },
        ],
      },
    ],

    // Western communes
    [
      "commune-mill",
      {
        planStore: millStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: millPlan.id,
            specId: "flour",
            quantity: 40,
            availableFrom: "2026-03-20",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [
          {
            plannedWithin: millPlan.id,
            intentId: "intent-mill-wheat",
            specId: "wheat",
            action: "transfer",
            shortfall: 0,
            originalShortfall: 200,
            resolvedAt: ["commune-grain"],
            source: "unmet_demand",
          },
        ],
      },
    ],
    [
      "commune-bakery",
      {
        planStore: bakeryStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: bakeryPlan.id,
            specId: "bread",
            quantity: 200,
            availableFrom: "2026-03-22",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [
          {
            plannedWithin: bakeryPlan.id,
            intentId: "intent-bakery-flour",
            specId: "flour",
            action: "transfer",
            shortfall: 0,
            originalShortfall: 80,
            resolvedAt: ["commune-mill"],
            source: "unmet_demand",
          },
          {
            plannedWithin: bakeryPlan.id,
            intentId: "intent-bakery-dairy",
            specId: "dairy",
            action: "transfer",
            shortfall: 0,
            originalShortfall: 30,
            resolvedAt: ["commune-dairy"],
            source: "unmet_demand",
          },
        ],
      },
    ],

    // Coastal communes
    [
      "commune-fisher",
      {
        planStore: fisherStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: fisherPlan.id,
            specId: "fish",
            quantity: 80,
            availableFrom: "2026-03-19",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [],
      },
    ],
    [
      "commune-salter",
      {
        planStore: salterStore,
        purchaseIntents: [],
        surplus: [
          {
            plannedWithin: salterPlan.id,
            specId: "salt",
            quantity: 150,
            availableFrom: "2026-03-18",
          },
        ],
        unmetDemand: [],
        metabolicDebt: [],
        laborGaps: [],
        deficits: [],
      },
    ],
  ]);

  const mockPlanOrder = [
    "commune-grain",
    "commune-dairy",
    "commune-forge",
    "commune-workshop",
    "commune-olive",
    "commune-citrus",
    "commune-mill",
    "commune-bakery",
    "commune-fisher",
    "commune-salter",
    "northern-federation",
    "eastern-federation",
    "southern-federation",
    "western-federation",
    "coastal-federation",
    "universal-commune",
  ];

  const parentMap: Record<string, string> = {
    "northern-federation": "universal-commune",
    "eastern-federation": "universal-commune",
    "southern-federation": "universal-commune",
    "western-federation": "universal-commune",
    "coastal-federation": "universal-commune",
    "commune-grain": "northern-federation",
    "commune-dairy": "northern-federation",
    "commune-forge": "eastern-federation",
    "commune-workshop": "eastern-federation",
    "commune-olive": "southern-federation",
    "commune-citrus": "southern-federation",
    "commune-mill": "western-federation",
    "commune-bakery": "western-federation",
    "commune-fisher": "coastal-federation",
    "commune-salter": "coastal-federation",
  };

  function mockParentOf(id: string): string | undefined {
    return parentMap[id];
  }

  // 5 cross-federation inter-scope supports
  const mockTradeProposals: TradeProposal[] = [
    {
      id: "trade-grain-mill",
      fromScopeId: "commune-grain",
      toScopeId: "commune-mill",
      specId: "wheat",
      quantity: 200,
      status: "proposed",
    },
    {
      id: "trade-forge-grain",
      fromScopeId: "commune-forge",
      toScopeId: "commune-grain",
      specId: "tools",
      quantity: 15,
      status: "proposed",
    },
    {
      id: "trade-dairy-bakery",
      fromScopeId: "commune-dairy",
      toScopeId: "commune-bakery",
      specId: "dairy",
      quantity: 30,
      status: "accepted",
    },
    {
      id: "trade-mill-forge",
      fromScopeId: "commune-mill",
      toScopeId: "commune-forge",
      specId: "flour",
      quantity: 30,
      status: "proposed",
    },
    {
      id: "trade-fisher-citrus",
      fromScopeId: "commune-fisher",
      toScopeId: "commune-citrus",
      specId: "fish",
      quantity: 40,
      status: "settled",
    },
  ];

  // Federation event log
  const mockEvents: FederationEvent[] = [
    // Round 0: bottom-up pass (leaves → federations → UC)
    { kind: "scope-planned", round: 0, scopeId: "commune-grain" },
    { kind: "scope-planned", round: 0, scopeId: "commune-dairy" },
    { kind: "scope-planned", round: 0, scopeId: "commune-forge" },
    { kind: "scope-planned", round: 0, scopeId: "commune-workshop" },
    { kind: "scope-planned", round: 0, scopeId: "commune-olive" },
    { kind: "scope-planned", round: 0, scopeId: "commune-citrus" },
    { kind: "scope-planned", round: 0, scopeId: "commune-mill" },
    { kind: "scope-planned", round: 0, scopeId: "commune-bakery" },
    { kind: "scope-planned", round: 0, scopeId: "commune-fisher" },
    { kind: "scope-planned", round: 0, scopeId: "commune-salter" },
    { kind: "scope-planned", round: 0, scopeId: "northern-federation" },
    { kind: "scope-planned", round: 0, scopeId: "eastern-federation" },
    { kind: "scope-planned", round: 0, scopeId: "southern-federation" },
    { kind: "scope-planned", round: 0, scopeId: "western-federation" },
    { kind: "scope-planned", round: 0, scopeId: "coastal-federation" },
    { kind: "scope-planned", round: 0, scopeId: "universal-commune" },
    // Round 1: surplus pool
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-grain",
      specId: "wheat",
      quantity: 100,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-dairy",
      specId: "dairy",
      quantity: 50,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-forge",
      specId: "tools",
      quantity: 65,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-workshop",
      specId: "goods",
      quantity: 60,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-olive",
      specId: "olive-oil",
      quantity: 100,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-citrus",
      specId: "citrus",
      quantity: 150,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-mill",
      specId: "flour",
      quantity: 40,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-bakery",
      specId: "bread",
      quantity: 200,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-fisher",
      specId: "fish",
      quantity: 80,
    },
    {
      kind: "surplus-offered",
      round: 1,
      scopeId: "commune-salter",
      specId: "salt",
      quantity: 150,
    },
    // Round 1: cross-federation deficits announced
    {
      kind: "deficit-announced",
      round: 1,
      scopeId: "commune-mill",
      specId: "wheat",
      quantity: 200,
    },
    {
      kind: "deficit-announced",
      round: 1,
      scopeId: "commune-grain",
      specId: "tools",
      quantity: 15,
    },
    {
      kind: "deficit-announced",
      round: 1,
      scopeId: "commune-bakery",
      specId: "dairy",
      quantity: 30,
    },
    {
      kind: "deficit-announced",
      round: 1,
      scopeId: "commune-forge",
      specId: "flour",
      quantity: 30,
    },
    {
      kind: "deficit-announced",
      round: 1,
      scopeId: "commune-citrus",
      specId: "fish",
      quantity: 40,
    },
    // Round 1: lateral matches resolved
    {
      kind: "lateral-match",
      round: 1,
      scopeId: "commune-grain",
      targetScopeId: "commune-mill",
      specId: "wheat",
      quantity: 200,
    },
    {
      kind: "lateral-match",
      round: 1,
      scopeId: "commune-forge",
      targetScopeId: "commune-grain",
      specId: "tools",
      quantity: 15,
    },
    {
      kind: "lateral-match",
      round: 1,
      scopeId: "commune-dairy",
      targetScopeId: "commune-bakery",
      specId: "dairy",
      quantity: 30,
    },
    {
      kind: "lateral-match",
      round: 1,
      scopeId: "commune-mill",
      targetScopeId: "commune-forge",
      specId: "flour",
      quantity: 30,
    },
    {
      kind: "lateral-match",
      round: 1,
      scopeId: "commune-fisher",
      targetScopeId: "commune-citrus",
      specId: "fish",
      quantity: 40,
    },
  ];

  const mockRegistry = new StoreRegistry();

  // Per-scope observers seeded from mockResources
  const mockObservers = new Map<string, Observer>();
  for (const [scopeId, resources] of mockResources) {
    const obs = new Observer();
    for (const r of resources) obs.seedResource(r);
    mockObservers.set(scopeId, obs);
  }

  // ---- Buffer zones per scope -----------------------------------------------
  const mockBufferZones = new Map([
    ["commune-forge", [{ specId: "tools", tor: 25, toy: 50, tog: 80 }]],
    ["commune-mill", [{ specId: "flour", tor: 30, toy: 70, tog: 150 }]],
    ["commune-bakery", [{ specId: "bread", tor: 50, toy: 100, tog: 200 }]],
    ["commune-grain", [{ specId: "wheat", tor: 80, toy: 160, tog: 300 }]],
    ["commune-salter", [{ specId: "salt", tor: 40, toy: 90, tog: 200 }]],
    ["commune-fisher", [{ specId: "fish", tor: 20, toy: 50, tog: 120 }]],
  ]);

  // ---- Capacity buffers per scope --------------------------------------------
  const mockCapacityBuffers = new Map([
    [
      "commune-forge",
      [
        {
          processId: smeltProc.id,
          currentLoadHours: 30,
          totalCapacityHours: 40,
        },
        {
          processId: smithProc.id,
          currentLoadHours: 46,
          totalCapacityHours: 50,
        },
      ],
    ],
    [
      "commune-mill",
      [
        {
          processId: millingProc.id,
          currentLoadHours: 18,
          totalCapacityHours: 30,
        },
        {
          processId: siftingProc.id,
          currentLoadHours: 27,
          totalCapacityHours: 30,
        },
      ],
    ],
    [
      "commune-bakery",
      [
        {
          processId: proofProc.id,
          currentLoadHours: 32,
          totalCapacityHours: 48,
        },
        {
          processId: bakingProc.id,
          currentLoadHours: 46,
          totalCapacityHours: 48,
        },
      ],
    ],
    [
      "commune-grain",
      [
        {
          processId: grainProc.id,
          currentLoadHours: 70,
          totalCapacityHours: 100,
        },
      ],
    ],
  ]);

  // ---------------------------------------------------------------------------
  // Hub analytics — coherence, self-sufficiency, net flows
  // ---------------------------------------------------------------------------

  // Leaf communes for each hub (direct members only; UC flattens all leaves)
  const federationLeaves: Record<string, string[]> = {
    "northern-federation": ["commune-grain", "commune-dairy"],
    "eastern-federation": ["commune-forge", "commune-workshop"],
    "southern-federation": ["commune-olive", "commune-citrus"],
    "western-federation": ["commune-mill", "commune-bakery"],
    "coastal-federation": ["commune-fisher", "commune-salter"],
    "universal-commune": [
      "commune-grain",
      "commune-dairy",
      "commune-forge",
      "commune-workshop",
      "commune-olive",
      "commune-citrus",
      "commune-mill",
      "commune-bakery",
      "commune-fisher",
      "commune-salter",
    ],
  };
  const hubIds = new Set(Object.keys(federationLeaves));
  function isHub(id: string): boolean {
    return hubIds.has(id);
  }

  function getLeaves(hubId: string): string[] {
    return federationLeaves[hubId] ?? [];
  }

  // % of leaf deficits fully resolved
  function computeCoherence(hubId: string): number {
    const leaves = getLeaves(hubId);
    let total = 0,
      resolved = 0;
    for (const id of leaves) {
      for (const d of mockByScope.get(id)?.deficits ?? []) {
        total++;
        if (d.shortfall === 0) resolved++;
      }
    }
    return total === 0 ? 1 : resolved / total;
  }

  // % of leaf deficits resolved by a scope WITHIN the same federation
  function computeSufficiency(hubId: string): number {
    if (hubId === "universal-commune") return 1;
    const leafSet = new Set(getLeaves(hubId));
    let total = 0,
      internal = 0;
    for (const id of leafSet) {
      for (const d of mockByScope.get(id)?.deficits ?? []) {
        total++;
        const resolvers = d.resolvedAt ?? [];
        if (resolvers.length > 0 && resolvers.every((s) => leafSet.has(s)))
          internal++;
      }
    }
    return total === 0 ? 1 : internal / total;
  }

  // Aggregate net surplus pool across leaves (by spec)
  function computeSurplusPool(
    hubId: string,
  ): { specId: string; quantity: number }[] {
    const map = new Map<string, number>();
    for (const id of getLeaves(hubId)) {
      for (const s of mockByScope.get(id)?.surplus ?? [])
        map.set(s.specId, (map.get(s.specId) ?? 0) + s.quantity);
    }
    return [...map.entries()].map(([specId, quantity]) => ({
      specId,
      quantity,
    }));
  }

  // External trade flows crossing federation boundary (or everything for UC)
  function computeNetFlows(hubId: string) {
    const leafSet = new Set(getLeaves(hubId));
    const exMap = new Map<string, number>();
    const imMap = new Map<string, number>();
    for (const t of mockTradeProposals) {
      const fromIn = leafSet.has(t.fromScopeId);
      const toIn = leafSet.has(t.toScopeId);
      if (fromIn && !toIn)
        exMap.set(t.specId, (exMap.get(t.specId) ?? 0) + t.quantity);
      else if (!fromIn && toIn)
        imMap.set(t.specId, (imMap.get(t.specId) ?? 0) + t.quantity);
    }
    return {
      exports: [...exMap.entries()].map(([specId, qty]) => ({ specId, qty })),
      imports: [...imMap.entries()].map(([specId, qty]) => ({ specId, qty })),
    };
  }

  // Per-member health for a hub (green=surplus only, yellow=resolved deficit, red=unresolved)
  function computeMemberHealth(hubId: string) {
    return getLeaves(hubId).map((id) => {
      const r = mockByScope.get(id);
      const unresolved = r?.deficits.filter((d) => d.shortfall > 0).length ?? 0;
      const resolved = r?.deficits.filter((d) => d.shortfall === 0).length ?? 0;
      const surplus = r?.surplus.length ?? 0;
      const status: "red" | "yellow" | "green" | "dim" =
        unresolved > 0
          ? "red"
          : resolved > 0
            ? "yellow"
            : surplus > 0
              ? "green"
              : "dim";
      return { id, status };
    });
  }

  // Sub-federation health for universal-commune
  function computeFederationHealth() {
    return Object.keys(federationLeaves)
      .filter((id) => id !== "universal-commune")
      .map((fedId) => {
        const coherence = computeCoherence(fedId);
        const sufficiency = computeSufficiency(fedId);
        const flows = computeNetFlows(fedId);
        return {
          fedId,
          coherence,
          sufficiency,
          exports: flows.exports,
          imports: flows.imports,
        };
      });
  }

  function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }
  function coherenceColor(n: number): string {
    return n >= 1 ? "#68d391" : n >= 0.8 ? "#d69e2e" : "#e53e3e";
  }
  function sufficiencyColor(n: number): string {
    return n >= 0.8 ? "#68d391" : n >= 0.4 ? "#d69e2e" : "#b0c4f0";
  }

  // ---------------------------------------------------------------------------
  // Page state
  // ---------------------------------------------------------------------------

  let selectedScope = $state("");
  let mode = $state<"plan" | "observe">("plan");

  const selectedResult = $derived(
    selectedScope ? mockByScope.get(selectedScope) : undefined,
  );
  const selectedIsHub = $derived(isHub(selectedScope));
  const hubLeaves = $derived(selectedIsHub ? getLeaves(selectedScope) : []);
  const hubCoherence = $derived(
    selectedIsHub ? computeCoherence(selectedScope) : 0,
  );
  const hubSufficiency = $derived(
    selectedIsHub ? computeSufficiency(selectedScope) : 0,
  );
  const hubSurplus = $derived(
    selectedIsHub ? computeSurplusPool(selectedScope) : [],
  );
  const hubFlows = $derived(
    selectedIsHub
      ? computeNetFlows(selectedScope)
      : { exports: [], imports: [] },
  );
  const hubMemberHealth = $derived(
    selectedIsHub ? computeMemberHealth(selectedScope) : [],
  );
  const hubFedHealth = $derived(
    selectedScope === "universal-commune" ? computeFederationHealth() : [],
  );

  const outgoingTrades = $derived(
    mockTradeProposals.filter((t) => t.fromScopeId === selectedScope),
  );
  const incomingTrades = $derived(
    mockTradeProposals.filter((t) => t.toScopeId === selectedScope),
  );
  const hasTrades = $derived(
    outgoingTrades.length > 0 || incomingTrades.length > 0,
  );

  function tradeStatusColor(status: TradeProposal["status"]): string {
    if (status === "settled") return "#7ee8a2";
    return "#76c3f5";
  }

  const totalScopes = $derived(mockPlanOrder.length);
  const totalUnresolved = $derived(
    Array.from(mockByScope.values()).reduce(
      (sum, r) => sum + r.deficits.filter((d) => d.shortfall > 0).length,
      0,
    ),
  );
  const totalSurplusUnits = $derived(
    Array.from(mockByScope.values()).reduce(
      (sum, r) => sum + r.surplus.reduce((s, x) => s + x.quantity, 0),
      0,
    ),
  );
  const totalTrades = $derived(mockTradeProposals.length);
  const fullyResolvedDeficits = $derived(
    Array.from(mockByScope.values()).reduce((sum, r) => {
      return (
        sum +
        r.deficits.filter(
          (d) => d.shortfall === 0 && (d.originalShortfall ?? d.shortfall) > 0,
        ).length
      );
    }, 0),
  );
  const allDeficits = $derived(
    Array.from(mockByScope.values()).reduce(
      (sum, r) => sum + r.deficits.length,
      0,
    ),
  );
  const resolvedPct = $derived(
    allDeficits > 0
      ? Math.round((fullyResolvedDeficits / allDeficits) * 100)
      : 100,
  );
</script>

<div class="page">
  <!-- Header stat bar -->
  <header class="stat-bar">
    <div class="page-title">
      <span class="title-label">FEDERATION PLANNING</span>
    </div>
    <div class="stats">
      <div class="stat">
        <span class="stat-value">{totalScopes}</span>
        <span class="stat-label">SCOPES PLANNED</span>
      </div>
      <div class="stat">
        <span class="stat-value" class:red={totalUnresolved > 0}
          >{totalUnresolved}</span
        >
        <span class="stat-label">UNRESOLVED</span>
      </div>
      <div class="stat">
        <span class="stat-value green">{totalSurplusUnits}</span>
        <span class="stat-label">SURPLUS UNITS</span>
      </div>
      <div class="stat">
        <span class="stat-value blue">{totalTrades}</span>
        <span class="stat-label">INTER-SCOPE SUPPORTS</span>
      </div>
      <div class="stat">
        <span
          class="stat-value"
          class:green={resolvedPct === 100}
          class:yellow={resolvedPct < 100}>{resolvedPct}%</span
        >
        <span class="stat-label">DEFICITS RESOLVED</span>
      </div>
    </div>
  </header>

  <!-- Info strip: scope/deficit (left) | surplus/trades (right) -->
  <div class="info-strip">
    <div class="scope-band">
      {#if selectedIsHub}
        <!-- Hub: federation or universal-commune -->
        <span class="band-lbl"
          >{selectedScope === "universal-commune"
            ? "SYSTEM"
            : "FEDERATION"}</span
        >
        <span class="band-val">{selectedScope}</span>
        <span class="hub-stat">
          <span class="hub-stat-lbl">MEMBERS</span>
          <span class="hub-stat-val">{hubLeaves.length}</span>
        </span>
        <span class="band-divider"></span>
        <span class="hub-stat">
          <span class="hub-stat-lbl">COHERENCE</span>
          <span
            class="hub-stat-val"
            style="color:{coherenceColor(hubCoherence)}"
            >{pct(hubCoherence)}</span
          >
        </span>
        <span class="hub-stat">
          <span class="hub-stat-lbl">SUFFICIENCY</span>
          <span
            class="hub-stat-val"
            style="color:{sufficiencyColor(hubSufficiency)}"
            >{pct(hubSufficiency)}</span
          >
        </span>
        <span class="band-divider"></span>
        <span class="hub-stat">
          <span class="hub-stat-lbl">MEMBERS</span>
          <span class="member-dots">
            {#each hubMemberHealth as m (m.id)}
              <span class="member-dot member-dot--{m.status}" title={m.id}
              ></span>
            {/each}
          </span>
        </span>
        {#if selectedScope === "universal-commune"}
          <span class="band-divider"></span>
          {#each hubFedHealth as f (f.fedId)}
            <span class="fed-chip">
              <span class="fed-chip-name"
                >{f.fedId.replace("-federation", "")}</span
              >
              <span
                class="fed-chip-score"
                style="color:{coherenceColor(f.coherence)}"
                >{pct(f.coherence)}</span
              >
            </span>
          {/each}
        {/if}
      {:else if selectedScope && selectedResult}
        <!-- Leaf commune -->
        <span class="band-lbl">SCOPE</span>
        <span class="band-val">{selectedScope}</span>
        {#if selectedResult.deficits.length > 0}
          <span class="band-divider"></span>
          <span class="band-lbl">DEFICITS</span>
          {#each selectedResult.deficits as d (d.intentId)}
            <DeficitResidualBar
              specId={d.specId}
              shortfall={d.shortfall}
              originalShortfall={d.originalShortfall}
              resolvedAt={d.resolvedAt ?? []}
            />
          {/each}
        {/if}
        {#if selectedResult.metabolicDebt.length > 0}
          <span class="band-divider"></span>
          <span class="band-lbl">METABOLIC DEBT</span>
          {#each selectedResult.metabolicDebt as debt (debt.specId)}
            <span class="inline-item">
              <span class="band-spec">{debt.specId}</span>
              <span class="yellow">{debt.shortfall}</span>
            </span>
          {/each}
        {/if}
        {#if selectedResult.deficits.length === 0 && selectedResult.metabolicDebt.length === 0}
          <span class="band-divider"></span>
          <span class="band-empty">No deficits.</span>
        {/if}
      {:else}
        <span class="band-idle-lbl">SCOPE</span>
      {/if}
    </div>

    <div class="surplus-band">
      {#if selectedIsHub}
        <!-- Hub surplus: pool + net flows -->
        {#if hubSurplus.length > 0}
          <span class="band-lbl">POOL</span>
          {#each hubSurplus as s (s.specId)}
            <span class="inline-item">
              <span class="band-spec">{s.specId}</span>
              <span class="green">{s.quantity}</span>
            </span>
          {/each}
        {/if}
        {#if hubFlows.exports.length > 0}
          <span class="band-divider"></span>
          <span class="band-lbl">EXPORTS→</span>
          {#each hubFlows.exports as e (e.specId)}
            <span class="inline-item">
              <span class="band-spec">{e.specId}</span>
              <span style="color:#76c3f5">{e.qty}</span>
            </span>
          {/each}
        {/if}
        {#if hubFlows.imports.length > 0}
          <span class="band-divider"></span>
          <span class="band-lbl">←IMPORTS</span>
          {#each hubFlows.imports as i (i.specId)}
            <span class="inline-item">
              <span class="band-spec">{i.specId}</span>
              <span style="color:#b0c4f0">{i.qty}</span>
            </span>
          {/each}
        {/if}
        {#if selectedScope === "universal-commune"}
          <span class="band-divider"></span>
          <span class="hub-stat">
            <span class="hub-stat-lbl">TRADES</span>
            <span class="hub-stat-val blue">{mockTradeProposals.length}</span>
          </span>
          <span class="hub-stat">
            <span class="hub-stat-lbl">SETTLED</span>
            <span class="hub-stat-val green"
              >{mockTradeProposals.filter((t) => t.status === "settled")
                .length}</span
            >
          </span>
        {/if}
      {:else if selectedScope && selectedResult}
        <!-- Leaf surplus + trades -->
        {#if selectedResult.surplus.length > 0}
          <span class="band-lbl">SURPLUS</span>
          {#each selectedResult.surplus as s (s.specId)}
            <span class="inline-item">
              <span class="band-spec">{s.specId}</span>
              <span class="green">{s.quantity}</span>
              {#if s.availableFrom}<span class="muted">{s.availableFrom}</span
                >{/if}
            </span>
          {/each}
        {/if}
        {#if hasTrades}
          <span class="band-divider"></span>
          <span class="band-lbl">INTER-SCOPE SUPPORTS</span>
          {#each outgoingTrades as t (t.id)}
            <span class="inline-trade">
              <span class="trade-arrow" style="color:#76c3f5">→</span>
              <span class="trade-peer">{t.toScopeId}</span>
              <span class="trade-meta">{t.specId} ×{t.quantity}</span>
              <span
                class="trade-status"
                style="color:{tradeStatusColor(t.status)}"
                >{t.status.toUpperCase()}</span
              >
            </span>
          {/each}
          {#each incomingTrades as t (t.id)}
            <span class="inline-trade">
              <span class="trade-arrow" style="color:#7ee8a2">←</span>
              <span class="trade-peer">{t.fromScopeId}</span>
              <span class="trade-meta">{t.specId} ×{t.quantity}</span>
              <span
                class="trade-status"
                style="color:{tradeStatusColor(t.status)}"
                >{t.status.toUpperCase()}</span
              >
            </span>
          {/each}
        {/if}
        {#if selectedResult.surplus.length === 0 && !hasTrades}
          <span class="band-empty">No surplus.</span>
        {/if}
      {:else}
        <span class="band-idle-lbl">SURPLUS</span>
      {/if}
    </div>
  </div>

  <!-- Main body: event log + graph, full width -->
  <div class="body">
    <FederationEventLog events={mockEvents} />
    <div class="graph-wrap">
      <FederationGraphView
        planOrder={mockPlanOrder}
        byScope={mockByScope}
        parentOf={mockParentOf}
        tradeProposals={mockTradeProposals}
        selected={selectedScope}
        onselect={(id) => {
          selectedScope = selectedScope === id ? "" : id;
        }}
      />
    </div>
  </div>

  <!-- Network diagram band — only for leaf communes (hubs have empty plan stores) -->
  {#if selectedScope && selectedResult && !selectedIsHub}
    <div class="network-band">
      <div class="network-band-head">
        <span class="band-lbl">NETWORK</span>
        <span class="band-val">{selectedScope}</span>
        <div class="mode-tabs">
          <button
            class="tab-btn"
            class:active={mode === "plan"}
            onclick={() => (mode = "plan")}>PLAN</button
          >
          <button
            class="tab-btn"
            class:active={mode === "observe"}
            onclick={() => (mode = "observe")}>OBSERVE</button
          >
        </div>
      </div>
      <div class="network-diagram-wrap">
        <ScopeNetworkDiagram
          planStore={selectedResult.planStore}
          observer={mockObservers.get(selectedScope) ?? new Observer()}
          {specNames}
          {mode}
          bufferZones={mockBufferZones.get(selectedScope) ?? []}
          capacityBuffers={mockCapacityBuffers.get(selectedScope) ?? []}
        />
      </div>
    </div>
  {/if}

  <InventoryBand allResources={mockResources} {specNames} {selectedScope} />
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-base);
    color: rgba(228, 238, 255, 0.92);
    font-family: var(--font-mono);
    overflow: hidden;
  }

  /* ---- Stat bar ---- */
  .stat-bar {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .page-title {
    margin-right: auto;
  }

  .title-label {
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.85;
  }

  .stats {
    display: flex;
    gap: 28px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .stat-value {
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1;
  }

  .stat-value.red {
    color: #fc5858;
  }
  .stat-value.green {
    color: #7ee8a2;
  }
  .stat-value.blue {
    color: #76c3f5;
  }
  .stat-value.yellow {
    color: #e8b04e;
  }

  .stat-label {
    font-size: 0.52rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.68;
  }

  /* ---- Body ---- */
  .body {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .graph-wrap {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: flex;
  }

  /* ---- Info strip (horizontal, below stat bar) ---- */
  .info-strip {
    display: flex;
    flex-shrink: 0;
    height: 38px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-surface);
  }

  .scope-band {
    flex: 1;
    min-width: 0;
    border-right: 1px solid var(--border-faint);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .surplus-band {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  /* ---- Shared band primitives ---- */
  .band-lbl {
    font-size: 0.5rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.62;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .band-val {
    font-size: 0.68rem;
    color: rgba(228, 238, 255, 0.96);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .band-divider {
    width: 1px;
    height: 18px;
    background: var(--border-faint);
    flex-shrink: 0;
  }

  .band-idle-lbl {
    font-size: 0.5rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.38;
  }

  .band-empty {
    font-size: 0.6rem;
    opacity: 0.52;
  }

  .inline-item {
    display: flex;
    align-items: baseline;
    gap: 5px;
    font-size: 0.62rem;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .band-spec {
    color: rgba(210, 228, 255, 0.88);
  }

  .inline-trade {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.58rem;
    padding: 2px 7px;
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .trade-arrow {
    font-size: 0.65rem;
    flex-shrink: 0;
  }
  .trade-peer {
    color: rgba(210, 228, 255, 0.88);
  }
  .trade-meta {
    color: rgba(180, 205, 255, 0.65);
  }

  .trade-status {
    font-size: 0.44rem;
    letter-spacing: 0.07em;
  }

  .green {
    color: #7ee8a2;
  }
  .yellow {
    color: #e8b04e;
  }
  .blue {
    color: #76c3f5;
  }
  .muted {
    opacity: 0.58;
    font-size: 0.55rem;
  }

  /* ---- Hub-level analytics widgets ---- */
  .hub-stat {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex-shrink: 0;
  }

  .hub-stat-lbl {
    font-size: 0.42rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.45;
    line-height: 1;
  }

  .hub-stat-val {
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.02em;
  }

  .hub-stat-val.green {
    color: #7ee8a2;
  }
  .hub-stat-val.blue {
    color: #76c3f5;
  }

  /* Member health dots */
  .member-dots {
    display: flex;
    gap: 3px;
    align-items: center;
    margin-top: 1px;
  }

  .member-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .member-dot--green {
    background: #7ee8a2;
  }
  .member-dot--yellow {
    background: #e8b04e;
  }
  .member-dot--red {
    background: #fc5858;
  }
  .member-dot--dim {
    background: rgba(255, 255, 255, 0.18);
  }

  /* Per-federation chips (universal-commune view) */
  .fed-chip {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 8px;
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    flex-shrink: 0;
  }

  .fed-chip-name {
    font-size: 0.44rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    opacity: 0.55;
    line-height: 1;
  }

  .fed-chip-score {
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1;
  }

  /* ---- Network diagram band (above inventory) ---- */
  .network-band {
    flex-shrink: 0;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
  }

  .network-band-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .network-diagram-wrap {
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px 16px;
  }

  /* ---- Mode tabs ---- */
  .mode-tabs {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }

  .tab-btn {
    background: none;
    border: 1px solid var(--border-dim);
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    padding: 3px 8px;
    border-radius: 3px;
    transition:
      color 0.15s,
      border-color 0.15s,
      background 0.15s;
  }

  .tab-btn:hover {
    color: rgba(255, 255, 255, 0.7);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .tab-btn.active {
    color: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.35);
    background: var(--border-faint);
  }
</style>
