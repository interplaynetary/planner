<script lang="ts">
  import {
    processSpecs, resourceSpecs, processList, resourceList,
    commitmentList, planList, agentList, bufferZoneList, capacityBufferList,
  } from '$lib/vf-stores.svelte';
  import { capacityBufferStatus } from '$lib/algorithms/ddmrp';
  import BufferZoneBar from '$lib/components/ui/BufferZoneBar.svelte';
  import {
    ENTITY_DESCS, ENTITY_STORE,
    type EntityType, type StoreKey, type FieldKind,
  } from '$lib/vf-descriptors';

  interface Props {
    type: EntityType;
    id: string;
    onclose: () => void;
  }

  const { type, id, onclose }: Props = $props();

  // ── Navigation stack ──────────────────────────────────────────────────────
  // navExtra holds entries pushed after the initial prop entry.
  // The full stack is derived so type/id stay reactive inside $derived.
  // Parent uses {#key} to remount this component when the root entity changes.
  let navExtra = $state<{ type: EntityType; id: string }[]>([]);

  const navStack = $derived([{ type, id }, ...navExtra]);
  const current  = $derived(navStack[navStack.length - 1]);
  const desc     = $derived(ENTITY_DESCS[current.type]);

  // ── Store map (reactive proxy arrays) ────────────────────────────────────
  // Object holds references to the $state proxy arrays — reads inside $derived
  // and the template will properly track mutations.
  const STORE_MAP: Record<StoreKey, any[]> = {
    processSpecs,
    resourceSpecs,
    processList,
    resourceList,
    commitmentList,
    planList,
    agentList,
    capacityBufferList,
  };

  function getEntity(t: EntityType, eid: string): any | undefined {
    return STORE_MAP[ENTITY_STORE[t]].find((e: any) => e.id === eid);
  }

  function getName(t: EntityType, eid: string): string {
    const e = getEntity(t, eid);
    if (!e) return eid.slice(0, 8) + '…';
    return e[ENTITY_DESCS[t].nameField] ?? eid.slice(0, 8) + '…';
  }

  const entity = $derived(getEntity(current.type, current.id));

  // ── Navigation helpers ────────────────────────────────────────────────────
  function pushNav(t: EntityType, eid: string) {
    navExtra = [...navExtra, { type: t, id: eid }];
  }

  function popNav() {
    if (navExtra.length > 0) navExtra = navExtra.slice(0, -1);
  }

  // ── Field value rendering ─────────────────────────────────────────────────
  function renderValue(kind: FieldKind, v: any): string {
    switch (kind) {
      case 'boolean': return v ? 'yes' : 'no';
      case 'date':    return new Date(v).toLocaleDateString();
      case 'measure': return `${v.hasNumericalValue} ${v.hasUnit}`;
      default:        return String(v);
    }
  }

  function shouldShow(kind: FieldKind, v: any): boolean {
    if (v === undefined || v === null) return false;
    if (kind === 'text' && v === '') return false;
    return true;
  }

  // ── ResourceSpec buffer zone aggregates ───────────────────────────────────
  const matchingResources = $derived(
    current.type === 'resourceSpec'
      ? resourceList.filter((r: any) => r.conformsTo === current.id)
      : []
  );

  const bufferZone = $derived(
    current.type === 'resourceSpec'
      ? bufferZoneList.find((b: any) => b.specId === current.id)
      : undefined
  );

  const totalOnhand = $derived(
    matchingResources.reduce((acc: number, r: any) => acc + (r.onhandQuantity?.hasNumericalValue ?? 0), 0)
  );

  const totalAccounting = $derived(
    matchingResources.reduce((acc: number, r: any) => acc + (r.accountingQuantity?.hasNumericalValue ?? 0), 0)
  );

  const bufferUnit = $derived(
    matchingResources[0]?.onhandQuantity?.hasUnit
      ?? (entity as any)?.defaultUnitOfResource
      ?? ''
  );
</script>

