<script lang="ts">
  import type { ScopeTransitionReport } from '$lib/observation/transition';

  interface Props {
    report: ScopeTransitionReport;
    scopeName: string;
    period: string;
  }

  let { report, scopeName, period }: Props = $props();

  const balanceColor = $derived(report.dollar_balance >= 0 ? '#68d391' : '#e53e3e');
  const subRatioColor = $derived(
    report.substitution_ratio >= 0.9 ? '#68d391'
    : report.substitution_ratio >= 0.6 ? '#d69e2e'
    : '#e53e3e'
  );
</script>

<div class="scope-panel">
  <div class="panel-header">
    <span class="panel-title">{scopeName}</span>
    <span class="period-pill">{period}</span>
    <span class="solvent-badge" class:solvent={report.is_solvent} class:insolvent={!report.is_solvent}>
      {report.is_solvent ? 'SOLVENT' : 'INSOLVENT'}
    </span>
  </div>

  <div class="stat-grid">
    <div class="cell">
      <span class="cell-label">DOLLAR BALANCE</span>
      <span class="cell-big" style="color: {balanceColor}">
        ${report.dollar_balance.toFixed(2)}
      </span>
      <span class="cell-sub">
        {report.is_solvent ? 'revenues exceed costs — scope is viable' : 'costs exceed revenues — scope needs support'}
      </span>
    </div>

    <div class="cell">
      <span class="cell-label">SOCIAL OUTPUT</span>
      <span class="cell-big">{(report.fractions.social_output_fraction * 100).toFixed(1)}%</span>
      <div class="thin-bar-track">
        <div class="thin-bar-fill teal" style="width: {Math.min(100, report.fractions.social_output_fraction * 100)}%"></div>
      </div>
      <span class="cell-sub">of production directed to social recipients</span>
    </div>

    <div class="cell">
      <span class="cell-label">CONFIRMED</span>
      <span class="cell-big">{(report.fractions.confirmed_output_fraction * 100).toFixed(1)}%</span>
      <div class="thin-bar-track">
        <div class="thin-bar-fill yellow" style="width: {Math.min(100, report.fractions.confirmed_output_fraction * 100)}%"></div>
      </div>
      <span class="cell-sub">social deliveries acknowledged by recipients</span>
    </div>

    <div class="cell">
      <span class="cell-label">SUBSTITUTION RATIO</span>
      <span class="cell-big" style="color: {subRatioColor}">{report.substitution_ratio.toFixed(2)}</span>
      <span class="cell-sub">social channel vs. market compensation per hour</span>
      <span class="cell-sub">transition depth: {(report.fractions.transition_depth * 100).toFixed(1)}%</span>
    </div>
  </div>
</div>

<style>
  .scope-panel {
    border: 1px solid rgba(56, 189, 248, 0.2);
    border-radius: 4px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-sm) var(--gap-md);
    background: rgba(56, 189, 248, 0.05);
    border-bottom: 1px solid rgba(56, 189, 248, 0.12);
    flex-wrap: wrap;
  }

  .panel-title {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgb(56, 189, 248);
  }

  .period-pill {
    font-size: 0.62rem;
    padding: 1px 6px;
    background: rgba(56, 189, 248, 0.1);
    border: 1px solid rgba(56, 189, 248, 0.2);
    border-radius: 2px;
    color: rgba(56, 189, 248, 0.8);
  }

  .solvent-badge {
    margin-left: auto;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 2px 7px;
    border-radius: 2px;
  }

  .solvent-badge.solvent {
    background: rgba(104, 211, 145, 0.12);
    border: 1px solid rgba(104, 211, 145, 0.3);
    color: #68d391;
  }

  .solvent-badge.insolvent {
    background: rgba(229, 62, 62, 0.12);
    border: 1px solid rgba(229, 62, 62, 0.3);
    color: #e53e3e;
  }

  .stat-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    background: rgba(255, 255, 255, 0.05);
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 12px;
    background: #0d0d0d;
    min-width: 130px;
    flex: 1;
  }

  .cell-label {
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    opacity: 0.3;
  }

  .cell-big {
    font-size: 1.1rem;
    font-weight: 600;
    line-height: 1.1;
    color: #e2e8f0;
  }

  .thin-bar-track {
    height: 3px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 2px;
  }

  .thin-bar-fill {
    height: 100%;
    border-radius: 2px;
  }

  .cell-sub {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    opacity: 0.4;
    margin-top: 1px;
  }

  .thin-bar-fill.teal {
    background: rgb(56, 189, 248);
    opacity: 0.6;
  }

  .thin-bar-fill.yellow {
    background: var(--zone-yellow);
    opacity: 0.6;
  }
</style>
