<script lang="ts">
  import type { EconomicEvent } from '$lib/schemas';
  import ActionBadge from './ActionBadge.svelte';
  import MeasureDisplay from './MeasureDisplay.svelte';

  interface Props {
    event: EconomicEvent;
    class?: string;
  }

  let { event, class: cls = '' }: Props = $props();

  const t = $derived(event.hasPointInTime ?? event.hasBeginning ?? event.created);
  const dateStr = $derived(t ? new Date(t).toLocaleString() : '');
  const sameAgent = $derived(event.provider && event.receiver && event.provider === event.receiver);
</script>

<div class="er {cls}">
  {#if dateStr}<span class="muted">{dateStr}</span>{/if}
  <ActionBadge action={event.action} />
  {#if event.resourceQuantity}<MeasureDisplay measure={event.resourceQuantity} />{/if}
  {#if event.provider && !sameAgent}<span class="muted">{event.provider.slice(0, 8)}</span>{/if}
  {#if event.provider && event.receiver && !sameAgent}<span class="muted">→</span>{/if}
  {#if event.receiver && !sameAgent}<span class="muted">{event.receiver.slice(0, 8)}</span>{/if}
  {#if event.resourceInventoriedAs}<span class="muted">{event.resourceInventoriedAs.slice(0, 8)}</span>{/if}
</div>

<style>
  .er {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }
  .muted { opacity: var(--muted); }
</style>
