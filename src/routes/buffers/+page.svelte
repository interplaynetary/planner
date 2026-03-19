<script lang="ts">
  import {
    bufferZoneList,
    resourceList,
    resourceSpecs,
    bufferProfileList,
  } from '$lib/vf-stores.svelte';
  import { bufferStatus } from '$lib/algorithms/ddmrp';
  import { getBufferType, getResponseTime } from '$lib/utils/buffer-type';
  import type { BufferType } from '$lib/utils/buffer-type';
  import BufferTypeBadge from '$lib/components/buffers/BufferTypeBadge.svelte';
  import BufferZoneBar from '$lib/components/ui/BufferZoneBar.svelte';
  import ZoneBadge from '$lib/components/ui/ZoneBadge.svelte';
  import BufferCalculationBreakdown from '$lib/components/buffers/BufferCalculationBreakdown.svelte';

  const ZONE_ORDER = { red: 0, yellow: 1, green: 2, excess: 3, stockout: -1 } as const;

  const ZONE_LABELS = {
    red: 'CRITICAL',
    yellow: 'NEEDS REPLENISHMENT',
    green: 'SUFFICIENT',
    excess: 'ABUNDANT',
    stockout: 'DEPLETED',
  } as const;

  type FilterType = 'all' | BufferType;
  let filter = $state<FilterType>('all');
  let expandedId = $state<string | null>(null);

  const specNameMap = $derived(new Map(resourceSpecs.map(s => [s.id, s.name])));

  const enriched = $derived(
    bufferZoneList.map(bz => {
      const pool = bz.atLocation
        ? resourceList.filter(r => r.conformsTo === bz.specId && r.currentLocation === bz.atLocation)
        : resourceList.filter(r => r.conformsTo === bz.specId);
      const onhand = pool.reduce((s, r) => s + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
      const status = bufferStatus(onhand, bz);
      const type = getBufferType(bz.specId, resourceSpecs);
      const tippingWarning = bz.tippingPoint !== undefined && onhand < bz.tippingPoint * 1.5;
      const responseTime = getResponseTime(type);
      return { bz, onhand, status, type, tippingWarning, responseTime };
    }).sort((a, b) => {
      const az = ZONE_ORDER[a.status.zone as keyof typeof ZONE_ORDER] ?? 99;
      const bz = ZONE_ORDER[b.status.zone as keyof typeof ZONE_ORDER] ?? 99;
      return az - bz;
    })
  );

  const filtered = $derived(
    filter === 'all' ? enriched : enriched.filter(e => e.type === filter)
  );

  const redCount       = $derived(enriched.filter(e => e.status.zone === 'red').length);
  const yellowCount    = $derived(enriched.filter(e => e.status.zone === 'yellow').length);
  const sufficientCount = $derived(enriched.filter(e =>
    e.status.zone === 'green' || e.status.zone === 'excess'
  ).length);
  const ecoRisk        = $derived(enriched.some(e => e.type === 'ecological' && e.tippingWarning));
  const ecoRiskCount   = $derived(enriched.filter(e => e.type === 'ecological' && e.tippingWarning).length);

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: 'all',         label: 'All' },
    { key: 'ecological',  label: 'Ecological' },
    { key: 'strategic',   label: 'Strategic' },
    { key: 'metabolic',   label: 'Metabolic' },
    { key: 'reserve',     label: 'Reserve' },
    { key: 'social',      label: 'Social' },
    { key: 'consumption', label: 'Consumption' },
  ];
</script>

<svelte:head>
  <title>Buffers — Free Association</title>
</svelte:head>

