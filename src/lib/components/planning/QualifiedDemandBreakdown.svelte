<script lang="ts">
  import type { Commitment, Intent } from "$lib/schemas";

  export interface QualifiedDemandRow {
    flow: Commitment | Intent;
    type: "commitment" | "intent";
    qty: number;
    due?: string;
    qualified: boolean;
    reason?: string; // why filtered out
  }

  interface Props {
    rows: QualifiedDemandRow[];
    ostHorizon?: string;
    spikeThreshold?: number;
    class?: string;
  }

  let { rows, ostHorizon, spikeThreshold, class: cls = "" }: Props = $props();
</script>

<div class="qdb {cls}">
  {#if ostHorizon || spikeThreshold !== undefined}
    <div class="params">
      {#if ostHorizon}
        <span>OST <b>{new Date(ostHorizon).toLocaleDateString()}</b></span>
      {/if}
      {#if spikeThreshold !== undefined}
        <span>Spike threshold <b>{spikeThreshold.toFixed(1)}</b></span>
      {/if}
    </div>
  {/if}

  <table>
    <thead>
      <tr>
        <th>Flow</th>
        <th>Type</th>
        <th>Qty</th>
        <th>Due</th>
        <th>Status</th>
        <th>Note</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r}
        <tr class:filtered={!r.qualified}>
          <td class="id">{r.flow.id.slice(0, 8)}</td>
          <td>{r.type}</td>
          <td class="num">{r.qty.toFixed(1)}</td>
          <td>{r.due ? new Date(r.due).toLocaleDateString() : "—"}</td>
          <td>
            {#if r.qualified}
              <span class="yes">✓</span>
            {:else}
              <span class="no">—</span>
            {/if}
          </td>
          <td class="note">{r.reason ?? ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .qdb {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }
  .params {
    display: flex;
    gap: var(--gap-lg);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
  }
  .params b {
    opacity: 1;
  }

  table {
    border-collapse: collapse;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    width: 100%;
  }
  th {
    opacity: var(--muted);
    font-weight: 500;
    text-align: left;
    padding: 2px var(--gap-sm);
  }
  td {
    padding: 2px var(--gap-sm);
  }
  .num {
    text-align: right;
  }
  .id,
  .note {
    opacity: var(--muted);
  }

  .filtered {
    opacity: 0.4;
  }
  .yes {
    color: var(--zone-green);
  }
  .no {
    opacity: var(--muted);
  }
</style>
