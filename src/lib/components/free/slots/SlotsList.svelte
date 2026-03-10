<!--
  SlotsList.svelte

  Display a list of Intents with filtering and sorting.

  Usage:
    <SlotsList
      intents={intents}
      isCapacity={false}
      onEdit={(intent) => {...}}
      onDelete={(id) => {...}}
    />
-->

<script lang="ts">
  import type { Intent } from '$lib/schemas';
  import SlotCard from './SlotCard.svelte';

  interface Props {
    intents: Intent[];
    isCapacity?: boolean;
    onEdit?: (intent: Intent) => void;
    onDelete?: (id: string) => void;
    readonly?: boolean;
    emptyMessage?: string;
  }

  let {
    intents,
    isCapacity = false,
    onEdit,
    onDelete,
    readonly = false,
    emptyMessage = 'No slots yet'
  }: Props = $props();

  // Filter and sort state
  let filterType = $state<string>('all');
  let searchQuery = $state('');
  let sortBy = $state<'name' | 'date' | 'quantity'>('date');
  let sortDirection = $state<'asc' | 'desc'>('asc');

  // Get unique resource types from intents
  const resourceTypes = $derived(
    Array.from(new Set(intents.map(s => s.resourceConformsTo).filter(Boolean))).sort() as string[]
  );

  // Filtered and sorted intents
  const filteredIntents = $derived.by(() => {
    let result = intents;

    // Filter by resource type
    if (filterType !== 'all') {
      result = result.filter(s => s.resourceConformsTo === filterType);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(s =>
        (s.name || '').toLowerCase().includes(query) ||
        (s.note || '').toLowerCase().includes(query) ||
        (s.resourceConformsTo || '').toLowerCase().includes(query)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'name') {
        comparison = (a.name || '').localeCompare(b.name || '');
      } else if (sortBy === 'date') {
        const dateA = a.hasBeginning || '';
        const dateB = b.hasBeginning || '';
        comparison = dateA.localeCompare(dateB);
      } else if (sortBy === 'quantity') {
        comparison = (a.resourceQuantity?.hasNumericalValue ?? 0) - (b.resourceQuantity?.hasNumericalValue ?? 0);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  });
</script>

<div class="slots-list" data-testid="slots-list">
  <!-- Filters and Search -->
  <div class="controls">
    <div class="search-bar">
      <span class="search-icon">🔍</span>
      <input
        type="text"
        class="search-input"
        bind:value={searchQuery}
        placeholder="Search..."
        data-testid="search-input"
      />
    </div>

    <div class="filters">
      <select
        class="filter-select"
        bind:value={filterType}
        data-testid="filter-type-select"
      >
        <option value="all">All Types</option>
        {#each resourceTypes as type (type)}
          <option value={type}>{type}</option>
        {/each}
      </select>

      <select
        class="filter-select"
        bind:value={sortBy}
        data-testid="sort-by-select"
      >
        <option value="name">Sort by Name</option>
        <option value="date">Sort by Date</option>
        <option value="quantity">Sort by Quantity</option>
      </select>

      <button
        type="button"
        class="sort-direction-button"
        onclick={() => sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'}
        title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        data-testid="sort-direction-button"
      >
        {sortDirection === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  </div>

  <!-- Results Count -->
  <div class="results-info">
    Showing {filteredIntents.length} of {intents.length} slots
  </div>

  <!-- Intents Grid -->
  {#if filteredIntents.length === 0}
    <div class="empty-state">
      <p>{searchQuery || filterType !== 'all' ? 'No matching slots found' : emptyMessage}</p>
    </div>
  {:else}
    <div class="slots-grid">
      {#each filteredIntents as intent (intent.id)}
        <SlotCard
          {intent}
          {isCapacity}
          {onEdit}
          {onDelete}
          {readonly}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .slots-list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  @media (min-width: 640px) {
    .controls {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .search-bar {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 0.75rem;
    font-size: 1rem;
  }

  .search-input {
    width: 100%;
    padding: 0.5rem 0.75rem 0.5rem 2.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: #1f2937;
    background: white;
  }

  .search-input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .search-input::placeholder {
    color: #9ca3af;
  }

  .filters {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .filter-select {
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: #1f2937;
    background: white;
    cursor: pointer;
  }

  .filter-select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .sort-direction-button {
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: white;
    font-size: 1.25rem;
    color: #1f2937;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sort-direction-button:hover {
    border-color: #3b82f6;
    background: #eff6ff;
    color: #3b82f6;
  }

  .results-info {
    font-size: 0.875rem;
    color: #6b7280;
    padding: 0.5rem 0;
  }

  .slots-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
  }

  @media (min-width: 1024px) {
    .slots-grid {
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    }
  }

  .empty-state {
    padding: 4rem 2rem;
    text-align: center;
    background: #fafafa;
    border: 2px dashed #d1d5db;
    border-radius: 0.5rem;
  }

  .empty-state p {
    margin: 0;
    font-size: 1rem;
    color: #9ca3af;
  }
</style>
