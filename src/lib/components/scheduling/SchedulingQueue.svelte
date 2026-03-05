<script lang="ts">
  import type { PrioritizedSupplyEntry } from "$lib/algorithms/ddmrp";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";
  import PriorityCell from "$lib/components/ui/PriorityCell.svelte";

  export interface SchedulingRow {
    moId: string;
    partName: string;
    zone: string;
    priority: number; // 0–1
    nfp: number;
    due?: string;
    agent?: string;
    sequenceGroup?: string;
  }

  interface Props {
    rows: SchedulingRow[];
    class?: string;
  }

  let { rows, class: cls = "" }: Props = $props();
</script>

<table class="sq {cls}">
  <thead>
    <tr>
      <th>Group</th>
      <th>MO#</th>
      <th>Part</th>
      <th>Priority %</th>
      <th>NFP</th>
      <th>Due</th>
      <th>Agent</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as r}
      <tr>
        <td><span class="grp">{r.sequenceGroup ?? "—"}</span></td>
        <td class="id">{r.moId.slice(0, 8)}</td>
        <td class="part">{r.partName}</td>
        <td><PriorityCell pct={r.priority * 100} zone={r.zone} /></td>
        <td class="num" class:neg={r.nfp < 0}>{r.nfp.toFixed(1)}</td>
        <td>{r.due ? new Date(r.due).toLocaleDateString() : "—"}</td>
        <td class="agent">{r.agent ?? "—"}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .sq {
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
  .neg {
    color: var(--zone-red);
  }
  .part {
    font-weight: 500;
  }
  .id {
    opacity: var(--muted);
  }
  .agent {
    opacity: 0.75;
  }
  .grp {
    font-size: var(--text-xs);
    opacity: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
