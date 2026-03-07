<script lang="ts">
  import type { CapacityBuffer } from "$lib/schemas";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";
  import BufferZoneBar from "$lib/components/ui/BufferZoneBar.svelte";

  interface Props {
    buffers: CapacityBuffer[];
    /** processSpecId → display name */
    specNames?: Map<string, string>;
    class?: string;
  }

  let { buffers, specNames, class: cls = "" }: Props = $props();

  function zoneFor(b: CapacityBuffer): "red" | "yellow" | "green" {
    const util =
      b.totalCapacityHours > 0
        ? b.currentLoadHours / b.totalCapacityHours
        : 0;
    const gt = b.greenThreshold ?? 0.8;
    const yt = b.yellowThreshold ?? 0.95;
    return util < gt ? "green" : util < yt ? "yellow" : "red";
  }

  function utilPct(b: CapacityBuffer): number {
    return b.totalCapacityHours > 0
      ? (b.currentLoadHours / b.totalCapacityHours) * 100
      : 0;
  }

  const zoneOrder: Record<string, number> = { red: 0, yellow: 1, green: 2 };

  const sorted = $derived(
    [...buffers].sort(
      (a, b) => zoneOrder[zoneFor(a)] - zoneOrder[zoneFor(b)],
    ),
  );

  const totalLoad = $derived(
    buffers.reduce((s, b) => s + b.currentLoadHours, 0),
  );
  const totalCap = $derived(
    buffers.reduce((s, b) => s + b.totalCapacityHours, 0),
  );
  const totalZone = $derived(
    totalCap > 0 && totalLoad / totalCap < 0.8
      ? "green"
      : totalCap > 0 && totalLoad / totalCap < 0.95
        ? "yellow"
        : "red",
  );
</script>

<div class="clv {cls}">
  {#if buffers.length === 0}
    <p class="empty">No capacity buffers defined.</p>
  {:else}
    <table class="tbl">
      <thead>
        <tr>
          <th>Resource</th>
          <th>Period</th>
          <th class="bar-col">Utilization</th>
          <th class="num">Load / Capacity</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as b (b.id)}
          {@const zone = zoneFor(b)}
          {@const gt = b.greenThreshold ?? 0.8}
          {@const yt = b.yellowThreshold ?? 0.95}
          <tr class={zone}>
            <td class="name"
              >{specNames?.get(b.processSpecId) ??
                b.processSpecId.slice(0, 18)}</td
            >
            <td class="period mono">{b.periodDays}d</td>
            <td class="bar-col">
              <BufferZoneBar
                value={b.currentLoadHours}
                tor={gt * b.totalCapacityHours}
                toy={yt * b.totalCapacityHours}
                tog={b.totalCapacityHours}
              />
            </td>
            <td class="num mono">
              {b.currentLoadHours.toFixed(1)} / {b.totalCapacityHours.toFixed(
                1,
              )}h &nbsp;({utilPct(b).toFixed(0)}%)
            </td>
            <td><ZoneBadge {zone} /></td>
          </tr>
          {#if b.note}
            <tr class="note-row">
              <td colspan={5} class="note">{b.note}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
      <tfoot>
        <tr class="footer {totalZone}">
          <td colspan={2}><strong>Total</strong></td>
          <td class="bar-col">
            <BufferZoneBar
              value={totalLoad}
              tor={0.8 * totalCap}
              toy={0.95 * totalCap}
              tog={totalCap}
            />
          </td>
          <td class="num mono">
            {totalLoad.toFixed(1)} / {totalCap.toFixed(1)}h &nbsp;({totalCap >
            0
              ? ((totalLoad / totalCap) * 100).toFixed(0)
              : 0}%)
          </td>
          <td><ZoneBadge zone={totalZone} /></td>
        </tr>
      </tfoot>
    </table>
  {/if}
</div>

<style>
  .clv {
    overflow-x: auto;
  }

  .tbl {
    border-collapse: collapse;
    font-size: var(--text-xs);
    width: 100%;
    min-width: 480px;
  }

  th {
    font-weight: 500;
    text-align: left;
    padding: 3px var(--gap-sm);
    opacity: var(--muted);
    white-space: nowrap;
  }

  td {
    padding: 4px var(--gap-sm);
    vertical-align: middle;
  }

  tr + tr {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  tr.red td.name {
    color: var(--zone-red);
  }
  tr.yellow td.name {
    color: var(--zone-yellow);
  }
  tr.green td.name {
    color: var(--zone-green);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .num {
    text-align: right;
    white-space: nowrap;
  }

  .bar-col {
    width: 140px;
    min-width: 100px;
  }

  .note-row td {
    padding: 1px var(--gap-sm) 4px calc(var(--gap-sm) + 8px);
    font-size: var(--text-xs);
    opacity: var(--muted);
    font-style: italic;
  }

  .footer td {
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.15);
  }

  .empty {
    font-size: var(--text-xs);
    opacity: var(--muted);
    margin: 0;
  }
</style>
