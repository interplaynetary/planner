<script lang="ts">
  import type { Commitment } from '$lib/schemas';
  import ActionBadge from '$lib/components/vf/ActionBadge.svelte';
  import MeasureDisplay from '$lib/components/vf/MeasureDisplay.svelte';

  interface Props {
    commitment: Commitment;
    specName?: string;
    class?: string;
  }

  let { commitment, specName, class: cls = '' }: Props = $props();
</script>

<div class="cd {cls}">
  <div class="row"><ActionBadge action={commitment.action} />{#if specName}<span class="muted">{specName}</span>{/if}</div>
  <div class="row">
    {#if commitment.resourceQuantity}<MeasureDisplay measure={commitment.resourceQuantity} />{/if}
    {#if commitment.effortQuantity}<span class="muted"><MeasureDisplay measure={commitment.effortQuantity} /></span>{/if}
  </div>
  <div class="row">
    <span class="muted">due: {commitment.due?.slice(0, 10) ?? '—'}</span>
    <span class="muted">finished: {commitment.finished ? '✓' : '✗'}</span>
  </div>
  <div class="row">
    {#if commitment.provider}<span class="muted">provider: {commitment.provider}</span>{/if}
    {#if commitment.receiver}<span class="muted">receiver: {commitment.receiver}</span>{/if}
  </div>
  <div class="row">
    {#if commitment.plannedWithin}<span class="muted">plan: {commitment.plannedWithin}</span>{/if}
    {#if commitment.inputOf ?? commitment.outputOf}
      <span class="muted">process: {commitment.inputOf ?? commitment.outputOf}</span>
    {/if}
  </div>
  {#if commitment.clauseOf}<span class="muted">agreement: {commitment.clauseOf}</span>{/if}
</div>

<style>
  .cd { display: flex; flex-direction: column; gap: 3px; font-size: var(--text-xs); }
  .row { display: flex; align-items: center; gap: var(--gap-sm); flex-wrap: wrap; }
  .muted { opacity: var(--muted); }
</style>
