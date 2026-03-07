<script lang="ts">
  import type { BufferHealthEntry } from "$lib/algorithms/ddmrp";
  import type { BufferZone } from "$lib/schemas";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    entries: BufferHealthEntry[];
    bufferZone: BufferZone;
    title?: string;
    class?: string;
  }

  let { entries, bufferZone, title, class: cls = "" }: Props = $props();

  // Chart geometry constants
  const W = 360;
  const H = 120;
  const PAD_L = 36;
  const PAD_B = 20;
  const chartW = W - PAD_L;
  const chartH = H - PAD_B;

  // Reactive derived values
  const maxPct = $derived(Math.max(120, ...entries.map((e) => e.pct)));
  const torPct = $derived(
    bufferZone.tog > 0 ? (bufferZone.tor / bufferZone.tog) * 100 : 0,
  );
  const toyPct = $derived(
    bufferZone.tog > 0 ? (bufferZone.toy / bufferZone.tog) * 100 : 0,
  );

  // Coordinate functions — reference reactive variables, tracked by $derived callers
  function toY(pct: number) {
    return chartH - (pct / maxPct) * chartH;
  }
  function toX(i: number) {
    return PAD_L + (i / Math.max(1, entries.length - 1)) * chartW;
  }

  // Polyline points string
  const points = $derived(
    entries.map((e, i) => `${toX(i)},${toY(e.pct)}`).join(" "),
  );

  // X-axis ticks: at most 7 labels
  const xStep = $derived(Math.max(1, Math.ceil(entries.length / 6)));
  const xTicks = $derived(
    entries
      .map((e, i) => ({ x: toX(i), label: e.date.slice(5), i }))
      .filter(({ i }) => i % xStep === 0 || i === entries.length - 1),
  );

  // Y-axis ticks
  const yTicks = $derived([
    { pct: 0, label: "0%" },
    { pct: torPct, label: `${torPct.toFixed(0)}%` },
    { pct: toyPct, label: `${toyPct.toFixed(0)}%` },
    { pct: 100, label: "100%" },
  ]);

  // Summary counts by zone
  const countByZone = $derived(
    entries.reduce(
      (acc, e) => {
        acc[e.zone] = (acc[e.zone] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  );
  const total = $derived(entries.length || 1);
  const redDays = $derived(countByZone["red"] ?? 0);
  const yellowDays = $derived(countByZone["yellow"] ?? 0);
  const greenDays = $derived(countByZone["green"] ?? 0);
  const excessDays = $derived(countByZone["excess"] ?? 0);
</script>

<div class="bhrc {cls}">
  {#if title}
    <div class="title">{title}</div>
  {/if}

  <svg width={W} height={H} viewBox="0 0 {W} {H}" overflow="visible">
    <!-- Zone band fills (bottom to top: red, yellow, green, excess) -->
    <rect
      x={PAD_L}
      y={toY(torPct)}
      width={chartW}
      height={chartH - toY(torPct)}
      fill="var(--zone-red-fill)"
    />
    <rect
      x={PAD_L}
      y={toY(toyPct)}
      width={chartW}
      height={toY(torPct) - toY(toyPct)}
      fill="var(--zone-yellow-fill)"
    />
    <rect
      x={PAD_L}
      y={toY(100)}
      width={chartW}
      height={toY(toyPct) - toY(100)}
      fill="var(--zone-green-fill)"
    />
    <rect
      x={PAD_L}
      y={0}
      width={chartW}
      height={toY(100)}
      fill="var(--zone-excess-fill)"
    />

    <!-- Zone threshold reference lines -->
    <line
      x1={PAD_L}
      y1={toY(torPct)}
      x2={W}
      y2={toY(torPct)}
      stroke="var(--zone-red)"
      stroke-width="0.5"
      stroke-dasharray="3,3"
      opacity="0.5"
    />
    <line
      x1={PAD_L}
      y1={toY(toyPct)}
      x2={W}
      y2={toY(toyPct)}
      stroke="var(--zone-yellow)"
      stroke-width="0.5"
      stroke-dasharray="3,3"
      opacity="0.5"
    />
    <line
      x1={PAD_L}
      y1={toY(100)}
      x2={W}
      y2={toY(100)}
      stroke="var(--zone-green)"
      stroke-width="0.5"
      stroke-dasharray="3,3"
      opacity="0.5"
    />

    <!-- Axes -->
    <line
      x1={PAD_L}
      y1={0}
      x2={PAD_L}
      y2={chartH}
      stroke="currentColor"
      opacity="0.2"
    />
    <line
      x1={PAD_L}
      y1={chartH}
      x2={W}
      y2={chartH}
      stroke="currentColor"
      opacity="0.2"
    />

    <!-- Y-axis ticks and labels -->
    {#each yTicks as t (t.pct)}
      <line
        x1={PAD_L - 3}
        y1={toY(t.pct)}
        x2={PAD_L}
        y2={toY(t.pct)}
        stroke="currentColor"
        opacity="0.3"
      />
      <text
        x={PAD_L - 5}
        y={toY(t.pct) + 3}
        text-anchor="end"
        font-size="9"
        font-family="var(--font-mono)"
        opacity="0.6">{t.label}</text
      >
    {/each}

    <!-- X-axis ticks and labels -->
    {#each xTicks as t (t.i)}
      <line
        x1={t.x}
        y1={chartH}
        x2={t.x}
        y2={chartH + 3}
        stroke="currentColor"
        opacity="0.3"
      />
      <text
        x={t.x}
        y={H - 4}
        text-anchor="middle"
        font-size="9"
        font-family="var(--font-mono)"
        opacity="0.6">{t.label}</text
      >
    {/each}

    <!-- Polyline of daily pct values -->
    {#if entries.length > 1}
      <polyline
        {points}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        opacity="0.5"
      />
    {/if}

    <!-- Dots colored by zone -->
    {#each entries as e, i (e.date)}
      <circle
        cx={toX(i)}
        cy={toY(e.pct)}
        r="3"
        fill="var(--zone-{e.zone})"
      />
    {/each}
  </svg>

  <!-- Summary row -->
  <div class="summary">
    <span class="zone-stat">
      <ZoneBadge zone="red" label="Red" />
      {redDays}d ({((redDays / total) * 100).toFixed(0)}%)
    </span>
    <span class="zone-stat">
      <ZoneBadge zone="yellow" label="Yellow" />
      {yellowDays}d ({((yellowDays / total) * 100).toFixed(0)}%)
    </span>
    <span class="zone-stat">
      <ZoneBadge zone="green" label="Green" />
      {greenDays}d ({((greenDays / total) * 100).toFixed(0)}%)
    </span>
    {#if excessDays > 0}
      <span class="zone-stat">
        <ZoneBadge zone="excess" label="Excess" />
        {excessDays}d ({((excessDays / total) * 100).toFixed(0)}%)
      </span>
    {/if}
  </div>
</div>

<style>
  .bhrc {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .title {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  svg {
    display: block;
  }

  .summary {
    display: flex;
    gap: var(--gap-md);
    flex-wrap: wrap;
  }

  .zone-stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
  }
</style>
