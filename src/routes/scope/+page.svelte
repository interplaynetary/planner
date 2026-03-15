<script lang="ts">
  import "$lib/components/ui/tokens.css";
  import ScopePanel from "$lib/components/scope/ScopePanel.svelte";
  import NetworkDiagram from "$lib/components/vf/NetworkDiagram.svelte";
  import EventRecorderPanel from "$lib/components/observation/EventRecorderPanel.svelte";
  import type { FlowSelectCtx } from "$lib/components/vf/observe-types";
  import { SvelteMap } from "svelte/reactivity";
  import { eventList, agentList, commitmentList, communeState, resourceSpecs, intentList, planList } from "$lib/vf-stores.svelte";
  import { resetStores, processList } from "$lib/vf-stores.svelte";
  import { seedExample } from "$lib/vf-seed";
  import WorkerCard from "$lib/components/scope/WorkerCard.svelte";
  import {
    computeScopeTransitionReport,
    type ScopeTransitionConfig,
  } from "$lib/observation/transition";

  // ── Federation hourly dollar rate (set by federation policy) ─────────────
  let federationRate = $state(0);

  // ── Social economy policy inputs ──────────────────────────────────────────
  let targetCommunalRatio = $state(1.0);
  let claimPurchasingPower = $state(0);      // goods per 1 SVC unit in local claim pool
  let subsidyReceived = $state(0);           // federation bridge subsidy this period ($)
  let avgCommunalCoverage = $state(0);       // market-cost equivalent of communal provision per worker ($)

  // Workers = agents who appear as `provider` in work events
  const workerIds = $derived([
    ...new Set(
      eventList
        .filter((e) => e.action === "work" && e.provider)
        .map((e) => e.provider!),
    ),
  ]);

  // ── Flow classification state ─────────────────────────────────────────────
  interface FlowConfig {
    isMarket: boolean;
    unitPrice: number;
  }
  let outputFlowConfigs = new SvelteMap<string, FlowConfig>();
  let inputFlowConfigs  = new SvelteMap<string, FlowConfig>();

  // ── Scope owner = most-frequent provider across all outputOf commitments ──
  const scopeOwnerId = $derived.by(() => {
    const tally = new Map<string, number>();
    for (const c of commitmentList)
      if (c.outputOf && c.provider)
        tally.set(c.provider, (tally.get(c.provider) ?? 0) + 1);
    let best = "ose", bestCount = 0;
    for (const [id, count] of tally)
      if (count > bestCount) { best = id; bestCount = count; }
    return best;
  });

  const agentsById = $derived(new Map(agentList.map((a) => [a.id, a])));

  const socialPlanIds = $derived(
    new Set(planList.filter(p => p.classifiedAs?.includes('tag:plan:social')).map(p => p.id))
  );
  const intentsById = $derived(new Map(intentList.map(i => [i.id, i])));

  // ── Flow classification helper ────────────────────────────────────────────
  type FlowDirection = 'output' | 'input';

  function classifyFlowChannel(
    c: typeof commitmentList[number],
    direction: FlowDirection,
    counterpartyId: string,
    socialPlanIds: Set<string>,
    intentsById: Map<string, typeof intentList[number]>,
    agentsById: Map<string, typeof agentList[number]>,
    scopeOwnerId: string,
  ): { isMarket: boolean; isSocialByAction: boolean; isSocialByPlan: boolean } {
    // Tier 1: action type carries unambiguous signal
    const isSocialByAction = c.action === 'transferCustody';
    const isMarketByAction = c.action === 'transferAllRights';
    // Tier 2: plan-chain check for ambiguous actions
    let isSocialByPlan = false;
    if (!isSocialByAction && !isMarketByAction) {
      if (c.satisfies) {
        const intent = intentsById.get(c.satisfies);
        if (intent?.plannedWithin && socialPlanIds.has(intent.plannedWithin)) {
          const intentParty = direction === 'output' ? intent.receiver : intent.provider;
          if (!intentParty || intentParty === counterpartyId) isSocialByPlan = true;
        }
      }
      if (!isSocialByPlan && c.plannedWithin && socialPlanIds.has(c.plannedWithin))
        isSocialByPlan = true;
    }
    // Tier 3: agent-type heuristic fallback
    const counterpartyAgent = agentsById.get(counterpartyId);
    const isMarket = !isSocialByAction && !isSocialByPlan &&
      (isMarketByAction ||
       (!!counterpartyAgent && counterpartyAgent.type === 'Organization' && counterpartyId !== scopeOwnerId));
    return { isMarket, isSocialByAction, isSocialByPlan };
  }

  interface FlowRow {
    rowKey: string;          // `${specId}|${counterpartyId}`
    specId: string; specName: string; unit: string;
    counterpartyId: string; counterpartyName: string;
    plannedQty: number; actualQty: number;
    isMarket: boolean; unitPrice: number;
    planValidated: boolean;
  }

  const outputFlows = $derived.by((): FlowRow[] => {
    const processIds = new Set(processList.map((p) => p.id));
    type RowAcc = { planned: number; unit: string; counterpartyId: string; counterpartyName: string; isExternalByDefault: boolean; planValidated: boolean; specId: string; specName: string };
    const rowMap = new Map<string, RowAcc>();
    for (const c of commitmentList) {
      if (c.outputOf && processIds.has(c.outputOf) && c.resourceConformsTo) {
        const specId = c.resourceConformsTo;
        const counterpartyId = c.receiver ?? '_unknown';
        const rowKey = `${specId}|${counterpartyId}`;
        const qty = c.resourceQuantity?.hasNumericalValue ?? 0;
        const unit = c.resourceQuantity?.hasUnit ?? '';
        const { isMarket: isExternalByDefault, isSocialByAction, isSocialByPlan } =
          classifyFlowChannel(c, 'output', counterpartyId, socialPlanIds, intentsById, agentsById, scopeOwnerId);
        const counterpartyAgent = agentsById.get(counterpartyId);
        const counterpartyName = counterpartyAgent?.name ?? counterpartyId;
        const existing = rowMap.get(rowKey);
        rowMap.set(rowKey, {
          planned: (existing?.planned ?? 0) + qty,
          unit: existing?.unit ?? unit,
          counterpartyId, counterpartyName,
          isExternalByDefault: isExternalByDefault || (existing?.isExternalByDefault ?? false),
          planValidated: isSocialByAction || isSocialByPlan || (existing?.planValidated ?? false),
          specId,
          specName: resourceSpecs.find((s) => s.id === specId)?.name ?? specId,
        });
      }
    }
    return Array.from(rowMap.entries()).map(([rowKey, info]) => {
      const actualQty = eventList
        .filter((e) =>
          (e.action === 'produce' || e.action === 'transfer' ||
           e.action === 'transferCustody' || e.action === 'transferAllRights') &&
          e.resourceConformsTo === info.specId &&
          e.outputOf && processIds.has(e.outputOf) &&
          (e.receiver ?? "_unknown") === info.counterpartyId)
        .reduce((s, e) => s + (e.resourceQuantity?.hasNumericalValue ?? 0), 0);
      const cfg = outputFlowConfigs.get(rowKey);
      return {
        rowKey, specId: info.specId, specName: info.specName, unit: info.unit,
        counterpartyId: info.counterpartyId, counterpartyName: info.counterpartyName,
        plannedQty: info.planned, actualQty,
        isMarket: cfg?.isMarket ?? info.isExternalByDefault,
        unitPrice: cfg?.unitPrice ?? 0,
        planValidated: info.planValidated,
      };
    });
  });

  const inputFlows = $derived.by((): FlowRow[] => {
    const processIds = new Set(processList.map((p) => p.id));
    type RowAcc = { planned: number; unit: string; counterpartyId: string; counterpartyName: string; isExternalByDefault: boolean; planValidated: boolean; specId: string; specName: string };
    const rowMap = new Map<string, RowAcc>();
    for (const c of commitmentList) {
      if (c.inputOf && processIds.has(c.inputOf) && c.resourceConformsTo) {
        const specId = c.resourceConformsTo;
        const counterpartyId = c.provider ?? '_unknown';
        const rowKey = `${specId}|${counterpartyId}`;
        const qty = c.resourceQuantity?.hasNumericalValue ?? 0;
        const unit = c.resourceQuantity?.hasUnit ?? '';
        const { isMarket: isExternalByDefault, isSocialByAction, isSocialByPlan } =
          classifyFlowChannel(c, 'input', counterpartyId, socialPlanIds, intentsById, agentsById, scopeOwnerId);
        const counterpartyAgent = agentsById.get(counterpartyId);
        const counterpartyName = counterpartyAgent?.name ?? counterpartyId;
        const existing = rowMap.get(rowKey);
        rowMap.set(rowKey, {
          planned: (existing?.planned ?? 0) + qty,
          unit: existing?.unit ?? unit,
          counterpartyId, counterpartyName,
          isExternalByDefault: isExternalByDefault || (existing?.isExternalByDefault ?? false),
          planValidated: isSocialByAction || isSocialByPlan || (existing?.planValidated ?? false),
          specId,
          specName: resourceSpecs.find((s) => s.id === specId)?.name ?? specId,
        });
      }
    }
    return Array.from(rowMap.entries()).map(([rowKey, info]) => {
      const actualQty = eventList
        .filter((e) => e.action === "consume" &&
                       e.resourceConformsTo === info.specId &&
                       e.inputOf && processIds.has(e.inputOf) &&
                       (e.provider ?? "_unknown") === info.counterpartyId)
        .reduce((s, e) => s + (e.resourceQuantity?.hasNumericalValue ?? 0), 0);
      const cfg = inputFlowConfigs.get(rowKey);
      return {
        rowKey, specId: info.specId, specName: info.specName, unit: info.unit,
        counterpartyId: info.counterpartyId, counterpartyName: info.counterpartyName,
        plannedQty: info.planned, actualQty,
        isMarket: cfg?.isMarket ?? info.isExternalByDefault,
        unitPrice: cfg?.unitPrice ?? 0,
        planValidated: info.planValidated,
      };
    });
  });

  // ── Auto-init flow configs on first appearance ────────────────────────────
  $effect(() => {
    for (const row of outputFlows)
      if (!outputFlowConfigs.has(row.rowKey))
        outputFlowConfigs.set(row.rowKey, { isMarket: row.isMarket, unitPrice: 0 });
  });
  $effect(() => {
    for (const row of inputFlows)
      if (!inputFlowConfigs.has(row.rowKey))
        inputFlowConfigs.set(row.rowKey, { isMarket: row.isMarket, unitPrice: 0 });
  });

  // ── Reactive ScopeTransitionConfig ───────────────────────────────────────
  const scopeConfig = $derived.by((): ScopeTransitionConfig => {
    const processIds = new Set(processList.map((p) => p.id));
    const workEvs    = eventList.filter((e) => e.action === "work");
    const consumeEvs = eventList.filter((e) => e.action === "consume" && e.inputOf && processIds.has(e.inputOf!));
    const produceEvs = eventList.filter((e) =>
      (e.action === 'produce' || e.action === 'transfer' ||
       e.action === 'transferCustody' || e.action === 'transferAllRights') &&
      e.outputOf && processIds.has(e.outputOf!));

    const socialOutKeys    = new Set(outputFlows.filter((r) => !r.isMarket).map((r) => r.rowKey));
    const socialOutSpecIds = new Set(outputFlows.filter((r) => !r.isMarket).map((r) => r.specId));
    const socialInSpecIds  = new Set(inputFlows.filter((r) => !r.isMarket).map((r) => r.specId));
    const socialOutputEvs  = produceEvs.filter((e) =>
      e.resourceConformsTo && socialOutSpecIds.has(e.resourceConformsTo) &&
      socialOutKeys.has(`${e.resourceConformsTo}|${e.receiver ?? "_unknown"}`));
    const socialConsumeEvs = consumeEvs.filter((e) => e.resourceConformsTo && socialInSpecIds.has(e.resourceConformsTo));
    const confirmedEvs     = socialOutputEvs.filter((e) => e.receiver && e.receiver !== scopeOwnerId);

    let market_revenue = 0;
    for (const row of outputFlows) {
      const price = outputFlowConfigs.get(row.rowKey)?.unitPrice ?? 0;
      if (row.isMarket) market_revenue += row.actualQty * price;
    }
    let market_input_cost = 0;
    for (const row of inputFlows) {
      const price = inputFlowConfigs.get(row.rowKey)?.unitPrice ?? 0;
      if (row.isMarket) market_input_cost += row.actualQty * price;
    }

    return {
      workEvents: workEvs,
      inputConsumeEvents: consumeEvs,
      socialInputConsumeEvents: socialConsumeEvs,
      outputEvents: produceEvs,
      socialOutputEvents: socialOutputEvs,
      confirmedReceiptEvents: confirmedEvs,
      workerRates: workerIds.map((agentId) => ({ agentId, hourly_rate: federationRate })),
      communalCoverage: workerIds.map(agentId => ({
        agentId,
        communal_need_coverage: avgCommunalCoverage,
        uncovered_essential_expenses: 0,
      })),
      solidaritySupplements: new Map(),
      available_claimable_pool: communeState.available_claimable_pool,
      total_social_svc: communeState.totalSocialSvc ?? 0,
      purchasingPower: { claim_purchasing_power: claimPurchasingPower, dollar_purchasing_power: 1, import_purchasing_power: 1 },
      target_communal_ratio: targetCommunalRatio,
      financials: {
        market_revenue,
        social_cash_revenue: 0,
        subsidy_received: subsidyReceived,
        market_input_cost,
        social_input_cash_cost: 0,
        total_dollar_wages: 0,
        other_costs: 0,
        contribution_sent: 0,
      },
    };
  });

  const report = $derived(computeScopeTransitionReport(scopeConfig));

  let diagramMode = $state<"plan" | "observe">("plan");
  let selectedFlow = $state<FlowSelectCtx | null>(null);

  // Scope solvency: revenue - input costs (no wage bill — wages are federation's)
  const scopeBalance = $derived(report.dollar_balance);

  const phaseOutPct   = $derived(report.dollar_wage_phase_out_factor * 100);
  const phaseOutColor = $derived(
    report.dollar_wage_phase_out_factor === 0 ? '#68d391'
    : report.dollar_wage_phase_out_factor < 1  ? '#d69e2e'
    : '#e2e8f0'
  );

  const compRatioColor = $derived(
    report.market_real_wage_per_hour === 0       ? '#a0aec0'
    : report.composition_ratio >= 0.9            ? '#68d391'
    : report.composition_ratio >= 0.6            ? '#d69e2e'
    : '#e53e3e'
  );

  const satColor = $derived(
    report.communal_satisfaction_ratio >= 1.0
      ? "#68d391"
      : report.communal_satisfaction_ratio >= 0.7
        ? "#d69e2e"
        : "#e53e3e",
  );
  const satTag = $derived(
    report.communal_satisfaction_ratio >= 1.0
      ? "COVERED"
      : report.communal_satisfaction_ratio >= 0.7
        ? "PARTIAL"
        : "DEFICIT",
  );
