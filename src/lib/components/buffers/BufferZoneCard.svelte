<script lang="ts">
  import type { BufferZone } from "$lib/schemas";
  import type { BufferStatusResult } from "$lib/algorithms/ddmrp";
  import BufferFunnel from "$lib/components/execution/BufferFunnel.svelte";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";
  import ZoneFormulaBreakdown from "$lib/components/buffers/ZoneFormulaBreakdown.svelte";

  interface Props {
    bufferZone: BufferZone;
    status: BufferStatusResult;
    specName?: string;
    location?: string;
    class?: string;
  }

  let {
    bufferZone,
    status,
    specName,
    location,
    class: cls = "",
  }: Props = $props();
</script>

<article class="bzc {cls}">
  <header>
    {#if specName}<span class="name">{specName}</span>{/if}
    {#if location}<span class="loc">{location}</span>{/if}
  </header>

  <div class="body">
    <BufferFunnel {bufferZone} onhand={status.onhand} height={64} />
    <div class="meta">
      <ZoneBadge zone={status.zone} pct={Math.round(status.pct)} />
      <ZoneFormulaBreakdown {bufferZone} />
    </div>
  </div>
</article>

<style>
  .bzc {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    min-width: 160px;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .loc {
    font-size: var(--text-xs);
    opacity: var(--muted);
    font-family: var(--font-mono);
  }

  .body {
    display: flex;
    gap: var(--gap-lg);
    align-items: flex-start;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }
</style>
