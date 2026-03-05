<script lang="ts">
  import type { EconomicResource } from '$lib/schemas';
  import LotBadge from '$lib/components/trace/LotBadge.svelte';
  import MeasureDisplay from '$lib/components/vf/MeasureDisplay.svelte';

  interface Props {
    resource: EconomicResource;
    specName?: string;
    class?: string;
  }

  let { resource, specName, class: cls = '' }: Props = $props();
</script>

<div class="rc {cls}">
  <span class="spec">{specName ?? resource.conformsTo}</span>
  {#if resource.accountingQuantity}
    <div class="row"><span class="lbl">acct</span><MeasureDisplay measure={resource.accountingQuantity} /></div>
  {/if}
  {#if resource.onhandQuantity}
    <div class="row"><span class="lbl">OH</span><MeasureDisplay measure={resource.onhandQuantity} /></div>
  {/if}
  {#if resource.stage}<span class="muted">stage: {resource.stage}</span>{/if}
  {#if resource.currentLocation}<span class="muted">{resource.currentLocation}</span>{/if}
  {#if resource.lot}<LotBadge lot={resource.lot} />{/if}
</div>

<style>
  .rc { display: flex; flex-direction: column; gap: 2px; }
  .spec { font-size: var(--text-sm); font-weight: 500; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .lbl { opacity: var(--muted); }
  .muted { font-size: var(--text-xs); opacity: var(--muted); }
</style>
