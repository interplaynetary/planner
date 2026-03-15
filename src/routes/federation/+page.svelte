<script lang="ts">
  import '$lib/components/ui/tokens.css';
  import FederationGraphView from '$lib/components/federation/FederationGraphView.svelte';
  import ScopeDetailPanel from '$lib/components/federation/ScopeDetailPanel.svelte';
  import FederationEventLog from '$lib/components/federation/FederationEventLog.svelte';
  import type { ScopePlanResult } from '$lib/planning/plan-for-scope';
  import type { TradeProposal, FederationEvent } from '$lib/planning/plan-federation';
  import { StoreRegistry } from '$lib/planning/store-registry';
  import { PlanStore } from '$lib/planning/planning';
  import { ProcessRegistry } from '$lib/process-registry';
  import { Observer } from '$lib/observation/observer';
  import type { EconomicResource } from '$lib/schemas';

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
  // 5 Lateral trades (cross-federation peer exchanges):
  //   commune-grain  (N) → commune-mill    (W): wheat × 200
  //   commune-forge  (E) → commune-grain   (N): tools × 15
  //   commune-dairy  (N) → commune-bakery  (W): dairy × 30
  //   commune-mill   (W) → commune-forge   (E): flour × 30
  //   commune-fisher (C) → commune-citrus  (S): fish  × 40
  // ---------------------------------------------------------------------------

  const specNames: Record<string, string> = {
    wheat:      'Wheat',
    dairy:      'Dairy',
    tools:      'Tools',
    goods:      'Goods',
    'olive-oil':'Olive Oil',
    citrus:     'Citrus',
    flour:      'Flour',
    bread:      'Bread',
    fish:       'Fish',
    salt:       'Salt',
  };

  // ---- Northern: commune-grain -----------------------------------------------
  const grainReg = new ProcessRegistry();
  const grainStore = new PlanStore(grainReg);
  const grainPlan = grainStore.addPlan({ name: 'Grain Harvest 2026-Q1' });
  const grainProc = grainReg.register({ name: 'Wheat Harvest', plannedWithin: grainPlan.id });
  grainStore.addCommitment({
    plannedWithin: grainPlan.id, action: 'produce',
    outputOf: grainProc.id,
    provider: 'commune-grain', resourceConformsTo: 'wheat',
    resourceQuantity: { hasNumericalValue: 300, hasUnit: 'kg' },
  });
  grainStore.addCommitment({
    plannedWithin: grainPlan.id, action: 'transfer',
    provider: 'commune-grain', receiver: 'commune-mill', resourceConformsTo: 'wheat',
    resourceQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
  });

  // ---- Northern: commune-dairy -----------------------------------------------
  const dairyReg = new ProcessRegistry();
  const dairyStore = new PlanStore(dairyReg);
  const dairyPlan = dairyStore.addPlan({ name: 'Dairy Production 2026-Q1' });
  const dairyProc = dairyReg.register({ name: 'Dairy Production', plannedWithin: dairyPlan.id });
  dairyStore.addCommitment({
    plannedWithin: dairyPlan.id, action: 'produce',
    outputOf: dairyProc.id,
    provider: 'commune-dairy', resourceConformsTo: 'dairy',
    resourceQuantity: { hasNumericalValue: 80, hasUnit: 'kg' },
  });
  dairyStore.addCommitment({
    plannedWithin: dairyPlan.id, action: 'transfer',
    provider: 'commune-dairy', receiver: 'commune-bakery', resourceConformsTo: 'dairy',
    resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
  });

  // ---- Eastern: commune-forge ------------------------------------------------
  const forgeReg = new ProcessRegistry();
  const forgeStore = new PlanStore(forgeReg);
  const forgePlan = forgeStore.addPlan({ name: 'Forge Output 2026-Q1' });
  const forgeProc = forgeReg.register({ name: 'Forge Work', plannedWithin: forgePlan.id });
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id, action: 'produce',
    outputOf: forgeProc.id,
    provider: 'commune-forge', resourceConformsTo: 'tools',
    resourceQuantity: { hasNumericalValue: 80, hasUnit: 'unit' },
  });
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id, action: 'transfer',
    provider: 'commune-forge', receiver: 'commune-grain', resourceConformsTo: 'tools',
    resourceQuantity: { hasNumericalValue: 15, hasUnit: 'unit' },
  });
  // Lateral receipt: commune-mill supplies flour to commune-forge
  forgeStore.addCommitment({
    plannedWithin: forgePlan.id, action: 'transfer',
    provider: 'commune-mill', receiver: 'commune-forge', resourceConformsTo: 'flour',
    resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
  });

  // ---- Eastern: commune-workshop ---------------------------------------------
  const workshopReg = new ProcessRegistry();
  const workshopStore = new PlanStore(workshopReg);
  const workshopPlan = workshopStore.addPlan({ name: 'Workshop Output 2026-Q1' });
  const workshopProc = workshopReg.register({ name: 'Manufacturing', plannedWithin: workshopPlan.id });
  workshopStore.addCommitment({
    plannedWithin: workshopPlan.id, action: 'produce',
    outputOf: workshopProc.id,
    provider: 'commune-workshop', resourceConformsTo: 'goods',
    resourceQuantity: { hasNumericalValue: 60, hasUnit: 'unit' },
  });

  // ---- Southern: commune-olive -----------------------------------------------
  const oliveReg = new ProcessRegistry();
  const oliveStore = new PlanStore(oliveReg);
  const olivePlan = oliveStore.addPlan({ name: 'Olive Harvest 2026-Q1' });
  const oliveProc = oliveReg.register({ name: 'Olive Pressing', plannedWithin: olivePlan.id });
  oliveStore.addCommitment({
    plannedWithin: olivePlan.id, action: 'produce',
    outputOf: oliveProc.id,
    provider: 'commune-olive', resourceConformsTo: 'olive-oil',
    resourceQuantity: { hasNumericalValue: 100, hasUnit: 'liter' },
  });

  // ---- Southern: commune-citrus ----------------------------------------------
  const citrusReg = new ProcessRegistry();
  const citrusStore = new PlanStore(citrusReg);
  const citrusPlan = citrusStore.addPlan({ name: 'Citrus Harvest 2026-Q1' });
  const citrusProc = citrusReg.register({ name: 'Citrus Harvest', plannedWithin: citrusPlan.id });
  citrusStore.addCommitment({
    plannedWithin: citrusPlan.id, action: 'produce',
    outputOf: citrusProc.id,
    provider: 'commune-citrus', resourceConformsTo: 'citrus',
    resourceQuantity: { hasNumericalValue: 150, hasUnit: 'kg' },
  });
  // Lateral receipt: commune-fisher supplies fish to commune-citrus
  citrusStore.addCommitment({
    plannedWithin: citrusPlan.id, action: 'transfer',
    provider: 'commune-fisher', receiver: 'commune-citrus', resourceConformsTo: 'fish',
    resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
  });

  // ---- Western: commune-mill -------------------------------------------------
  const millReg = new ProcessRegistry();
  const millStore = new PlanStore(millReg);
  const millPlan = millStore.addPlan({ name: 'Mill Production 2026-Q1' });
  const millingProc = millReg.register({ name: 'Grain Milling', plannedWithin: millPlan.id });
  millStore.addCommitment({
    plannedWithin: millPlan.id, action: 'consume',
    inputOf: millingProc.id,
    provider: 'commune-mill', resourceConformsTo: 'wheat',
    resourceQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
  });
  millStore.addCommitment({
    plannedWithin: millPlan.id, action: 'produce',
    outputOf: millingProc.id,
    provider: 'commune-mill', resourceConformsTo: 'flour',
    resourceQuantity: { hasNumericalValue: 150, hasUnit: 'kg' },
  });
  millStore.addCommitment({
    plannedWithin: millPlan.id, action: 'transfer',
    provider: 'commune-mill', receiver: 'commune-bakery', resourceConformsTo: 'flour',
    resourceQuantity: { hasNumericalValue: 80, hasUnit: 'kg' },
  });
  millStore.addCommitment({
    plannedWithin: millPlan.id, action: 'transfer',
    provider: 'commune-mill', receiver: 'commune-forge', resourceConformsTo: 'flour',
    resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
  });

  // ---- Western: commune-bakery -----------------------------------------------
  const bakeryReg = new ProcessRegistry();
  const bakeryStore = new PlanStore(bakeryReg);
  const bakeryPlan = bakeryStore.addPlan({ name: 'Bakery Production 2026-Q1' });
  const bakingProc = bakeryReg.register({ name: 'Bread Baking', plannedWithin: bakeryPlan.id });
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id, action: 'consume',
    inputOf: bakingProc.id,
    provider: 'commune-bakery', resourceConformsTo: 'flour',
    resourceQuantity: { hasNumericalValue: 80, hasUnit: 'kg' },
  });
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id, action: 'consume',
    inputOf: bakingProc.id,
    provider: 'commune-bakery', resourceConformsTo: 'dairy',
    resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
  });
  bakeryStore.addCommitment({
    plannedWithin: bakeryPlan.id, action: 'produce',
    outputOf: bakingProc.id,
    provider: 'commune-bakery', resourceConformsTo: 'bread',
    resourceQuantity: { hasNumericalValue: 200, hasUnit: 'loaf' },
  });

  // ---- Coastal: commune-fisher -----------------------------------------------
  const fisherReg = new ProcessRegistry();
  const fisherStore = new PlanStore(fisherReg);
  const fisherPlan = fisherStore.addPlan({ name: 'Fishing 2026-Q1' });
  const fishingProc = fisherReg.register({ name: 'Fishing', plannedWithin: fisherPlan.id });
  fisherStore.addCommitment({
    plannedWithin: fisherPlan.id, action: 'produce',
    outputOf: fishingProc.id,
    provider: 'commune-fisher', resourceConformsTo: 'fish',
    resourceQuantity: { hasNumericalValue: 120, hasUnit: 'kg' },
  });
  fisherStore.addCommitment({
    plannedWithin: fisherPlan.id, action: 'transfer',
    provider: 'commune-fisher', receiver: 'commune-citrus', resourceConformsTo: 'fish',
    resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
  });

  // ---- Coastal: commune-salter -----------------------------------------------
  const salterReg = new ProcessRegistry();
  const salterStore = new PlanStore(salterReg);
  const salterPlan = salterStore.addPlan({ name: 'Salt Production 2026-Q1' });
  const saltProc = salterReg.register({ name: 'Salt Extraction', plannedWithin: salterPlan.id });
  salterStore.addCommitment({
    plannedWithin: salterPlan.id, action: 'produce',
    outputOf: saltProc.id,
    provider: 'commune-salter', resourceConformsTo: 'salt',
    resourceQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
  });
  salterStore.addCommitment({
    plannedWithin: salterPlan.id, action: 'transfer',
    provider: 'commune-salter', receiver: 'commune-fisher', resourceConformsTo: 'salt',
    resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
  });

  // ---- Per-scope observed resources ------------------------------------------
  const mockResources = new Map<string, EconomicResource[]>([
    ['commune-grain',    [{ id: 'res-grain-wheat',    name: 'Wheat Reserve',   conformsTo: 'wheat',     accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },    onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },    primaryAccountable: 'commune-grain' }]],
    ['commune-dairy',    [{ id: 'res-dairy-dairy',    name: 'Dairy Stock',     conformsTo: 'dairy',     accountingQuantity: { hasNumericalValue: 50,  hasUnit: 'kg' },    onhandQuantity: { hasNumericalValue: 50,  hasUnit: 'kg' },    primaryAccountable: 'commune-dairy' }]],
    ['commune-forge',    [{ id: 'res-forge-tools',    name: 'Tool Stock',      conformsTo: 'tools',     accountingQuantity: { hasNumericalValue: 65,  hasUnit: 'unit' },  onhandQuantity: { hasNumericalValue: 65,  hasUnit: 'unit' },  primaryAccountable: 'commune-forge' }]],
    ['commune-workshop', [{ id: 'res-workshop-goods', name: 'Goods Stock',     conformsTo: 'goods',     accountingQuantity: { hasNumericalValue: 60,  hasUnit: 'unit' },  onhandQuantity: { hasNumericalValue: 60,  hasUnit: 'unit' },  primaryAccountable: 'commune-workshop' }]],
    ['commune-olive',    [{ id: 'res-olive-oil',      name: 'Olive Oil',       conformsTo: 'olive-oil', accountingQuantity: { hasNumericalValue: 100, hasUnit: 'liter' }, onhandQuantity: { hasNumericalValue: 100, hasUnit: 'liter' }, primaryAccountable: 'commune-olive' }]],
    ['commune-citrus',   [{ id: 'res-citrus-fruit',   name: 'Citrus Fruits',   conformsTo: 'citrus',    accountingQuantity: { hasNumericalValue: 150, hasUnit: 'kg' },    onhandQuantity: { hasNumericalValue: 150, hasUnit: 'kg' },    primaryAccountable: 'commune-citrus' }]],
    ['commune-mill',     [{ id: 'res-mill-flour',     name: 'Flour Surplus',   conformsTo: 'flour',     accountingQuantity: { hasNumericalValue: 40,  hasUnit: 'kg' },    onhandQuantity: { hasNumericalValue: 40,  hasUnit: 'kg' },    primaryAccountable: 'commune-mill' }]],
    ['commune-bakery',   [{ id: 'res-bakery-bread',   name: 'Bread Stock',     conformsTo: 'bread',     accountingQuantity: { hasNumericalValue: 200, hasUnit: 'loaf' },  onhandQuantity: { hasNumericalValue: 200, hasUnit: 'loaf' },  primaryAccountable: 'commune-bakery' }]],
    ['commune-fisher',   [{ id: 'res-fisher-fish',    name: 'Fish Stock',      conformsTo: 'fish',      accountingQuantity: { hasNumericalValue: 80,  hasUnit: 'kg' },    onhandQuantity: { hasNumericalValue: 80,  hasUnit: 'kg' },    primaryAccountable: 'commune-fisher' }]],
    ['commune-salter',   [{ id: 'res-salter-salt',    name: 'Salt Reserve',    conformsTo: 'salt',      accountingQuantity: { hasNumericalValue: 150, hasUnit: 'kg' },    onhandQuantity: { hasNumericalValue: 150, hasUnit: 'kg' },    primaryAccountable: 'commune-salter' }]],
  ]);

  // ---- Scope plan results ----------------------------------------------------
  const emptyResult = (): ScopePlanResult => ({
    planStore: new PlanStore(new ProcessRegistry()),
    purchaseIntents: [], surplus: [], unmetDemand: [], metabolicDebt: [], laborGaps: [], deficits: [],
  });

  const mockByScope = new Map<string, ScopePlanResult>([
    // Hubs — no direct signals
    ['universal-commune',   emptyResult()],
    ['northern-federation', emptyResult()],
    ['eastern-federation',  emptyResult()],
    ['southern-federation', emptyResult()],
    ['western-federation',  emptyResult()],
    ['coastal-federation',  emptyResult()],

    // Northern communes
    ['commune-grain', {
      planStore: grainStore, purchaseIntents: [],
      surplus: [{ plannedWithin: grainPlan.id, specId: 'wheat', quantity: 100, availableFrom: '2026-03-18' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [],
      deficits: [{
        plannedWithin: grainPlan.id, intentId: 'intent-grain-tools',
        specId: 'tools', action: 'transfer',
        shortfall: 0, originalShortfall: 15, resolvedAt: ['commune-forge'],
        source: 'unmet_demand',
      }],
    }],
    ['commune-dairy', {
      planStore: dairyStore, purchaseIntents: [],
      surplus: [{ plannedWithin: dairyPlan.id, specId: 'dairy', quantity: 50, availableFrom: '2026-03-17' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [], deficits: [],
    }],

    // Eastern communes
    ['commune-forge', {
      planStore: forgeStore, purchaseIntents: [],
      surplus: [{ plannedWithin: forgePlan.id, specId: 'tools', quantity: 65, availableFrom: '2026-03-20' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [],
      deficits: [{
        plannedWithin: forgePlan.id, intentId: 'intent-forge-flour',
        specId: 'flour', action: 'transfer',
        shortfall: 0, originalShortfall: 30, resolvedAt: ['commune-mill'],
        source: 'unmet_demand',
      }],
    }],
    ['commune-workshop', {
      planStore: workshopStore, purchaseIntents: [],
      surplus: [{ plannedWithin: workshopPlan.id, specId: 'goods', quantity: 60, availableFrom: '2026-03-22' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [], deficits: [],
    }],

    // Southern communes
    ['commune-olive', {
      planStore: oliveStore, purchaseIntents: [],
      surplus: [{ plannedWithin: olivePlan.id, specId: 'olive-oil', quantity: 100, availableFrom: '2026-03-25' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [], deficits: [],
    }],
    ['commune-citrus', {
      planStore: citrusStore, purchaseIntents: [],
      surplus: [{ plannedWithin: citrusPlan.id, specId: 'citrus', quantity: 150, availableFrom: '2026-03-24' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [],
      deficits: [{
        plannedWithin: citrusPlan.id, intentId: 'intent-citrus-fish',
        specId: 'fish', action: 'transfer',
        shortfall: 0, originalShortfall: 40, resolvedAt: ['commune-fisher'],
        source: 'unmet_demand',
      }],
    }],

    // Western communes
    ['commune-mill', {
      planStore: millStore, purchaseIntents: [],
      surplus: [{ plannedWithin: millPlan.id, specId: 'flour', quantity: 40, availableFrom: '2026-03-20' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [],
      deficits: [{
        plannedWithin: millPlan.id, intentId: 'intent-mill-wheat',
        specId: 'wheat', action: 'transfer',
        shortfall: 0, originalShortfall: 200, resolvedAt: ['commune-grain'],
        source: 'unmet_demand',
      }],
    }],
    ['commune-bakery', {
      planStore: bakeryStore, purchaseIntents: [],
      surplus: [{ plannedWithin: bakeryPlan.id, specId: 'bread', quantity: 200, availableFrom: '2026-03-22' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [],
      deficits: [
        {
          plannedWithin: bakeryPlan.id, intentId: 'intent-bakery-flour',
          specId: 'flour', action: 'transfer',
          shortfall: 0, originalShortfall: 80, resolvedAt: ['commune-mill'],
          source: 'unmet_demand',
        },
        {
          plannedWithin: bakeryPlan.id, intentId: 'intent-bakery-dairy',
          specId: 'dairy', action: 'transfer',
          shortfall: 0, originalShortfall: 30, resolvedAt: ['commune-dairy'],
          source: 'unmet_demand',
        },
      ],
    }],

    // Coastal communes
    ['commune-fisher', {
      planStore: fisherStore, purchaseIntents: [],
      surplus: [{ plannedWithin: fisherPlan.id, specId: 'fish', quantity: 80, availableFrom: '2026-03-19' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [], deficits: [],
    }],
    ['commune-salter', {
      planStore: salterStore, purchaseIntents: [],
      surplus: [{ plannedWithin: salterPlan.id, specId: 'salt', quantity: 150, availableFrom: '2026-03-18' }],
      unmetDemand: [], metabolicDebt: [], laborGaps: [], deficits: [],
    }],
  ]);

  const mockPlanOrder = [
    'commune-grain', 'commune-dairy',
    'commune-forge', 'commune-workshop',
    'commune-olive', 'commune-citrus',
    'commune-mill',  'commune-bakery',
    'commune-fisher','commune-salter',
    'northern-federation', 'eastern-federation', 'southern-federation',
    'western-federation',  'coastal-federation',
    'universal-commune',
  ];

  const parentMap: Record<string, string> = {
    'northern-federation': 'universal-commune',
    'eastern-federation':  'universal-commune',
    'southern-federation': 'universal-commune',
    'western-federation':  'universal-commune',
    'coastal-federation':  'universal-commune',
    'commune-grain':       'northern-federation',
    'commune-dairy':       'northern-federation',
    'commune-forge':       'eastern-federation',
    'commune-workshop':    'eastern-federation',
    'commune-olive':       'southern-federation',
    'commune-citrus':      'southern-federation',
    'commune-mill':        'western-federation',
    'commune-bakery':      'western-federation',
    'commune-fisher':      'coastal-federation',
    'commune-salter':      'coastal-federation',
  };

  function mockParentOf(id: string): string | undefined {
    return parentMap[id];
  }

  // 5 cross-federation lateral trades
  const mockTradeProposals: TradeProposal[] = [
    { id: 'trade-grain-mill',    fromScopeId: 'commune-grain',  toScopeId: 'commune-mill',   specId: 'wheat', quantity: 200, status: 'proposed' },
    { id: 'trade-forge-grain',   fromScopeId: 'commune-forge',  toScopeId: 'commune-grain',  specId: 'tools', quantity: 15,  status: 'proposed' },
    { id: 'trade-dairy-bakery',  fromScopeId: 'commune-dairy',  toScopeId: 'commune-bakery', specId: 'dairy', quantity: 30,  status: 'accepted' },
    { id: 'trade-mill-forge',    fromScopeId: 'commune-mill',   toScopeId: 'commune-forge',  specId: 'flour', quantity: 30,  status: 'proposed' },
    { id: 'trade-fisher-citrus', fromScopeId: 'commune-fisher', toScopeId: 'commune-citrus', specId: 'fish',  quantity: 40,  status: 'settled'  },
  ];

  // Federation event log
  const mockEvents: FederationEvent[] = [
    // Round 0: bottom-up pass (leaves → federations → UC)
    { kind: 'scope-planned', round: 0, scopeId: 'commune-grain' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-dairy' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-forge' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-workshop' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-olive' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-citrus' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-mill' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-bakery' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-fisher' },
    { kind: 'scope-planned', round: 0, scopeId: 'commune-salter' },
    { kind: 'scope-planned', round: 0, scopeId: 'northern-federation' },
    { kind: 'scope-planned', round: 0, scopeId: 'eastern-federation' },
    { kind: 'scope-planned', round: 0, scopeId: 'southern-federation' },
    { kind: 'scope-planned', round: 0, scopeId: 'western-federation' },
    { kind: 'scope-planned', round: 0, scopeId: 'coastal-federation' },
    { kind: 'scope-planned', round: 0, scopeId: 'universal-commune' },
    // Round 1: surplus pool
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-grain',    specId: 'wheat',     quantity: 100 },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-dairy',    specId: 'dairy',     quantity: 50  },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-forge',    specId: 'tools',     quantity: 65  },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-workshop', specId: 'goods',     quantity: 60  },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-olive',    specId: 'olive-oil', quantity: 100 },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-citrus',   specId: 'citrus',    quantity: 150 },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-mill',     specId: 'flour',     quantity: 40  },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-bakery',   specId: 'bread',     quantity: 200 },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-fisher',   specId: 'fish',      quantity: 80  },
    { kind: 'surplus-offered', round: 1, scopeId: 'commune-salter',   specId: 'salt',      quantity: 150 },
    // Round 1: cross-federation deficits announced
    { kind: 'deficit-announced', round: 1, scopeId: 'commune-mill',   specId: 'wheat', quantity: 200 },
    { kind: 'deficit-announced', round: 1, scopeId: 'commune-grain',  specId: 'tools', quantity: 15  },
    { kind: 'deficit-announced', round: 1, scopeId: 'commune-bakery', specId: 'dairy', quantity: 30  },
    { kind: 'deficit-announced', round: 1, scopeId: 'commune-forge',  specId: 'flour', quantity: 30  },
    { kind: 'deficit-announced', round: 1, scopeId: 'commune-citrus', specId: 'fish',  quantity: 40  },
    // Round 1: lateral matches resolved
    { kind: 'lateral-match', round: 1, scopeId: 'commune-grain',  targetScopeId: 'commune-mill',   specId: 'wheat', quantity: 200 },
    { kind: 'lateral-match', round: 1, scopeId: 'commune-forge',  targetScopeId: 'commune-grain',  specId: 'tools', quantity: 15  },
    { kind: 'lateral-match', round: 1, scopeId: 'commune-dairy',  targetScopeId: 'commune-bakery', specId: 'dairy', quantity: 30  },
    { kind: 'lateral-match', round: 1, scopeId: 'commune-mill',   targetScopeId: 'commune-forge',  specId: 'flour', quantity: 30  },
    { kind: 'lateral-match', round: 1, scopeId: 'commune-fisher', targetScopeId: 'commune-citrus', specId: 'fish',  quantity: 40  },
  ];

  const mockRegistry = new StoreRegistry();

  // Per-scope observers seeded from mockResources
  const mockObservers = new Map<string, Observer>();
  for (const [scopeId, resources] of mockResources) {
    const obs = new Observer();
    for (const r of resources) obs.seedResource(r);
    mockObservers.set(scopeId, obs);
  }

  // ---------------------------------------------------------------------------
  // Page state
  // ---------------------------------------------------------------------------

  let selectedScope = $state('');

  const selectedResult = $derived(selectedScope ? mockByScope.get(selectedScope) : undefined);

  const totalScopes = $derived(mockPlanOrder.length);
  const totalUnresolved = $derived(
    Array.from(mockByScope.values()).reduce(
      (sum, r) => sum + r.deficits.filter(d => d.shortfall > 0).length,
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
      return sum + r.deficits.filter(d => d.shortfall === 0 && (d.originalShortfall ?? d.shortfall) > 0).length;
    }, 0),
  );
  const allDeficits = $derived(
    Array.from(mockByScope.values()).reduce((sum, r) => sum + r.deficits.length, 0),
  );
  const resolvedPct = $derived(allDeficits > 0 ? Math.round((fullyResolvedDeficits / allDeficits) * 100) : 100);
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
        <span class="stat-value" class:red={totalUnresolved > 0}>{totalUnresolved}</span>
        <span class="stat-label">UNRESOLVED</span>
      </div>
      <div class="stat">
        <span class="stat-value green">{totalSurplusUnits}</span>
        <span class="stat-label">SURPLUS UNITS</span>
      </div>
      <div class="stat">
        <span class="stat-value blue">{totalTrades}</span>
        <span class="stat-label">LATERAL TRADES</span>
      </div>
      <div class="stat">
        <span class="stat-value" class:green={resolvedPct === 100} class:yellow={resolvedPct < 100}>{resolvedPct}%</span>
        <span class="stat-label">DEFICITS RESOLVED</span>
      </div>
    </div>
  </header>

  <!-- Main body -->
  <div class="body">
    <!-- Graph -->
    <div class="graph-wrap">
      <FederationGraphView
        planOrder={mockPlanOrder}
        byScope={mockByScope}
        parentOf={mockParentOf}
        tradeProposals={mockTradeProposals}
        selected={selectedScope}
        onselect={(id) => { selectedScope = selectedScope === id ? '' : id; }}
      />
    </div>

    <!-- Detail panel or placeholder -->
    {#if selectedScope && selectedResult}
      <ScopeDetailPanel
        scopeId={selectedScope}
        result={selectedResult}
        observer={mockObservers.get(selectedScope) ?? new Observer()}
        resources={mockResources.get(selectedScope) ?? []}
        {specNames}
        registry={mockRegistry}
        tradeProposals={mockTradeProposals}
        onclose={() => { selectedScope = ''; }}
      />
    {:else}
      <div class="placeholder">
        <span class="ph-icon">◈</span>
        <span class="ph-text">Click a scope node to inspect deficits, surplus, lateral trades, and metabolic debt.</span>
      </div>
    {/if}
  </div>

  <!-- Federation event log strip -->
  <FederationEventLog events={mockEvents} />
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #0a0a0a;
    color: rgba(255, 255, 255, 0.8);
    font-family: var(--font-mono);
    overflow: hidden;
  }

  /* ---- Stat bar ---- */
  .stat-bar {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 10px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: #111;
    flex-shrink: 0;
  }

  .page-title {
    margin-right: auto;
  }

  .title-label {
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.55;
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

  .stat-value.red    { color: #e53e3e; }
  .stat-value.green  { color: #68d391; }
  .stat-value.blue   { color: #63b3ed; }
  .stat-value.yellow { color: #d69e2e; }

  .stat-label {
    font-size: 0.52rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.35;
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

  /* ---- Placeholder ---- */
  .placeholder {
    width: 480px;
    min-width: 480px;
    background: #111;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    flex-shrink: 0;
  }

  .ph-icon {
    font-size: 1.8rem;
    opacity: 0.15;
  }

  .ph-text {
    font-size: 0.65rem;
    line-height: 1.6;
    opacity: 0.3;
    text-align: center;
    letter-spacing: 0.04em;
  }
</style>
