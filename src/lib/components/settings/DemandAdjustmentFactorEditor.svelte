<script lang="ts">
  import type { DemandAdjustmentFactor, ResourceSpecification } from '$lib/schemas';

  interface Props {
    factors: DemandAdjustmentFactor[];
    specs: ResourceSpecification[];
    onupsert?: (f: DemandAdjustmentFactor) => void;
    class?: string;
  }

  let { factors, specs, onupsert, class: cls = '' }: Props = $props();

  let specId = $state('');
  let type = $state<'demand' | 'zone' | 'leadTime'>('demand');
  let factor = $state(1.0);
  let validFrom = $state('');
  let validTo = $state('');
  let atLocation = $state('');
  let targetZone = $state<'green' | 'yellow' | 'red' | ''>('');
  let supplyOffsetDays = $state(0);

  const ZONE_RATIONALE: Record<'green' | 'yellow' | 'red', string> = {
    green:  'Adjusts order size / frequency. Increase when setup costs dominate.',
    yellow: 'Adjusts coverage window. Use for short promos or supply disruptions.',
    red:    'Adjusts embedded safety. Use for temporary volatility.',
  };

  function add() {
    if (!specId || !validFrom || !validTo) return;
    const f: DemandAdjustmentFactor = {
      id: crypto.randomUUID(),
      specId, type, factor, validFrom, validTo,
      atLocation: atLocation || undefined,
    };
    if (type === 'zone' && targetZone) f.targetZone = targetZone;
    if (type === 'demand' && supplyOffsetDays > 0) f.supplyOffsetDays = supplyOffsetDays;
    onupsert?.(f);
    specId = ''; factor = 1.0; validFrom = ''; validTo = '';
    targetZone = ''; supplyOffsetDays = 0;
  }

  function typeLabel(f: DemandAdjustmentFactor): string {
    if (f.type === 'zone' && f.targetZone) return `zone/${f.targetZone}`;
    return f.type;
  }
</script>

<div class="dafe {cls}">
  <div class="list">
    {#each factors as f}
      <div class="row">
        <span class="mono">{typeLabel(f)}</span>
        <span>{specs.find(s => s.id === f.specId)?.name ?? f.specId.slice(0, 8)}</span>
        <span class="mono bold">×{f.factor}</span>
        <span class="muted">{f.validFrom} → {f.validTo}</span>
        {#if f.supplyOffsetDays}
          <span class="muted">+{f.supplyOffsetDays}d offset</span>
        {/if}
      </div>
    {/each}
  </div>
  <div class="form">
    <div class="row">
      <label>spec</label>
      <select bind:value={specId}>
        <option value="">— select —</option>
        {#each specs as s}<option value={s.id}>{s.name}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label>type</label>
      <select bind:value={type}>
        <option value="demand">demand</option>
        <option value="zone">zone</option>
        <option value="leadTime">leadTime</option>
      </select>
    </div>

    {#if type === 'zone'}
      <div class="zone-target">
        <label class="zone-label">zone target</label>
        <div class="toggle-group">
          {#each (['green', 'yellow', 'red'] as const) as z}
            <button
              type="button"
              class="toggle {z}"
              class:active={targetZone === z}
              onclick={() => { targetZone = targetZone === z ? '' : z; }}
            >{z}</button>
          {/each}
        </div>
        {#if targetZone}
          <span class="rationale">{ZONE_RATIONALE[targetZone]}</span>
        {:else}
          <span class="rationale muted">No selection → legacy red (backward compat)</span>
        {/if}
      </div>
    {/if}

    {#if type === 'demand'}
      <div class="row">
        <label>offset</label>
        <input type="number" bind:value={supplyOffsetDays} min="0" step="1" placeholder="0" />
        <span class="muted">days (supply pre-positioning)</span>
      </div>
    {/if}

    <div class="row"><label>factor</label><input type="number" bind:value={factor} step="0.01" min="0" /></div>
    <div class="row"><label>from</label><input type="date" bind:value={validFrom} /></div>
    <div class="row"><label>to</label><input type="date" bind:value={validTo} /></div>
    <div class="row"><label>loc</label><input bind:value={atLocation} placeholder="optional" /></div>
    <button onclick={add}>Add</button>
  </div>
</div>

<style>
  .dafe { display: flex; flex-direction: column; gap: var(--gap-sm); font-size: var(--text-xs); }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .form { display: flex; flex-direction: column; gap: 4px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); flex-wrap: wrap; }
  label { opacity: var(--muted); min-width: 40px; }
  input, select { font-size: var(--text-xs); font-family: var(--font-mono); }
  .mono { font-family: var(--font-mono); }
  .bold { font-weight: 700; }
  .muted { opacity: var(--muted); }

  .zone-target {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    background: rgba(255,255,255,0.02);
  }
  .zone-label { opacity: var(--muted); font-size: var(--text-xs); }
  .toggle-group { display: flex; gap: 4px; }
  .toggle {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 8px;
    border: 1px solid var(--border-dim);
    background: var(--bg-overlay);
    color: #e2e8f0;
    cursor: pointer;
    border-radius: 3px;
    opacity: 0.6;
  }
  .toggle.active { opacity: 1; font-weight: 700; }
  .toggle.green.active  { border-color: var(--zone-green); color: var(--zone-green); }
  .toggle.yellow.active { border-color: var(--zone-yellow); color: var(--zone-yellow); }
  .toggle.red.active    { border-color: var(--zone-red); color: var(--zone-red); }
  .rationale { font-size: 0.65rem; opacity: 0.5; font-style: italic; }
</style>
