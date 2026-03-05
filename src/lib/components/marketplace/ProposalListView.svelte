<script lang="ts">
  import type { Proposal } from '$lib/schemas';

  interface Props {
    proposals: Proposal[];
    specNames?: Map<string, string>;
    onaccept?: (id: string) => void;
    class?: string;
  }

  let { proposals, specNames, onaccept, class: cls = '' }: Props = $props();

  function purposeColor(purpose: string | undefined): string {
    return purpose === 'offer' ? 'green' : purpose === 'request' ? 'yellow' : 'other';
  }
</script>

<div class="plv {cls}">
  {#each proposals as p}
    <div class="row">
      <span class="badge {purposeColor(p.purpose)}">{p.purpose ?? '—'}</span>
      {#if p.name}<span>{p.name}</span>{/if}
      <span class="muted">{p.publishes?.length ?? 0} intents</span>
      {#if p.hasBeginning || p.hasEnd}
        <span class="muted">
          {p.hasBeginning?.slice(0, 10) ?? ''}
          {#if p.hasBeginning && p.hasEnd}→{/if}
          {p.hasEnd?.slice(0, 10) ?? ''}
        </span>
      {/if}
      {#if onaccept}
        <button onclick={() => onaccept(p.id)}>Accept</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .plv { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .badge { font-size: var(--text-xs); font-family: var(--font-mono); font-weight: 600; text-transform: uppercase; }
  .badge.green  { color: var(--zone-green); }
  .badge.yellow { color: var(--zone-yellow); }
  .badge.other  { opacity: var(--muted); }
  .muted { opacity: var(--muted); }
  button { font-size: var(--text-xs); cursor: pointer; }
</style>
