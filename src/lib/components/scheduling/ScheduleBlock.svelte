<script lang="ts">
  import type { ScheduleBlock } from '$lib/planning/schedule-book';
  import ActionBadge from '$lib/components/vf/ActionBadge.svelte';
  import MeasureDisplay from '$lib/components/vf/MeasureDisplay.svelte';

  interface Props {
    block: ScheduleBlock;
    class?: string;
  }

  let { block, class: cls = '' }: Props = $props();

  const isIntent = $derived(block.type === 'intent');
</script>

<div class="sb {cls}" class:tentative={isIntent} title={block.id}>
  <ActionBadge action={block.action} />
  <span class="lbl">{block.id.slice(0, 8)}</span>
  {#if block.resourceQuantity}<MeasureDisplay measure={block.resourceQuantity} />{/if}
</div>

<style>
  .sb {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }
  .tentative { opacity: 0.6; }
  .lbl { font-family: var(--font-mono); }
</style>
