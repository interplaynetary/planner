<script lang="ts">
  import type { DailyProjectionEntry } from "$lib/algorithms/ddmrp";
  import type { BufferZone } from "$lib/schemas";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    entries: DailyProjectionEntry[];
    bufferZone: BufferZone;
    /** Height of the sparkline in px */
    chartHeight?: number;
    class?: string;
  }

  let {
    entries,
    bufferZone,
    chartHeight = 48,
    class: cls = "",
  }: Props = $props();

  // Sparkline geometry
  const minVal = $derived(
    Math.min(0, ...entries.map((e) => e.projectedOnHand)),
  );
  const maxVal = $derived(
    Math.max(bufferZone.tog, ...entries.map((e) => e.projectedOnHand)),
  );
  const range = $derived(maxVal - minVal || 1);
  const W = 200;

  const toY = (v: number) => chartHeight - ((v - minVal) / range) * chartHeight;
  const toX = (i: number) => (i / Math.max(1, entries.length - 1)) * W;

  const path = $derived(
    entries
      .map(
        (e, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(e.projectedOnHand)}`,
      )
      .join(" "),
  );

  // Zone threshold lines
  const torY = $derived(toY(bufferZone.tor));
  const toyY = $derived(toY(bufferZone.toy));
  const zeroY = $derived(toY(0));
</script>

<div class="poh {cls}">
  <!-- Sparkline -->
  <svg
    width={W}
    height={chartHeight}
    viewBox="0 0 {W} {chartHeight}"
    overflow="visible"
  >
    <!-- Zone fill bands -->
    <rect
      x="0"
      y={toY(bufferZone.tog)}
      width={W}
      height={toyY - toY(bufferZone.tog)}
      fill="var(--zone-green-fill)"
    />
    <rect
      x="0"
      y={toyY}
      width={W}
      height={torY - toyY}
      fill="var(--zone-yellow-fill)"
    />
    <rect
      x="0"
      y={torY}
      width={W}
      height={zeroY - torY}
      fill="var(--zone-red-fill)"
    />
    {#if minVal < 0}
      <rect
        x="0"
        y={zeroY}
        width={W}
        height={chartHeight - zeroY}
        fill="var(--zone-stockout-fill)"
      />
    {/if}

    <!-- Projection line -->
    <path
      d={path}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    />

    <!-- Zero line -->
    <line
      x1="0"
      y1={zeroY}
      x2={W}
      y2={zeroY}
      stroke="currentColor"
      stroke-opacity="0.2"
      stroke-width="0.5"
      stroke-dasharray="2,2"
    />
  </svg>

  <!-- Table -->
  <table class="tbl">
    <thead>
      <tr>
        <th>Date</th>
        <th>Demand</th>
        <th>Receipts</th>
        <th>On-Hand</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each entries as e}
        <tr>
          <td>{e.date}</td>
          <td class="num">−{e.demand.toFixed(1)}</td>
          <td class="num">+{e.receipts.toFixed(1)}</td>
          <td class="num {e.zone}">{e.projectedOnHand.toFixed(1)}</td>
          <td><ZoneBadge zone={e.zone} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .poh {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
  }

  svg {
    display: block;
  }

  .tbl {
    border-collapse: collapse;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    width: 100%;
  }
  th {
    opacity: var(--muted);
    font-weight: 500;
    text-align: left;
    padding: 2px var(--gap-sm);
  }
  td {
    padding: 1px var(--gap-sm);
  }
  .num {
    text-align: right;
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
  .stockout {
    color: var(--zone-stockout);
  }
  .excess {
    color: var(--zone-excess);
  }
</style>
