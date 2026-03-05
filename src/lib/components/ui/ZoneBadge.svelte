<script lang="ts">
  export type Zone =
    | "red"
    | "yellow"
    | "green"
    | "excess"
    | "stockout"
    | "early"
    | "late";

  interface Props {
    zone: Zone | string;
    label?: string;
    pct?: number; // optional numeric label
    class?: string;
  }

  let { zone, label, pct, class: cls = "" }: Props = $props();

  const display = $derived(
    label ?? (pct !== undefined ? `${pct.toFixed(0)}%` : zone),
  );
</script>

<span class="badge {zone} {cls}">
  {display}
</span>

<style>
  .badge {
    display: inline-block;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: 2px;
    line-height: 1.6;
  }
  .red {
    color: var(--zone-red);
    background: var(--zone-red-fill);
  }
  .yellow {
    color: var(--zone-yellow);
    background: var(--zone-yellow-fill);
  }
  .green {
    color: var(--zone-green);
    background: var(--zone-green-fill);
  }
  .excess {
    color: var(--zone-excess);
    background: var(--zone-excess-fill);
  }
  .stockout {
    color: var(--zone-stockout);
    background: var(--zone-stockout-fill);
  }
  .early {
    color: var(--zone-early);
    background: rgba(66, 153, 225, 0.15);
  }
  .late {
    color: var(--zone-late);
    background: var(--zone-stockout-fill);
  }
</style>
