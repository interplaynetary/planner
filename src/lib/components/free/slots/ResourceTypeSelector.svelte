<!--
  ResourceTypeSelector.svelte

  Select a ResourceSpecification from the VF store.

  Usage:
    <ResourceTypeSelector
      value={specId}
      onSelect={(id) => specId = id}
      variant="grid"
    />
-->

<script lang="ts">
  import type { ResourceSpecification } from '$lib/schemas';
  import { resourceSpecs } from '$lib/vf-stores.svelte';

  interface Props {
    /** Currently selected ResourceSpecification.id */
    value?: string;
    /** Callback when a spec is selected */
    onSelect: (specId: string) => void;
    /** Show as grid buttons or dropdown */
    variant?: 'grid' | 'dropdown';
    required?: boolean;
  }

  let { value, onSelect, variant = 'grid', required = false }: Props = $props();

  // Group specs by their first classification tag
  const categories = $derived.by(() => {
    const groups: Record<string, ResourceSpecification[]> = {};
    const order: string[] = [];

    for (const spec of resourceSpecs) {
      const cat = spec.resourceClassifiedAs?.[0] ?? 'other';
      if (!groups[cat]) {
        groups[cat] = [];
        order.push(cat);
      }
      groups[cat].push(spec);
    }

    return order.map(cat => ({ name: cat, specs: groups[cat] }));
  });

  const selectedSpec = $derived(resourceSpecs.find(s => s.id === value));

  function handleSelect(specId: string) {
    onSelect(specId);
  }
</script>

{#if variant === 'grid'}
  <div class="resource-type-selector" data-testid="resource-type-selector">
    <span class="label">
      Resource Type {#if required}<span class="required">*</span>{/if}
    </span>

    {#if resourceSpecs.length === 0}
      <p class="empty-hint">No resource specs defined yet.</p>
    {:else}
      <div class="category-list">
        {#each categories as category (category.name)}
          <div class="category-section">
            <h4 class="category-title">{category.name}</h4>
            <div class="type-grid">
              {#each category.specs as spec (spec.id)}
                <button
                  type="button"
                  class="type-button"
                  class:selected={value === spec.id}
                  onclick={() => handleSelect(spec.id)}
                  data-testid="resource-type-{spec.id}"
                  title={spec.note}
                >
                  {#if spec.image}
                    <span class="emoji">{spec.image}</span>
                  {/if}
                  <span class="name">{spec.name}</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if selectedSpec?.note}
      <div class="selected-info">
        <p class="description">{selectedSpec.note}</p>
      </div>
    {/if}
  </div>
{:else}
  <!-- Dropdown variant -->
  <div class="resource-type-selector dropdown" data-testid="resource-type-selector-dropdown">
    <label class="label" for="resource-type-select">
      Resource Type {#if required}<span class="required">*</span>{/if}
    </label>

    <select
      id="resource-type-select"
      class="select"
      {value}
      onchange={(e) => handleSelect(e.currentTarget.value)}
      {required}
      data-testid="resource-type-select"
    >
      <option value="">Select a type...</option>
      {#each categories as category (category.name)}
        <optgroup label={category.name}>
          {#each category.specs as spec (spec.id)}
            <option value={spec.id}>{spec.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>

    {#if selectedSpec?.note}
      <div class="selected-info">
        <p class="description">{selectedSpec.note}</p>
      </div>
    {/if}
  </div>
{/if}

<style>
  .resource-type-selector {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .label {
    font-weight: 600;
    font-size: 0.875rem;
    color: #374151;
  }

  .required {
    color: #ef4444;
  }

  .empty-hint {
    font-size: 0.875rem;
    color: #9ca3af;
    margin: 0;
  }

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .category-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    color: #6b7280;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid #e5e7eb;
  }

  .type-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 0.5rem;
  }

  .type-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    background: white;
    cursor: pointer;
    transition: all 0.2s;
    min-height: 60px;
    justify-content: center;
  }

  .type-button:hover {
    border-color: #3b82f6;
    background: #eff6ff;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  }

  .type-button.selected {
    border-color: #3b82f6;
    background: #dbeafe;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .emoji {
    font-size: 1.75rem;
    line-height: 1;
  }

  .name {
    font-size: 0.8rem;
    font-weight: 500;
    color: #374151;
    text-align: center;
    line-height: 1.2;
  }

  .selected-info {
    padding: 0.75rem;
    background: #f9fafb;
    border-radius: 0.375rem;
    border-left: 3px solid #3b82f6;
    margin-top: 0.5rem;
  }

  .description {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0;
  }

  /* Dropdown variant styles */
  .dropdown .select {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: #1f2937;
    background: white;
    cursor: pointer;
  }

  .dropdown .select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
</style>
