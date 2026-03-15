<script lang="ts">
  import type { ResourceSpecification, BufferZone, DemandAdjustmentFactor } from '$lib/schemas';
  import { cascadeComponentDAF } from '$lib/algorithms/ddmrp';

  interface ParentContribution {
    parentSpec: ResourceSpecification;
    parentBufferZone: BufferZone;
    parentDAF: number;
    usageQty: number;
  }

  interface Props {
    componentSpec: ResourceSpecification;
    componentBufferZone: BufferZone;
    parentContributions: ParentContribution[];
    onupsert?: (f: DemandAdjustmentFactor) => void;
  }

  let { componentSpec, componentBufferZone, parentContributions, onupsert }: Props = $props();

  const computedDAF = $derived(
    cascadeComponentDAF(
      componentBufferZone.adu,
      parentContributions.map(p => ({
        parentAdjustedADU: p.parentBufferZone.adu * p.parentDAF,
        usageQty: p.usageQty,
      })),
    )
  );

  function fmt(n: number): string { return n.toFixed(2); }

  let validFrom = $state('');
  let validTo   = $state('');

  function apply() {
    if (!validFrom || !validTo) return;
    onupsert?.({
      id: crypto.randomUUID(),
      specId: componentSpec.id,
      type: 'demand',
      factor: computedDAF,
      validFrom,
      validTo,
    });
    validFrom = ''; validTo = '';
  }
</script>

<div class="ccp">
  <div class="header">Component DAF Cascade — {componentSpec.name}</div>
  <table>
    <thead>
      <tr>
        <th>Parent</th>
        <th>Base ADU</th>
        <th>DAF</th>
        <th>Adj. ADU</th>
        <th>Qty/Unit</th>
        <th>Contribution</th>
      </tr>
    </thead>
    <tbody>
      {#each parentContributions as p}
        {@const adjADU   = p.parentBufferZone.adu * p.parentDAF}
        {@const contrib  = adjADU * p.usageQty}
        <tr>
          <td>{p.parentSpec.name}</td>
          <td class="num">{fmt(p.parentBufferZone.adu)}</td>
          <td class="num">×{fmt(p.parentDAF)}</td>
          <td class="num adj">{fmt(adjADU)}</td>
          <td class="num">{p.usageQty}</td>
          <td class="num contrib">{fmt(contrib)}</td>
        </tr>
      {/each}
      <tr class="total">
        <td><strong>{componentSpec.name}</strong></td>
        <td class="num">{fmt(componentBufferZone.adu)}</td>
        <td class="num result">→ ×{fmt(computedDAF)}</td>
        <td class="num adj">{fmt(componentBufferZone.adu * computedDAF)}</td>
        <td></td>
        <td></td>
      </tr>
    </tbody>
  </table>

  {#if onupsert}
    <div class="apply-row">
      <label>from</label><input type="date" bind:value={validFrom} />
      <label>to</label><input type="date" bind:value={validTo} />
      <button onclick={apply}>Apply DAF ×{fmt(computedDAF)}</button>
    </div>
  {/if}
</div>

<style>
  .ccp { display: flex; flex-direction: column; gap: 6px; font-size: var(--text-xs); }
  .header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.4;
    padding-bottom: var(--gap-xs);
    border-bottom: 1px solid var(--border-faint);
  }
  table { border-collapse: collapse; font-family: var(--font-mono); width: 100%; }
  th {
    text-align: left;
    opacity: 0.35;
    font-weight: 400;
    padding: 2px 6px;
    border-bottom: 1px solid var(--border-faint);
  }
  td { padding: 2px 6px; }
  .num { text-align: right; }
  .adj    { color: var(--zone-yellow); }
  .contrib { color: rgba(226,232,240,0.7); }
  .result { color: var(--zone-green); font-weight: 700; }
  .total td { border-top: 1px solid rgba(255,255,255,0.1); font-weight: 600; }
  .apply-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    margin-top: 4px;
  }
  label { opacity: var(--muted); }
  input, button { font-size: var(--text-xs); font-family: var(--font-mono); }
  button {
    padding: 2px 8px;
    background: var(--bg-overlay);
    border: 1px solid var(--border-dim);
    color: #e2e8f0;
    cursor: pointer;
    border-radius: 3px;
  }
  button:hover { background: var(--bg-elevated); }
</style>
