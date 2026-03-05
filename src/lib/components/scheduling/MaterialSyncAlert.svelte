<script lang="ts">
  import type { BufferStatusResult } from '$lib/algorithms/ddmrp';
  import ZoneBadge from '$lib/components/ui/ZoneBadge.svelte';

  interface MaterialSyncEntry {
    commitmentId: string;
    specId: string;
    specName?: string;
    shortfall: number;
    releaseDate: string;
    bufferStatus?: BufferStatusResult;
  }

  interface Props {
    entries: MaterialSyncEntry[];
    class?: string;
  }

  let { entries, class: cls = '' }: Props = $props();
</script>

<div class="msa {cls}">
  {#each entries as e}
    <div class="row">
      <span class="muted">{e.commitmentId.slice(0, 8)}</span>
      <span>{e.specName ?? e.specId}</span>
      <span class="shortfall">{e.shortfall}</span>
      <span class="muted">{e.releaseDate}</span>
      {#if e.bufferStatus}<ZoneBadge zone={e.bufferStatus.zone} />{/if}
    </div>
  {/each}
</div>

<style>
  .msa { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .muted { opacity: var(--muted); }
  .shortfall { color: var(--zone-red); font-family: var(--font-mono); font-weight: 700; }
</style>
