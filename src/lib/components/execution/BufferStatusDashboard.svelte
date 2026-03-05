<script lang="ts">
  import type { BufferZone } from '$lib/schemas';
  import { bufferStatus } from '$lib/algorithms/ddmrp';
  import BufferFunnel from '$lib/components/execution/BufferFunnel.svelte';
  import ZoneBadge from '$lib/components/ui/ZoneBadge.svelte';

  interface Entry {
    bufferZone: BufferZone;
    onhand: number;
    specName?: string;
  }

  interface Props {
    entries: Entry[];
    class?: string;
  }

  let { entries, class: cls = '' }: Props = $props();

  const statuses = $derived(
    entries.map(e => ({ ...e, status: bufferStatus(e.onhand, e.bufferZone) }))
  );
</script>

<div class="bsd {cls}">
  {#each statuses as e}
    <div class="entry">
      <BufferFunnel bufferZone={e.bufferZone} onhand={e.onhand} />
      {#if e.specName}<span class="name">{e.specName}</span>{/if}
      <ZoneBadge zone={e.status.zone} pct={e.status.pct} />
    </div>
  {/each}
</div>

<style>
  .bsd {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-md);
  }
  .entry {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .name {
    font-size: var(--text-xs);
    opacity: var(--muted);
    max-width: 64px;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
