<script lang="ts">
  import type { ReplenishmentSignal } from "$lib/schemas";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    signals: ReplenishmentSignal[];
    onApprove?: (signalId: string) => void;
    onReject?: (signalId: string) => void;
    class?: string;
  }

  let { signals, onApprove, onReject, class: cls = "" }: Props = $props();
</script>

<ul class="rsp {cls}" role="list">
  {#each signals as s}
    <li>
      <span class="id">{s.id.slice(0, 8)}</span>
      <ZoneBadge zone={s.zone ?? "yellow"} />
      <span class="qty">×{s.recommendedQty?.toFixed(1) ?? "?"}</span>
      <span class="due"
        >{s.recommendedDueDate
          ? new Date(s.recommendedDueDate).toLocaleDateString()
          : "—"}</span
      >
      <span class="pct"
        >{s.priority !== undefined
          ? `${(s.priority * 100).toFixed(0)}%`
          : ""}</span
      >
      <div class="acts">
        {#if onApprove}
          <button class="yes" onclick={() => onApprove(s.id)}>↑</button>
        {/if}
        {#if onReject}
          <button class="no" onclick={() => onReject(s.id)}>✕</button>
        {/if}
      </div>
    </li>
  {/each}
</ul>

<style>
  .rsp {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }
  .id {
    opacity: var(--muted);
    width: 6ch;
  }
  .qty {
    font-weight: 600;
  }
  .due {
    opacity: var(--muted);
  }
  .pct {
    margin-left: auto;
  }

  .acts {
    display: flex;
    gap: 2px;
  }
  button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: var(--text-xs);
    padding: 1px 4px;
    border-radius: 2px;
    line-height: 1;
  }
  .yes {
    color: var(--zone-green);
  }
  .no {
    color: var(--zone-red);
  }
  .yes:hover {
    background: var(--zone-green-fill);
  }
  .no:hover {
    background: var(--zone-red-fill);
  }
</style>
