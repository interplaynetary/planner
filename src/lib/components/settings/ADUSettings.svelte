<script lang="ts">
  import type { BufferZone } from '$lib/schemas';

  interface Props {
    zones: BufferZone[];
    onupdate?: (id: string, patch: Partial<BufferZone>) => void;
    class?: string;
  }

  let { zones, onupdate, class: cls = '' }: Props = $props();
</script>

<div class="adus {cls}">
  <div class="header row">
    <span>spec</span><span>window (days)</span><span>blend ratio</span><span>last computed</span>
  </div>
  {#each zones as z}
    <div class="row">
      <span class="mono">{z.specId.slice(0, 12)}</span>
      <input
        type="number"
        value={z.aduWindowDays ?? ''}
        min="1" step="1"
        onchange={e => onupdate?.(z.id, { aduWindowDays: Number(e.currentTarget.value) })}
      />
      <input
        type="range" min="0" max="1" step="0.05"
        value={z.aduBlendRatio ?? 0.5}
        onchange={e => onupdate?.(z.id, { aduBlendRatio: Number(e.currentTarget.value) })}
      />
      <span class="muted">{z.lastComputedAt?.slice(0, 10) ?? '—'}</span>
    </div>
  {/each}
</div>

<style>
  .adus { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .header { opacity: var(--muted); }
  .mono { font-family: var(--font-mono); min-width: 96px; }
  input[type="number"] { width: 60px; font-size: var(--text-xs); font-family: var(--font-mono); }
  .muted { opacity: var(--muted); }
</style>
