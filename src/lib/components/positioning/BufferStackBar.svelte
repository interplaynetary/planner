<script lang="ts">
  const MAX_HEIGHT = 160;

  interface Props {
    label: string;
    tor: number;
    toy: number;
    tog: number;
    maxTog?: number;
    class?: string;
  }

  let { label, tor, toy, tog, maxTog, class: cls = '' }: Props = $props();

  const scale = $derived(maxTog ?? tog);

  const redPx   = $derived(scale > 0 ? (tor / scale) * MAX_HEIGHT : 0);
  const yellowPx = $derived(scale > 0 ? ((toy - tor) / scale) * MAX_HEIGHT : 0);
  const greenPx  = $derived(scale > 0 ? ((tog - toy) / scale) * MAX_HEIGHT : 0);
</script>

<div class="bar-wrap {cls}">
  <div class="bar" style="height: {MAX_HEIGHT}px">
    <!-- Green on top, Yellow in middle, Red on bottom — stacked bottom-up via column-reverse -->
    <div class="segment green" style="height: {greenPx}px">
      {#if greenPx >= 20}
        <span class="seg-label">G {(tog - toy).toFixed(1)}</span>
      {/if}
    </div>
    <div class="segment yellow" style="height: {yellowPx}px">
      {#if yellowPx >= 20}
        <span class="seg-label">Y {(toy - tor).toFixed(1)}</span>
      {/if}
    </div>
    <div class="segment red" style="height: {redPx}px">
      {#if redPx >= 14}
        <span class="seg-label">R {tor.toFixed(1)}</span>
      {/if}
    </div>
  </div>
  <span class="bar-label">{label}</span>
</div>

<style>
  .bar-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .bar {
    display: flex;
    flex-direction: column-reverse;
    width: 48px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .segment {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }

  .segment.green  { background: var(--zone-green-fill, rgba(72,187,120,0.25)); }
  .segment.yellow { background: var(--zone-yellow-fill, rgba(214,158,46,0.25)); }
  .segment.red    { background: var(--zone-red-fill, rgba(245,101,101,0.25)); }

  .seg-label {
    font-family: var(--font-mono);
    font-size: 8px;
    color: #e2e8f0;
    opacity: 0.85;
    white-space: nowrap;
  }

  .bar-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs, 11px);
    opacity: 0.6;
    white-space: nowrap;
  }
</style>
