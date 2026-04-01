<script lang="ts">
  import type { PlanHypercert, HypercertStore } from '$lib/observation/hypercerts';
  import HypercertCard from './HypercertCard.svelte';

  interface Props {
    hypercerts: PlanHypercert[];
    store: HypercertStore;
    scopeNames: Record<string, string>;
    onissue: () => void;
    onchange: () => void;
  }
  let { hypercerts, store, scopeNames, onissue, onchange }: Props = $props();

  let connecting = $state(false);
  let connectError = $state('');

  const totalFunds = $derived(
    hypercerts.reduce((sum, c) => sum + c.fundsRaised, 0),
  );
  const totalAvailable = $derived(
    hypercerts.reduce((sum, c) => sum + c.availableUnits, 0),
  );

  async function handleConnect() {
    connecting = true;
    connectError = '';
    const result = await store.connectWallet();
    if (result.ok) {
      onchange();
    } else {
      connectError = result.reason;
    }
    connecting = false;
  }
</script>

<div class="hypercerts-band">
  <div class="band-head">
    <span class="band-lbl">HYPERCERTS</span>
    {#if hypercerts.length > 0}
      <span class="band-count">{hypercerts.length}</span>
    {/if}
    {#if totalFunds > 0}
      <span class="funds-badge">{totalFunds.toFixed(6)} ETH raised</span>
    {/if}
    {#if totalAvailable > 0}
      <span class="avail-badge">{totalAvailable.toLocaleString()} units available</span>
    {/if}

    <div class="head-actions">
      {#if store.walletConnected && store.walletAddress}
        <span class="wallet-badge" title={store.walletAddress}>
          {store.walletAddress.slice(0, 6)}…{store.walletAddress.slice(-4)}
          <span class="chain-tag">{store.chainName}</span>
        </span>
      {:else}
        <button class="connect-btn" onclick={handleConnect} disabled={connecting}>
          {connecting ? 'CONNECTING…' : 'CONNECT WALLET'}
        </button>
      {/if}
      <button class="issue-btn" onclick={onissue}>ISSUE PLAN CERT</button>
    </div>
  </div>
  {#if connectError}
    <div class="connect-error">{connectError}</div>
  {/if}
  {#if hypercerts.length > 0}
    <div class="cards-scroll">
      {#each hypercerts as cert (cert.id)}
        <HypercertCard {cert} {store} {scopeNames} {onchange} />
      {/each}
    </div>
  {:else}
    <div class="empty-msg">No plan certificates issued yet. Click ISSUE PLAN CERT to snapshot the current federation plan as a tradeable impact certificate.</div>
  {/if}
</div>

<style>
  .hypercerts-band {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-faint);
    padding: var(--gap-md) var(--gap-lg);
  }

  .band-head {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    margin-bottom: var(--gap-md);
    flex-wrap: wrap;
  }

  .band-lbl {
    font-weight: 700;
    font-size: var(--text-sm);
    letter-spacing: 0.06em;
    color: var(--text-primary);
  }

  .band-count {
    font-size: 0.58rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--zone-green-fill);
    color: var(--zone-green);
  }

  .funds-badge {
    font-size: 0.6rem;
    font-weight: 600;
    padding: 1px 8px;
    border-radius: 3px;
    background: var(--zone-excess-fill);
    color: var(--zone-excess);
  }

  .avail-badge {
    font-size: 0.58rem;
    color: var(--text-dim);
  }

  .head-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
  }

  .wallet-badge {
    font-size: 0.6rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--zone-green-fill);
    color: var(--zone-green);
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
  }

  .chain-tag {
    font-size: 0.5rem;
    font-weight: 400;
    color: var(--text-dim);
  }

  .connect-btn {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 3px 10px;
    border: 1px solid var(--zone-yellow);
    border-radius: 4px;
    background: var(--zone-yellow-fill);
    color: var(--zone-yellow);
    cursor: pointer;
  }
  .connect-btn:hover { background: rgba(232, 176, 78, 0.35); }
  .connect-btn:disabled { opacity: 0.5; cursor: default; }

  .connect-error {
    color: var(--zone-red);
    font-size: 0.58rem;
    margin-bottom: var(--gap-sm);
  }

  .issue-btn {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 3px 10px;
    border: 1px solid var(--zone-excess);
    border-radius: 4px;
    background: var(--zone-excess-fill);
    color: var(--zone-excess);
    cursor: pointer;
  }
  .issue-btn:hover { background: rgba(76, 166, 240, 0.35); }

  .cards-scroll {
    display: flex;
    gap: var(--gap-md);
    overflow-x: auto;
    padding-bottom: var(--gap-sm);
  }

  .empty-msg {
    color: var(--text-dim);
    font-size: var(--text-xs);
    padding: var(--gap-sm) 0;
  }
</style>
