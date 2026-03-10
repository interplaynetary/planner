<script lang="ts">
  import type { WorkerTransitionState } from '$lib/observation/transition';

  interface Props {
    worker: WorkerTransitionState;
    name?: string;
  }

  let { worker, name }: Props = $props();

  const displayName = $derived(name ?? worker.agentId);

  const wageNormPct = $derived(Math.round((worker.wage_rate_normalized - 1) * 100));
  const wageNormColor = $derived(
    worker.wage_rate_normalized >= 1.25 ? '#f6ad55'
    : worker.wage_rate_normalized >= 0.8 ? '#68d391'
    : 'rgba(255,255,255,0.35)'
  );
  const wageNormLabel = $derived(
    wageNormPct > 0 ? `+${wageNormPct}% avg`
    : wageNormPct < 0 ? `${wageNormPct}% avg`
    : `at avg`
  );

  const coveragePct = $derived(Math.min(100, worker.communal_satisfaction_ratio * 100));
  const coverageColor = $derived(
    worker.communal_satisfaction_ratio >= 1.0 ? '#68d391'
    : worker.communal_satisfaction_ratio >= 0.7 ? '#d69e2e'
    : '#e53e3e'
  );
  const coverageText = $derived(
    worker.communal_satisfaction_ratio >= 1.0
      ? 'fully covered'
      : `covers ${Math.round(coveragePct)}% of market need`
  );

  const socialPct = $derived(Math.round(worker.social_fraction_of_entitlement * 100));
  const marketPct = $derived(100 - socialPct);
</script>

<div class="worker-card">
  <!-- ── Header ── -->
  <div class="card-header">
    <span class="worker-name">{displayName}</span>
    <span
      class="wage-pill"
      style="color: {wageNormColor}"
      title="Hourly rate relative to group average"
    >{wageNormLabel}</span>
  </div>
  <div class="hours-row">
    {worker.hours_worked.toFixed(0)}h worked
    · {worker.validated_hours.toFixed(1)}h validated
  </div>

  <!-- ── Market channel ── -->
  <div class="section-head">market channel</div>
  <div class="stat-row">
    <span class="stat-label">market wage</span>
    <span class="stat-val">${worker.dollar_wage.toFixed(2)}</span>
  </div>
  <div class="stat-row">
    <span class="stat-label">after essentials</span>
    <span class="stat-val">${worker.effective_net_market_wage.toFixed(2)}</span>
  </div>

  <!-- ── Social plan ── -->
  <div class="section-head">social plan</div>
  <div class="stat-row">
    <span class="stat-label">SVC claim</span>
    <span class="stat-val">{worker.claim_capacity.toFixed(1)}<span class="unit"> SVC</span></span>
  </div>
  <div class="stat-row">
    <span class="stat-label">provision</span>
    <span class="stat-val">${worker.communal_need_coverage.toFixed(2)}</span>
  </div>

  <!-- ── Coverage ── -->
  <div class="section-head">social plan covers</div>
  <div class="coverage-wrap">
    <div class="coverage-track">
      <div
        class="coverage-fill"
        style="width: {coveragePct}%; background: {coverageColor}"
      ></div>
    </div>
  </div>
  <span class="coverage-text" style="color: {coverageColor}">{coverageText}</span>

  <!-- ── Goods access split ── -->
  <div class="section-sep"></div>
  <div class="section-head">real goods access</div>
  <div class="ent-bar">
    <div class="ent-seg social" style="width: {socialPct}%"></div>
    <div class="ent-seg market" style="width: {marketPct}%"></div>
  </div>
  <div class="ent-labels">
    <span class="ent-label social">{socialPct}% social</span>
    <span class="ent-label market">{marketPct}% market</span>
  </div>
</div>

<style>
  .worker-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 160px;
    flex-shrink: 0;
    padding: 8px 10px 9px;
    background: #0d0d0d;
    border: 1px solid rgba(56, 189, 248, 0.12);
    border-radius: 4px;
    font-family: var(--font-mono);
    color: #e2e8f0;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .worker-name {
    font-size: var(--text-xs);
    font-weight: 600;
    color: rgb(56, 189, 248);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wage-pill {
    font-size: 0.56rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .hours-row {
    font-size: 0.58rem;
    opacity: 0.4;
    margin-top: -1px;
    margin-bottom: 1px;
  }

  .section-head {
    font-size: 0.52rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    opacity: 0.25;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    padding-top: 4px;
    margin-top: 1px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px;
  }

  .stat-label {
    font-size: 0.58rem;
    opacity: 0.38;
    flex-shrink: 0;
  }

  .stat-val {
    font-size: 0.72rem;
    font-weight: 600;
  }

  .unit {
    font-size: 0.55rem;
    opacity: 0.45;
    font-weight: 400;
  }

  .coverage-wrap {
    margin-top: 1px;
  }

  .coverage-track {
    height: 5px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    overflow: hidden;
  }

  .coverage-fill {
    height: 100%;
    border-radius: 2px;
    opacity: 0.7;
    transition: width 0.3s;
  }

  .coverage-text {
    font-size: 0.58rem;
    font-weight: 600;
  }

  .section-sep {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 2px 0;
  }

  .ent-bar {
    display: flex;
    height: 5px;
    border-radius: 2px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.07);
  }

  .ent-seg.social {
    background: rgb(56, 189, 248);
    opacity: 0.65;
  }

  .ent-seg.market {
    background: var(--zone-yellow);
    opacity: 0.55;
  }

  .ent-labels {
    display: flex;
    justify-content: space-between;
  }

  .ent-label {
    font-size: 0.55rem;
    font-weight: 600;
  }

  .ent-label.social {
    color: rgb(56, 189, 248);
    opacity: 0.7;
  }

  .ent-label.market {
    color: var(--zone-yellow);
    opacity: 0.7;
  }
</style>
