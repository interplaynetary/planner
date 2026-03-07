<script lang="ts">
  import type { FulfillmentState } from '$lib/observation/observer';
  import QuantityBar from '$lib/components/ui/QuantityBar.svelte';

  interface Props {
    state: FulfillmentState;
    class?: string;
  }

  let { state, class: cls = '' }: Props = $props();

  const committed = $derived(state.totalCommitted.hasNumericalValue);
  const fulfilled = $derived(state.totalFulfilled.hasNumericalValue);
  const unit = $derived(state.totalCommitted.hasUnit);
  const zone = $derived(
    state.overFulfilled ? 'excess' : state.finished ? 'green' : undefined
  );
</script>

<div class="fb {cls}">
  <QuantityBar value={fulfilled} max={committed} label={unit} {zone} />
  {#if state.overFulfilled}<span class="warn">over-fulfilled</span>{/if}
</div>

<style>
  .fb { display: flex; flex-direction: column; gap: 2px; }
  .warn { font-size: var(--text-xs); color: var(--zone-excess); }
</style>
