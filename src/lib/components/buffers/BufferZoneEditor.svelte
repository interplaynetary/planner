<script lang="ts">
  import type { BufferZone, BufferProfile } from '$lib/schemas';
  import { computeBufferZone } from '$lib/algorithms/ddmrp';

  interface Props {
    zone: BufferZone;
    profile: BufferProfile;
    onchange?: (z: Partial<BufferZone>) => void;
    class?: string;
  }

  let { zone, profile, onchange, class: cls = '' }: Props = $props();

  let adu = $state(zone.adu);
  let dlt = $state(zone.dltDays);
  let moq = $state(zone.moq);

  const preview = $derived(
    computeBufferZone(profile, adu, zone.aduUnit, dlt, moq, zone.moqUnit)
  );

  function apply() {
    onchange?.({
      adu,
      dltDays: dlt,
      moq,
      tor: preview.tor,
      toy: preview.toy,
      tog: preview.tog,
    });
  }
</script>

<div class="bze {cls}">
  <div class="row">
    <label>ADU</label>
    <input type="number" bind:value={adu} min="0" step="0.1" />
  </div>
  <div class="row">
    <label>DLT</label>
    <input type="number" bind:value={dlt} min="0" step="1" /><span class="muted">d</span>
  </div>
  <div class="row">
    <label>MOQ</label>
    <input type="number" bind:value={moq} min="0" step="1" />
  </div>
  <div class="preview mono">
    TOR {preview.tor.toFixed(1)} · TOY {preview.toy.toFixed(1)} · TOG {preview.tog.toFixed(1)}
  </div>
  <button onclick={apply}>Apply</button>
</div>

<style>
  .bze { display: flex; flex-direction: column; gap: var(--gap-sm); }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  label { opacity: var(--muted); min-width: 36px; }
  input { font-family: var(--font-mono); font-size: var(--text-xs); width: 72px; }
  .preview { font-size: var(--text-xs); opacity: var(--muted); }
  .mono { font-family: var(--font-mono); }
  .muted { opacity: var(--muted); }
</style>
