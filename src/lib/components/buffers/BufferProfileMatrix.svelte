<script lang="ts">
  import type { BufferProfile, ResourceSpecification, BufferZone } from '$lib/schemas';
  import { LTF_RANGES, VF_RANGES } from '$lib/algorithms/ddmrp';

  interface Props {
    profiles: BufferProfile[];
    specs: ResourceSpecification[];
    zones: BufferZone[];
    selectedCode?: string | null;
    onselect?: (code: string | null) => void;
  }

  let { profiles, specs, zones, selectedCode = null, onselect }: Props = $props();

  const ITEM_TYPES = ['Purchased', 'Manufactured', 'Intermediate', 'Distributed'] as const;
  const LT_CATS = ['short', 'medium', 'long'] as const;
  const VAR_CATS = ['low', 'medium', 'high'] as const;

  // Map profileId → profile for quick lookup
  const profileById = $derived(new Map(profiles.map(p => [p.id, p])));

  // Count parts per profile code (via zone → profileId → profile.code)
  const countByCode = $derived.by(() => {
    const m = new Map<string, string[]>();
    for (const z of zones) {
      const prof = profileById.get(z.profileId);
      if (!prof?.code) continue;
      const specName = specs.find(s => s.id === z.specId)?.name ?? z.specId;
      const arr = m.get(prof.code) ?? [];
      arr.push(specName);
      m.set(prof.code, arr);
    }
    return m;
  });

  // Build cell data: for each itemType × ltCat × varCat → {code, profile?, count, partNames}
  type CellDatum = {
    itemType: string;
    lt: string;
    vr: string;
    code: string;
    profile: BufferProfile | undefined;
    count: number;
    partNames: string[];
  };

  const cells = $derived.by((): CellDatum[] => {
    const result: CellDatum[] = [];
    for (const it of ITEM_TYPES) {
      for (const lt of LT_CATS) {
        for (const vr of VAR_CATS) {
          const code = `${it[0]}${lt[0].toUpperCase()}${vr[0].toUpperCase()}`;
          const profile = profiles.find(
            p => p.itemType === it && p.leadTimeCategory === lt && p.variabilityCategory === vr
          );
          const partNames = countByCode.get(code) ?? [];
          result.push({ itemType: it, lt, vr, code, profile, count: partNames.length, partNames });
        }
      }
    }
    return result;
  });

  function cellColor(count: number, hasProfile: boolean): string {
    if (!hasProfile) return 'rgba(255,255,255,0.03)';
    if (count === 0) return 'rgba(79,209,197,0.08)';
    const intensity = Math.min(count / 5, 1);
    const r = Math.round(79 + (63 - 79) * intensity);
    const g = Math.round(209 + (111 - 209) * intensity);
    const b = Math.round(197 + (224 - 197) * intensity);
    return `rgba(${r},${g},${b},${0.2 + intensity * 0.5})`;
  }

  function handleClick(code: string) {
    onselect?.(selectedCode === code ? null : code);
  }
</script>

<div class="bpm">
  {#each ITEM_TYPES as itemType (itemType)}
    <div class="facet">
      <div class="facet-title">{itemType}</div>
      <div class="matrix">
        <!-- Column headers -->
        <div class="corner"></div>
        {#each VAR_CATS as vr (vr)}
          <div class="col-hdr">
            <span class="cat">{vr}</span>
            <span class="range">VF {VF_RANGES[vr][0]}–{VF_RANGES[vr][1] === Infinity ? '∞' : VF_RANGES[vr][1]}</span>
          </div>
        {/each}
        <!-- Rows -->
        {#each LT_CATS as lt (lt)}
          <div class="row-hdr">
            <span class="cat">{lt}</span>
            <span class="range">LTF {LTF_RANGES[lt][0]}–{LTF_RANGES[lt][1]}</span>
          </div>
          {#each VAR_CATS as vr (`${lt}-${vr}`)}
            {@const cell = cells.find(c => c.itemType === itemType && c.lt === lt && c.vr === vr)!}
            <button
              class="cell"
              class:active={selectedCode === cell.code}
              class:has-profile={!!cell.profile}
              class:has-parts={cell.count > 0}
              style:background={cellColor(cell.count, !!cell.profile)}
              onclick={() => handleClick(cell.code)}
              title={cell.profile
                ? `${cell.profile.name}\nLTF ${cell.profile.leadTimeFactor} · VF ${cell.profile.variabilityFactor}\n${cell.count} part(s): ${cell.partNames.slice(0, 5).join(', ')}`
                : `${cell.code} — no profile configured`}
            >
              <span class="cell-code">{cell.code}</span>
              {#if cell.count > 0}
                <span class="cell-count">{cell.count}</span>
              {/if}
            </button>
          {/each}
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .bpm {
    display: flex;
    gap: var(--gap-lg);
    flex-wrap: wrap;
  }

  .facet {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .facet-title {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    text-transform: uppercase;
    opacity: 0.5;
    letter-spacing: 0.08em;
    padding-left: 52px;
  }

  .matrix {
    display: grid;
    grid-template-columns: 52px repeat(3, 64px);
    grid-template-rows: auto repeat(3, 52px);
    gap: 2px;
  }

  .corner { grid-area: 1/1; }

  .col-hdr, .row-hdr {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    gap: 1px;
    padding: 2px;
  }

  .row-hdr {
    align-items: flex-end;
    padding-right: 4px;
  }

  .cat {
    font-weight: 600;
    opacity: 0.7;
    text-transform: uppercase;
  }

  .range {
    opacity: 0.35;
    font-size: 0.55rem;
    white-space: nowrap;
  }

  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 3px;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.1s;
    gap: 2px;
    padding: 4px 2px;
  }

  .cell:hover {
    border-color: rgba(79,209,197,0.4);
    transform: scale(1.04);
  }

  .cell.active {
    border-color: #4fd1c5;
    box-shadow: 0 0 0 1px #4fd1c5;
  }

  .cell-code {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 700;
    opacity: 0.8;
  }

  .cell.has-profile .cell-code {
    color: #4fd1c5;
    opacity: 1;
  }

  .cell-count {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 600;
    color: #fff;
    background: rgba(79,209,197,0.3);
    border-radius: 2px;
    padding: 0 3px;
    line-height: 1.4;
  }
</style>
