<script lang="ts">
  import type { ResourceSpecification, BufferProfile, BufferZone } from '$lib/schemas';

  interface Props {
    specs: ResourceSpecification[];
    profiles: BufferProfile[];
    zones: BufferZone[];
    filterProfileCode?: string | null;
    onselect?: (specId: string) => void;
  }

  let { specs, profiles, zones, filterProfileCode = null, onselect }: Props = $props();

  const profileById = $derived(new Map(profiles.map(p => [p.id, p])));

  type Row = {
    spec: ResourceSpecification;
    zone: BufferZone | undefined;
    profile: BufferProfile | undefined;
    code: string;
  };

  const rows = $derived.by((): Row[] => {
    return specs.map(spec => {
      const zone = zones.find(z => z.specId === spec.id);
      const profile = zone ? profileById.get(zone.profileId) : undefined;
      const code = profile?.code ?? (profile ? `${profile.itemType[0]}??` : '—');
      return { spec, zone, profile, code };
    }).sort((a, b) => {
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      return a.spec.name.localeCompare(b.spec.name);
    });
  });

  const visibleRows = $derived(
    filterProfileCode
      ? rows.filter(r => r.code === filterProfileCode)
      : rows
  );

  let selectedSpecId = $state<string | null>(null);

  function handleSelect(specId: string) {
    selectedSpecId = specId;
    onselect?.(specId);
  }

  function fmt(n: number | undefined): string {
    if (n === undefined) return '—';
    return n.toFixed(2);
  }
</script>

<div class="ppt">
  {#if filterProfileCode}
    <div class="filter-bar">
      <span class="filter-label">Profile: <strong>{filterProfileCode}</strong></span>
      <span class="filter-count">{visibleRows.length} part(s)</span>
    </div>
  {/if}

  {#if visibleRows.length === 0}
    <div class="empty">
      {filterProfileCode ? `No parts assigned to profile ${filterProfileCode}` : 'No resource specs. Load example data.'}
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Part</th>
            <th>Profile</th>
            <th>ADU</th>
            <th>DLT (d)</th>
            <th>MOQ</th>
            <th>LTF</th>
            <th>VF</th>
            <th>TOR</th>
            <th>TOY</th>
            <th>TOG</th>
          </tr>
        </thead>
        <tbody>
          {#each visibleRows as row (row.spec.id)}
            <tr
              class:selected={selectedSpecId === row.spec.id}
              class:no-zone={!row.zone}
              onclick={() => row.zone ? handleSelect(row.spec.id) : undefined}
              role="button"
              tabindex="0"
              onkeydown={(e) => e.key === 'Enter' && row.zone && handleSelect(row.spec.id)}
            >
              <td class="part-name">{row.spec.name}</td>
              <td>
                {#if row.profile}
                  <span class="code-badge">{row.code}</span>
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
              <td class="mono">{row.zone ? fmt(row.zone.adu) : '—'}</td>
              <td class="mono">{row.zone ? fmt(row.zone.dltDays) : '—'}</td>
              <td class="mono">{row.zone ? fmt(row.zone.moq) : '—'}</td>
              <td class="mono">{row.profile ? fmt(row.profile.leadTimeFactor) : '—'}</td>
              <td class="mono">{row.profile ? fmt(row.profile.variabilityFactor) : '—'}</td>
              <td class="mono zone-red">{row.zone ? fmt(row.zone.tor) : '—'}</td>
              <td class="mono zone-yellow">{row.zone ? fmt(row.zone.toy) : '—'}</td>
              <td class="mono zone-green">{row.zone ? fmt(row.zone.tog) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .ppt {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }

  .filter-bar {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.7;
  }

  .filter-count {
    opacity: 0.5;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-xs);
  }

  th {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.4;
    text-align: left;
    padding: 2px 8px 4px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    white-space: nowrap;
  }

  td {
    padding: 3px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    white-space: nowrap;
  }

  tr:hover td {
    background: rgba(255,255,255,0.04);
  }

  tr.selected td {
    background: rgba(79,209,197,0.08);
  }

  tr.no-zone {
    opacity: 0.4;
    cursor: default;
  }

  .part-name {
    font-weight: 500;
    min-width: 140px;
  }

  .mono {
    font-family: var(--font-mono);
    text-align: right;
  }

  .muted {
    opacity: var(--muted);
  }

  .code-badge {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 1px 4px;
    background: rgba(79,209,197,0.12);
    color: #4fd1c5;
    border-radius: 2px;
    font-weight: 700;
  }

  .zone-red { color: var(--zone-red); }
  .zone-yellow { color: var(--zone-yellow); }
  .zone-green { color: var(--zone-green); }

  .empty {
    opacity: 0.3;
    font-size: var(--text-xs);
    padding: var(--gap-sm) 0;
  }
</style>
