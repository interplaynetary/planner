<script lang="ts">
  import type { ADUResult } from "$lib/algorithms/ddmrp";

  interface Props {
    past?: ADUResult;
    forward?: ADUResult;
    blended?: number;
    class?: string;
  }

  let { past, forward, blended, class: cls = "" }: Props = $props();
</script>

<div class="adu {cls}">
  <span class="label">ADU</span>
  <div class="vals">
    {#if past}
      <span title="Past {past.windowDays}d rolling">
        <span class="key">←</span>
        <b>{past.adu.toFixed(2)}</b>
        <span class="unit">{past.unit}</span>
      </span>
    {/if}
    {#if forward}
      <span title="Forward {forward.windowDays}d">
        <span class="key">→</span>
        <b>{forward.adu.toFixed(2)}</b>
        <span class="unit">{forward.unit}</span>
      </span>
    {/if}
    {#if blended !== undefined}
      <span class="blended" title="Blended ADU">
        <span class="key">≈</span>
        <b>{blended.toFixed(2)}</b>
      </span>
    {/if}
  </div>
</div>

<style>
  .adu {
    display: flex;
    align-items: baseline;
    gap: var(--gap-lg);
  }
  .label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: var(--muted);
  }
  .vals {
    display: flex;
    gap: var(--gap-lg);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
  }
  .key {
    opacity: var(--muted);
    margin-right: 2px;
  }
  .unit {
    font-size: var(--text-xs);
    opacity: var(--muted);
    margin-left: 2px;
  }
  .blended b {
    color: var(--zone-excess);
  }
</style>
