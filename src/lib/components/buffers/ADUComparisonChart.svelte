<script lang="ts">
  import type { BufferZone, EconomicEvent, Intent } from '$lib/schemas';
  import { computeADU, computeForwardADU, bootstrapADU } from '$lib/algorithms/ddmrp';
  import { Plot, Line, RuleX } from 'svelteplot';

  interface Props {
    specId: string;
    events: EconomicEvent[];
    intents: Intent[];
    today: string;
    zone?: BufferZone;
  }

  let { specId, events, intents, today, zone }: Props = $props();

  type SeriesPoint = { date: string; adu: number; series: string };

  const chartData = $derived.by((): SeriesPoint[] => {
    const todayDate = new Date(today);
    const points: SeriesPoint[] = [];

    const hasBootstrap = zone?.estimatedADU !== undefined && zone.estimatedADU > 0;
    const estADU = zone?.estimatedADU ?? 0;
    const windowDays = zone?.aduWindowDays ?? 84;

    // Generate one sample per week for the past 52 weeks
    for (let w = 52; w >= 0; w--) {
      const sampleDate = new Date(todayDate.getTime() - w * 7 * 86_400_000);
      const dateStr = sampleDate.toISOString().slice(0, 10);

      const adu1w  = computeADU(events, specId, 7,   sampleDate).adu;
      const adu12w = computeADU(events, specId, 84,  sampleDate).adu;
      const adu52w = computeADU(events, specId, 364, sampleDate).adu;
      const aduFwd = computeForwardADU(intents, specId, 84, sampleDate).adu;

      if (adu1w  > 0) points.push({ date: dateStr, adu: adu1w,  series: '1-week' });
      if (adu12w > 0) points.push({ date: dateStr, adu: adu12w, series: '12-week' });
      if (adu52w > 0) points.push({ date: dateStr, adu: adu52w, series: '52-week' });
      if (aduFwd > 0) points.push({ date: dateStr, adu: aduFwd, series: 'fwd-12wk' });

      if (hasBootstrap) {
        // daysActual = calendar days elapsed since "bootstrap start" 52 weeks ago
        const daysActual = Math.min(windowDays, (52 - w) * 7);
        const actualADU = computeADU(events, specId, Math.max(7, daysActual || 7), sampleDate).adu;
        const { blendedADU } = bootstrapADU(actualADU, daysActual, estADU, windowDays);
        points.push({ date: dateStr, adu: blendedADU, series: 'actualized' });
        if (daysActual < windowDays) {
          points.push({ date: dateStr, adu: estADU, series: 'estimated' });
        }
      }
    }

    return points;
  });

  const hasData = $derived(chartData.length > 0);
  const hasBootstrap = $derived(zone?.estimatedADU !== undefined && (zone?.estimatedADU ?? 0) > 0);

  const seriesColors: Record<string, string> = {
    '1-week':    '#a0aec0',
    '12-week':   '#f6ad55',
    '52-week':   '#4fd1c5',
    'fwd-12wk':  '#9f7aea',
    'estimated': '#718096',
    'actualized':'#f7fafc',
  };
</script>

<div class="adu-chart">
  <div class="chart-header">
    <span class="chart-title">ADU Comparison</span>
    <div class="legend">
      {#each Object.entries(seriesColors) as [label, color]}
        {#if label !== 'estimated' && label !== 'actualized' || hasBootstrap}
          <span class="legend-item" style:color={color}>
            <svg width="16" height="4" style="vertical-align:middle;margin-right:2px">
              <line x1="0" y1="2" x2="16" y2="2" stroke={color}
                stroke-width={label === 'actualized' ? 2.5 : 2}
                stroke-dasharray={label === '1-week' ? '3,2' : label === '12-week' ? '5,2' : label === 'estimated' ? '4,3' : 'none'}
                opacity={label === 'estimated' ? 0.55 : 1} />
            </svg>
            {label}
          </span>
        {/if}
      {/each}
    </div>
  </div>

  {#if !hasData}
    <div class="empty">No event history — seed example data to see ADU trends</div>
  {:else}
    <Plot
      height={160}
      marginLeft={40}
      marginBottom={24}
      marginTop={8}
    >
      {#each Object.keys(seriesColors) as series}
        {#if series !== 'estimated' && series !== 'actualized' || hasBootstrap}
          {@const seriesData = chartData.filter(d => d.series === series)}
          {#if seriesData.length > 0}
            <Line
              data={seriesData}
              x="date"
              y="adu"
              stroke={seriesColors[series]}
              strokeWidth={series === '52-week' || series === 'actualized' ? 2.5 : 1.5}
              strokeDasharray={series === '1-week' ? '3,2' : series === '12-week' ? '5,2' : series === 'estimated' ? '4,3' : undefined}
              strokeOpacity={series === 'estimated' ? 0.55 : 1}
            />
          {/if}
        {/if}
      {/each}
      <RuleX data={[{ x: today }]} stroke="rgba(226,232,240,0.2)" strokeDasharray="3,2" />
    </Plot>
  {/if}
</div>

<style>
  .adu-chart {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .chart-header {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    flex-wrap: wrap;
  }

  .chart-title {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.5;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .legend {
    display: flex;
    gap: var(--gap-md);
    flex-wrap: wrap;
  }

  .legend-item {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    display: flex;
    align-items: center;
  }

  .empty {
    font-size: var(--text-xs);
    opacity: 0.3;
    padding: var(--gap-sm) 0;
  }
</style>
