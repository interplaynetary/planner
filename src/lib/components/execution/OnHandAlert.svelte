<script lang="ts">
  import type { OnhandAlertEntry } from "$lib/algorithms/ddmrp";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    entries: OnhandAlertEntry[];
    class?: string;
  }

  let { entries, class: cls = "" }: Props = $props();
</script>

<ul class="oha {cls}" role="list">
  {#each entries as e}
    <li>
      <ZoneBadge zone={e.zone} />
      <span class="spec">{e.specId.slice(0, 14)}</span>
      <span class="pct {e.zone}">{Math.round(e.pct)}%</span>
      {#if e.location}
        <span class="loc">{e.location}</span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .oha {
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
  .spec {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pct {
    font-weight: 700;
    width: 4ch;
    text-align: right;
  }
  .pct.red {
    color: var(--zone-red);
  }
  .pct.yellow {
    color: var(--zone-yellow);
  }
  .pct.green {
    color: var(--zone-green);
  }
  .loc {
    opacity: var(--muted);
  }
</style>
