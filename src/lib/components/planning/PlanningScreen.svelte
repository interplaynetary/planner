<script lang="ts">
  // PlanningRow = the data needed per row in the planning screen.
  // Computed upstream by the caller using computeNFP() + generateReplenishmentSignal().
  export interface PlanningRow {
    specId: string;
    specName: string;
    openSupply: number;
    onhand: number;
    qualifiedDemand: number;
    nfp: number;
    zone: string;
    priority: number; // 0–1 fraction
    recommendedQty: number | null;
    action: "replenish" | "none";
  }

  interface Props {
    rows: PlanningRow[];
    onReplenish?: (specId: string) => void;
    class?: string;
  }

  import PriorityCell from "$lib/components/ui/PriorityCell.svelte";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  let { rows, onReplenish, class: cls = "" }: Props = $props();
</script>

<table class="ps {cls}">
  <thead>
    <tr>
      <th>Part</th>
      <th>Supply</th>
      <th>On-Hand</th>
      <th>Demand</th>
      <th>NFP</th>
      <th>Priority %</th>
      <th>Rec. Qty</th>
      <th>Action</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as r}
      <tr class={r.zone}>
        <td class="part">{r.specName}</td>
        <td class="num">{r.openSupply.toFixed(1)}</td>
        <td class="num">{r.onhand.toFixed(1)}</td>
        <td class="num">{r.qualifiedDemand.toFixed(1)}</td>
        <td class="num" class:neg={r.nfp < 0}>
          {r.nfp >= 0 ? "+" : ""}{r.nfp.toFixed(1)}
        </td>
        <td class="num">
          <PriorityCell pct={r.priority * 100} zone={r.zone} />
        </td>
        <td class="num">
          {#if r.recommendedQty !== null}
            {r.recommendedQty.toFixed(1)}
          {:else}
            —
          {/if}
        </td>
        <td>
          {#if r.action === "replenish"}
            <button class="act" onclick={() => onReplenish?.(r.specId)}>
              Replenish
            </button>
          {:else}
            <ZoneBadge zone="green" label="OK" />
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .ps {
    border-collapse: collapse;
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    width: 100%;
  }
  th {
    opacity: var(--muted);
    font-weight: 500;
    text-align: left;
    padding: 3px var(--gap-md);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  td {
    padding: 3px var(--gap-md);
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

  /* Row tint by zone — left indicator only */
  tr.red td:first-child {
    border-left: 2px solid var(--zone-red);
  }
  tr.yellow td:first-child {
    border-left: 2px solid var(--zone-yellow);
  }
  tr.green td:first-child {
    border-left: 2px solid var(--zone-green);
  }
  tr.excess td:first-child {
    border-left: 2px solid var(--zone-excess);
  }

  .act {
    background: none;
    border: 1px solid var(--zone-yellow);
    color: var(--zone-yellow);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 1px 6px;
    border-radius: 2px;
    cursor: pointer;
  }
  .act:hover {
    background: var(--zone-yellow-fill);
  }
</style>
