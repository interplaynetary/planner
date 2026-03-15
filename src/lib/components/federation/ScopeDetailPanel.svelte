<script lang="ts">
  import DeficitResidualBar from './DeficitResidualBar.svelte';
  import ScopeNetworkDiagram from './ScopeNetworkDiagram.svelte';
  import EconomicResourceCard from '$lib/components/vf/EconomicResourceCard.svelte';
  import type { ScopePlanResult } from '$lib/planning/plan-for-scope';
  import type { StoreRegistry } from '$lib/planning/store-registry';
  import type { EconomicResource } from '$lib/schemas';
  import type { TradeProposal } from '$lib/planning/plan-federation';
  import type { Observer } from '$lib/observation/observer';

  interface Props {
    scopeId: string;
    result: ScopePlanResult;
    observer: Observer;
    resources: EconomicResource[];
    specNames: Record<string, string>;
    registry: StoreRegistry;
    tradeProposals?: TradeProposal[];
    onclose: () => void;
  }

  let { scopeId, result, observer, resources, specNames, registry, tradeProposals = [], onclose }: Props = $props();

  const outgoingTrades = $derived(tradeProposals.filter(t => t.fromScopeId === scopeId));
  const incomingTrades = $derived(tradeProposals.filter(t => t.toScopeId === scopeId));
  const hasTrades = $derived(outgoingTrades.length > 0 || incomingTrades.length > 0);

  function tradeStatusColor(status: TradeProposal['status']): string {
    if (status === 'settled') return '#68d391';
    return '#63b3ed';
  }

  let mode = $state<'plan' | 'observe'>('plan');
</script>

