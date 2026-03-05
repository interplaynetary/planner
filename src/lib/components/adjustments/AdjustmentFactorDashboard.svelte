<script lang="ts">
  import type { DemandAdjustmentFactor } from '$lib/schemas';

  interface Props {
    factors: DemandAdjustmentFactor[];
    specNames?: Map<string, string>;
    today?: Date;
    class?: string;
  }

  let { factors, specNames, today = new Date(), class: cls = '' }: Props = $props();

  const todayStr = $derived(today.toISOString().slice(0, 10));

  const activeFactors = $derived(
    factors.filter(f => f.validFrom <= todayStr && f.validTo >= todayStr)
  );

  function typeColor(type: string): string {
    switch (type) {
      case 'demand':   return 'green';
      case 'zone':     return 'excess';
      case 'leadTime': return 'yellow';
      default:         return 'other';
    }
  }
</script>

<div class="afd {cls}">
  {#each activeFactors as f}
    <div class="row">
      <span class="badge {typeColor(f.type)}">{f.type}</span>
      <span>{specNames?.get(f.specId) ?? f.specId.slice(0, 12)}</span>
      <span class="val">{f.factor}</span>
      <span class="muted">{f.validFrom}→{f.validTo}</span>
      {#if f.atLocation}<span class="muted">{f.atLocation}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .afd { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .badge { font-size: var(--text-xs); font-family: var(--font-mono); font-weight: 600; text-transform: uppercase; }
  .badge.green   { color: var(--zone-green); }
  .badge.excess  { color: var(--zone-excess); }
  .badge.yellow  { color: var(--zone-yellow); }
  .badge.other   { opacity: var(--muted); }
  .val { font-family: var(--font-mono); font-weight: 700; }
  .muted { opacity: var(--muted); }
</style>
