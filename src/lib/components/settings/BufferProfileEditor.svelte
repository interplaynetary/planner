<script lang="ts">
  import type { BufferProfile } from '$lib/schemas';
  import { LTF_RANGES, VF_RANGES, deriveVariabilityFactor } from '$lib/algorithms/ddmrp';

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
  let leadTimeCategory = $state<'short' | 'medium' | 'long' | undefined>(undefined);
  let variabilityCategory = $state<'low' | 'medium' | 'high' | undefined>(undefined);
  let vrd = $state<'low' | 'medium' | 'high' | undefined>(undefined);
  let vrs = $state<'low' | 'medium' | 'high' | undefined>(undefined);

  // Auto-derive code from itemType + leadTimeCategory + variabilityCategory
  const derivedCode = $derived.by(() => {
    if (!leadTimeCategory || !variabilityCategory) return undefined;
    return `${itemType[0]}${leadTimeCategory[0].toUpperCase()}${variabilityCategory[0].toUpperCase()}`;
  });

  // Auto-derive VF from vrd+vrs when both set
  $effect(() => {
    if (vrd && vrs) {
      variabilityFactor = deriveVariabilityFactor(vrd, vrs);
    }
  });

  // LTF hint range
  const ltfHint = $derived(leadTimeCategory ? LTF_RANGES[leadTimeCategory] : null);
  const vfHint = $derived(variabilityCategory ? VF_RANGES[variabilityCategory] : null);

  function selectProfile(p: BufferProfile) {
    selected = p;
    name = p.name;
    itemType = p.itemType;
    leadTimeFactor = p.leadTimeFactor;
    variabilityFactor = p.variabilityFactor;
    orderCycleDays = p.orderCycleDays;
    ostMultiplier = p.ostMultiplier;
    recalculationCadence = p.recalculationCadence;
    leadTimeCategory = p.leadTimeCategory;
    variabilityCategory = p.variabilityCategory;
    vrd = p.vrd;
    vrs = p.vrs;
  }

  function save() {
    const p: BufferProfile = {
      id: selected?.id ?? crypto.randomUUID(),
      name, itemType, leadTimeFactor, variabilityFactor,
      orderCycleDays, ostMultiplier, recalculationCadence,
      leadTimeCategory, variabilityCategory,
      vrd, vrs,
      code: derivedCode,
    };
    onupsert?.(p);
    selected = null;
  }
</script>

<div class="bpe {cls}">
  <div class="list">
    {#each profiles as p}
      <button class="prof" class:active={selected?.id === p.id} onclick={() => selectProfile(p)}>
        {#if p.code}<span class="code">{p.code}</span>{/if}
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
        <option>Purchased</option><option>Manufactured</option><option>Intermediate</option><option>Distributed</option>
      </select>
    </div>
    <div class="row">
      <label for="bp-ltcat">LT band</label>
      <select id="bp-ltcat" bind:value={leadTimeCategory}>
        <option value="">—</option>
        <option value="short">short (61–100%)</option>
        <option value="medium">medium (41–60%)</option>
        <option value="long">long (20–40%)</option>
      </select>
    </div>
    <div class="row">
      <label for="bp-ltf">LTF</label>
      <input id="bp-ltf" type="number" bind:value={leadTimeFactor} step="0.01" min="0" />
      {#if ltfHint}<span class="hint">[{ltfHint[0]}–{ltfHint[1]}]</span>{/if}
    </div>
    <div class="row">
      <label for="bp-vcat">Var band</label>
      <select id="bp-vcat" bind:value={variabilityCategory}>
        <option value="">—</option>
        <option value="low">low (0–40%)</option>
        <option value="medium">medium (41–60%)</option>
        <option value="high">high (61%+)</option>
      </select>
    </div>
    <div class="row">
      <label for="bp-vrd" aria-label="Variable Rate of Demand">VRD</label>
      <select id="bp-vrd" bind:value={vrd}>
        <option value="">—</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      <label for="bp-vrs" aria-label="Variable Rate of Supply">VRS</label>
      <select id="bp-vrs" bind:value={vrs}>
        <option value="">—</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
    </div>
    <div class="row">
      <label for="bp-vf">VF</label>
      <input id="bp-vf" type="number" bind:value={variabilityFactor} step="0.01" min="0" />
      {#if vfHint}<span class="hint">[{vfHint[0]}–{vfHint[1] === Infinity ? '∞' : vfHint[1]}]</span>{/if}
    </div>
    {#if derivedCode}
      <div class="row code-row"><label>code</label><span class="code-badge">{derivedCode}</span></div>
    {/if}
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
  .list { display: flex; flex-direction: column; gap: 2px; min-width: 140px; }
  .prof { text-align: left; font-size: var(--text-xs); cursor: pointer; border: none; background: none; padding: 2px 4px; color: #e2e8f0; }
  .prof.active { color: var(--zone-green); }
  .form { display: flex; flex-direction: column; gap: var(--gap-sm); }
  .row { display: flex; align-items: center; gap: var(--gap-sm); }
  label { opacity: var(--muted); min-width: 52px; }
  input, select { font-size: var(--text-xs); font-family: var(--font-mono); }
  .hint { opacity: 0.4; font-family: var(--font-mono); font-size: 0.65rem; }
  .code { font-family: var(--font-mono); font-size: 0.65rem; opacity: 0.6; margin-right: 2px; }
  .code-badge {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 1px 6px;
    background: rgba(79,209,197,0.15);
    color: #4fd1c5;
    border-radius: 3px;
    font-weight: 700;
  }
</style>
