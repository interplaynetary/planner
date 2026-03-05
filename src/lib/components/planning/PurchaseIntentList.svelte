<script lang="ts">
  import type { Intent } from '$lib/schemas';
  import MeasureDisplay from '$lib/components/vf/MeasureDisplay.svelte';
  import ActionBadge from '$lib/components/vf/ActionBadge.svelte';

  interface Props {
    intents: Intent[];
    specNames?: Map<string, string>;
    class?: string;
  }

  let { intents, specNames, class: cls = '' }: Props = $props();
</script>

<div class="pil {cls}">
  <div class="header row">
    <span>spec</span><span>qty</span><span>due</span><span>provider</span>
  </div>
  {#each intents as i}
    <div class="row">
      <span>{specNames?.get(i.resourceConformsTo ?? '') ?? i.resourceConformsTo?.slice(0, 12) ?? '—'}</span>
      {#if i.resourceQuantity}<MeasureDisplay measure={i.resourceQuantity} />{/if}
      <span class="muted">{i.due?.slice(0, 10) ?? '—'}</span>
      <span class="muted">{i.provider ?? '—'}</span>
    </div>
  {/each}
</div>

<style>
  .pil { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .header { opacity: var(--muted); }
  .muted { opacity: var(--muted); }
</style>
