<script lang="ts">
  import type { LTMAlertEntry } from "$lib/algorithms/ddmrp";

  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    entries: LTMAlertEntry[];
    class?: string;
  }

  let { entries, class: cls = "" }: Props = $props();
</script>

<table class="ltm {cls}">
  <thead>
    <tr>
      <th>Order</th>
      <th>Spec</th>
      <th>Due</th>
      <th>Days left</th>
      <th>LTM Zone</th>
    </tr>
  </thead>
  <tbody>
    {#each entries as e}
      <tr>
        <td class="id">{e.orderId.slice(0, 8)}</td>
        <td>{e.specId.slice(0, 12)}</td>
        <td>{e.due ? new Date(e.due).toLocaleDateString() : "—"}</td>
        <td class="num">{e.daysRemaining?.toFixed(1) ?? "—"}</td>
        <td><ZoneBadge zone={e.ltmZone} /></td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .ltm {
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
  .id {
    opacity: var(--muted);
  }
</style>
