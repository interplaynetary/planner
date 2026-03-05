<script lang="ts">
  interface Props {
    pct: number; // NFP / TOG × 100 — can be negative
    zone: string;
    class?: string;
  }

  let { pct, zone, class: cls = "" }: Props = $props();

  const label = $derived(isFinite(pct) ? `${pct.toFixed(1)}%` : "—");
</script>

<span class="pc {zone} {cls}" title="Priority: {label}">
  {label}
</span>

<style>
  .pc {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
    letter-spacing: -0.01em;
    tabular-nums: true;
  }
  .red {
    color: var(--zone-red);
  }
  .yellow {
    color: var(--zone-yellow);
  }
  .green {
    color: var(--zone-green);
  }
  .excess {
    color: var(--zone-excess);
  }
  .stockout {
    color: var(--zone-stockout);
  }
</style>
