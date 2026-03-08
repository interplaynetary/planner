<script lang="ts">
  import type { BufferZone } from '$lib/schemas';

  interface Props {
    zones: BufferZone[];
    onupdate?: (id: string, patch: Partial<BufferZone>) => void;
    class?: string;
  }

  let { zones, onupdate, class: cls = '' }: Props = $props();

  function bootstrapLabel(z: BufferZone): string {
    if (z.estimatedADU === undefined || z.estimatedADU <= 0) return '—';
    const window = z.aduWindowDays ?? 84;
    const days = z.bootstrapDaysAccumulated ?? 0;
    if (days >= window) return '✓ complete';
    return `${days}/${window}d`;
  }

  function bootstrapPct(z: BufferZone): number {
    const window = z.aduWindowDays ?? 84;
    const days = z.bootstrapDaysAccumulated ?? 0;
    return Math.min(1, days / window);
  }

  function isBootstrapActive(z: BufferZone): boolean {
    return z.estimatedADU !== undefined && z.estimatedADU > 0;
  }

  function isBootstrapComplete(z: BufferZone): boolean {
    const window = z.aduWindowDays ?? 84;
    return (z.bootstrapDaysAccumulated ?? 0) >= window;
  }
</script>

<div class="adus {cls}">
  <div class="header row">
    <span>spec</span><span>window (days)</span><span>blend ratio</span><span>est. ADU</span><span>bootstrap</span><span>last computed</span>
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
      <input
        type="number"
        class="est-adu"
        value={z.estimatedADU ?? ''}
        min="0" step="0.01"
        placeholder="—"
        onchange={e => {
          const v = Number(e.currentTarget.value);
          onupdate?.(z.id, { estimatedADU: v > 0 ? v : undefined, bootstrapDaysAccumulated: 0 });
        }}
      />
      <span class="bootstrap-status" class:complete={isBootstrapComplete(z)} class:muted={!isBootstrapActive(z)}>
        {#if isBootstrapActive(z) && !isBootstrapComplete(z)}
          <progress value={bootstrapPct(z)} max="1"></progress>
        {/if}
        {bootstrapLabel(z)}
      </span>
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
  .est-adu { width: 56px; }
  .muted { opacity: var(--muted); }
  .bootstrap-status {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    min-width: 80px;
  }
  .bootstrap-status.complete { color: #68d391; }
  progress { width: 36px; height: 4px; }
</style>