{#if entity}
  <div class="ep">
    <!-- Header -->
    <div class="ep-header">
      {#if navStack.length > 1}
        <button class="back-btn" onclick={popNav} aria-label="Back">←</button>
      {/if}
      <span class="ep-dot" style="background:{desc.color}"></span>
      <span class="ep-type">{desc.label}</span>
      <button class="close-btn" onclick={onclose} aria-label="Close">×</button>
    </div>

    <!-- Breadcrumb (shown when nav stack depth > 1) -->
    {#if navStack.length > 1}
      <div class="breadcrumb">
        {#each navStack as step, i (i)}
          {#if i > 0}<span class="bc-sep">›</span>{/if}
          <span class="bc-chip" class:bc-current={i === navStack.length - 1}>
            {ENTITY_DESCS[step.type].label}
          </span>
        {/each}
      </div>
    {/if}

    <!-- Entity name -->
    <div class="ep-name">{entity[desc.nameField] ?? current.id.slice(0, 8)}</div>

    <!-- Fields -->
    {#if desc.fields.length > 0}
      {@const visibleFields = desc.fields.filter(f => shouldShow(f.kind, entity[f.key]))}
      {#if visibleFields.length > 0}
        <dl class="ep-fields">
          {#each visibleFields as field (field.key)}
            {@const v = entity[field.key]}
            <dt>{field.label}</dt>
            {#if field.kind === 'ref' && field.refType}
              <dd>
                <button class="ref-btn" onclick={() => pushNav(field.refType!, v)}>
                  {getName(field.refType!, v)}
                </button>
              </dd>
            {:else}
              <dd>{renderValue(field.kind, v)}</dd>
            {/if}
          {/each}
        </dl>
      {/if}
    {/if}

    <!-- Back-reference sections -->
    {#if desc.backRefs}
      {#each desc.backRefs as br (br.label)}
        {@const items = STORE_MAP[br.storeKey].filter((e: any) => e[br.matchField] === current.id)}
        {#if items.length > 0}
          <div class="section-header">{br.label} ({items.length})</div>
          <ul class="ref-list">
            {#each items as item (item.id)}
              <li>
                <button class="ref-btn" onclick={() => pushNav(br.entityType, item.id)}>
                  {item[ENTITY_DESCS[br.entityType].nameField] ?? item.id.slice(0, 8)}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/each}
    {/if}

    <!-- processSpec-only: capacity buffer section -->
    {#if current.type === 'processSpec'}
      {@const capBuf = capacityBufferList.find(cb => cb.processSpecId === current.id)}
      {#if capBuf}
        {@const cbr      = capacityBufferStatus(
          capBuf.currentLoadHours, capBuf.totalCapacityHours,
          capBuf.greenThreshold ?? 0.80, capBuf.yellowThreshold ?? 0.95)}
        {@const gt       = capBuf.greenThreshold  ?? 0.80}
        {@const yt       = capBuf.yellowThreshold ?? 0.95}
        {@const loadFrac = Math.min(cbr.utilizationPct / 100, 1.05)}
        <div class="section-header">CAPACITY BUFFER</div>
        <dl class="ep-fields">
          <dt>load</dt>    <dd>{capBuf.currentLoadHours}h / {capBuf.periodDays}d</dd>
          <dt>capacity</dt><dd>{capBuf.totalCapacityHours}h / {capBuf.periodDays}d</dd>
          <dt>util %</dt>  <dd>{cbr.utilizationPct.toFixed(1)}%</dd>
          <dt>zone</dt>    <dd class="cap-zone" data-zone={cbr.zone}>{cbr.zone}</dd>
        </dl>
        <div class="cap-bar-wrap">
          <div class="cap-bar">
            <div class="cap-seg green"  style="flex:{gt * 100}"></div>
            <div class="cap-seg yellow" style="flex:{(yt - gt) * 100}"></div>
            <div class="cap-seg red"    style="flex:{(1 - yt) * 100}"></div>
            <div class="cap-cursor" style="left:{loadFrac * 100}%"></div>
          </div>
        </div>
      {/if}
    {/if}

    <!-- ResourceSpec-only: buffer zone section -->
    {#if current.type === 'resourceSpec' && matchingResources.length > 0}
      <div class="section-header">BUFFER ZONE</div>
      <div class="res-row">
        <span class="res-stat">onhand: <strong>{totalOnhand} {bufferUnit}</strong></span>
        {#if totalAccounting !== totalOnhand}
          <span class="res-stat">accounting: <strong>{totalAccounting} {bufferUnit}</strong></span>
        {/if}
      </div>
      {#if bufferZone}
        <div class="buffer-wrap">
          <BufferZoneBar
            value={totalOnhand}
            tor={bufferZone.tor}
            toy={bufferZone.toy}
            tog={bufferZone.tog}
            unit={bufferUnit}
            showLabels={true}
          />
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .ep {
    margin-top: 8px;
    background: rgba(26, 32, 44, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: var(--text-xs, 11px);
    color: #e2e8f0;
  }

  .ep-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .back-btn {
    background: none;
    border: none;
    color: rgba(226, 232, 240, 0.5);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }

  .back-btn:hover {
    color: #e2e8f0;
  }

  .ep-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ep-type {
    font-size: 10px;
    color: rgba(226, 232, 240, 0.45);
    flex: 1;
  }

  .close-btn {
    background: none;
    border: none;
    color: rgba(226, 232, 240, 0.5);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
  }

  .close-btn:hover {
    color: #e2e8f0;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-bottom: 4px;
    flex-wrap: wrap;
  }

  .bc-chip {
    font-size: 9px;
    color: rgba(226, 232, 240, 0.3);
  }

  .bc-chip.bc-current {
    color: rgba(226, 232, 240, 0.6);
  }

  .bc-sep {
    font-size: 9px;
    color: rgba(226, 232, 240, 0.2);
  }

  .ep-name {
    font-size: var(--text-sm, 12px);
    font-weight: 600;
    margin-bottom: 6px;
  }

  .ep-fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    margin: 0 0 4px;
  }

  .ep-fields dt {
    color: rgba(226, 232, 240, 0.4);
    white-space: nowrap;
  }

  .ep-fields dd {
    margin: 0;
    color: rgba(226, 232, 240, 0.8);
    word-break: break-word;
  }

  .ref-btn {
    background: none;
    border: none;
    color: #90cdf4;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs, 11px);
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .ref-btn:hover {
    color: #bee3f8;
  }

  .section-header {
    margin-top: 10px;
    margin-bottom: 4px;
    font-size: 9px;
    font-weight: 600;
    color: rgba(226, 232, 240, 0.4);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .ref-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ref-list li {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ref-list li::before {
    content: '·';
    color: rgba(226, 232, 240, 0.3);
  }

  .res-row {
    display: flex;
    gap: 12px;
    margin-bottom: 4px;
  }

  .res-stat {
    color: rgba(226, 232, 240, 0.6);
  }

  .res-stat strong {
    color: #e2e8f0;
  }

  .buffer-wrap {
    margin-top: 6px;
    max-width: 260px;
  }

  .cap-bar-wrap { margin-top: 6px; max-width: 220px; }
  .cap-bar {
    position: relative;
    display: flex;
    height: 6px;
    border-radius: 2px;
    overflow: visible;
  }
  .cap-seg { min-width: 2px; }
  .cap-seg.green  { background: #276749; opacity: 0.85; }
  .cap-seg.yellow { background: #b7791f; opacity: 0.85; }
  .cap-seg.red    { background: #9b2c2c; opacity: 0.85; }
  .cap-cursor {
    position: absolute;
    top: -2px;
    width: 2px;
    height: 10px;
    background: white;
    transform: translateX(-50%);
    border-radius: 1px;
    opacity: 0.9;
  }
  .cap-zone[data-zone="green"]  { color: #68d391; }
  .cap-zone[data-zone="yellow"] { color: #f6ad55; }
  .cap-zone[data-zone="red"]    { color: #fc8181; }
  .cap-zone[data-zone="excess"] { color: #fc8181; font-weight: 600; }
</style>
