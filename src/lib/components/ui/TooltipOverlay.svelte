<script lang="ts">
  import { tipState } from '$lib/tooltip.svelte';
</script>

{#if tipState.visible}
  <div class="tip" style="left:{tipState.x}px;top:{tipState.y}px">
    {#each tipState.lines as line, i (i)}
      <div class:header={i === 0}>{line}</div>
    {/each}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    background: rgba(10, 10, 14, 0.93);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #e2e8f0;
    padding: 6px 10px;
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    border-radius: 4px;
    pointer-events: none;
    z-index: 9999;
    white-space: nowrap;
    line-height: 1.55;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .header {
    font-weight: 600;
    color: #f7fafc;
    margin-bottom: 1px;
  }
</style>
