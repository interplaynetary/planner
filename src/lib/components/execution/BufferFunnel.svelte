<script lang="ts">
  import type { BufferZone } from "$lib/schemas";
  import BufferZoneBar from "$lib/components/ui/BufferZoneBar.svelte";

  interface Props {
    bufferZone: BufferZone;
    onhand: number;
    /** Height of the funnel in px */
    height?: number;
    class?: string;
  }

  let { bufferZone, onhand, height = 80, class: cls = "" }: Props = $props();

  const zone = $derived(
    onhand <= 0
      ? "stockout"
      : onhand <= bufferZone.tor
        ? "red"
        : onhand <= bufferZone.toy
          ? "yellow"
          : onhand <= bufferZone.tog
            ? "green"
            : "excess",
  );

  const pct = $derived(
    bufferZone.tog > 0 ? Math.round((onhand / bufferZone.tog) * 100) : 0,
  );
</script>

<div
  class="funnel {cls}"
  style="height:{height}px"
  title="{onhand} / {bufferZone.tog} {bufferZone.aduUnit} ({pct}% — {zone})"
>
  <!-- Trapezoid shape via clip-path -->
  <div class="shape">
    <BufferZoneBar
      value={onhand}
      tor={bufferZone.tor}
      toy={bufferZone.toy}
      tog={bufferZone.tog}
      orientation="vertical"
    />
  </div>
  <span class="val {zone}">{onhand}</span>
</div>

<style>
  .funnel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gap-sm);
    width: 20px;
  }
  .shape {
    flex: 1;
    width: 100%;
    display: flex;
    justify-content: center;
    /* Trapezoid via clip-path: wide at top, narrow at bottom */
    clip-path: polygon(0% 0%, 100% 0%, 75% 100%, 25% 100%);
    overflow: hidden;
  }
  .val {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .val.red {
    color: var(--zone-red);
  }
  .val.yellow {
    color: var(--zone-yellow);
  }
  .val.green {
    color: var(--zone-green);
  }
  .val.excess {
    color: var(--zone-excess);
  }
  .val.stockout {
    color: var(--zone-stockout);
  }
</style>
