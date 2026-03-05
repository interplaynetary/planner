<script lang="ts">
  import type { SignalIntegrityEntry } from "$lib/algorithms/ddmrp";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";
  import QuantityBar from "$lib/components/ui/QuantityBar.svelte";

  interface Props {
    entries: SignalIntegrityEntry[];
    class?: string;
  }

  let { entries, class: cls = "" }: Props = $props();

  function rowZone(e: SignalIntegrityEntry): "green" | "yellow" | "red" {
    if (e.late || e.overFulfilled) return "red";
    if (Math.abs(e.qtyDeviation) / (e.recommendedQty || 1) > 0.1)
      return "yellow";
    return "green";
  }
</script>

<table class="sir {cls}">
  <thead>
    <tr>
      <th>Signal</th>
      <th>Spec</th>
      <th>Rec. Qty</th>
      <th>Approved Qty</th>
      <th>Fulfillment</th>
      <th>Due</th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    {#each entries as e}
      {@const zone = rowZone(e)}
      <tr class={zone}>
        <td class="id">{e.signalId.slice(0, 8)}</td>
        <td>{e.specId.slice(0, 12)}</td>
        <td class="num">{e.recommendedQty.toFixed(1)}</td>
        <td class="num" class:dev={e.qtyDeviation !== 0}>
          {e.approvedQty.toFixed(1)}
          {#if e.qtyDeviation !== 0}
            <span class="diff"
              >({e.qtyDeviation > 0 ? "+" : ""}{e.qtyDeviation.toFixed(
                1,
              )})</span
            >
          {/if}
        </td>
        <td>
          <QuantityBar value={e.fulfilled} max={e.approvedQty} {zone} />
        </td>
        <td class="num"
          >{e.recommendedDue
            ? new Date(e.recommendedDue).toLocaleDateString()
            : "—"}</td
        >
        <td
          ><ZoneBadge
            {zone}
            label={e.late ? "LATE" : e.overFulfilled ? "OVER" : "OK"}
          /></td
        >
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .sir {
    border-collapse: collapse;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    width: 100%;
  }
  th {
    opacity: var(--muted);
    font-weight: 500;
    text-align: left;
    padding: 2px var(--gap-md);
  }
  td {
    padding: 2px var(--gap-md);
  }
  .num {
    text-align: right;
  }

  tr.red td:first-child {
    border-left: 2px solid var(--zone-red);
  }
  tr.yellow td:first-child {
    border-left: 2px solid var(--zone-yellow);
  }
  tr.green td:first-child {
    border-left: 2px solid var(--zone-green);
  }

  .id {
    opacity: var(--muted);
  }
  .diff {
    opacity: var(--muted);
    margin-left: 3px;
  }
  .dev {
    color: var(--zone-yellow);
  }
</style>
