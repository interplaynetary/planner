<script lang="ts">
  import type { DemandAdjustmentFactor, BufferZone } from '$lib/schemas';

  interface Props {
    factors: DemandAdjustmentFactor[];
    bufferZone: BufferZone;
    today: string;
  }

  let { factors, bufferZone, today }: Props = $props();

  // 12-week rolling window centered on today
  const WINDOW_DAYS = 84;
  const HALF = 42;

  const windowStart = $derived(
    new Date(new Date(today).getTime() - HALF * 86_400_000).toISOString().slice(0, 10)
  );
  const windowEnd = $derived(
    new Date(new Date(today).getTime() + HALF * 86_400_000).toISOString().slice(0, 10)
  );

  // Filter to factors that overlap this window
  const visible = $derived(
    factors.filter(f => f.validFrom <= windowEnd && f.validTo >= windowStart)
  );

  // Group: demand → zone/green → zone/yellow → zone/red → leadTime
  function sortKey(f: DemandAdjustmentFactor): number {
    if (f.type === 'demand') return 0;
    if (f.type === 'zone') {
      if (f.targetZone === 'green')  return 1;
      if (f.targetZone === 'yellow') return 2;
      return 3; // red or untagged
    }
    return 4; // leadTime
  }

  const sorted = $derived([...visible].sort((a, b) => sortKey(a) - sortKey(b)));

  // SVG layout
  const W = 460;
  const ROW_H = 20;
  const TOP = 8;
  const LEFT = 8;
  const RIGHT = 8;
  const CHART_W = $derived(W - LEFT - RIGHT);
  const svgH = $derived(TOP * 2 + Math.max(sorted.length, 1) * ROW_H + 16);

  function dateToX(dateStr: string): number {
    const wStart = new Date(windowStart).getTime();
    const wEnd   = new Date(windowEnd).getTime();
    const t      = Math.max(wStart, Math.min(wEnd, new Date(dateStr).getTime()));
    return LEFT + ((t - wStart) / (wEnd - wStart)) * CHART_W;
  }

  const todayX = $derived(dateToX(today));

  function barColor(f: DemandAdjustmentFactor): string {
    if (f.type === 'demand')   return '#ed8936';  // orange
    if (f.type === 'leadTime') return '#4299e1';  // blue
    if (f.type === 'zone') {
      if (f.targetZone === 'green')  return '#38a169';
      if (f.targetZone === 'yellow') return '#d69e2e';
      return '#e53e3e'; // red or untagged
    }
    return '#718096';
  }

  function barLabel(f: DemandAdjustmentFactor): string {
    if (f.type === 'demand')   return `DAF ×${f.factor}`;
    if (f.type === 'leadTime') return `LTAF ×${f.factor}`;
    if (f.type === 'zone') {
      if (f.targetZone === 'green')  return `greenZAF ×${f.factor}`;
      if (f.targetZone === 'yellow') return `yellowZAF ×${f.factor}`;
      return `redZAF ×${f.factor}`;
    }
    return `×${f.factor}`;
  }

  // Supply offset vertical line for demand factors
  function offsetX(f: DemandAdjustmentFactor): number | null {
    if (f.type !== 'demand' || !f.supplyOffsetDays || f.supplyOffsetDays <= 0) return null;
    const start = new Date(f.validFrom).getTime();
    const offsetDate = new Date(start - f.supplyOffsetDays * 86_400_000).toISOString().slice(0, 10);
    return dateToX(offsetDate);
  }

  // Detect overlapping demand factor transitions
  function isTransitionPair(a: DemandAdjustmentFactor, b: DemandAdjustmentFactor): boolean {
    return a.type === 'demand' && b.type === 'demand' &&
      a.validFrom <= b.validTo && a.validTo >= b.validFrom &&
      ((a.factor > 1 && b.factor < 1) || (a.factor < 1 && b.factor > 1));
  }

  const hasTransition = $derived(
    sorted.some((f, i) => sorted.slice(i + 1).some(g => isTransitionPair(f, g)))
  );
</script>

<div class="aft">
  <div class="header">Adjustment Factor Timeline · 12-week window</div>
  {#if sorted.length === 0}
    <span class="empty">No active adjustment factors in this window</span>
  {:else}
    <svg width={W} height={svgH} style="display:block;font-family:var(--font-mono);">
      <!-- Today line -->
      <line
        x1={todayX} y1={TOP - 4}
        x2={todayX} y2={svgH - 8}
        stroke="rgba(226,232,240,0.5)" stroke-width="1" stroke-dasharray="3,2"
      />
      <text x={todayX + 2} y={TOP + 4} font-size="7" fill="rgba(226,232,240,0.4)">today</text>

      <!-- Factor bars -->
      {#each sorted as f, i (f.id)}
        {@const y     = TOP + i * ROW_H + 4}
        {@const x1    = dateToX(f.validFrom)}
        {@const x2    = dateToX(f.validTo)}
        {@const bw    = Math.max(x2 - x1, 2)}
        {@const col   = barColor(f)}
        {@const label = barLabel(f)}
        {@const ox    = offsetX(f)}

        <!-- Supply offset dashed line -->
        {#if ox !== null}
          <line x1={ox} y1={y} x2={ox} y2={y + ROW_H - 6}
            stroke="#ed8936" stroke-width="1" stroke-dasharray="3,2" opacity="0.7" />
          <text x={ox + 2} y={y + 8} font-size="6.5" fill="#ed8936" opacity="0.7">offset</text>
        {/if}

        <!-- Bar -->
        <rect x={x1} y={y} width={bw} height={ROW_H - 6}
          fill={col} opacity="0.25" rx="2" />
        <rect x={x1} y={y} width={bw} height={ROW_H - 6}
          fill="none" stroke={col} stroke-width="1" rx="2" opacity="0.7" />
        <!-- Label inside bar if wide enough, else to right -->
        {#if bw > label.length * 5.5}
          <text x={x1 + 4} y={y + 9} font-size="7" fill={col}>{label}</text>
        {:else}
          <text x={x2 + 3} y={y + 9} font-size="7" fill={col}>{label}</text>
        {/if}
      {/each}

      <!-- Transition annotation -->
      {#if hasTransition}
        <text x={LEFT} y={svgH - 4} font-size="7" fill="rgba(226,232,240,0.4)">⇄ transition detected</text>
      {/if}
    </svg>
  {/if}
</div>

<style>
  .aft { display: flex; flex-direction: column; gap: 4px; }
  .header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.4;
    padding-bottom: var(--gap-xs);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .empty { font-size: var(--text-xs); opacity: 0.25; }
</style>
