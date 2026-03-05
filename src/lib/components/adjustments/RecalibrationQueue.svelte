<script lang="ts">
  import type { BufferZone, BufferProfile } from '$lib/schemas';

  interface Props {
    zones: BufferZone[];
    profileMap: Map<string, BufferProfile>;
    today?: Date;
    onrecalibrate?: (zoneId: string) => void;
    class?: string;
  }

  let { zones, profileMap, today = new Date(), onrecalibrate, class: cls = '' }: Props = $props();

  const asOfMs = $derived(today.getTime());

  const due = $derived(zones.filter(z => {
    const lastMs = new Date(z.lastComputedAt).getTime();
    const ageMs  = asOfMs - lastMs;
    const cadence = profileMap.get(z.profileId)?.recalculationCadence;
    switch (cadence) {
      case 'daily':   return ageMs >= 86_400_000;
      case 'weekly':  return ageMs >= 7  * 86_400_000;
      case 'monthly': return ageMs >= 30 * 86_400_000;
      default:        return false;
    }
  }));
</script>

<div class="rq {cls}">
  <span class="header">{due.length} zones due</span>
  {#each due as z}
    {@const cadence = profileMap.get(z.profileId)?.recalculationCadence ?? '—'}
    <div class="row">
      <span class="mono">{z.specId.slice(0, 12)}</span>
      <span class="muted">{z.lastComputedAt.slice(0, 10)}</span>
      <span class="muted">{cadence}</span>
      <button onclick={() => onrecalibrate?.(z.id)}>Recalibrate</button>
    </div>
  {/each}
</div>

<style>
  .rq { display: flex; flex-direction: column; gap: 2px; }
  .header { font-size: var(--text-xs); font-weight: 600; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .mono { font-family: var(--font-mono); min-width: 96px; }
  .muted { opacity: var(--muted); }
  button { font-size: var(--text-xs); cursor: pointer; }
</style>
