<script lang="ts">
  import type { DemandAdjustmentFactor } from "$lib/schemas";

  interface Props {
    factors: DemandAdjustmentFactor[];
    class?: string;
  }

  let { factors, class: cls = "" }: Props = $props();

  // Only show active ones inline; show count of inactive
  const active = $derived(factors.filter((f) => f.isActive !== false));
</script>

{#if active.length === 0}
  <span class="none {cls}">no adj.</span>
{:else}
  <span class="afb {cls}">
    {#each active as f}
      <span class="chip {f.type}" title="{f.type}: ×{f.factor}">
        ×{f.factor.toFixed(2)}
      </span>
    {/each}
  </span>
{/if}

<style>
  .afb {
    display: inline-flex;
    gap: 2px;
    flex-wrap: wrap;
  }
  .chip {
    font-size: calc(var(--text-xs) - 1px);
    font-family: var(--font-mono);
    padding: 0 3px;
    border-radius: 2px;
    font-weight: 600;
  }
  .chip.demand {
    color: var(--zone-yellow);
    background: var(--zone-yellow-fill);
  }
  .chip.zone {
    color: var(--zone-excess);
    background: var(--zone-excess-fill);
  }
  .chip.leadTime {
    color: var(--zone-green);
    background: var(--zone-green-fill);
  }
  .none {
    font-size: var(--text-xs);
    opacity: var(--muted);
    font-family: var(--font-mono);
  }
</style>
