<script lang="ts">
  import type { BufferProfile } from '$lib/schemas';

  interface Props {
    profiles: BufferProfile[];
    onupsert?: (p: BufferProfile) => void;
    class?: string;
  }

  let { profiles, onupsert, class: cls = '' }: Props = $props();

  let selected = $state<BufferProfile | null>(null);
  let name = $state('');
  let itemType = $state<'Purchased' | 'Manufactured' | 'Intermediate' | 'Distributed'>('Purchased');
  let leadTimeFactor = $state(1.0);
  let variabilityFactor = $state(0.5);
  let orderCycleDays = $state<number | undefined>(undefined);
  let ostMultiplier = $state<number | undefined>(undefined);
  let recalculationCadence = $state<'daily' | 'weekly' | 'monthly' | undefined>(undefined);

  function selectProfile(p: BufferProfile) {
    selected = p;
    name = p.name;
    itemType = p.itemType;
    leadTimeFactor = p.leadTimeFactor;
    variabilityFactor = p.variabilityFactor;
    orderCycleDays = p.orderCycleDays;
    ostMultiplier = p.ostMultiplier;
    recalculationCadence = p.recalculationCadence;
  }

  function save() {
    const p: BufferProfile = {
      id: selected?.id ?? crypto.randomUUID(),
      name, itemType, leadTimeFactor, variabilityFactor,
      orderCycleDays, ostMultiplier, recalculationCadence,
    };
    onupsert?.(p);
    selected = null;
  }
</script>

<div class="bpe {cls}">
  <div class="list">
    {#each profiles as p}
      <button class="prof" class:active={selected?.id === p.id} onclick={() => selectProfile(p)}>
        {p.name}
      </button>
    {/each}
    <button class="prof new" onclick={() => { selected = null; name = ''; }}>+ new</button>
  </div>
  <div class="form">
    <div class="row"><label for="bp-name">name</label><input id="bp-name" bind:value={name} /></div>
    <div class="row">
      <label for="bp-type">type</label>
      <select id="bp-type" bind:value={itemType}>
        <option>Purchased</option><option>Manufactured</option><option>Intermediate</option>
      </select>
    </div>
    <div class="row"><label for="bp-ltf">LTF</label><input id="bp-ltf" type="number" bind:value={leadTimeFactor} step="0.1" min="0" /></div>
    <div class="row"><label for="bp-vf">VF</label><input id="bp-vf" type="number" bind:value={variabilityFactor} step="0.1" min="0" /></div>
    <div class="row"><label for="bp-ocd">OCD</label><input id="bp-ocd" type="number" bind:value={orderCycleDays} step="1" min="0" /></div>
    <div class="row"><label for="bp-ost">OST×</label><input id="bp-ost" type="number" bind:value={ostMultiplier} step="0.1" min="0" /></div>
    <div class="row">
      <label for="bp-cad">cadence</label>
      <select id="bp-cad" bind:value={recalculationCadence}>
        <option value="">—</option>
        <option value="daily">daily</option>
        <option value="weekly">weekly</option>
        <option value="monthly">monthly</option>
      </select>
    </div>
    <button onclick={save}>Save</button>
  </div>
</div>

<style>
  .bpe { display: flex; gap: var(--gap-sm); font-size: var(--text-xs); }
  .list { display: flex; flex-direction: column; gap: 2px; min-width: 120px; }
  .prof { text-align: left; font-size: var(--text-xs); cursor: pointer; border: none; background: none; padding: 2px 4px; }
  .prof.active { color: var(--zone-green); }
  .form { display: flex; flex-direction: column; gap: var(--gap-sm); }
  .row { display: flex; align-items: center; gap: var(--gap-sm); }
  label { opacity: var(--muted); min-width: 48px; }
  input, select { font-size: var(--text-xs); font-family: var(--font-mono); }
</style>
