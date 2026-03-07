<script lang="ts">
  import type { ScheduleBlock } from "$lib/planning/schedule-book";

  interface Props {
    blocks: ScheduleBlock[];
    /** Start of the displayed time window */
    windowStart: Date;
    /** End of the displayed time window */
    windowEnd: Date;
    /** px height of the chart */
    height?: number;
    class?: string;
  }

  let {
    blocks,
    windowStart,
    windowEnd,
    height = 120,
    class: cls = "",
  }: Props = $props();

  const rangeMs = $derived(windowEnd.getTime() - windowStart.getTime() || 1);

  function toX(d: Date | string) {
    return Math.max(
      0,
      Math.min(
        100,
        ((new Date(d).getTime() - windowStart.getTime()) / rangeMs) * 100,
      ),
    );
  }
  function width(start: Date | string, end: Date | string) {
    return Math.max(0.5, toX(end) - toX(start));
  }

  // Group blocks by agent / resource for row lanes
  const lanes = $derived(() => {
    const map = new Map<string, ScheduleBlock[]>();
    for (const b of blocks) {
      const key = b.provider ?? b.resourceInventoriedAs ?? "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return [...map.entries()];
  });

  const laneHeight = $derived(
    lanes().length > 0 ? height / lanes().length : height,
  );
</script>

<div class="gantt {cls}" style="height:{height}px; position:relative;">
  {#each lanes() as [laneId, laneBlocks], li}
    <div class="lane" style="top:{li * laneHeight}px; height:{laneHeight}px;">
      <span class="lane-label">{laneId.slice(0, 10)}</span>
      {#each laneBlocks as b}
        {@const committed = b.type === "commitment"}
        <div
          class="block {committed ? 'committed' : 'intent'}"
          style="left:{toX(b.hasBeginning ?? b.due ?? windowStart)}%; width:{width(
            b.hasBeginning ?? b.due ?? windowStart,
            b.hasEnd ?? b.due ?? windowEnd,
          )}%; top:20%; height:60%;"
          title="{b.action} · {b.resourceQuantity?.hasNumericalValue?.toFixed(1) ?? ''}"
        ></div>
      {/each}
    </div>
  {/each}

  <!-- Today line -->
  <div class="today" style="left:{toX(new Date())}%"></div>
</div>

<style>
  .gantt {
    width: 100%;
    overflow: hidden;
  }

  .lane {
    position: absolute;
    left: 0;
    right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .lane-label {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
    width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  .block {
    position: absolute;
    border-radius: 1px;
    min-width: 2px;
  }
  .block.committed {
    background: rgba(99, 179, 237, 0.7);
  }
  .block.intent {
    background: rgba(99, 179, 237, 0.25);
    border: 1px solid rgba(99, 179, 237, 0.5);
  }

  .today {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--zone-yellow);
    opacity: 0.7;
    pointer-events: none;
  }
</style>
