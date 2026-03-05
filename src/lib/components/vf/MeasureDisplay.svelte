<script lang="ts">
  import type { Measure } from '$lib/schemas';

  interface Props {
    measure: Measure;
    precision?: number;
    class?: string;
  }

  let { measure, precision = 2, class: cls = '' }: Props = $props();

  const formatted = $derived(measure.hasNumericalValue.toFixed(precision));
</script>

<span class="measure {cls}"><b>{formatted}</b> <span class="unit">{measure.hasUnit}</span></span>

<style>
  .measure {
    font-family: var(--font-mono);
    display: inline;
  }
  .unit {
    opacity: var(--muted);
  }
</style>
