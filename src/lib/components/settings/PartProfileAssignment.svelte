<script lang="ts">
  import type { ResourceSpecification, BufferProfile } from '$lib/schemas';

  interface Props {
    specs: ResourceSpecification[];
    profiles: BufferProfile[];
    onassign?: (specId: string, profileId: string) => void;
    class?: string;
  }

  let { specs, profiles, onassign, class: cls = '' }: Props = $props();

  const profileMap = $derived(new Map(profiles.map(p => [p.id, p])));
</script>

<div class="ppa {cls}">
  {#each specs as s}
    <div class="row">
      <span class="name">{s.name}</span>
      <select
        value={s.bufferProfileId ?? ''}
        onchange={e => onassign?.(s.id, e.currentTarget.value)}
      >
        <option value="">— none —</option>
        {#each profiles as p}
          <option value={p.id} selected={p.id === s.bufferProfileId}>{p.name}</option>
        {/each}
      </select>
      {#if s.bufferProfileId}
        <span class="muted">{profileMap.get(s.bufferProfileId)?.name ?? ''}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .ppa { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .name { min-width: 120px; }
  select { font-size: var(--text-xs); font-family: var(--font-mono); }
  .muted { opacity: var(--muted); }
</style>
