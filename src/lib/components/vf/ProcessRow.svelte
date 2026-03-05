<script lang="ts">
  import type { Process } from '$lib/schemas';

  interface Props {
    process: Process;
    specName?: string;
    class?: string;
  }

  let { process, specName, class: cls = '' }: Props = $props();

  const status = $derived(
    process.finished ? 'done' : process.hasBeginning ? 'active' : 'planned'
  );

  const window = $derived(
    process.hasBeginning && process.hasEnd
      ? `${process.hasBeginning.slice(0, 10)} – ${process.hasEnd.slice(0, 10)}`
      : null
  );
</script>

<div class="pr {cls}">
  <span class="icon {status}">▷</span>
  <span>{process.name}</span>
  {#if specName}<span class="muted">{specName}</span>{/if}
  {#if window}<span class="muted">{window}</span>{/if}
  {#if process.finished}<span class="done">✓</span>{/if}
</div>

<style>
  .pr {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }
  .muted { opacity: var(--muted); }
  .icon.planned { opacity: var(--muted); }
  .icon.active  { color: var(--zone-yellow); }
  .icon.done    { color: var(--zone-green); }
  .done { color: var(--zone-green); }
</style>
