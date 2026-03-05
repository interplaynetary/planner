<script lang="ts">
  /** Reusable zone colour helper — also exported for programmatic use */
  export type Zone =
    | "red"
    | "yellow"
    | "green"
    | "excess"
    | "stockout"
    | "early"
    | "late";

  interface Props {
    /** Current value (quantity or time units) */
    value: number;
    /** Top of Red */
    tor: number;
    /** Top of Yellow */
    toy: number;
    /** Top of Green */
    tog: number;
    unit?: string;
    /** If true, show zone labels along the bar */
    showLabels?: boolean;
    /** 'horizontal' fills left-to-right; 'vertical' fills bottom-to-top (funnel) */
    orientation?: "horizontal" | "vertical";
    /** Extra CSS class */
    class?: string;
  }

  let {
    value,
    tor,
    toy,
    tog,
    unit = "",
    showLabels = false,
    orientation = "horizontal",
    class: cls = "",
  }: Props = $props();

  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  /** Width/height percentages for each zone segment */
  const redPct = $derived(tog > 0 ? (tor / tog) * 100 : 0);
  const yellowPct = $derived(tog > 0 ? ((toy - tor) / tog) * 100 : 0);
  const greenPct = $derived(tog > 0 ? ((tog - toy) / tog) * 100 : 0);
  /** Cursor position (clamped 0-100%) */
  const cursorPct = $derived(tog > 0 ? clamp((value / tog) * 100, 0, 104) : 0);

  const zone = $derived(
    value <= 0
      ? "stockout"
      : value <= tor
        ? "red"
        : value <= toy
          ? "yellow"
          : value <= tog
            ? "green"
            : "excess",
  );
</script>

<div
  class="bzb {orientation} {cls}"
  role="meter"
  aria-valuenow={value}
  aria-valuemin={0}
  aria-valuemax={tog}
>
  {#if orientation === "vertical"}
    <!-- Funnel: red at bottom, green at top -->
    <div class="track vertical">
      <div class="seg green" style="flex:{greenPct}"></div>
      <div class="seg yellow" style="flex:{yellowPct}"></div>
      <div class="seg red" style="flex:{redPct}"></div>
      <!-- value cursor -->
      <div class="cursor v" style="bottom:{cursorPct}%"></div>
    </div>
  {:else}
    <div class="track horizontal">
      <div class="seg red" style="flex:{redPct}"></div>
      <div class="seg yellow" style="flex:{yellowPct}"></div>
      <div class="seg green" style="flex:{greenPct}"></div>
      <div class="cursor h" style="left:{cursorPct}%"></div>
    </div>
    {#if showLabels}
      <div class="labels">
        <span>0</span>
        <span style="left:{redPct}%">TOR</span>
        <span style="left:{redPct + yellowPct}%">TOY</span>
        <span style="right:0">TOG{unit ? ` (${unit})` : ""}</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .bzb {
    position: relative;
  }

  .track {
    position: relative;
    display: flex;
    border-radius: 2px;
    overflow: visible;
  }
  .track.horizontal {
    height: 6px;
    width: 100%;
  }
  .track.vertical {
    flex-direction: column-reverse;
    height: 100%;
    width: 8px;
  }

  .seg {
    min-width: 2px;
    min-height: 2px;
    transition: flex 0.3s;
  }
  .seg.red {
    background: var(--zone-red);
  }
  .seg.yellow {
    background: var(--zone-yellow);
  }
  .seg.green {
    background: var(--zone-green);
  }

  /* Value cursor */
  .cursor {
    position: absolute;
    background: #fff;
    border: 2px solid currentColor;
    border-radius: 50%;
    width: 10px;
    height: 10px;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 2;
  }
  .cursor.h {
    top: 50%;
  }
  .cursor.v {
    left: 50%;
    transform: translate(-50%, 50%);
  }

  .labels {
    position: relative;
    height: 14px;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
    margin-top: 4px;
  }
  .labels span {
    position: absolute;
    transform: translateX(-50%);
  }
  .labels span:first-child {
    transform: none;
  }
  .labels span:last-child {
    transform: none;
  }
</style>
