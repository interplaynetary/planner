<script lang="ts">
  import type { EconomicResource } from '$lib/schemas';

  interface Props {
    resource: EconomicResource;
    specName: string;
    price: number;
    canClaim: boolean;
    onclaim: () => void;
  }

  let { resource, specName, price, canClaim, onclaim }: Props = $props();

  const isClaimable = $derived(resource.classifiedAs?.includes('individual-claimable') ?? false);

  const accentColor = $derived(
    isClaimable
      ? 'var(--zone-yellow)'
      : (resource.classifiedAs?.includes('communal') ?? false)
        ? 'var(--zone-green)'
        : 'rgba(255,255,255,0.12)',
  );

  const accentRgb = $derived(
    isClaimable
      ? '214,158,46'
      : (resource.classifiedAs?.includes('communal') ?? false)
        ? '56,161,105'
        : '255,255,255',
  );

  const classification = $derived(
    (resource.classifiedAs?.[0] ?? '').split(':').at(-1) ?? 'resource'
  );

  const unit = $derived(
    resource.onhandQuantity?.hasUnit ?? resource.accountingQuantity?.hasUnit ?? ''
  );

  const onhand = $derived(resource.onhandQuantity?.hasNumericalValue ?? 0);
  const accounting = $derived(resource.accountingQuantity?.hasNumericalValue ?? 0);

  const claimDisabled = $derived(!canClaim || price === 0);
</script>

<div class="card" style="--accent: {accentColor}; --accent-rgb: {accentRgb};">
  <div class="card-header">
    <span class="classification">{classification || 'resource'}</span>
    {#if unit}
      <span class="unit">{unit}</span>
    {/if}
  </div>

  <div class="card-art" aria-hidden="true"></div>

  <div class="card-body">
    <div class="spec-name">{resource.name ?? specName}</div>
    <div class="qty-row">
      <span class="qty-label">OH</span>
      <span class="qty-val">{onhand}</span>
      <span class="qty-sep">·</span>
      <span class="qty-label">AC</span>
      <span class="qty-val">{accounting}</span>
    </div>

    {#if isClaimable}
      <div class="tag-pill">individual-claimable</div>
    {/if}

    {#if isClaimable}
      <button
        class="claim-btn"
        disabled={claimDisabled}
        onclick={onclaim}
      >
        {#if price > 0}
          Claim — {price} SVC
        {:else}
          Claim
        {/if}
      </button>
    {/if}
  </div>
</div>

<style>
  .card {
    width: 160px;
    min-height: 240px;
    flex-shrink: 0;
    background: #16161e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    transition: border-color 0.15s;
  }

  .card:hover {
    border-color: rgba(255, 255, 255, 0.2);
    border-left-color: var(--accent);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
    background: var(--border-faint);
    border-bottom: 1px solid var(--border-faint);
    gap: 4px;
  }

  .classification {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .unit {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .card-art {
    height: 52px;
    background:
      repeating-linear-gradient(
        -45deg,
        rgba(var(--accent-rgb), 0.04) 0px,
        rgba(var(--accent-rgb), 0.04) 1px,
        transparent 1px,
        transparent 6px
      ),
      linear-gradient(
        135deg,
        rgba(var(--accent-rgb), 0.12) 0%,
        rgba(0, 0, 0, 0) 100%
      );
    flex-shrink: 0;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 7px 7px 8px;
    flex: 1;
  }

  .spec-name {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    color: #e2e8f0;
  }

  .qty-row {
    display: flex;
    align-items: center;
    gap: 3px;
    font-family: var(--font-mono);
    font-size: 0.65rem;
  }

  .qty-label {
    opacity: 0.45;
  }

  .qty-val {
    color: var(--accent);
  }

  .qty-sep {
    opacity: 0.3;
    margin: 0 1px;
  }

  .tag-pill {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    padding: 1px 5px;
    border-radius: 2px;
    background: rgba(214, 158, 46, 0.12);
    color: var(--zone-yellow);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    align-self: flex-start;
  }

  .claim-btn {
    margin-top: auto;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    padding: 3px 8px;
    background: rgba(214, 158, 46, 0.15);
    border: 1px solid rgba(214, 158, 46, 0.4);
    color: var(--zone-yellow);
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.12s;
    align-self: stretch;
    text-align: center;
  }

  .claim-btn:hover:not(:disabled) {
    background: rgba(214, 158, 46, 0.28);
  }

  .claim-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
