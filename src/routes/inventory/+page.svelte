<script lang="ts">
  import "$lib/components/ui/tokens.css";
  import { SPEC_NAMES, buildFederationInventory } from "$lib/knowledge/federation-recipes";

  const allResources = buildFederationInventory();
  const scopes = [...allResources.keys()];
  const allFlat = [...allResources.values()].flat();

  // Stats
  const totalResources = allFlat.length;
  const totalScopes = scopes.length;
  const totalOnhand = allFlat.reduce(
    (sum, r) => sum + (r.onhandQuantity?.hasNumericalValue ?? 0),
    0,
  );
  const claimableCount = allFlat.filter((r) =>
    r.classifiedAs?.includes("individual-claimable"),
  ).length;

  // Filter
  let search = $state("");

  const filtered = $derived(
    search
      ? scopes.filter((s) => {
          const q = search.toLowerCase();
          if (s.toLowerCase().includes(q)) return true;
          return (allResources.get(s) ?? []).some((r) => {
            const name = (
              r.name ??
              SPEC_NAMES[r.conformsTo] ??
              r.conformsTo
            ).toLowerCase();
            return name.includes(q) || r.conformsTo.toLowerCase().includes(q);
          });
        })
      : scopes,
  );

  let selectedId = $state<string | null>(null);
  const selectedResource = $derived(
    selectedId ? allFlat.find((r) => r.id === selectedId) : null,
  );
</script>