</script>

<svelte:head>
  <title>Scope Transition Economics</title>
</svelte:head>

<div class="page">
  <!-- ── SCOPE PANEL ────────────────────────────────────────────────────────── -->
  <ScopePanel {report} scopeName="Scope" period="" />

  <!-- ── PROCESS LAYER DIAGRAM ─────────────────────────────────────────────── -->
  <section class="band diagram">
    <div class="band-header">
      <span class="band-title" style="color: #a0aec0">PROCESS LAYER</span>
      {#if processList.length === 0}
        <div class="diagram-actions">
          <button onclick={seedExample}>Load Example</button>
        </div>
      {:else}
        <button class="reset-btn" onclick={resetStores}>Reset</button>
      {/if}
      <div class="mode-toggle">
        <button
          class:active={diagramMode === "plan"}
          onclick={() => {
            diagramMode = "plan";
            selectedFlow = null;
          }}>PLAN</button
        >
        <button
          class:active={diagramMode === "observe"}
          onclick={() => (diagramMode = "observe")}>OBSERVE</button
        >
      </div>
    </div>
    <div class="diagram-wrap">
      <NetworkDiagram
        mode={diagramMode}
        onflowselect={(ctx) => (selectedFlow = ctx)}
        {selectedFlow}
      />
    </div>
    {#if selectedFlow}
      <div class="observe-panel">
        <EventRecorderPanel
          context={selectedFlow}
          onrecord={() => (selectedFlow = null)}
          onclose={() => (selectedFlow = null)}
        />
      </div>
    {/if}
  </section>

  <!-- ── OUTPUTS band ──────────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-header">
      <span class="band-title" style="color: #68d391">OUTPUTS</span>
      <span class="count">{outputFlows.length} flow rows</span>
    </div>
    <p class="band-desc">
      Mark each output as MARKET (sold for dollars) or SOCIAL (dispatched to the social plan).
      Enter unit price for market outputs to compute revenue.
    </p>
    {#if outputFlows.length > 0}
      <div class="flow-table">
        <div class="flow-head flow-head-7">
          <span class="ft-name">Resource</span>
          <span class="ft-party">Counterparty</span>
          <span class="ft-qty">Planned</span>
          <span class="ft-qty">Actual</span>
          <span class="ft-channel">Channel</span>
          <span class="ft-price">$/unit</span>
          <span class="ft-total">Revenue</span>
        </div>
        {#each outputFlows as row (row.rowKey)}
          {@const cfg = outputFlowConfigs.get(row.rowKey) ?? { isMarket: row.isMarket, unitPrice: 0 }}
          <div class="flow-row flow-row-7">
            <span class="ft-name">{row.specName}</span>
            <span class="ft-party">→ {row.counterpartyName}</span>
            <span class="ft-qty">{row.plannedQty} {row.unit}</span>
            <span class="ft-qty">{row.actualQty.toFixed(1)} {row.unit}</span>
            <span class="ft-channel">
              <button
                class="channel-btn"
                class:market={cfg.isMarket}
                class:social={!cfg.isMarket}
                onclick={() => { outputFlowConfigs.set(row.rowKey, { ...cfg, isMarket: !cfg.isMarket }); }}
              >{cfg.isMarket ? "MARKET" : "SOCIAL"}</button>
              {#if row.planValidated && !cfg.isMarket}
                <span class="plan-badge" title="Validated by social plan">plan</span>
              {/if}
            </span>
            <span class="ft-price">
              {#if cfg.isMarket}
                <input type="number" min="0" step="0.01" value={cfg.unitPrice}
                  oninput={(ev) => { const v = parseFloat((ev.currentTarget as HTMLInputElement).value); outputFlowConfigs.set(row.rowKey, { ...cfg, unitPrice: isNaN(v) ? 0 : v }); }}
                  class="price-input" />
              {:else}<span class="ft-na">—</span>{/if}
            </span>
            <span class="ft-total">{cfg.isMarket ? `$${(row.actualQty * cfg.unitPrice).toFixed(2)}` : "—"}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="band-empty">No output commitments found.</div>
    {/if}
  </section>

  <!-- ── INPUTS band ────────────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-header">
      <span class="band-title" style="color: #f6ad55">INPUTS</span>
      <span class="count">{inputFlows.length} flow rows</span>
    </div>
    <p class="band-desc">
      Mark each input as MARKET PURCHASE (bought for dollars) or SOCIAL (sourced from social providers).
      Enter unit price for market inputs to compute input cost.
    </p>
    {#if inputFlows.length > 0}
      <div class="flow-table">
        <div class="flow-head flow-head-7">
          <span class="ft-name">Resource</span>
          <span class="ft-party">Counterparty</span>
          <span class="ft-qty">Planned</span>
          <span class="ft-qty">Actual</span>
          <span class="ft-channel">Channel</span>
          <span class="ft-price">$/unit</span>
          <span class="ft-total">Cost</span>
        </div>
        {#each inputFlows as row (row.rowKey)}
          {@const cfg = inputFlowConfigs.get(row.rowKey) ?? { isMarket: row.isMarket, unitPrice: 0 }}
          <div class="flow-row flow-row-7">
            <span class="ft-name">{row.specName}</span>
            <span class="ft-party">← {row.counterpartyName}</span>
            <span class="ft-qty">{row.plannedQty} {row.unit}</span>
            <span class="ft-qty">{row.actualQty.toFixed(1)} {row.unit}</span>
            <span class="ft-channel">
              <button
                class="channel-btn"
                class:market={cfg.isMarket}
                class:social={!cfg.isMarket}
                onclick={() => { inputFlowConfigs.set(row.rowKey, { ...cfg, isMarket: !cfg.isMarket }); }}
              >{cfg.isMarket ? "MARKET PURCHASE" : "SOCIAL"}</button>
            </span>
            <span class="ft-price">
              {#if cfg.isMarket}
                <input type="number" min="0" step="0.01" value={cfg.unitPrice}
                  oninput={(ev) => { const v = parseFloat((ev.currentTarget as HTMLInputElement).value); inputFlowConfigs.set(row.rowKey, { ...cfg, unitPrice: isNaN(v) ? 0 : v }); }}
                  class="price-input" />
              {:else}<span class="ft-na">—</span>{/if}
            </span>
            <span class="ft-total">{cfg.isMarket ? `$${(row.actualQty * cfg.unitPrice).toFixed(2)}` : "—"}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="band-empty">No input commitments found.</div>
    {/if}
  </section>

  <!-- ── FLOW FRACTIONS band ─────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-header">
      <span class="band-title" style="color: rgb(56,189,248)">FLOW FRACTIONS</span>
    </div>
    <p class="band-desc">
      How much of this scope's activity has entered the social economy — and how
      much has been formally acknowledged? Each bar is a fraction of the scope's total volume.
    </p>
    <div class="fractions-body">
      <div class="frac-item">
        <div class="frac-row">
          <span class="frac-label">Social inputs</span>
          <div class="frac-track">
            <div class="frac-fill" style="width: {report.fractions.social_input_fraction * 100}%; background: rgb(56,189,248)"></div>
          </div>
          <span class="frac-pct">{(report.fractions.social_input_fraction * 100).toFixed(1)}%</span>
        </div>
        <p class="frac-desc">of inputs sourced from social providers — rising fraction = import substitution progress</p>
      </div>
      <div class="frac-item">
        <div class="frac-row">
          <span class="frac-label">Social outputs</span>
          <div class="frac-track">
            <div class="frac-fill" style="width: {report.fractions.social_output_fraction * 100}%; background: #68d391"></div>
          </div>
          <span class="frac-pct">{(report.fractions.social_output_fraction * 100).toFixed(1)}%</span>
        </div>
        <p class="frac-desc">of production dispatched to social-plan recipients</p>
      </div>
      <div class="frac-item">
        <div class="frac-row">
          <span class="frac-label">Confirmed receipts</span>
          <div class="frac-track">
            <div class="frac-fill" style="width: {report.fractions.confirmed_output_fraction * 100}%; background: var(--zone-yellow)"></div>
          </div>
          <span class="frac-pct">{(report.fractions.confirmed_output_fraction * 100).toFixed(1)}%</span>
        </div>
        <p class="frac-desc">of social deliveries formally acknowledged by recipients</p>
      </div>
      <div class="frac-divider"></div>
      <div class="frac-item derived">
        <div class="frac-row">
          <span class="frac-label">Transition depth</span>
          <div class="frac-track">
            <div class="frac-fill" style="width: {report.fractions.transition_depth * 100}%; background: #a78bfa"></div>
          </div>
          <span class="frac-pct">{(report.fractions.transition_depth * 100).toFixed(1)}%</span>
        </div>
        <p class="frac-desc">social outputs × confirmed — the verified, end-to-end transition progress</p>
      </div>
      <div class="frac-item derived">
        <div class="frac-row">
          <span class="frac-label">Commitment gap</span>
          <div class="frac-track">
            <div class="frac-fill" style="width: {report.fractions.commitment_gap * 100}%; background: #f6ad55"></div>
          </div>
          <span class="frac-pct">{(report.fractions.commitment_gap * 100).toFixed(1)}%</span>
        </div>
        <p class="frac-desc">dispatched to social recipients but not yet confirmed — a trust signal</p>
      </div>
    </div>
  </section>

  <!-- ── WORKERS band ────────────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-header">
      <span class="band-title" style="color: rgb(56,189,248)">WORKERS</span>
      <span class="count">{workerIds.length} workers</span>
    </div>
    {#if workerIds.length > 0}
      {#if report.workers.length > 0}
        <p class="band-desc">
          Per-worker breakdown of labor validation and social plan compensation.
          The <em>goods access</em> bar shows what fraction of each worker's real
          purchasing power flows through the social economy vs. the dollar channel.
        </p>
        <div class="workers-body">
          {#each report.workers as worker (worker.agentId)}
            <WorkerCard
              {worker}
              name={agentList.find((a) => a.id === worker.agentId)?.name ?? worker.agentId}
            />
          {/each}
        </div>
      {/if}
    {:else}
      <div class="band-empty">
        No work events yet — load the example or record work events from the PROCESS LAYER diagram.
      </div>
    {/if}
    <!-- Labor stats -->
    <div class="band-body">
      <div class="wages-col">
        <div class="stat-cell">
          <span class="sc-label">Total hours worked</span>
          <span class="sc-val">{report.total_hours_worked.toFixed(1)}<span class="sc-unit"> hr</span></span>
        </div>
        <div class="stat-cell">
          <span class="sc-label">Total validated hours</span>
          <span class="sc-val">{report.total_validated_hours.toFixed(1)}<span class="sc-unit"> hr</span></span>
        </div>
        <div class="stat-cell">
          <span class="sc-label">Avg claim / validated hr</span>
          <span class="sc-val">{report.average_claim_per_validated_hour.toFixed(2)}<span class="sc-unit"> SVC/hr</span></span>
        </div>
      </div>
    </div>
  </section>

  <!-- ── SCOPE SOLVENCY band ────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-header">
      <span class="band-title" style="color: #68d391">SCOPE SOLVENCY</span>
      <span class="solvent-tag" class:solvent={report.is_solvent} class:insolvent={!report.is_solvent}>
        {report.is_solvent ? 'SOLVENT' : 'INSOLVENT'}
      </span>
    </div>
    <p class="band-desc">
      Scope-level external accounts. Dollar wages are a federation responsibility and
      are excluded — the scope's solvency is judged on its own revenue and operating costs.
    </p>
    <div class="band-body">
      <div class="wages-col">
        <div class="stat-cell">
          <span class="sc-label">Market revenue</span>
          <span class="sc-val">+${scopeConfig.financials.market_revenue.toFixed(2)}</span>
        </div>
        <div class="stat-cell">
          <span class="sc-label">Subsidy received</span>
          <span class="sc-val">+${scopeConfig.financials.subsidy_received.toFixed(2)}</span>
        </div>
        <div class="stat-cell sc-divider">
          <span class="sc-label">Market input cost</span>
          <span class="sc-val">−${scopeConfig.financials.market_input_cost.toFixed(2)}</span>
        </div>
        <div class="stat-cell sc-total">
          <span class="sc-label">Scope balance</span>
          <span class="sc-val" style="color: {scopeBalance >= 0 ? '#68d391' : '#e53e3e'}">
            {scopeBalance >= 0 ? '+' : ''}${scopeBalance.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  </section>

  <!-- ════════════════════════════════════════════════════════════════════════ -->
  <!-- ── FEDERATION INTERFACE ─────────────────────────────────────────────── -->
  <!-- ════════════════════════════════════════════════════════════════════════ -->

  <!-- ── FEDERATION WAGES band ─────────────────────────────────────────────── -->
  <section class="band federation">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-yellow)">FEDERATION WAGES</span>
    </div>
    <p class="band-desc">
      Dollar wages during the transitional period are set by the federation, not derived from
      the scope's own market revenue. The federation pays a flat hourly dollar rate to all
      participating workers; as the communal satisfaction ratio rises toward the democratic
      target, the phase-out factor reduces these payments to zero.
    </p>
    <div class="band-body">
      <div class="wages-col">
        <!-- Rate input -->
        <div class="stat-cell">
          <span class="sc-label">Federation hourly dollar rate</span>
          <div class="rate-input-row">
            <span class="sc-unit-prefix">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              bind:value={federationRate}
              class="wage-input"
            />
            <span class="sc-unit"> /hr</span>
          </div>
        </div>
        <div class="stat-cell">
          <span class="sc-label">Phase-out factor</span>
          <span class="sc-val" style="color: {phaseOutColor}">
            {phaseOutPct.toFixed(1)}%
          </span>
          <span class="sc-sub-note">
            {report.dollar_wage_phase_out_factor === 0
              ? 'wages fully phased out — communal plan covers workers'
              : `CSR ${report.communal_satisfaction_ratio.toFixed(2)} / target ${targetCommunalRatio.toFixed(2)}`}
          </span>
        </div>
        <div class="stat-cell">
          <span class="sc-label">Total federation wages this period</span>
          <span class="sc-val">${report.total_dollar_wages.toFixed(2)}</span>
        </div>
        <div class="stat-cell">
          <span class="sc-label">Avg $/hr (effective)</span>
          <span class="sc-val">${report.average_dollar_wage_per_hour.toFixed(2)}<span class="sc-unit"> /hr</span></span>
        </div>
      </div>
    </div>
  </section>

  <!-- ── TRANSITION DIAGNOSTICS band ──────────────────────────────────────── -->
  <section class="band federation collective">
    <div class="band-header">
      <span class="band-title" style="color: #a78bfa">TRANSITION DIAGNOSTICS</span>
    </div>
    <p class="band-desc">
      Federation-level inputs and derived adequacy metrics. The communal satisfaction ratio
      is the primary signal: it rises as communal provision expands and as dollar income covers
      less of workers' survival. The composition ratio tracks real social goods per hour relative
      to the federation dollar rate — a transitional diagnostic that becomes undefined when wages phase out.
    </p>
    <!-- Policy inputs -->
    <div class="collective-controls">
      <label class="ctrl-label">
        SVC purchasing power (goods/SVC)
        <input type="number" min="0" step="0.01" bind:value={claimPurchasingPower} class="ctrl-input" />
      </label>
      <label class="ctrl-label">
        Communal coverage/worker ($)
        <input type="number" min="0" step="1" bind:value={avgCommunalCoverage} class="ctrl-input" />
      </label>
      <label class="ctrl-label">
        Federation subsidy ($)
        <input type="number" min="0" step="1" bind:value={subsidyReceived} class="ctrl-input" />
      </label>
      <label class="ctrl-label">
        Phase-out target CSR
        <input type="number" min="0" step="0.1" bind:value={targetCommunalRatio} class="ctrl-input" />
      </label>
    </div>
    <!-- Stat grid -->
    <div class="collective-grid">
      <div class="coll-cell">
        <span class="coll-label">COMMUNAL SAT. RATIO</span>
        <span class="coll-val" style="color: {satColor}">{report.communal_satisfaction_ratio.toFixed(2)}×</span>
        <span class="coll-sub">{satTag} — {report.communal_satisfaction_ratio >= 1.0 ? 'social plan sufficient' : report.communal_satisfaction_ratio >= 0.7 ? 'partial coverage' : 'deficit — material basis for wage resistance'}</span>
      </div>
      <div class="coll-cell">
        <span class="coll-label">COMPOSITION RATIO</span>
        <span class="coll-val" style="color: {compRatioColor}">
          {report.market_real_wage_per_hour === 0 ? '—' : report.composition_ratio.toFixed(2)}
        </span>
        <span class="coll-sub">
          {report.market_real_wage_per_hour === 0
            ? 'wages phased out — ratio undefined'
            : report.composition_ratio >= 1.0
              ? 'social goods match dollar parity'
              : 'social goods below dollar parity'}
        </span>
      </div>
      <div class="coll-cell">
        <span class="coll-label">EXTERNAL CONTRIBUTION</span>
        <span class="coll-val" style="color: {report.scope_net_external_contribution >= 0 ? '#68d391' : '#e53e3e'}">
          {report.scope_net_external_contribution >= 0 ? '+' : ''}{report.scope_net_external_contribution.toFixed(2)}
        </span>
        <span class="coll-sub">{report.scope_net_external_contribution >= 0 ? 'net contributor to federation fund' : 'net draw from federation fund'}</span>
      </div>
      <div class="coll-cell">
        <span class="coll-label">LOCAL PROVISION / WORKER</span>
        <span class="coll-val">{report.local_provision_value_per_worker.toFixed(3)}</span>
        <span class="coll-sub">goods/worker via claims + communal coverage</span>
      </div>
    </div>
  </section>

</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    background: #0d0d0d;
    color: #e2e8f0;
    min-height: 100vh;
    padding: var(--gap-md);
    gap: var(--gap-md);
  }

  .band {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    overflow: hidden;
  }

  .band-header {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-sm) var(--gap-md);
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-wrap: wrap;
  }

  .band-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.5;
  }

  .band-desc {
    font-family: var(--font-sans);
    font-size: 0.68rem;
    line-height: 1.5;
    opacity: 0.45;
    padding: 6px var(--gap-md) 0;
    margin: 0;
    font-style: italic;
  }

  .band-empty {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.3;
    padding: var(--gap-md);
    font-style: italic;
  }

  /* ── FLOW TABLE (outputs / inputs) ── */
  .flow-table { display: flex; flex-direction: column; gap: 1px; padding: var(--gap-md); }
  .flow-head-7  { display: grid; grid-template-columns: 1fr 120px 80px 80px 130px 70px 80px; gap: var(--gap-sm); padding: 3px 6px; opacity: 0.35; font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.07em; }
  .flow-row-7   { display: grid; grid-template-columns: 1fr 120px 80px 80px 130px 70px 80px; gap: var(--gap-sm); padding: 3px 6px; border-radius: 2px; font-family: var(--font-mono); font-size: var(--text-xs); }
  .flow-row-7:hover { background: rgba(255,255,255,0.03); }
  .ft-name    { opacity: 0.85; }
  .ft-party   { font-family: var(--font-mono); font-size: 0.6rem; opacity: 0.45; }
  .ft-qty     { opacity: 0.5; }
  .ft-channel { display: flex; align-items: center; }
  .ft-price, .ft-total { display: flex; align-items: center; }
  .ft-na      { opacity: 0.2; }
  .price-input { width: 60px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); border-radius: 3px; color: #e2e8f0; font-family: var(--font-mono); font-size: var(--text-xs); padding: 2px 5px; }
  .channel-btn { font-family: var(--font-mono); font-size: 0.58rem; font-weight: 700; padding: 2px 6px; border-radius: 2px; border: none; cursor: pointer; letter-spacing: 0.06em; white-space: nowrap; }
  .channel-btn.market { background: rgba(56,161,105,0.15); color: #68d391; border: 1px solid rgba(56,161,105,0.3); }
  .channel-btn.social { background: rgba(56,189,248,0.1); color: rgb(56,189,248); border: 1px solid rgba(56,189,248,0.25); }
  .channel-btn:hover { filter: brightness(1.2); }
  .plan-badge {
    font-family: var(--font-mono); font-size: 0.5rem; opacity: 0.55;
    padding: 1px 4px; border-radius: 2px;
    border: 1px solid rgba(56,189,248,0.35); color: rgb(56,189,248);
    margin-left: 3px; white-space: nowrap;
  }

  /* ── FLOW FRACTIONS ── */
  .fractions-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--gap-md);
  }

  .frac-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .frac-item.derived {
    opacity: 0.75;
  }

  .frac-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
  }

  .frac-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.6;
    width: 140px;
    flex-shrink: 0;
  }

  .frac-track {
    flex: 1;
    height: 8px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 2px;
    overflow: hidden;
  }

  .frac-fill {
    height: 100%;
    border-radius: 2px;
    opacity: 0.7;
    transition: width 0.3s;
  }

  .frac-pct {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    width: 48px;
    text-align: right;
    flex-shrink: 0;
  }

  .frac-desc {
    font-family: var(--font-sans);
    font-size: 0.6rem;
    opacity: 0.35;
    margin: 0;
    padding-left: 148px;
    font-style: italic;
    line-height: 1.3;
  }

  .frac-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 4px 0;
  }

  /* ── WORKERS ── */
  .wage-editor {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .wage-row {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .wage-agent {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.7;
    min-width: 60px;
  }

  .wage-label {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    opacity: 0.35;
  }

  .wage-input {
    width: 64px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 5px;
  }

  .workers-body {
    display: flex;
    flex-direction: row;
    gap: var(--gap-sm);
    padding: var(--gap-md);
    overflow-x: auto;
  }

  /* ── WAGES ── */
  .band-body {
    display: flex;
    gap: var(--gap-lg);
    padding: var(--gap-md);
    overflow-x: auto;
  }

  .wages-col {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
    min-width: 220px;
  }

  .stat-cell {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--gap-sm);
  }

  .sc-label {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    opacity: 0.4;
  }

  .sc-val {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 600;
  }

  .sc-unit {
    font-size: 0.55rem;
    opacity: 0.45;
    font-weight: 400;
  }

  .sc-phase-note {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    color: #d69e2e;
    opacity: 0.75;
  }

  /* ── DIAGRAM ── */
  .diagram-wrap {
    overflow-x: auto;
    padding: var(--gap-md);
  }
  .diagram-actions {
    display: flex;
    gap: var(--gap-xs);
  }
  .diagram-actions button,
  .reset-btn {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #e2e8f0;
  }
  .diagram-actions button:hover,
  .reset-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .reset-btn {
    color: rgba(226, 232, 240, 0.4);
  }
  .mode-toggle {
    display: flex;
    gap: var(--gap-xs);
    margin-left: auto;
  }
  .mode-toggle button {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(226, 232, 240, 0.5);
  }
  .mode-toggle button.active {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.3);
    color: #e2e8f0;
  }
  .observe-panel {
    padding: var(--gap-md);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    max-width: 480px;
  }

  /* ── FEDERATION SECTION ── */
  .band.federation {
    border-color: rgba(246, 173, 85, 0.15);
  }
  .band.federation .band-header {
    background: rgba(246, 173, 85, 0.04);
    border-color: rgba(246, 173, 85, 0.1);
  }

  /* ── SCOPE SOLVENCY ── */
  .solvent-tag {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 2px 7px;
    border-radius: 2px;
  }
  .solvent-tag.solvent {
    background: rgba(104, 211, 145, 0.12);
    border: 1px solid rgba(104, 211, 145, 0.3);
    color: #68d391;
  }
  .solvent-tag.insolvent {
    background: rgba(229, 62, 62, 0.12);
    border: 1px solid rgba(229, 62, 62, 0.3);
    color: #e53e3e;
  }
  .sc-divider {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 5px;
    margin-top: 2px;
  }
  .sc-total .sc-label { opacity: 0.65; }

  /* ── FEDERATION WAGES ── */
  .rate-input-row {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .sc-unit-prefix {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.5;
  }
  .sc-sub-note {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    opacity: 0.4;
  }

  /* ── COLLECTIVE METRICS ── */
  .band.collective {
    border-color: rgba(167, 139, 250, 0.2);
  }

  .band.collective .band-header {
    background: rgba(167, 139, 250, 0.04);
    border-color: rgba(167, 139, 250, 0.12);
  }

  .collective-controls {
    display: flex;
    gap: var(--gap-lg);
    padding: var(--gap-sm) var(--gap-md);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-wrap: wrap;
  }

  .ctrl-label {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    opacity: 0.55;
  }

  .ctrl-input {
    width: 72px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 5px;
  }

  .collective-grid {
    display: flex;
    gap: 1px;
    background: rgba(255, 255, 255, 0.05);
    flex-wrap: wrap;
  }

  .coll-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px;
    background: #0d0d0d;
    flex: 1;
    min-width: 180px;
  }

  .coll-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    opacity: 0.3;
    text-transform: uppercase;
  }

  .coll-val {
    font-family: var(--font-mono);
    font-size: 1.1rem;
    font-weight: 600;
    line-height: 1.1;
    color: #e2e8f0;
  }

  .coll-sub {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    opacity: 0.4;
  }


</style>
