<script lang="ts">
  import {
    communeState,
    accountState,
    agentList,
    setActiveAgentId,
  } from "$lib/vf-stores.svelte";

  let agentSel = $state("");

  $effect(() => {
    agentSel = communeState.activeAgentId ?? "";
  });

  function onAgentChange() {
    setActiveAgentId(agentSel || null);
  }

  const contributionShare = $derived(
    communeState.totalSocialSvc > 0
      ? (
          (accountState.gross_contribution_credited /
            communeState.totalSocialSvc) *
          100
        ).toFixed(1)
      : "0.0",
  );
  const usedCapacity = $derived(accountState.claimed_capacity);
  const remainingCapacity = $derived(
    Math.max(
      0,
      accountState.total_claim_capacity - accountState.claimed_capacity,
    ),
  );
  const usedPct = $derived(
    accountState.total_claim_capacity > 0
      ? Math.min(
          100,
          Math.round((usedCapacity / accountState.total_claim_capacity) * 100),
        )
      : 0,
  );
</script>

<div class="commune-panel">
  <div class="panel-header">
    <span class="panel-title">COMMUNE</span>
    <div class="agent-select-wrap">
      <select bind:value={agentSel} onchange={onAgentChange}>
        <option value="">— Select Agent —</option>
        {#each agentList as agent (agent.id)}
          <option value={agent.id}>{agent.name ?? agent.id}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if accountState.loaded}
    <div class="account-body">
      <div class="acct-agent">{accountState.agentId}</div>

      <div class="grid">
        <!-- Contribution -->
        <div class="cell">
          <span class="cell-label">CONTRIBUTION</span>
          <span class="cell-big"
            >{accountState.gross_contribution_credited.toFixed(0)}<span
              class="cell-unit">hrs</span
            ></span
          >
          <span class="cell-sub">{contributionShare}% of total work</span>
        </div>

        <!-- Claim capacity -->
        <div class="cell">
          <span class="cell-label">CLAIM CAPACITY</span>
          <span class="cell-big accent"
            >{accountState.total_claim_capacity.toFixed(1)}<span
              class="cell-unit">SVC</span
            ></span
          >
          <span class="cell-sub"
            >{(accountState.current_share_of_claims * 100).toFixed(1)}% pool
            share</span
          >
        </div>

        <!-- Usage -->
        <div class="cell wide">
          <span class="cell-label">USAGE</span>
          <div class="usage-bar-track">
            <div class="usage-bar-fill" style="width: {usedPct}%"></div>
          </div>
          <div class="usage-labels">
            <span>used {usedCapacity.toFixed(1)}</span>
            <span class="accent"
              >remaining <strong>{remainingCapacity.toFixed(1)} SVC</strong
              ></span
            >
          </div>
        </div>

        {#if accountState.solidarity_supplement > 0}
          <div class="cell">
            <span class="cell-label">SOLIDARITY SUPP</span>
            <span class="cell-big"
              >{accountState.solidarity_supplement.toFixed(1)}<span
                class="cell-unit">SVC</span
              ></span
            >
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .commune-panel {
    border: 1px solid rgba(214, 158, 46, 0.2);
    border-radius: 4px;
    overflow: hidden;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-sm) var(--gap-md);
    background: rgba(214, 158, 46, 0.05);
    border-bottom: 1px solid rgba(214, 158, 46, 0.1);
    flex-wrap: wrap;
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--zone-yellow);
    flex-shrink: 0;
  }

  .rate {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.4;
  }

  .agent-select-wrap {
    margin-left: auto;
  }

  select {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #e2e8f0;
    border-radius: 3px;
    cursor: pointer;
    min-width: 200px;
  }

  select:focus {
    outline: none;
    border-color: var(--zone-yellow);
  }

  .account-body {
    padding: var(--gap-sm) var(--gap-md);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .acct-agent {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--zone-yellow);
    opacity: 0.8;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
    overflow: hidden;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    background: #0d0d0d;
    min-width: 120px;
    flex: 1;
  }

  .cell.wide {
    min-width: 200px;
    flex: 2;
  }

  .cell-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    opacity: 0.3;
  }

  .cell-big {
    font-family: var(--font-mono);
    font-size: 1.1rem;
    font-weight: 600;
    line-height: 1.1;
    color: #e2e8f0;
  }

  .cell-big.accent {
    color: var(--zone-yellow);
  }

  .cell-unit {
    font-size: 0.65rem;
    opacity: 0.5;
    font-weight: 400;
    margin-left: 3px;
  }

  .cell-sub {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.45;
  }

  .usage-bar-track {
    height: 5px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    overflow: hidden;
    margin: 4px 0 3px;
  }

  .usage-bar-fill {
    height: 100%;
    background: var(--zone-yellow);
    border-radius: 3px;
    opacity: 0.6;
    transition: width 0.3s;
  }

  .usage-labels {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 0.58rem;
    opacity: 0.6;
  }

  .accent {
    color: var(--zone-yellow);
    opacity: 1 !important;
  }
</style>
