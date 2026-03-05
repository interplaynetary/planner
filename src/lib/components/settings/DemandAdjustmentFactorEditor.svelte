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

  function add() {
    if (!specId || !validFrom || !validTo) return;
    onupsert?.({
      id: crypto.randomUUID(),
      specId, type, factor, validFrom, validTo,
      atLocation: atLocation || undefined,
    });
    specId = ''; factor = 1.0; validFrom = ''; validTo = '';
  }
</script>

<div class="dafe {cls}">
  <div class="list">
    {#each factors as f}
      <div class="row">
        <span class="mono">{f.type}</span>
        <span>{specs.find(s => s.id === f.specId)?.name ?? f.specId.slice(0, 8)}</span>
        <span class="mono bold">{f.factor}</span>
        <span class="muted">{f.validFrom} → {f.validTo}</span>
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
  .row { display: flex; align-items: center; gap: var(--gap-sm); }
  label { opacity: var(--muted); min-width: 40px; }
  input, select { font-size: var(--text-xs); font-family: var(--font-mono); }
  .mono { font-family: var(--font-mono); }
  .bold { font-weight: 700; }
  .muted { opacity: var(--muted); }
</style>
