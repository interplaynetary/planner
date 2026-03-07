<script lang="ts">
  import type { SignalIntegrityEntry } from "$lib/algorithms/ddmrp";
  import type { FulfillmentState } from "$lib/observation/observer";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";
  import QuantityBar from "$lib/components/ui/QuantityBar.svelte";

  interface Props {
    entries: SignalIntegrityEntry[];
    class?: string;
  }

  let { entries, class: cls = "" }: Props = $props();

  function approvedQty(e: SignalIntegrityEntry): number {
    return e.commitment?.resourceQuantity?.hasNumericalValue ?? 0;
  }
  function fulfilled(e: SignalIntegrityEntry): number {
    return (e.fulfillmentState as FulfillmentState | undefined)
      ?.totalFulfilled?.hasNumericalValue ?? 0;
  }
  function qtyDeviation(e: SignalIntegrityEntry): number {
    return e.deviation?.qtyDiff ?? 0;
  }
  function isLate(e: SignalIntegrityEntry): boolean {
    return e.deviation?.late ?? false;
  }
  function isOverFulfilled(e: SignalIntegrityEntry): boolean {
    return (e.fulfillmentState as FulfillmentState | undefined)?.overFulfilled ?? false;
  }
  function rowZone(e: SignalIntegrityEntry): "green" | "yellow" | "red" {
    if (isLate(e) || isOverFulfilled(e)) return "red";
    const dev = qtyDeviation(e);
    if (Math.abs(dev) / (e.signal.recommendedQty || 1) > 0.1) return "yellow";
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
      {@const aqty = approvedQty(e)}
      {@const dev = qtyDeviation(e)}
      <tr class={zone}>
        <td class="id">{e.signal.id.slice(0, 8)}</td>
        <td>{e.signal.specId.slice(0, 12)}</td>
        <td class="num">{e.signal.recommendedQty.toFixed(1)}</td>
        <td class="num" class:dev={dev !== 0}>
          {aqty.toFixed(1)}
          {#if dev !== 0}
            <span class="diff">({dev > 0 ? "+" : ""}{dev.toFixed(1)})</span>
          {/if}
        </td>
        <td>
          <QuantityBar value={fulfilled(e)} max={aqty} {zone} />
        </td>
        <td class="num"
          >{e.signal.dueDate
            ? new Date(e.signal.dueDate).toLocaleDateString()
            : "—"}</td
        >
        <td
          ><ZoneBadge
            {zone}
            label={isLate(e) ? "LATE" : isOverFulfilled(e) ? "OVER" : "OK"}
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
