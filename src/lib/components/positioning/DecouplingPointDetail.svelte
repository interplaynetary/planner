<script lang="ts">
  import type { BufferZone, BufferProfile } from '$lib/schemas';
  import type { DecouplingTestResult } from '$lib/algorithms/positioning';
  import type { BufferZoneComputation } from '$lib/algorithms/ddmrp';
  import ZoneBadge from '$lib/components/ui/ZoneBadge.svelte';

  interface Props {
    bufferZone: BufferZone;
    profile: BufferProfile;
    testResult?: DecouplingTestResult;
    comp?: BufferZoneComputation;
    class?: string;
  }

  let { bufferZone, profile, testResult, comp, class: cls = '' }: Props = $props();

  const tests = $derived(testResult ? [
    { key: 'decouplesHorizon',            label: 'Decouples horizon',          pass: testResult.decouplesHorizon },
    { key: 'biDirectionalBenefit',        label: 'Bi-directional benefit',     pass: testResult.biDirectionalBenefit },
    { key: 'orderIndependence',           label: 'Order independence',         pass: testResult.orderIndependence },
    { key: 'isPrimaryPlanningMechanism',  label: 'Primary planning mechanism', pass: testResult.isPrimaryPlanningMechanism },
    { key: 'relativePriorityMet',         label: 'Relative priority met',      pass: testResult.relativePriorityMet },
    { key: 'dynamicAdjustmentReady',      label: 'Dynamic adjustment ready',   pass: testResult.dynamicAdjustmentReady },
  ] : []);
</script>

<div class="dpd {cls}">
  <div class="row mono">
    <span>ADU {bufferZone.adu} {bufferZone.aduUnit}</span>
    <span class="muted">DLT {bufferZone.dltDays}d</span>
  </div>
  <div class="row mono">
    <span>TOR {bufferZone.tor.toFixed(1)}</span>
    <span>TOY {bufferZone.toy.toFixed(1)}</span>
    <span>TOG {bufferZone.tog.toFixed(1)}</span>
  </div>
  {#if comp}
    <div class="row mono muted">
      <span>redBase={comp.redBase.toFixed(1)}</span>
      <span>redSafety={comp.redSafety.toFixed(1)}</span>
    </div>
  {/if}
  {#if testResult}
    <ul class="tests">
      {#each tests as t}
        <li class:pass={t.pass} class:fail={!t.pass}>
          <span class="icon">{t.pass ? '✓' : '✗'}</span>
          <span>{t.label}</span>
        </li>
      {/each}
    </ul>
    <span class="summary">{testResult.testsPassed}/6 tests passed</span>
  {/if}
</div>

<style>
  .dpd { display: flex; flex-direction: column; gap: var(--gap-sm); font-size: var(--text-xs); }
  .row { display: flex; gap: var(--gap-sm); }
  .mono { font-family: var(--font-mono); }
  .muted { opacity: var(--muted); }
  .tests { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  li { display: flex; align-items: center; gap: 4px; }
  .pass .icon { color: var(--zone-green); }
  .fail .icon { color: var(--zone-red); }
  .summary { font-family: var(--font-mono); opacity: var(--muted); }
</style>
