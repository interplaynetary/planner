<script lang="ts">
  import type { EconomicResource } from "$lib/schemas";

  interface Props {
    resources: EconomicResource[];
    onSelect?: (id: string) => void;
    class?: string;
  }

  let { resources, onSelect, class: cls = "" }: Props = $props();
</script>

<table class="inv {cls}">
  <thead>
    <tr>
      <th>ID</th>
      <th>Spec</th>
      <th>Accounting Qty</th>
      <th>On-Hand Qty</th>
      <th>Stage</th>
      <th>Location</th>
      <th>Lot</th>
    </tr>
  </thead>
  <tbody>
    {#each resources as r}
      <tr class:clickable={!!onSelect} onclick={() => onSelect?.(r.id)}>
        <td class="id">{r.id.slice(0, 8)}</td>
        <td>{r.conformsTo?.slice(0, 14) ?? "—"}</td>
        <td class="num"
          >{r.accountingQuantity?.hasNumericalValue?.toFixed(2) ?? "—"}</td
        >
        <td class="num"
          >{r.onhandQuantity?.hasNumericalValue?.toFixed(2) ?? "—"}</td
        >
        <td class="stage">{r.stage ?? "—"}</td>
        <td class="loc">{r.currentLocation ?? "—"}</td>
        <td class="lot">{r.lot ?? "—"}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .inv {
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
  .id,
  .lot {
    opacity: var(--muted);
  }
  .stage,
  .loc {
    opacity: 0.75;
  }

  .clickable {
    cursor: pointer;
  }
  .clickable:hover td {
    opacity: 0.85;
  }
</style>