<div class="page">
  <!-- System Summary -->
  <div class="system-summary">
    <div class="summary-cols">
      <div class="summary-col col-red">
        <div class="summary-count">{redCount}</div>
        <div class="summary-label">CRITICAL</div>
        <div class="summary-sub">buffers</div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-col col-yellow">
        <div class="summary-count">{yellowCount}</div>
        <div class="summary-label">NEEDS ATTENTION</div>
        <div class="summary-sub">buffers</div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-col col-green">
        <div class="summary-count">{sufficientCount}<span class="summary-total"> / {enriched.length}</span></div>
        <div class="summary-label">SUFFICIENT</div>
        <div class="summary-sub">{sufficientCount === enriched.length && enriched.length > 0 ? 'all buffers healthy' : 'buffers'}</div>
      </div>
    </div>
    {#if ecoRisk}
      <div class="eco-risk-banner">
        ⚠ ECOLOGICAL RISK — {ecoRiskCount} tipping-point {ecoRiskCount === 1 ? 'warning' : 'warnings'}
      </div>
    {/if}
  </div>

  <!-- Filter bar -->
  <div class="filter-bar">
    {#each FILTERS as f (f.key)}
      <button
        class="filter-btn"
        class:active={filter === f.key}
        onclick={() => filter = f.key}
      >{f.label}</button>
    {/each}
  </div>

  <!-- Buffer grid -->
  {#if bufferZoneList.length === 0}
    <p class="empty">No buffer zones loaded.</p>
  {:else if filtered.length === 0}
    <p class="empty">No buffers match this filter.</p>
  {:else}
    <div class="grid">
      {#each filtered as { bz, onhand, status, type, tippingWarning, responseTime } (bz.id)}
        {@const profile = bufferProfileList.find(p => p.id === bz.profileId)}
        {@const specName = specNameMap.get(bz.specId) ?? bz.specId.slice(0, 12)}
        {@const isExpanded = expandedId === bz.id}
        <div class="card zone-{status.zone}" class:expanded={isExpanded}>
          <button
            class="card-main"
            onclick={() => expandedId = isExpanded ? null : bz.id}
            aria-expanded={isExpanded}
          >
            <div class="card-top">
              <BufferTypeBadge {type} />
              <span class="response-badge rt-{responseTime.toLowerCase()}">{responseTime}</span>
              <span class="spec-name">{specName}</span>
              {#if bz.atLocation}
                <span class="location muted">{bz.atLocation.slice(0, 10)}</span>
              {/if}
              <div class="card-right">
                {#if tippingWarning}
                  <span class="tip-warn" title="Approaching ecological tipping point">⚠</span>
                {/if}
                <ZoneBadge zone={status.zone} pct={Math.round(status.pct)} />
              </div>
            </div>

            <div class="card-bar">
              <BufferZoneBar
                value={onhand}
                tor={bz.tor}
                toy={bz.toy}
                tog={bz.tog}
                tippingPoint={type === 'ecological' ? bz.tippingPoint : undefined}
              />
            </div>

            <div class="zone-label zone-label-{status.zone}">
              {ZONE_LABELS[status.zone as keyof typeof ZONE_LABELS] ?? status.zone}
            </div>

            <div class="card-vals">
              <span
                class="val red-val"
                title={type === 'ecological' ? 'Red line — set for future generations. Irreversible if crossed.' : undefined}
              >TOR {bz.tor.toFixed(1)}</span>
              <span class="val yellow-val">TOY {bz.toy.toFixed(1)}</span>
              <span class="val green-val">TOG {bz.tog.toFixed(1)}</span>
              <span class="val muted">on-hand {onhand.toFixed(1)}</span>
            </div>
          </button>

          {#if isExpanded && profile}
            <div class="card-detail">
              <BufferCalculationBreakdown
                bufferZone={bz}
                {profile}
                {specName}
              />
            </div>
          {:else if isExpanded && !profile}
            <div class="card-detail no-profile">No buffer profile linked — cannot show breakdown.</div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    padding: var(--gap-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    background: var(--bg-base);
    color: #e2e8f0;
    min-height: 100vh;
  }

  /* ── System Summary ── */
  .system-summary {
    border: 1px solid var(--border-dim);
    border-radius: 4px;
    background: var(--bg-surface);
    overflow: hidden;
  }

  .summary-cols {
    display: flex;
    align-items: stretch;
  }

  .summary-col {
    flex: 1;
    padding: var(--gap-md) var(--gap-lg);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .summary-divider {
    width: 1px;
    background: var(--border-dim);
    align-self: stretch;
    margin: var(--gap-sm) 0;
  }

  .summary-count {
    font-family: var(--font-mono);
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 1;
  }

  .summary-total {
    font-size: 0.9rem;
    opacity: 0.5;
    font-weight: 400;
  }

  .summary-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.1em;
    margin-top: 4px;
  }

  .summary-sub {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.45;
    letter-spacing: 0.05em;
  }

  .col-red    .summary-count,
  .col-red    .summary-label { color: var(--zone-red); }
  .col-yellow .summary-count,
  .col-yellow .summary-label { color: var(--zone-yellow); }
  .col-green  .summary-count,
  .col-green  .summary-label { color: var(--zone-green); }

  .eco-risk-banner {
    border-top: 1px solid rgba(56, 178, 172, 0.25);
    background: rgba(56, 178, 172, 0.07);
    color: #38b2ac;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    padding: 6px var(--gap-lg);
  }

  /* ── Filter bar ── */
  .filter-bar {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .filter-btn {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 10px;
    background: transparent;
    border: 1px solid var(--border-dim);
    color: rgba(226, 232, 240, 0.45);
    cursor: pointer;
    border-radius: 3px;
    letter-spacing: 0.04em;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .filter-btn:hover {
    color: rgba(226, 232, 240, 0.85);
    background: var(--bg-overlay);
  }

  .filter-btn.active {
    color: var(--zone-green);
    border-color: rgba(72, 187, 120, 0.45);
    background: rgba(72, 187, 120, 0.07);
  }

  /* ── Grid ── */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--gap-md);
    align-items: start;
  }

  /* ── Card ── */
  .card {
    border-radius: 4px;
    border: 1px solid var(--border-dim);
    background: var(--bg-surface);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .card.zone-red {
    border-color: rgba(252, 88, 88, 0.4);
    animation: pulse-red 2.5s ease-in-out infinite;
  }

  .card.zone-yellow { border-color: rgba(214, 158, 46, 0.35); }
  .card.zone-green  { border-color: rgba(72, 187, 120, 0.25); }

  @keyframes pulse-red {
    0%, 100% { border-color: rgba(252, 88, 88, 0.4); }
    50%       { border-color: rgba(252, 88, 88, 0.85); }
  }

  .card-main {
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--gap-sm) var(--gap-md);
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
    color: inherit;
  }

  .card-main:hover {
    background: var(--bg-overlay);
  }

  .card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  /* ── Response time badge ── */
  .response-badge {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    padding: 1px 5px;
    border-radius: 2px;
    flex-shrink: 0;
    line-height: 1.6;
  }

  .rt-seasons  { color: #38b2ac; background: rgba(56, 178, 172, 0.12); }
  .rt-months   { color: #4299e1; background: rgba(66, 153, 225, 0.12); }
  .rt-weeks    { color: #a0aec0; background: rgba(160, 174, 192, 0.12); }
  .rt-days     { color: var(--zone-green); background: var(--zone-green-fill); }
  .rt-ongoing  { color: #9f7aea; background: rgba(159, 122, 234, 0.12); }
  .rt-emergency { color: var(--zone-red); background: var(--zone-red-fill); }

  .spec-name {
    font-size: var(--text-xs);
    font-weight: 600;
    color: rgba(226, 232, 240, 0.9);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .location {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    flex-shrink: 0;
  }

  .card-right {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .tip-warn {
    color: #38b2ac;
    font-size: 0.75rem;
    line-height: 1;
  }

  .card-bar {
    padding: 2px 0;
  }

  /* ── Zone label ── */
  .zone-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 400;
    letter-spacing: 0.08em;
    opacity: 0.7;
    margin-top: -2px;
  }

  .zone-label-red      { color: var(--zone-red); }
  .zone-label-yellow   { color: var(--zone-yellow); }
  .zone-label-green    { color: var(--zone-green); }
  .zone-label-excess   { color: var(--zone-excess); }
  .zone-label-stockout { color: var(--zone-stockout); }

  .card-vals {
    display: flex;
    gap: var(--gap-md);
    flex-wrap: wrap;
  }

  .val {
    font-family: var(--font-mono);
    font-size: 0.6rem;
  }

  .red-val    { color: var(--zone-red); }
  .yellow-val { color: var(--zone-yellow); }
  .green-val  { color: var(--zone-green); }

  .muted { opacity: var(--muted); }

  /* ── Expanded detail ── */
  .card-detail {
    border-top: 1px solid var(--border-faint);
    padding: var(--gap-md);
  }

  .no-profile {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.45;
  }

  .empty {
    opacity: 0.5;
    font-size: var(--text-xs);
  }
</style>
