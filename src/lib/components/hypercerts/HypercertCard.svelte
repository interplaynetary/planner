<script lang="ts">
  import type { PlanHypercert, HypercertStore, BuyResult } from '$lib/observation/hypercerts';

  interface Props {
    cert: PlanHypercert;
    store: HypercertStore;
    scopeNames: Record<string, string>;
    onchange: () => void;
  }
  let { cert, store, scopeNames, onchange }: Props = $props();

  let expanded = $state(false);
  let buyUnits = $state(100);
  let buying = $state(false);
  let buyError = $state('');
  let buySuccess = $state('');
  let minting = $state(false);
  let mintMsg = $state('');

  const claimedUnits = $derived(cert.totalUnits - cert.availableUnits);
  const claimedPct = $derived(
    cert.totalUnits > 0 ? Math.round((claimedUnits / cert.totalUnits) * 100) : 0,
  );
  const coherencePct = $derived(Math.round(cert.metadata.coherence * 100));
  const buyCost = $derived(buyUnits * cert.pricePerUnit);

  async function handleBuy() {
    buyError = '';
    buySuccess = '';
    if (buyUnits <= 0) { buyError = 'Units must be > 0'; return; }
    buying = true;
    const result: BuyResult = await store.buyFraction(cert.id, buyUnits);
    if (result.ok) {
      buySuccess = `Bought ${buyUnits} units for ${(buyUnits * cert.pricePerUnit).toFixed(6)} ETH`;
      buyUnits = 100;
      onchange();
    } else {
      buyError = result.reason;
    }
    buying = false;
  }

  async function handleMint() {
    minting = true;
    mintMsg = 'Requesting wallet…';
    const result = await store.mintOnChain(cert.id);
    if (result.ok) {
      mintMsg = `Minted! tx: ${result.txHash.slice(0, 10)}…`;
      onchange();
    } else {
      mintMsg = result.reason;
    }
    minting = false;
  }

  function scopeLabel(id: string): string {
    return scopeNames[id] ?? id;
  }

  function addrShort(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
</script>

<div class="cert-card">
  <button class="cert-head" onclick={() => expanded = !expanded}>
    <span class="cert-name">{cert.metadata.name}</span>
    <span class="cert-date">{new Date(cert.issuedAt).toLocaleDateString()}</span>
    {#if cert.mintedOnChain}
      <span class="chain-badge">ON-CHAIN</span>
    {/if}
    <span class="expand-icon">{expanded ? '−' : '+'}</span>
  </button>

  <div class="metrics-row">
    <span class="metric-pill">SCOPES {cert.metadata.scopesPlanned.length}</span>
    <span class="metric-pill" class:good={coherencePct >= 80} class:warn={coherencePct >= 40 && coherencePct < 80} class:bad={coherencePct < 40}>
      COHERENCE {coherencePct}%
    </span>
    <span class="metric-pill">TRADES {cert.metadata.lateralMatches}</span>
    {#if cert.metadata.conservationSignals > 0}
      <span class="metric-pill warn">SIGNALS {cert.metadata.conservationSignals}</span>
    {/if}
  </div>

  <div class="price-row">
    <span class="price-label">PRICE</span>
    <span class="price-val">{cert.pricePerUnit.toFixed(6)} ETH/unit</span>
    <span class="funds-label">RAISED</span>
    <span class="funds-val">{cert.fundsRaised.toFixed(6)} ETH</span>
  </div>

  <div class="fraction-bar-wrap">
    <div class="fraction-track">
      <div class="fraction-fill" style="width:{claimedPct}%"></div>
    </div>
    <span class="fraction-label">
      {claimedUnits} / {cert.totalUnits} units sold ({claimedPct}%)
      — {cert.availableUnits} available
    </span>
  </div>

  {#if expanded}
    <div class="detail-section">
      <div class="detail-lbl">DESCRIPTION</div>
      <div class="detail-text">{cert.metadata.description}</div>

      <div class="detail-lbl">CONTRIBUTORS</div>
      <div class="contrib-chips">
        {#each cert.metadata.contributors as c (c)}
          <span class="contrib-chip">{scopeLabel(c)}</span>
        {/each}
      </div>

      {#if cert.fractions.length > 0}
        <div class="detail-lbl">OWNERS</div>
        <div class="fractions-list">
          {#each cert.fractions as f (f.id)}
            <div class="fraction-row">
              <span class="fraction-owner">{addrShort(f.ownerId)}</span>
              <span class="fraction-units">{f.units} units</span>
              <span class="fraction-paid">{f.ethPaid.toFixed(6)} ETH</span>
              <a class="fraction-tx" href="https://sepolia.etherscan.io/tx/{f.txHash}" target="_blank" rel="noopener">tx</a>
            </div>
          {/each}
        </div>
      {/if}

      {#if cert.availableUnits > 0}
        <div class="detail-lbl">BUY FRACTIONS</div>
        {#if !store.walletConnected}
          <div class="wallet-hint">Connect your wallet to buy fractions</div>
        {:else}
          <div class="buy-form">
            <input
              class="buy-input"
              type="number"
              min="1"
              max={cert.availableUnits}
              bind:value={buyUnits}
            />
            <span class="buy-cost">{buyCost.toFixed(6)} ETH</span>
            <button class="buy-btn" onclick={handleBuy} disabled={buying}>
              {buying ? 'SENDING TX…' : 'BUY'}
            </button>
          </div>
          <div class="buy-note">Pays to treasury on {store.chainName}</div>
          {#if buyError}<div class="buy-error">{buyError}</div>{/if}
          {#if buySuccess}<div class="buy-success">{buySuccess}</div>{/if}
        {/if}
      {/if}

      <!-- Blockchain minting -->
      <div class="detail-lbl">MINT CERTIFICATE</div>
      {#if cert.mintedOnChain}
        <div class="chain-info">
          Minted on Optimism
          {#if cert.txHash}<a class="tx-link" href="https://optimistic.etherscan.io/tx/{cert.txHash}" target="_blank" rel="noopener">tx: {cert.txHash.slice(0, 18)}…</a>{/if}
        </div>
      {:else}
        <button class="mint-btn" onclick={handleMint} disabled={minting || !store.walletConnected}>
          {minting ? 'MINTING…' : 'MINT ON-CHAIN'}
        </button>
        {#if mintMsg}<div class="mint-msg">{mintMsg}</div>{/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .cert-card {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-faint);
    border-radius: 6px;
    padding: var(--gap-md);
    min-width: 300px;
    max-width: 380px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .cert-head {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
  }

  .cert-name {
    font-weight: 700;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cert-date {
    color: var(--text-dim);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .chain-badge {
    font-size: 0.55rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--zone-green-fill);
    color: var(--zone-green);
    letter-spacing: 0.04em;
  }

  .expand-icon {
    color: var(--text-dim);
    font-size: var(--text-sm);
    width: 16px;
    text-align: center;
  }

  .metrics-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs);
  }

  .metric-pill {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    background: var(--bg-overlay);
    color: var(--text-secondary);
  }
  .metric-pill.good { color: var(--zone-green); background: var(--zone-green-fill); }
  .metric-pill.warn { color: var(--zone-yellow); background: var(--zone-yellow-fill); }
  .metric-pill.bad  { color: var(--zone-red); background: var(--zone-red-fill); }

  .price-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: 2px 0;
  }

  .price-label, .funds-label {
    font-size: 0.55rem;
    font-weight: 700;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  .price-val {
    color: var(--zone-excess);
    font-weight: 600;
  }

  .funds-val {
    color: var(--zone-green);
    font-weight: 600;
  }

  .funds-label { margin-left: auto; }

  .fraction-bar-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fraction-track {
    height: 4px;
    background: rgba(130, 175, 255, 0.12);
    border-radius: 2px;
    overflow: hidden;
  }

  .fraction-fill {
    height: 100%;
    background: var(--zone-green);
    border-radius: 2px;
    transition: width 0.2s ease;
  }

  .fraction-label {
    color: var(--text-dim);
    font-size: 0.58rem;
  }

  .detail-section {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    border-top: 1px solid var(--border-faint);
    padding-top: var(--gap-sm);
  }

  .detail-lbl {
    font-weight: 700;
    font-size: 0.58rem;
    color: var(--text-dim);
    letter-spacing: 0.05em;
    margin-top: var(--gap-xs);
  }

  .detail-text {
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .contrib-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs);
  }

  .contrib-chip {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 0.58rem;
    background: var(--bg-overlay);
    color: var(--text-secondary);
  }

  .fractions-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .fraction-row {
    display: flex;
    gap: var(--gap-sm);
    align-items: center;
    padding: 1px 0;
  }

  .fraction-owner { color: var(--zone-excess); font-size: 0.6rem; font-weight: 600; }
  .fraction-units { color: var(--text-dim); }
  .fraction-paid { color: var(--zone-green); font-size: 0.58rem; }
  .fraction-tx {
    color: var(--text-dim);
    font-size: 0.55rem;
    text-decoration: underline;
  }

  .wallet-hint {
    color: var(--text-dim);
    font-size: var(--text-xs);
    font-style: italic;
  }

  .buy-form {
    display: flex;
    gap: var(--gap-sm);
    align-items: center;
  }

  .buy-input {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--bg-base);
    color: var(--text-primary);
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    padding: 2px 4px;
    width: 70px;
  }

  .buy-cost {
    color: var(--zone-excess);
    font-size: 0.6rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .buy-btn {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 3px 10px;
    border: 1px solid var(--zone-excess);
    border-radius: 3px;
    background: var(--zone-excess-fill);
    color: var(--zone-excess);
    cursor: pointer;
  }
  .buy-btn:hover { background: rgba(76, 166, 240, 0.35); }
  .buy-btn:disabled { opacity: 0.5; cursor: default; }

  .buy-note {
    color: var(--text-dim);
    font-size: 0.55rem;
  }

  .buy-error { color: var(--zone-red); font-size: 0.58rem; }
  .buy-success { color: var(--zone-green); font-size: 0.58rem; }

  .chain-info {
    color: var(--zone-green);
    font-size: var(--text-xs);
  }

  .tx-link {
    color: var(--text-dim);
    font-size: 0.55rem;
    text-decoration: underline;
  }

  .mint-btn {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 3px 10px;
    border: 1px solid var(--zone-yellow);
    border-radius: 3px;
    background: var(--zone-yellow-fill);
    color: var(--zone-yellow);
    cursor: pointer;
    width: fit-content;
  }
  .mint-btn:hover { background: rgba(232, 176, 78, 0.35); }
  .mint-btn:disabled { opacity: 0.5; cursor: default; }

  .mint-msg {
    color: var(--text-secondary);
    font-size: 0.55rem;
  }
</style>