<aside class="detail-panel" aria-label="Scope detail: {scopeId}">
  <div class="panel-header">
    <div class="header-left">
      <span class="scope-label">SCOPE</span>
      <span class="scope-name">{scopeId}</span>
    </div>
    <div class="header-right">
      <div class="mode-tabs">
        <button class="tab-btn" class:active={mode === 'plan'} onclick={() => mode = 'plan'}>PLAN</button>
        <button class="tab-btn" class:active={mode === 'observe'} onclick={() => mode = 'observe'}>OBSERVE</button>
      </div>
      <button class="close-btn" onclick={onclose} aria-label="Close panel">✕</button>
    </div>
  </div>

  <!-- Signals band — always visible -->
  <div class="signals-band">
    {#if result.deficits.length > 0}
      <div class="section-label">DEFICITS</div>
      {#each result.deficits as deficit (deficit.intentId)}
        <DeficitResidualBar
          specId={deficit.specId}
          shortfall={deficit.shortfall}
          originalShortfall={deficit.originalShortfall}
          resolvedAt={deficit.resolvedAt ?? []}
        />
      {/each}
    {/if}

    {#if result.surplus.length > 0}
      <div class="section-label">SURPLUS</div>
      {#each result.surplus as s (s.specId)}
        <div class="signal-row">
          <span class="signal-spec">{s.specId}</span>
          <span class="green">{s.quantity}</span>
          {#if s.availableFrom}<span class="muted">{s.availableFrom}</span>{/if}
        </div>
      {/each}
    {/if}

    {#if result.metabolicDebt.length > 0}
      <div class="section-label">METABOLIC DEBT</div>
      {#each result.metabolicDebt as debt (debt.specId)}
        <div class="signal-row">
          <span class="signal-spec">{debt.specId}</span>
          <span class="yellow">{debt.shortfall}</span>
        </div>
      {/each}
    {/if}

    {#if hasTrades}
      <div class="section-label">LATERAL TRADES</div>
      {#each outgoingTrades as t (t.id)}
        <div class="trade-row">
          <span class="trade-arrow" style="color:#63b3ed">→</span>
          <span class="trade-peer">{t.toScopeId}</span>
          <span class="trade-spec">{t.specId}</span>
          <span class="trade-qty">×{t.quantity}</span>
          <span class="trade-status" style="color:{tradeStatusColor(t.status)}">{t.status.toUpperCase()}</span>
        </div>
      {/each}
      {#each incomingTrades as t (t.id)}
        <div class="trade-row">
          <span class="trade-arrow" style="color:#68d391">←</span>
          <span class="trade-peer">{t.fromScopeId}</span>
          <span class="trade-spec">{t.specId}</span>
          <span class="trade-qty">×{t.quantity}</span>
          <span class="trade-status" style="color:{tradeStatusColor(t.status)}">{t.status.toUpperCase()}</span>
        </div>
      {/each}
    {/if}

    {#if result.deficits.length === 0 && result.surplus.length === 0 && result.metabolicDebt.length === 0 && !hasTrades}
      <p class="empty">No signals.</p>
    {/if}
  </div>

  <!-- Network diagram — mode-toggled -->
  <section class="panel-section diagram-section">
    <div class="section-label">NETWORK</div>
    <ScopeNetworkDiagram
      planStore={result.planStore}
      {observer}
      {specNames}
      {mode}
    />
  </section>

  <!-- Inventory — always visible -->
  <section class="panel-section">
    <div class="section-label">INVENTORY</div>
    {#if resources.length === 0}
      <p class="empty">No resources observed.</p>
    {:else}
      <div class="resource-grid">
        {#each resources as r (r.id)}
          <EconomicResourceCard
            resource={r}
            specName={specNames[r.conformsTo] ?? r.conformsTo}
            price={0}
            canClaim={false}
            onclaim={() => {}}
          />
        {/each}
      </div>
    {/if}
  </section>
</aside>

<style>
  .detail-panel {
    width: 480px;
    min-width: 480px;
    background: #111;
    border-left: 1px solid rgba(255,255,255,0.06);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    gap: 8px;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .scope-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    opacity: 0.35;
    text-transform: uppercase;
  }

  .scope-name {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: rgba(255,255,255,0.85);
    word-break: break-all;
  }

  .mode-tabs {
    display: flex;
    gap: 2px;
  }

  .tab-btn {
    background: none;
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    padding: 3px 8px;
    border-radius: 3px;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }

  .tab-btn:hover {
    color: rgba(255,255,255,0.7);
    border-color: rgba(255,255,255,0.2);
  }

  .tab-btn.active {
    color: rgba(255,255,255,0.9);
    border-color: rgba(255,255,255,0.35);
    background: rgba(255,255,255,0.06);
  }

  .close-btn {
    background: none;
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 4px 7px;
    border-radius: 3px;
    flex-shrink: 0;
    transition: color 0.15s, border-color 0.15s;
  }

  .close-btn:hover {
    color: rgba(255,255,255,0.9);
    border-color: rgba(255,255,255,0.3);
  }

  .signals-band {
    padding: 10px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .panel-section {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }

  .diagram-section {
    overflow-x: auto;
  }

  .section-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.35;
    margin-bottom: 8px;
  }

  .signals-band .section-label {
    margin-bottom: 4px;
    margin-top: 4px;
  }

  .signals-band .section-label:first-child {
    margin-top: 0;
  }

  .empty {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.3;
    margin: 0;
  }

  .signal-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: 0.65rem;
  }

  .signal-spec {
    color: rgba(255,255,255,0.7);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .green { color: #68d391; }
  .yellow { color: #d69e2e; }
  .muted { opacity: 0.4; font-size: 0.58rem; }

  .trade-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: 0.62rem;
  }

  .trade-arrow { font-size: 0.72rem; flex-shrink: 0; }

  .trade-peer {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(255,255,255,0.7);
  }

  .trade-spec { color: rgba(255,255,255,0.4); flex-shrink: 0; }
  .trade-qty { color: rgba(255,255,255,0.5); flex-shrink: 0; }

  .trade-status {
    font-size: 0.48rem;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  .resource-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
</style>
