<script lang="ts">
  import type { Intent } from "$lib/schemas";
  import { PLAN_TAGS, parseReplenishmentNote } from "$lib/planning/planning";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    signals: Intent[];
    onApprove?: (intentId: string) => void;
    onReject?: (intentId: string) => void;
    class?: string;
  }

  let { signals, onApprove, onReject, class: cls = "" }: Props = $props();

  function parsed(s: Intent) {
    return parseReplenishmentNote(s);
  }
</script>

<ul class="rsp {cls}" role="list">
  {#each signals as s}
    {@const note = parsed(s)}
    <li>
      <span class="id">{s.id.slice(0, 8)}</span>
      <ZoneBadge zone={note.zone ?? "yellow"} />
      <span class="qty">&times;{note.recommendedQty?.toFixed(1) ?? "?"}</span>
      <span class="due"
        >{note.dueDate
          ? new Date(note.dueDate).toLocaleDateString()
          : "—"}</span
      >
      <span class="pct"
        >{note.priority !== undefined
          ? `${(note.priority * 100).toFixed(0)}%`
          : ""}</span
      >
      <div class="acts">
        {#if onApprove && !s.finished}
          <button class="yes" onclick={() => onApprove(s.id)}>↑</button>
        {/if}
        {#if onReject && !s.finished}
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
