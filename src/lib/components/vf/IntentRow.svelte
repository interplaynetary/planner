<script lang="ts">
  import type { Intent } from '$lib/schemas';
  import ActionBadge from './ActionBadge.svelte';
  import MeasureDisplay from './MeasureDisplay.svelte';

  interface Props {
    intent: Intent;
    specName?: string;
    class?: string;
  }

  let { intent, specName, class: cls = '' }: Props = $props();

  const dueStr = $derived(intent.due?.slice(0, 10));
  const atp = $derived(intent.availableQuantity?.hasNumericalValue);
  const minQty = $derived(intent.minimumQuantity?.hasNumericalValue ?? 0);
  const atpLow = $derived(atp !== undefined && atp < minQty);
  const agent = $derived(intent.provider ?? intent.receiver);
</script>

<div class="ir {cls}">
  <ActionBadge action={intent.action} />
  {#if intent.resourceQuantity}<MeasureDisplay measure={intent.resourceQuantity} />{/if}
  {#if specName}<span class="muted">{specName}</span>{/if}
  {#if dueStr}<span class="muted">{dueStr}</span>{/if}
  {#if agent}<span class="muted">{agent.slice(0, 8)}</span>{/if}
  {#if atp !== undefined}
    <span class="atp" class:low={atpLow}>ATP: {atp}</span>
  {/if}
</div>

<style>
  .ir {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }
  .muted { opacity: var(--muted); }
  .atp { font-family: var(--font-mono); }
  .atp.low { color: var(--zone-yellow); }
</style>
