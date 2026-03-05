<script lang="ts">
  import type { Commitment } from '$lib/schemas';
  import ActionBadge from './ActionBadge.svelte';
  import MeasureDisplay from './MeasureDisplay.svelte';

  interface Props {
    commitment: Commitment;
    specName?: string;
    class?: string;
  }

  let { commitment, specName, class: cls = '' }: Props = $props();

  const dueStr = $derived(commitment.due?.slice(0, 10));
</script>

<div class="cr {cls}">
  <ActionBadge action={commitment.action} />
  {#if commitment.resourceQuantity}<MeasureDisplay measure={commitment.resourceQuantity} />{/if}
  {#if specName}<span class="muted">{specName}</span>{/if}
  {#if dueStr}<span class="muted">{dueStr}</span>{/if}
  {#if commitment.provider}<span class="muted">{commitment.provider.slice(0, 8)}</span>{/if}
  {#if commitment.provider && commitment.receiver}<span class="muted">→</span>{/if}
  {#if commitment.receiver}<span class="muted">{commitment.receiver.slice(0, 8)}</span>{/if}
  {#if commitment.finished}<span class="done">✓</span>{/if}
</div>

<style>
  .cr {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }
  .muted { opacity: var(--muted); }
  .done { color: var(--zone-green); }
</style>
