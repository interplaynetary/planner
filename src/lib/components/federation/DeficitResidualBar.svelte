<script lang="ts">
  interface Props {
    specId: string;
    shortfall: number;
    originalShortfall?: number;
    resolvedAt?: string[];
  }

  let { specId, shortfall, originalShortfall, resolvedAt = [] }: Props = $props();

  const original = $derived(originalShortfall ?? shortfall);
  const resolvedQty = $derived(original - shortfall);
  const resolvedPct = $derived(original > 0 ? (1 - shortfall / original) * 100 : 0);
  const segmentWidth = $derived(resolvedAt.length > 0 ? resolvedQty / resolvedAt.length : 0);

  // Bar dimensions (total = 240px)
  const BAR_W = 240;
  const resolvedPx = $derived(original > 0 ? (resolvedQty / original) * BAR_W : 0);
  const remainingPx = $derived(BAR_W - resolvedPx);
  const segPx = $derived(resolvedAt.length > 0 ? resolvedPx / resolvedAt.length : 0);
</script>

<div class="deficit-bar-wrap">
  <div class="bar-header">
    <span class="spec-id">{specId}</span>
    <span class="resolved-label">{Math.round(resolvedPct)}% resolved</span>
  </div>

  <div class="bar-track" style="width:{BAR_W}px">
    {#each resolvedAt as scope, i (i)}
      <div
        class="seg seg-green"
        style="width:{segPx}px"
        title="{scope}: resolved {Math.round(segmentWidth)} units"
      ></div>
    {/each}
    {#if remainingPx > 0}
      <div
        class="seg seg-red"
        style="width:{remainingPx}px"
        title="Remaining shortfall: {shortfall}"
      ></div>
    {/if}
  </div>

  <div class="bar-meta">
    <span class="qty-label">shortfall {shortfall} / {original}</span>
    {#if resolvedAt.length > 0}
      <div class="scope-tags">
        {#each resolvedAt as scope (scope)}
          <span class="scope-tag">{scope}</span>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .deficit-bar-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  .bar-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .spec-id {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: rgba(255,255,255,0.75);
    letter-spacing: 0.04em;
  }

  .resolved-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.45;
  }

  .bar-track {
    height: 8px;
    border-radius: 2px;
    background: rgba(255,255,255,0.04);
    display: flex;
    overflow: hidden;
  }

  .seg {
    height: 100%;
    flex-shrink: 0;
  }

  .seg-green {
    background: #68d391;
    opacity: 0.85;
  }

  .seg-green + .seg-green {
    opacity: 0.65;
  }

  .seg-red {
    background: #e53e3e;
    opacity: 0.8;
  }

  .bar-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .qty-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.35;
    letter-spacing: 0.06em;
  }

  .scope-tags {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .scope-tag {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(104, 211, 145, 0.1);
    border: 1px solid rgba(104, 211, 145, 0.25);
    color: #68d391;
    border-radius: 2px;
    padding: 1px 5px;
  }
</style>
