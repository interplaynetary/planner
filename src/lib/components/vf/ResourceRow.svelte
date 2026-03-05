<script lang="ts">
  import type { EconomicResource } from '$lib/schemas';
  import MeasureDisplay from './MeasureDisplay.svelte';

  interface Props {
    resource: EconomicResource;
    specName?: string;
    class?: string;
  }

  let { resource, specName, class: cls = '' }: Props = $props();
</script>

<div class="rr {cls}">
  <span class="name">{specName ?? resource.conformsTo.slice(0, 12)}</span>
  {#if resource.stage}<span class="stage muted">{resource.stage.slice(0, 8)}</span>{/if}
  {#if resource.onhandQuantity}
    <span class="label">OH</span>
    <MeasureDisplay measure={resource.onhandQuantity} />
  {/if}
  {#if resource.accountingQuantity}
    <span class="label muted">AC</span>
    <span class="muted"><MeasureDisplay measure={resource.accountingQuantity} /></span>
  {/if}
  {#if resource.currentLocation}<span class="muted">{resource.currentLocation.slice(0, 10)}</span>{/if}
</div>

<style>
  .rr {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }
  .label { opacity: var(--muted); }
  .muted { opacity: var(--muted); }
  .stage { font-family: var(--font-mono); }
</style>
