<!--
  SlotCard.svelte

  Display a single Intent in card format.

  Usage:
    <SlotCard
      intent={intent}
      isCapacity={false}
      onEdit={(intent) => {...}}
      onDelete={(id) => {...}}
    />
-->

<script lang="ts">
  import type { Intent } from '$lib/schemas';
  import { formatWhen } from '$lib/utils/time';

  interface Props {
    intent: Intent;
    isCapacity?: boolean;
    onEdit?: (intent: Intent) => void;
    onDelete?: (id: string) => void;
    readonly?: boolean;
    compact?: boolean;
  }

  let {
    intent,
    isCapacity = false,
    onEdit,
    onDelete,
    readonly = false,
    compact = false,
  }: Props = $props();

  const timeDisplay = $derived(formatWhen(intent.availability_window, intent.due));

  const locationDisplay = $derived(
    intent.atLocation ? intent.atLocation : 'Not specified'
  );

  const isRecurring = $derived(
    !!intent.availability_window && !('specific_dates' in intent.availability_window)
  );

  function handleEdit() {
    onEdit?.(intent);
  }

  function handleDelete() {
    if (confirm(`Delete "${intent.name ?? 'this intent'}"?`)) {
      onDelete?.(intent.id);
    }
  }
</script>

<article
  class="slot-card"
  class:compact
  data-testid="slot-card-{intent.id}"
>
  <div class="card-header">
    <div class="header-left">
      {#if intent.image}
        <span class="emoji">{intent.image}</span>
      {/if}
      <div class="title-group">
        <h3 class="title" data-testid="slot-name">{intent.name ?? ''}</h3>
        {#if intent.resourceConformsTo}
          <span class="resource-type-badge">{intent.resourceConformsTo}</span>
        {/if}
      </div>
    </div>

    {#if !readonly && (onEdit || onDelete)}
      <div class="actions">
        {#if onEdit}
          <button
            type="button"
            class="action-button"
            onclick={handleEdit}
            title="Edit"
            data-testid="edit-button"
          >
            ✏️
          </button>
        {/if}
        {#if onDelete}
          <button
            type="button"
            class="action-button delete"
            onclick={handleDelete}
            title="Delete"
            data-testid="delete-button"
          >
            🗑️
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="card-body">
    <!-- Quantity -->
    {#if intent.resourceQuantity}
      <div class="info-row">
        <span class="icon">📊</span>
        <span class="info-label">Quantity:</span>
        <span class="info-value" data-testid="slot-quantity">
          <strong>{intent.resourceQuantity.hasNumericalValue}</strong> {intent.resourceQuantity.hasUnit || 'units'}
        </span>
      </div>
    {/if}

    <!-- Time -->
    {#if timeDisplay}
      <div class="info-row">
        <span class="icon">🕐</span>
        <span class="info-label">When:</span>
        <span class="info-value">
          {timeDisplay}
          {#if isRecurring}
            <span class="badge recurring">Recurring</span>
          {/if}
        </span>
      </div>
    {/if}

    <!-- Location -->
    <div class="info-row">
      <span class="icon">📍</span>
      <span class="info-label">Where:</span>
      <span class="info-value">{locationDisplay}</span>
    </div>

    <!-- Note (if not compact) -->
    {#if !compact && intent.note}
      <div class="description">
        <p>{intent.note}</p>
      </div>
    {/if}
  </div>
</article>

<style>
  .slot-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1);
    transition: all 0.2s;
    overflow: hidden;
  }

  .slot-card:hover {
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
    transform: translateY(-2px);
  }

  .slot-card.compact {
    padding: 0.75rem;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    padding: 1rem;
    border-bottom: 1px solid #f3f4f6;
    background: #fafafa;
  }

  .compact .card-header {
    padding: 0 0 0.5rem 0;
    border-bottom: none;
    background: transparent;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
  }

  .emoji {
    font-size: 2rem;
    line-height: 1;
  }

  .compact .emoji {
    font-size: 1.5rem;
  }

  .title-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
  }

  .compact .title {
    font-size: 1rem;
  }

  .resource-type-badge {
    display: inline-flex;
    padding: 0.125rem 0.5rem;
    background: #dbeafe;
    color: #1e40af;
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: 0.25rem;
    text-transform: capitalize;
    width: fit-content;
  }

  .actions {
    display: flex;
    gap: 0.25rem;
  }

  .action-button {
    width: 2rem;
    height: 2rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.25rem;
    background: white;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-button:hover {
    background: #f9fafb;
    border-color: #d1d5db;
  }

  .action-button.delete:hover {
    background: #fef2f2;
    border-color: #ef4444;
  }

  .card-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .compact .card-body {
    padding: 0;
    gap: 0.5rem;
  }

  .info-row {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 0.5rem;
    align-items: start;
    font-size: 0.875rem;
  }

  .compact .info-row {
    font-size: 0.8125rem;
  }

  .icon {
    font-size: 1rem;
  }

  .info-label {
    font-weight: 500;
    color: #6b7280;
    white-space: nowrap;
  }

  .info-value {
    color: #1f2937;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .badge {
    padding: 0.125rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    border-radius: 0.25rem;
    text-transform: uppercase;
  }

  .badge.recurring {
    background: #dbeafe;
    color: #1e40af;
  }

  .description {
    padding-top: 0.5rem;
    border-top: 1px solid #f3f4f6;
  }

  .description p {
    margin: 0;
    font-size: 0.875rem;
    color: #6b7280;
    line-height: 1.5;
  }
</style>
