<script lang="ts">
  import type { FlowSelectCtx } from '$lib/components/vf/observe-types';
  import { observer, refresh } from '$lib/vf-stores.svelte';
  import ActionBadge from '$lib/components/vf/ActionBadge.svelte';
  import EventRow from '$lib/components/vf/EventRow.svelte';

  interface Props {
    context:  FlowSelectCtx | null;
    onrecord: () => void;
    onclose:  () => void;
  }
  let { context, onrecord, onclose }: Props = $props();

  let qtyInput   = $state(0);
  let tsInput    = $state('');
  let notesInput = $state('');
  let submitting = $state(false);
  let errorMsg   = $state<string | null>(null);

  const remaining = $derived(context ? Math.max(0, context.plannedQty - context.fulfilledQty) : 0);

  $effect(() => {
    if (context) {
      qtyInput   = remaining;
      tsInput    = new Date().toISOString().slice(0, 16);
      errorMsg   = null;
    }
  });

  function handleSubmit() {
    if (!context || qtyInput <= 0) return;
    submitting = true;
    const isWork = context.action === 'work';
    try {
      observer.record({
        id:     `ev-obs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action: context.action as any,
        ...(context.isInput ? { inputOf: context.processId } : { outputOf: context.processId }),
        resourceConformsTo: context.specId,
        ...(isWork
          ? { effortQuantity: { hasNumericalValue: qtyInput, hasUnit: context.unit } }
          : { resourceQuantity: { hasNumericalValue: qtyInput, hasUnit: context.unit } }),
        hasPointInTime: new Date(tsInput).toISOString(),
        ...(context.commitmentId                     ? { fulfills: context.commitmentId }          : {}),
        ...(isWork && context.providerAgentId        ? { provider: context.providerAgentId }       : {}),
        ...(notesInput                               ? { note: notesInput }                         : {}),
      });
      refresh();
      notesInput = '';
      onrecord();
    } catch (e: any) {
      errorMsg = e.message ?? 'Recording failed';
    } finally {
      submitting = false;
    }
  }
</script>

{#if context}
  <div class="panel">
    <!-- Header breadcrumb -->
    <div class="panel-header">
      <span class="breadcrumb">
        <span class="proc-name">{context.procName}</span>
        <span class="sep">›</span>
        <ActionBadge action={context.action} />
        <span class="sep">›</span>
        <span class="spec-name">{context.specName}</span>
      </span>
      <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    </div>

    <!-- Fulfillment progress bar -->
    {#if context.plannedQty > 0}
      {@const pct = Math.min(100, (context.fulfilledQty / context.plannedQty) * 100)}
      <div class="progress-wrap">
        <div class="progress-track">
          <div class="progress-fill" style="width:{pct}%; background:{pct >= 100 ? '#38a169' : pct >= 50 ? '#d69e2e' : '#e53e3e'}"></div>
        </div>
        <span class="progress-label">
          {context.fulfilledQty.toFixed(1)} / {context.plannedQty} {context.unit}
          ({pct.toFixed(0)}%)
        </span>
      </div>
    {/if}

    <!-- Recording form -->
    <form class="form" onsubmit={(ev) => { ev.preventDefault(); handleSubmit(); }}>
      <div class="form-row">
        <label class="field-label" for="erp-qty">
          {context.action === 'work' ? 'Hours worked' : `Quantity (${context.unit})`}
        </label>
        <div class="qty-row">
          <input
            id="erp-qty"
            type="number"
            min="0"
            step="any"
            bind:value={qtyInput}
            class="qty-input"
          />
          <button type="button" class="quick-btn" onclick={() => { qtyInput = remaining; }}>
            Fulfill Exactly
          </button>
        </div>
      </div>
      <div class="form-row">
        <label class="field-label" for="erp-ts">Date/Time</label>
        <input
          id="erp-ts"
          type="datetime-local"
          bind:value={tsInput}
          class="ts-input"
        />
      </div>
      <div class="form-row">
        <label class="field-label" for="erp-notes">Notes (optional)</label>
        <textarea
          id="erp-notes"
          bind:value={notesInput}
          rows="2"
          class="notes-input"
          placeholder="Optional note…"
        ></textarea>
      </div>
      {#if errorMsg}
        <div class="error-msg">{errorMsg}</div>
      {/if}
      <button type="submit" class="submit-btn" disabled={submitting || qtyInput <= 0}>
        {submitting ? 'Recording…' : 'Record Event'}
      </button>
    </form>

    <!-- Past events list -->
    {#if context.existingEvents.length > 0}
      <div class="past-events">
        <div class="past-header">Past events ({context.existingEvents.length})</div>
        {#each context.existingEvents as ev (ev.id)}
          <EventRow event={ev} class="past-row" />
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    justify-content: space-between;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    flex-wrap: wrap;
  }

  .proc-name {
    font-weight: 700;
    color: #e2e8f0;
  }

  .sep {
    opacity: 0.35;
  }

  .spec-name {
    color: rgba(226,232,240,0.7);
  }

  .close-btn {
    background: none;
    border: none;
    color: rgba(226,232,240,0.4);
    cursor: pointer;
    font-size: var(--text-xs);
    padding: 2px 4px;
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .close-btn:hover {
    color: #e2e8f0;
    background: none;
  }

  .progress-wrap {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
  }

  .progress-track {
    flex: 1;
    height: 4px;
    background: var(--border-dim);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.2s;
  }

  .progress-label {
    font-size: 0.65rem;
    opacity: 0.6;
    white-space: nowrap;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .field-label {
    font-size: 0.65rem;
    opacity: 0.45;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .qty-row {
    display: flex;
    gap: var(--gap-xs);
    align-items: center;
  }

  .qty-input {
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 3px 6px;
    width: 90px;
  }

  .ts-input {
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 3px 6px;
  }

  .notes-input {
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 3px 6px;
    resize: vertical;
  }

  .quick-btn {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 2px 6px;
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: rgba(226,232,240,0.6);
    cursor: pointer;
  }

  .quick-btn:hover {
    background: rgba(255,255,255,0.1);
    color: #e2e8f0;
  }

  .submit-btn {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 4px 12px;
    background: rgba(56,161,105,0.2);
    border: 1px solid rgba(56,161,105,0.4);
    border-radius: 3px;
    color: #68d391;
    cursor: pointer;
    align-self: flex-start;
  }

  .submit-btn:hover:not(:disabled) {
    background: rgba(56,161,105,0.35);
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .error-msg {
    font-size: 0.65rem;
    color: #fc8181;
    padding: 3px 0;
  }

  .past-events {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-top: 1px solid var(--border-faint);
    padding-top: var(--gap-sm);
  }

  .past-header {
    font-size: 0.65rem;
    opacity: 0.4;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 3px;
  }

  :global(.past-row) {
    opacity: 0.65;
  }
</style>
