<script lang="ts">
  import type { EconomicResource } from '$lib/schemas';

  interface Props {
    allResources: Map<string, EconomicResource[]>;
    specNames: Record<string, string>;
    selectedScope?: string;
    myResources?: EconomicResource[];
  }

  let { allResources, specNames, selectedScope = '', myResources }: Props = $props();

  const hasAny = $derived(Array.from(allResources.values()).some(rs => rs.length > 0));
</script>

<div class="band">
  <div class="band-label">INVENTORY</div>

  <div class="scroll-area">
    {#if myResources && myResources.length > 0}
      <div class="scope-group">
        <div class="scope-divider" style="color: #7ee8a2">MY INV</div>
        {#each myResources as r (r.id)}
          <div class="resource-card" style="border-color: rgba(126,232,162,0.35)">
            <div class="card-scope">{r.conformsTo}</div>
            <div class="card-name">{r.name ?? specNames[r.conformsTo] ?? r.conformsTo}</div>
            <div class="card-qty" style="border-left-color: #7ee8a2">
              OH {r.onhandQuantity?.hasNumericalValue ?? '—'} {r.onhandQuantity?.hasUnit ?? ''}
            </div>
          </div>
        {/each}
      </div>
    {/if}
    {#if hasAny}
      {#each allResources.entries() as [scopeId, resources] (scopeId)}
        {#if resources.length > 0}
          <div class="scope-group">
            <div class="scope-divider">{scopeId}</div>
            {#each resources as r (r.id)}
              {@const isSelected = scopeId === selectedScope}
              {@const isClaimable = r.classifiedAs?.includes('individual-claimable') ?? false}
              <div class="resource-card" class:selected={isSelected}>
                <div class="card-scope">{scopeId}</div>
                <div class="card-name">{r.name ?? specNames[r.conformsTo] ?? r.conformsTo}</div>
                <div class="card-qty" style="border-left-color: {isClaimable ? '#e8b04e' : '#7ee8a2'}">
                  OH {r.onhandQuantity?.hasNumericalValue ?? '—'} {r.onhandQuantity?.hasUnit ?? ''}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    {:else}
      <div class="empty">No inventory observed.</div>
    {/if}
  </div>
</div>

<style>
  .band {
    display: flex;
    flex-direction: row;
    height: 110px;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-base);
    flex-shrink: 0;
    overflow: hidden;
  }

  .band-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.55;
    padding: 8px 6px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-right: 1px solid var(--border-faint);
  }

  .scroll-area {
    display: flex;
    flex-direction: row;
    gap: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    align-items: center;
    scrollbar-width: thin;
    flex: 1;
    min-width: 0;
  }

  .scope-group {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .scope-divider {
    font-family: var(--font-mono);
    font-size: 0.42rem;
    opacity: 0.50;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    letter-spacing: 0.06em;
    max-height: 86px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 0;
    flex-shrink: 0;
  }

  .resource-card {
    width: 120px;
    height: 86px;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 3px;
    padding: 5px 7px;
    gap: 4px;
    overflow: hidden;
    transition: border-color 0.15s, background 0.15s;
  }

  .resource-card.selected {
    border-color: rgba(255, 255, 255, 0.35);
    background: rgba(255, 255, 255, 0.11);
  }

  .card-scope {
    font-family: var(--font-mono);
    font-size: 0.44rem;
    opacity: 0.58;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .card-name {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    color: rgba(228, 238, 255, 0.96);
  }

  .card-qty {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    color: #7ee8a2;
    border-left: 2px solid #7ee8a2;
    padding-left: 5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .empty {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.52;
    margin: auto;
  }
</style>
