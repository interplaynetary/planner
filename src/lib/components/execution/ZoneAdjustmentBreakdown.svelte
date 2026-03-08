<script lang="ts">
  import type { BufferZone, BufferProfile } from '$lib/schemas';
  import type { AggregatedFactors } from '$lib/algorithms/ddmrp';
  import { computeBufferZone } from '$lib/algorithms/ddmrp';

  interface Props {
    bufferZone: BufferZone;
    /** Optional — if not provided, profile params are back-derived from the stored zone values. */
    profile?: BufferProfile;
    factors: AggregatedFactors;
  }

  let { bufferZone: bz, profile, factors }: Props = $props();

  /** Derive a synthetic profile from stored zone boundaries when no profile is given. */
  const effectiveProfile = $derived.by<BufferProfile>(() => {
    if (profile) return profile;
    // Back-derive LTF from stored redBase (or fallback to TOR / (adu*dlt*(1+vf)))
    const adu = bz.adu;
    const dlt = bz.dltDays;
    const redBase   = bz.redBase   ?? (adu * dlt > 0 ? bz.tor / (1 + 0.5) : 0);
    const redSafety = bz.redSafety ?? (bz.tor - redBase);
    const ltf = adu * dlt > 0 ? redBase / (adu * dlt) : 1;
    const vf  = redBase > 0 ? redSafety / redBase : 0.5;
    const green = bz.tog - bz.toy;
    const doc   = adu > 0 ? green / adu : undefined;
    return {
      id: '_derived',
      name: 'Derived',
      itemType: 'Manufactured',
      leadTimeFactor: ltf,
      variabilityFactor: vf,
      orderCycleDays: doc,
    };
  });

  const base = $derived(computeBufferZone(
    effectiveProfile,
    bz.adu,
    bz.aduUnit,
    bz.dltDays,
    bz.moq ?? 0,
    bz.moqUnit ?? bz.aduUnit,
  ));

  const adjusted = $derived(computeBufferZone(
    effectiveProfile,
    bz.adu,
    bz.aduUnit,
    bz.dltDays,
    bz.moq ?? 0,
    bz.moqUnit ?? bz.aduUnit,
    {
      demandAdjFactor:     factors.demandAdjFactor,
      leadTimeAdjFactor:   factors.leadTimeAdjFactor,
      zoneAdjFactor:       factors.zoneAdjFactor,
      redZoneAdjFactor:    factors.redZoneAdjFactor,
      yellowZoneAdjFactor: factors.yellowZoneAdjFactor,
      greenZoneAdjFactor:  factors.greenZoneAdjFactor,
    },
  ));

  function fmt(n: number): string { return n.toFixed(2); }

  function deltaClass(adj: number, bas: number): string {
    if (adj > bas + 0.001) return 'up';
    if (adj < bas - 0.001) return 'down';
    return 'eq';
  }

  function badge(label: string, val: number): string {
    return val !== 1 ? `${label} ×${val.toFixed(2)}` : '';
  }

  const dafBadge       = $derived(badge('DAF',      factors.demandAdjFactor));
  const ltafBadge      = $derived(badge('LTAF',     factors.leadTimeAdjFactor));
  const redZafBadge    = $derived(badge('redZAF',   factors.redZoneAdjFactor * factors.zoneAdjFactor));
  const yellowZafBadge = $derived(badge('yellowZAF', factors.yellowZoneAdjFactor));
  const greenZafBadge  = $derived(badge('greenZAF', factors.greenZoneAdjFactor));

  interface Row { label: string; base: number; adj: number; badge?: string; }

  const rows = $derived<Row[]>([
    { label: 'Effective ADU',  base: bz.adu,              adj: adjusted.effectiveADU,        badge: dafBadge },
    { label: 'Effective DLT',  base: bz.dltDays,          adj: adjusted.effectiveDLT,        badge: ltafBadge },
    { label: 'Red base',       base: base.redBase,         adj: adjusted.redBase },
    { label: 'Red safety',     base: base.redSafety,       adj: adjusted.redSafety },
    { label: 'TOR',            base: base.tor,             adj: adjusted.tor,                badge: redZafBadge },
    { label: 'Yellow size',    base: base.toy - base.tor,  adj: adjusted.toy - adjusted.tor, badge: yellowZafBadge },
    { label: 'Green size',     base: base.tog - base.toy,  adj: adjusted.tog - adjusted.toy, badge: greenZafBadge },
    { label: 'TOG',            base: base.tog,             adj: adjusted.tog },
  ]);
</script>

<div class="zab">
  <div class="header">Zone Adjustment Breakdown</div>
  <table>
    <thead>
      <tr>
        <th>Zone</th>
        <th>Base</th>
        <th>Adjusted</th>
        <th>Factor</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.label)}
        {@const dc = deltaClass(row.adj, row.base)}
        <tr>
          <td class="label">{row.label}</td>
          <td class="num muted">{fmt(row.base)}</td>
          <td class="num {dc}">{fmt(row.adj)}</td>
          <td>{#if row.badge}<span class="bdg">{row.badge}</span>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .zab { display: flex; flex-direction: column; gap: 4px; }
  .header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.4;
    padding-bottom: var(--gap-xs);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  table {
    border-collapse: collapse;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    width: 100%;
  }
  th {
    text-align: left;
    opacity: 0.35;
    font-weight: 400;
    padding: 2px 6px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    white-space: nowrap;
  }
  td { padding: 2px 6px; }
  .label { opacity: 0.7; white-space: nowrap; }
  .num { text-align: right; }
  .muted { opacity: 0.4; }
  .up   { color: var(--zone-green); }
  .down { color: var(--zone-red); }
  .eq   { opacity: 0.55; }
  .bdg {
    font-size: 0.6rem;
    padding: 1px 4px;
    border-radius: 2px;
    background: rgba(255,255,255,0.08);
    opacity: 0.7;
    white-space: nowrap;
  }
</style>
