<script lang="ts">
  import "$lib/components/ui/tokens.css";
  import ScopePanel from "$lib/components/scope/ScopePanel.svelte";
  import WorkerCard from "$lib/components/scope/WorkerCard.svelte";
  import {
    computeScopeTransitionReport,
    type ScopeTransitionConfig,
  } from "$lib/observation/transition";
  import type { EconomicEvent } from "$lib/schemas";

  // ── Mock helpers ───────────────────────────────────────────────────────────
  function workEv(provider: string, hours: number, idx: number): EconomicEvent {
    return {
      id: `work-${provider}-${idx}`,
      action: "work",
      provider,
      effortQuantity: { hasNumericalValue: hours, hasUnit: "hr" },
    };
  }

  function resEv(
    action: EconomicEvent["action"],
    qty: number,
    idx: number,
  ): EconomicEvent {
    return {
      id: `res-${action}-${idx}`,
      action,
      resourceQuantity: { hasNumericalValue: qty, hasUnit: "units" },
    };
  }

  // ── Mock config ─────────────────────────────────────────────────────────────
  // Workers: Alice $22/hr, Bob $18/hr, Carmen $28/hr
  // Total work = 80 hrs (Alice 32, Bob 24, Carmen 24)
  const workEvents: EconomicEvent[] = [
    workEv("alice", 32, 1),
    workEv("bob", 24, 2),
    workEv("carmen", 24, 3),
  ];

  // Inputs: 100 units total, 60 from social-plan → social_input_fraction = 0.6
  const allInputs: EconomicEvent[] = Array.from({ length: 10 }, (_, i) =>
    resEv("consume", 10, i),
  );
  const socialInputs = allInputs.slice(0, 6);

  // Outputs: 200 units total, 140 to social agents, 120 confirmed
  // social_output_fraction = 0.7, confirmed_output_fraction = 0.6
  const allOutputs: EconomicEvent[] = Array.from({ length: 10 }, (_, i) =>
    resEv("produce", 20, i),
  );
  const socialOutputs = allOutputs.slice(0, 7);
  const confirmedReceipts = allOutputs.slice(0, 6);

  const mockConfig: ScopeTransitionConfig = {
    workEvents,
    inputConsumeEvents: allInputs,
    socialInputConsumeEvents: socialInputs,
    outputEvents: allOutputs,
    socialOutputEvents: socialOutputs,
    confirmedReceiptEvents: confirmedReceipts,

    workerRates: [
      { agentId: "alice", hourly_rate: 22 },
      { agentId: "bob", hourly_rate: 18 },
      { agentId: "carmen", hourly_rate: 28 },
    ],

    communalCoverage: [
      {
        agentId: "alice",
        communal_need_coverage: 200,
        uncovered_essential_expenses: 50,
      },
      {
        agentId: "bob",
        communal_need_coverage: 150,
        uncovered_essential_expenses: 80,
      },
      {
        agentId: "carmen",
        communal_need_coverage: 300,
        uncovered_essential_expenses: 0,
      },
    ],

    solidaritySupplements: new Map([["carmen", 5]]),

    available_claimable_pool: 200,
    total_social_svc: 80,

    purchasingPower: {
      claim_purchasing_power: 0.8,
      dollar_purchasing_power: 1.0,
    },

    financials: {
      market_revenue: 8000,
      social_cash_revenue: 500,
      subsidy_received: 200,
      market_input_cost: 4000,
      social_input_cash_cost: 300,
      total_dollar_wages: 1200,
      other_costs: 500,
      contribution_sent: 200,
      total_output_market_value: 10000,
      labor_share_of_revenue: 0.4,
    },
  };

  const report = $derived(computeScopeTransitionReport(mockConfig));

  // Worker name map
  const nameMap: Record<string, string> = {
    alice: "Alice",
    bob: "Bob",
    carmen: "Carmen",
  };

  // For real-wage bar: proportional fill
  const maxRW = $derived(
    Math.max(
      report.social_real_wage_per_hour,
      report.market_real_wage_per_hour,
      0.001,
    ),
  );

  const subRatioColor = $derived(
    report.substitution_ratio >= 0.9
      ? "#68d391"
      : report.substitution_ratio >= 0.5
        ? "#d69e2e"
        : "#e53e3e",
  );
  const subRatioTag = $derived(
    report.substitution_ratio >= 0.9
      ? "ADEQUATE"
      : report.substitution_ratio >= 0.5
        ? "PARTIAL"
        : "DEFICIENT",
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
  <ScopePanel {report} scopeName="Metalwork Scope" period="2026-Q1" />

  <!-- ── FLOW FRACTIONS band ─────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-header">
      <span class="band-title" style="color: rgb(56,189,248)">FLOW FRACTIONS</span>
    </div>
    <p class="band-desc">
      How much of this scope's activity has entered the social economy — and how much has
      been formally acknowledged? Each bar is a fraction of the scope's total volume.
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
        <p class="frac-desc">of raw materials sourced from social-plan providers</p>
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
      <span class="count">{report.workers.length} workers</span>
    </div>
    <p class="band-desc">
      Per-worker breakdown of labor, market wages, and social plan compensation.
      The <em>goods access</em> bar at the bottom of each card shows what fraction of each
      worker's real purchasing power flows through the social economy vs. the market.
    </p>
    <div class="workers-body">
      {#each report.workers as worker (worker.agentId)}
        <WorkerCard {worker} name={nameMap[worker.agentId] ?? worker.agentId} />
      {/each}
    </div>
  </section>

  <!-- ── WAGES band ──────────────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-yellow)">WAGES &amp; LABOR</span>
    </div>
    <p class="band-desc">
      Validated hours determine SVC claim capacity; unvalidated hours go uncompensated by
      the social plan. Real wages translate nominal pay into equivalent goods, letting
      you compare across channels — when social real wages approach market real wages,
      the transition is economically adequate.
    </p>
    <div class="band-body">
      <!-- Left: Scope Totals -->
      <div class="wages-col">
        <div class="col-header">Scope Totals</div>
        <div class="stat-cell">
          <span class="sc-label">Total hours worked</span>
          <span class="sc-val"
            >{report.total_hours_worked.toFixed(1)}<span class="sc-unit">
              hr</span
            ></span
          >
        </div>
        <div class="stat-cell">
          <span class="sc-label">Total validated hours</span>
          <span class="sc-val"
            >{report.total_validated_hours.toFixed(1)}<span class="sc-unit">
              hr</span
            ></span
          >
        </div>
        <div class="stat-cell">
          <span class="sc-label">Total dollar wages</span>
          <span class="sc-val">${report.total_dollar_wages.toFixed(2)}</span>
        </div>
        <div class="stat-cell">
          <span class="sc-label">Avg $/hr</span>
          <span class="sc-val"
            >${report.average_dollar_wage_per_hour.toFixed(2)}<span
              class="sc-unit"
            >
              /hr</span
            ></span
          >
        </div>
        <div class="stat-cell">
          <span class="sc-label">Avg claim/validated hr</span>
          <span class="sc-val"
            >{report.average_claim_per_validated_hour.toFixed(2)}<span
              class="sc-unit"
            >
              SVC/hr</span
            ></span
          >
        </div>
      </div>

      <!-- Right: Real Wages -->
      <div class="wages-col">
        <div class="col-header">Real Wages</div>
        <div class="stat-cell">
          <span class="sc-label">Social real wage/hr (claim)</span>
          <span class="sc-val" style="color: rgb(56,189,248)"
            >{report.social_real_wage_per_hour.toFixed(3)}<span class="sc-unit">
              goods/hr</span
            ></span
          >
        </div>
        <div class="rw-bar-wrap">
          <div class="rw-track">
            <div
              class="rw-fill teal"
              style="width: {(report.social_real_wage_per_hour / maxRW) * 100}%"
            ></div>
          </div>
        </div>
        <div class="stat-cell" style="margin-top: 6px">
          <span class="sc-label">Market real wage/hr (dollar)</span>
          <span class="sc-val" style="color: var(--zone-yellow)"
            >{report.market_real_wage_per_hour.toFixed(3)}<span class="sc-unit">
              goods/hr</span
            ></span
          >
        </div>
        <div class="rw-bar-wrap">
          <div class="rw-track">
            <div
              class="rw-fill yellow"
              style="width: {(report.market_real_wage_per_hour / maxRW) * 100}%"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── RATIOS band ─────────────────────────────────────────────────────────── -->
  <section class="band ratios">
    <div class="band-header">
      <span class="band-title" style="color: #7c3aed">TRANSITION RATIOS</span>
    </div>
    <p class="band-desc">
      Two composite signals tracking whether the transition is delivering adequate
      compensation for workers. Both should trend toward 1.0 or above as the social plan
      deepens and communal provision grows.
    </p>
    <div class="ratios-body">
      <!-- Substitution Ratio -->
      <div class="ratio-block">
        <span class="ratio-label">SUBSTITUTION RATIO</span>
        <span class="ratio-num" style="color: {subRatioColor}">{report.substitution_ratio.toFixed(3)}</span>
        <span class="ratio-tag" style="color: {subRatioColor}">{subRatioTag}</span>
        <p class="ratio-meaning">
          For each unit of real goods a worker could access via the market, how much does
          the social channel deliver through confirmed hours? A ratio of 1.0 means the
          social plan fully substitutes for foregone market compensation.
        </p>
        <code class="ratio-formula">social_rw × confirmed_frac / (market_rw × (1 − social_frac))</code>
      </div>

      <div class="ratio-divider"></div>

      <!-- Communal Satisfaction -->
      <div class="ratio-block">
        <span class="ratio-label">COMMUNAL SATISFACTION</span>
        <span class="ratio-num" style="color: {satColor}">{report.communal_satisfaction_ratio.toFixed(3)}×</span>
        <span class="ratio-tag" style="color: {satColor}">{satTag}</span>
        <p class="ratio-meaning">
          Does the total value of social access — SVC claim purchasing power plus
          communally provided essentials — cover what workers still need to buy on the
          market? Above 1.0 means workers are better off than market wages alone.
        </p>
        <code class="ratio-formula">total_social_value / effective_net_market_wage</code>
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

  .col-header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.4;
    padding-bottom: var(--gap-xs);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 3px;
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

  .rw-bar-wrap {
    padding: 0 2px;
  }

  .rw-track {
    height: 4px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 2px;
    overflow: hidden;
  }

  .rw-fill {
    height: 100%;
    border-radius: 2px;
    opacity: 0.65;
  }

  .rw-fill.teal {
    background: rgb(56, 189, 248);
  }

  .rw-fill.yellow {
    background: var(--zone-yellow);
  }

  /* ── RATIOS ── */
  .band.ratios {
    border-color: rgba(124, 58, 237, 0.2);
  }

  .band.ratios .band-header {
    background: rgba(124, 58, 237, 0.04);
    border-color: rgba(124, 58, 237, 0.12);
  }

  .ratios-body {
    display: flex;
    gap: 1px;
    background: rgba(255, 255, 255, 0.05);
  }

  .ratio-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 18px;
    background: #0d0d0d;
    flex: 1;
    align-items: flex-start;
  }

  .ratio-label {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    opacity: 0.3;
    text-transform: uppercase;
  }

  .ratio-num {
    font-family: var(--font-mono);
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
  }

  .ratio-tag {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.05);
  }

  .ratio-meaning {
    font-family: var(--font-sans);
    font-size: 0.65rem;
    line-height: 1.5;
    opacity: 0.5;
    margin: 0;
    max-width: 340px;
  }

  .ratio-formula {
    font-family: var(--font-mono);
    font-size: 0.56rem;
    opacity: 0.22;
    line-height: 1.4;
    display: block;
  }

  .ratio-divider {
    width: 1px;
    background: rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
  }
</style>
