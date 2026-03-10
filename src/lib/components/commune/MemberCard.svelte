<script lang="ts">
  import type { MemberSnapshot } from "$lib/vf-stores.svelte";

  interface Props {
    member: MemberSnapshot;
    name: string;
    active?: boolean;
    onclick?: () => void;
  }

  let { member, name, active = false, onclick }: Props = $props();

  const ccfPct   = $derived(Math.round(member.contribution_capacity_factor * 100));
  const usedPct  = $derived(
    member.total_claim_capacity > 0
      ? Math.min(100, Math.round((member.claimed_capacity / member.total_claim_capacity) * 100))
      : 0,
  );
  const hasSupp  = $derived(member.solidarity_supplement > 0.005);
</script>

<button class="member-card" class:active onclick={onclick ?? (() => {})}>
  <!-- Header: name + CCF -->
  <div class="card-header">
    <span class="member-name">{name}</span>
    <div class="ccf-pill" title="Contribution Capacity Factor">
      <div class="ccf-bar-track">
        <div class="ccf-bar-fill" style="width: {ccfPct}%"></div>
      </div>
      <span class="ccf-label">{ccfPct}%</span>
    </div>
  </div>

  <!-- Contribution hours -->
  <div class="stat-row">
    <span class="stat-label">contribution</span>
    <span class="stat-val">{member.gross_contribution_credited.toFixed(0)}<span class="unit"> hrs</span></span>
  </div>

  <!-- Solidarity supplement (only if > 0) -->
  {#if hasSupp}
    <div class="stat-row supp">
      <span class="stat-label">supplement</span>
      <span class="stat-val accent">+{member.solidarity_supplement.toFixed(1)}<span class="unit"> SVC</span></span>
    </div>
  {/if}

  <!-- Total claim capacity -->
  <div class="stat-row total">
    <span class="stat-label">claim capacity</span>
    <span class="stat-val highlight">{member.total_claim_capacity.toFixed(1)}<span class="unit"> SVC</span></span>
  </div>

  <!-- Usage bar -->
  <div class="usage-wrap">
    <div class="usage-track">
      <div class="usage-fill" style="width: {usedPct}%"></div>
    </div>
    <div class="usage-labels">
      <span class="usage-used">{member.claimed_capacity.toFixed(1)} used</span>
      <span class="usage-pct">{usedPct}%</span>
    </div>
  </div>
</button>

<style>
  .member-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 160px;
    flex-shrink: 0;
    padding: 8px 10px 9px;
    background: #0d0d0d;
    border: 1px solid rgba(214, 158, 46, 0.12);
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
    font-family: var(--font-mono);
    color: #e2e8f0;
    transition: border-color 0.15s, background 0.15s;
  }

  .member-card:hover {
    border-color: rgba(214, 158, 46, 0.35);
    background: rgba(214, 158, 46, 0.03);
  }

  .member-card.active {
    border-color: rgba(214, 158, 46, 0.6);
    background: rgba(214, 158, 46, 0.05);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 2px;
  }

  .member-name {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--zone-yellow);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ccf-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .ccf-bar-track {
    width: 28px;
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .ccf-bar-fill {
    height: 100%;
    background: var(--zone-yellow);
    opacity: 0.55;
    border-radius: 2px;
  }

  .ccf-label {
    font-size: 0.55rem;
    opacity: 0.45;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px;
  }

  .stat-label {
    font-size: 0.58rem;
    opacity: 0.35;
    flex-shrink: 0;
  }

  .stat-val {
    font-size: 0.72rem;
    font-weight: 600;
  }

  .stat-row.supp .stat-val {
    color: var(--zone-green, #68d391);
  }

  .stat-row.total .stat-val {
    color: var(--zone-yellow);
  }

  .unit {
    font-size: 0.55rem;
    opacity: 0.45;
    font-weight: 400;
  }

  .usage-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 2px;
  }

  .usage-track {
    height: 3px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    overflow: hidden;
  }

  .usage-fill {
    height: 100%;
    background: var(--zone-yellow);
    opacity: 0.5;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .usage-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.55rem;
    opacity: 0.35;
  }
</style>
