<script lang="ts">
  import type { Intent } from '$lib/schemas';
  import ActionBadge from '$lib/components/vf/ActionBadge.svelte';
  import MeasureDisplay from '$lib/components/vf/MeasureDisplay.svelte';

  interface Props {
    intent: Intent;
    specName?: string;
    class?: string;
  }

  let { intent, specName, class: cls = '' }: Props = $props();

  const agent = $derived(intent.provider ?? intent.receiver);
  const agentLabel = $derived(intent.provider ? 'provider' : 'receiver');
</script>

<div class="id {cls}">
  <div class="row"><ActionBadge action={intent.action} />{#if specName}<span class="muted">{specName}</span>{/if}</div>
  <div class="row">
    {#if intent.resourceQuantity}<MeasureDisplay measure={intent.resourceQuantity} />{/if}
    {#if intent.effortQuantity}<span class="muted"><MeasureDisplay measure={intent.effortQuantity} /></span>{/if}
  </div>
  <div class="row">
    <span class="muted">due: {intent.due?.slice(0, 10) ?? '—'}</span>
    <span class="muted">finished: {intent.finished ? '✓' : '✗'}</span>
  </div>
  {#if agent}<div class="row"><span class="muted">{agentLabel}: {agent}</span></div>{/if}
  <div class="row">
    {#if intent.availableQuantity}
      <span class="avail">avail: <MeasureDisplay measure={intent.availableQuantity} /></span>
    {/if}
    {#if intent.minimumQuantity}
      <span class="muted">min: <MeasureDisplay measure={intent.minimumQuantity} /></span>
    {/if}
  </div>
  {#if intent.availability_window}<span class="muted">recurring</span>{/if}
</div>

<style>
  .id { display: flex; flex-direction: column; gap: 3px; font-size: var(--text-xs); }
  .row { display: flex; align-items: center; gap: var(--gap-sm); flex-wrap: wrap; }
  .muted { opacity: var(--muted); }
  .avail { color: var(--zone-green); }
</style>