<div class="page">
  <header class="stat-bar">
    <div class="page-title">
      <span class="title-label">INVENTORY</span>
    </div>
    <div class="stats">
      <div class="stat">
        <span class="stat-value">{totalScopes}</span>
        <span class="stat-label">SCOPES</span>
      </div>
      <div class="stat">
        <span class="stat-value green">{totalResources}</span>
        <span class="stat-label">RESOURCES</span>
      </div>
      <div class="stat">
        <span class="stat-value yellow">{claimableCount}</span>
        <span class="stat-label">CLAIMABLE</span>
      </div>
    </div>
  </header>

  <div class="toolbar">
    <input
      class="search"
      type="text"
      placeholder="Filter scopes or resources..."
      bind:value={search}
    />
  </div>

  <div class="body" class:has-detail={!!selectedResource}>
    <div class="grid">
      {#each filtered as scopeId (scopeId)}
        {@const resources = allResources.get(scopeId) ?? []}
        <div class="scope-card">
          <div class="scope-head">
            <span class="scope-name">{scopeId}</span>
            <span class="scope-count">{resources.length}</span>
          </div>
          <div class="scope-resources">
            {#each resources as r (r.id)}
              {@const isClaimable =
                r.classifiedAs?.includes("individual-claimable") ?? false}
              <button
                class="resource-row"
                class:selected={selectedId === r.id}
                onclick={() =>
                  (selectedId = selectedId === r.id ? null : r.id)}
              >
                <span class="r-name"
                  >{r.name ?? SPEC_NAMES[r.conformsTo] ?? r.conformsTo}</span
                >
                <span
                  class="r-qty"
                  style="border-left-color: {isClaimable
                    ? '#e8b04e'
                    : '#7ee8a2'}"
                >
                  {r.onhandQuantity?.hasNumericalValue ?? 0}
                  <span class="r-unit"
                    >{r.onhandQuantity?.hasUnit ?? ""}</span
                  >
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
      {#if filtered.length === 0}
        <div class="empty">No scopes match the filter.</div>
      {/if}
    </div>

    {#if selectedResource}
      <aside class="detail">
        <button class="close" onclick={() => (selectedId = null)}>✕</button>
        <div class="d-spec">
          {SPEC_NAMES[selectedResource.conformsTo] ??
            selectedResource.conformsTo}
        </div>
        <div class="d-name">{selectedResource.name ?? ""}</div>
        <dl class="d-meta">
          <dt>ID</dt>
          <dd>{selectedResource.id}</dd>
          <dt>Spec</dt>
          <dd>{selectedResource.conformsTo}</dd>
          <dt>Scope</dt>
          <dd>{selectedResource.custodianScope ?? "—"}</dd>
          <dt>Accountable</dt>
          <dd>{selectedResource.primaryAccountable ?? "—"}</dd>
          <dt>Accounting</dt>
          <dd>
            {selectedResource.accountingQuantity?.hasNumericalValue ?? 0}
            {selectedResource.accountingQuantity?.hasUnit ?? ""}
          </dd>
          <dt>On-Hand</dt>
          <dd>
            {selectedResource.onhandQuantity?.hasNumericalValue ?? 0}
            {selectedResource.onhandQuantity?.hasUnit ?? ""}
          </dd>
          {#if selectedResource.classifiedAs?.length}
            <dt>Tags</dt>
            <dd>{selectedResource.classifiedAs.join(", ")}</dd>
          {/if}
          {#if selectedResource.stage}
            <dt>Stage</dt>
            <dd>{selectedResource.stage}</dd>
          {/if}
          {#if selectedResource.currentLocation}
            <dt>Location</dt>
            <dd>{selectedResource.currentLocation}</dd>
          {/if}
        </dl>
      </aside>
    {/if}
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-base);
    color: rgba(228, 238, 255, 0.92);
    font-family: var(--font-mono);
    overflow: hidden;
  }

  /* ---- Stat bar ---- */
  .stat-bar {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-surface);
    flex-shrink: 0;
  }
  .page-title {
    margin-right: auto;
  }
  .title-label {
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.85;
  }
  .stats {
    display: flex;
    gap: 28px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .stat-value {
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1;
  }
  .stat-value.green {
    color: #7ee8a2;
  }
  .stat-value.yellow {
    color: #e8b04e;
  }
  .stat-label {
    font-size: 0.52rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.68;
  }

  /* ---- Toolbar ---- */
  .toolbar {
    padding: 8px 20px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }
  .search {
    width: 100%;
    max-width: 340px;
    padding: 5px 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    font-size: 0.65rem;
    font-family: var(--font-mono);
  }
  .search::placeholder {
    opacity: 0.35;
  }

  /* ---- Body ---- */
  .body {
    flex: 1;
    overflow: hidden;
    display: flex;
    min-height: 0;
  }
  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
    padding: 14px 20px;
    overflow-y: auto;
    align-content: start;
  }

  /* ---- Scope card ---- */
  .scope-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 4px;
    overflow: hidden;
  }
  .scope-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.02);
  }
  .scope-name {
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: rgba(228, 238, 255, 0.9);
  }
  .scope-count {
    font-size: 0.5rem;
    opacity: 0.45;
  }
  .scope-resources {
    display: flex;
    flex-direction: column;
  }

  /* ---- Resource row ---- */
  .resource-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 10px;
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    background: transparent;
    color: inherit;
    font-family: var(--font-mono);
    cursor: pointer;
    text-align: left;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .resource-row:first-child {
    border-top: none;
  }
  .resource-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .resource-row.selected {
    background: rgba(126, 232, 162, 0.06);
    box-shadow: inset 2px 0 0 #7ee8a2;
  }
  .r-name {
    font-size: 0.6rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(228, 238, 255, 0.82);
  }
  .r-qty {
    font-size: 0.6rem;
    font-weight: 600;
    color: #7ee8a2;
    border-left: 2px solid #7ee8a2;
    padding-left: 6px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .r-unit {
    font-weight: 400;
    font-size: 0.5rem;
    opacity: 0.55;
  }

  /* ---- Detail pane ---- */
  .detail {
    width: 280px;
    flex-shrink: 0;
    border-left: 1px solid var(--border-faint);
    padding: 14px 16px;
    overflow-y: auto;
    position: relative;
    background: var(--bg-surface);
  }
  .close {
    position: absolute;
    top: 8px;
    right: 10px;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    opacity: 0.45;
    font-size: 0.7rem;
  }
  .d-spec {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(228, 238, 255, 0.96);
    margin-bottom: 2px;
  }
  .d-name {
    font-size: 0.55rem;
    opacity: 0.55;
    margin-bottom: 10px;
  }
  .d-meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    font-size: 0.58rem;
  }
  .d-meta dt {
    opacity: 0.45;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.48rem;
    align-self: center;
  }
  .d-meta dd {
    margin: 0;
    color: rgba(228, 238, 255, 0.85);
  }

  .empty {
    grid-column: 1 / -1;
    font-size: 0.65rem;
    opacity: 0.45;
    text-align: center;
    padding: 40px 0;
  }
</style>
