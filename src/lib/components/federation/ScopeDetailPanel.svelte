<script lang="ts">
  import DeficitResidualBar from "./DeficitResidualBar.svelte";
  import ScopeNetworkDiagram from "./ScopeNetworkDiagram.svelte";
  import type {
    SimpleBufferZone,
    SimpleCapacityBuffer,
  } from "./ScopeNetworkDiagram.svelte";
  import type { ScopePlanResult } from "$lib/planning/plan-for-scope";
  import type { StoreRegistry } from "$lib/planning/store-registry";
  import type { TradeProposal } from "$lib/planning/plan-federation";
  import type { Observer } from "$lib/observation/observer";
  import type { FlowSelectCtx } from "$lib/components/vf/observe-types";

  interface Props {
    scopeId: string;
    result: ScopePlanResult;
    observer: Observer;
    specNames: Record<string, string>;
    registry: StoreRegistry;
    tradeProposals?: TradeProposal[];
    bufferZones?: SimpleBufferZone[];
    capacityBuffers?: SimpleCapacityBuffer[];
    onclose: () => void;
  }

  let {
    scopeId,
    result,
    observer,
    specNames,
    registry,
    tradeProposals = [],
    bufferZones = [],
    capacityBuffers = [],
    onclose,
  }: Props = $props();

  const outgoingTrades = $derived(
    tradeProposals.filter((t) => t.fromScopeId === scopeId),
  );
  const incomingTrades = $derived(
    tradeProposals.filter((t) => t.toScopeId === scopeId),
  );
  const hasTrades = $derived(
    outgoingTrades.length > 0 || incomingTrades.length > 0,
  );

  function tradeStatusColor(status: TradeProposal["status"]): string {
    if (status === "settled") return "#68d391";
    return "#63b3ed";
  }

  let mode = $state<"plan" | "observe">("plan");

  // ── Observe mode: inline event recorder ─────────────────────────────────────
  let flowCtx     = $state<FlowSelectCtx | null>(null);
  let observerTick = $state(0);
  let recordQty   = $state(0);
  let recordTs    = $state('');
  let recordNotes = $state('');
  let recordError = $state<string | null>(null);
  let submitting  = $state(false);

  function handleFlowSelect(ctx: FlowSelectCtx) {
    flowCtx     = ctx;
    recordQty   = Math.max(0, ctx.plannedQty - ctx.fulfilledQty);
    recordTs    = new Date().toISOString().slice(0, 16);
    recordError = null;
  }

  function handleRecord() {
    if (!flowCtx || recordQty <= 0) return;
    submitting = true;
    const ctx = flowCtx;
    const isWork = ctx.action === 'work';
    try {
      observer.record({
        id: `ev-scope-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action: ctx.action as any,
        ...(ctx.isInput ? { inputOf: ctx.processId } : { outputOf: ctx.processId }),
        resourceConformsTo: ctx.specId,
        ...(isWork
          ? { effortQuantity: { hasNumericalValue: recordQty, hasUnit: ctx.unit } }
          : { resourceQuantity: { hasNumericalValue: recordQty, hasUnit: ctx.unit } }),
        hasPointInTime: new Date(recordTs).toISOString(),
        ...(ctx.commitmentId ? { fulfills: ctx.commitmentId } : {}),
        ...(isWork && ctx.providerAgentId ? { provider: ctx.providerAgentId } : {}),
        ...(recordNotes ? { note: recordNotes } : {}),
      });
      observerTick++;
      recordNotes = '';
      recordError = null;
      // Refresh the ctx so past events list and progress update
      const updatedEvents = observer.allEvents().filter(e =>
        (ctx.isInput ? e.inputOf === ctx.processId : e.outputOf === ctx.processId) &&
        e.resourceConformsTo === ctx.specId
      );
      const fs = ctx.commitmentId ? observer.getFulfillment(ctx.commitmentId) : null;
      flowCtx = {
        ...ctx,
        existingEvents: updatedEvents,
        fulfilledQty: fs?.totalFulfilled.hasNumericalValue ?? (ctx.fulfilledQty + recordQty),
      };
    } catch (e: any) {
      recordError = e.message ?? 'Recording failed';
    } finally {
      submitting = false;
    }
  }
</script>

<aside class="detail-panel" aria-label="Scope detail: {scopeId}">
  <div class="panel-header">
    <div class="header-left">
      <span class="scope-label">SCOPE</span>
      <span class="scope-name">{scopeId}</span>
    </div>
    <div class="header-right">
      <div class="mode-tabs">
        <button
          class="tab-btn"
          class:active={mode === "plan"}
          onclick={() => (mode = "plan")}>PLAN</button
        >
        <button
          class="tab-btn"
          class:active={mode === "observe"}
          onclick={() => (mode = "observe")}>OBSERVE</button
        >
      </div>
      <button class="close-btn" onclick={onclose} aria-label="Close panel"
        >✕</button
      >
    </div>
  </div>

  <!-- Signals band — always visible -->
  <div class="signals-band">
    {#if result.deficits.length > 0}
      <div class="section-label">DEFICITS</div>
      {#each result.deficits as deficit (deficit.intentId)}
        <DeficitResidualBar
          specId={deficit.specId}
          shortfall={deficit.shortfall}
          originalShortfall={deficit.originalShortfall}
          resolvedAt={deficit.resolvedAt ?? []}
        />
      {/each}
    {/if}

    {#if result.surplus.length > 0}
      <div class="section-label">SURPLUS</div>
      {#each result.surplus as s, i (s.specId + '-' + i)}
        <div class="signal-row">
          <span class="signal-spec">{s.specId}</span>
          <span class="green">{s.quantity}</span>
          {#if s.availableFrom}<span class="muted">{s.availableFrom}</span>{/if}
        </div>
      {/each}
    {/if}

    {#if result.metabolicDebt.length > 0}
      <div class="section-label">METABOLIC DEBT</div>
      {#each result.metabolicDebt as debt, i (debt.specId + '-' + i)}
        <div class="signal-row">
          <span class="signal-spec">{debt.specId}</span>
          <span class="yellow">{debt.shortfall}</span>
        </div>
      {/each}
    {/if}

    {#if hasTrades}
      <div class="section-label">INTER-SCOPE SUPPORTS</div>
      {#each outgoingTrades as t (t.id)}
        <div class="trade-row">
          <span class="trade-arrow" style="color:#63b3ed">→</span>
          <span class="trade-peer">{t.toScopeId}</span>
          <span class="trade-spec">{t.specId}</span>
          <span class="trade-qty">×{t.quantity}</span>
          <span class="trade-status" style="color:{tradeStatusColor(t.status)}"
            >{t.status.toUpperCase()}</span
          >
        </div>
      {/each}
      {#each incomingTrades as t (t.id)}
        <div class="trade-row">
          <span class="trade-arrow" style="color:#68d391">←</span>
          <span class="trade-peer">{t.fromScopeId}</span>
          <span class="trade-spec">{t.specId}</span>
          <span class="trade-qty">×{t.quantity}</span>
          <span class="trade-status" style="color:{tradeStatusColor(t.status)}"
            >{t.status.toUpperCase()}</span
          >
        </div>
      {/each}
    {/if}

    {#if result.deficits.length === 0 && result.surplus.length === 0 && result.metabolicDebt.length === 0 && !hasTrades}
      <p class="empty">No signals.</p>
    {/if}
  </div>

  <!-- Network diagram — mode-toggled -->
  <section class="panel-section diagram-section">
    <div class="section-label">NETWORK</div>
    <ScopeNetworkDiagram
      planStore={result.planStore}
      {observer}
      {specNames}
      {mode}
      {bufferZones}
      {capacityBuffers}
      {observerTick}
      onflowselect={handleFlowSelect}
    />
  </section>

  <!-- Inline event recorder — appears when a card is clicked in observe mode -->
  {#if flowCtx && mode === 'observe'}
    {@const pct = flowCtx.plannedQty > 0
      ? Math.min(100, (flowCtx.fulfilledQty / flowCtx.plannedQty) * 100)
      : 0}
    <section class="panel-section recorder-section">
      <div class="rec-header">
        <div class="rec-breadcrumb">
          <span class="rec-proc">{flowCtx.procName}</span>
          <span class="rec-sep">›</span>
          <span class="rec-action" style="color:{flowCtx.action === 'work' ? '#9f7aea' : flowCtx.action === 'produce' ? '#38a169' : '#e53e3e'}">{flowCtx.action}</span>
          <span class="rec-sep">›</span>
          <span class="rec-spec">{flowCtx.specName}</span>
        </div>
        <button class="rec-close" onclick={() => (flowCtx = null)} aria-label="Close recorder">✕</button>
      </div>

      {#if flowCtx.plannedQty > 0}
        <div class="rec-progress">
          <div class="rec-track">
            <div class="rec-fill" style="width:{pct}%; background:{pct >= 100 ? '#38a169' : pct >= 50 ? '#d69e2e' : '#e53e3e'}"></div>
          </div>
          <span class="rec-pct-label">{flowCtx.fulfilledQty.toFixed(1)} / {flowCtx.plannedQty} {flowCtx.unit} ({pct.toFixed(0)}%)</span>
        </div>
      {/if}

      <form class="rec-form" onsubmit={(ev) => { ev.preventDefault(); handleRecord(); }}>
        <div class="rec-row">
          <label class="rec-label" for="sdp-qty">
            {flowCtx.action === 'work' ? 'Hours worked' : `Quantity (${flowCtx.unit})`}
          </label>
          <div class="rec-qty-row">
            <input id="sdp-qty" type="number" min="0" step="any" bind:value={recordQty} class="rec-input-qty" />
            <button type="button" class="rec-exact-btn"
              onclick={() => { recordQty = Math.max(0, (flowCtx?.plannedQty ?? 0) - (flowCtx?.fulfilledQty ?? 0)); }}>
              Fulfill Exactly
            </button>
          </div>
        </div>
        <div class="rec-row">
          <label class="rec-label" for="sdp-ts">Date / Time</label>
          <input id="sdp-ts" type="datetime-local" bind:value={recordTs} class="rec-input-ts" />
        </div>
        <div class="rec-row">
          <label class="rec-label" for="sdp-notes">Notes (optional)</label>
          <textarea id="sdp-notes" bind:value={recordNotes} rows="2" class="rec-input-notes" placeholder="Optional note…"></textarea>
        </div>
        {#if recordError}
          <div class="rec-error">{recordError}</div>
        {/if}
        <button type="submit" class="rec-submit" disabled={submitting || recordQty <= 0}>
          {submitting ? 'Recording…' : 'Record Event'}
        </button>
      </form>

      {#if flowCtx.existingEvents.length > 0}
        <div class="rec-past">
          <div class="rec-past-header">Past events ({flowCtx.existingEvents.length})</div>
          {#each flowCtx.existingEvents as ev (ev.id)}
            <div class="rec-past-row">
              <span class="rec-past-ts">{new Date(ev.hasPointInTime ?? '').toLocaleString()}</span>
              <span class="rec-past-qty">
                {ev.resourceQuantity?.hasNumericalValue ?? ev.effortQuantity?.hasNumericalValue ?? '?'}
                {ev.resourceQuantity?.hasUnit ?? ev.effortQuantity?.hasUnit ?? ''}
              </span>
              {#if ev.note}<span class="rec-past-note">{ev.note}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</aside>

<style>
  .detail-panel {
    width: 480px;
    min-width: 480px;
    background: var(--bg-surface);
    border-left: 1px solid var(--border-faint);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border-faint);
    gap: 8px;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .scope-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    opacity: 0.58;
    text-transform: uppercase;
  }

  .scope-name {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: rgba(228, 238, 255, 0.96);
    word-break: break-all;
  }

  .mode-tabs {
    display: flex;
    gap: 2px;
  }

  .tab-btn {
    background: none;
    border: 1px solid var(--border-dim);
    color: rgba(200, 220, 255, 0.62);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    padding: 3px 8px;
    border-radius: 3px;
    transition:
      color 0.15s,
      border-color 0.15s,
      background 0.15s;
  }

  .tab-btn:hover {
    color: rgba(228, 238, 255, 0.88);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .tab-btn.active {
    color: rgba(228, 238, 255, 0.98);
    border-color: rgba(255, 255, 255, 0.5);
    background: var(--border-faint);
  }

  .close-btn {
    background: none;
    border: 1px solid var(--border-dim);
    color: rgba(200, 220, 255, 0.7);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 4px 7px;
    border-radius: 3px;
    flex-shrink: 0;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .close-btn:hover {
    color: rgba(228, 238, 255, 0.98);
    border-color: rgba(255, 255, 255, 0.45);
  }

  .signals-band {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-faint);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .panel-section {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-faint);
  }

  .diagram-section {
    overflow-x: auto;
  }

  .section-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.58;
    margin-bottom: 8px;
  }

  .signals-band .section-label {
    margin-bottom: 4px;
    margin-top: 4px;
  }

  .signals-band .section-label:first-child {
    margin-top: 0;
  }

  .empty {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.52;
    margin: 0;
  }

  .signal-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: 0.65rem;
  }

  .signal-spec {
    color: rgba(210, 228, 255, 0.88);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .green {
    color: #7ee8a2;
  }
  .yellow {
    color: #e8b04e;
  }
  .muted {
    opacity: 0.6;
    font-size: 0.58rem;
  }

  .trade-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: 0.62rem;
  }

  .trade-arrow {
    font-size: 0.72rem;
    flex-shrink: 0;
  }

  .trade-peer {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(210, 228, 255, 0.88);
  }

  .trade-spec {
    color: rgba(180, 205, 255, 0.65);
    flex-shrink: 0;
  }
  .trade-qty {
    color: rgba(190, 215, 255, 0.72);
    flex-shrink: 0;
  }

  .trade-status {
    font-size: 0.48rem;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  /* ── Inline event recorder ─────────────────────────────────────────── */
  .recorder-section {
    background: rgba(159, 122, 234, 0.04);
    border-top: 1px solid rgba(159, 122, 234, 0.2);
  }

  .rec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .rec-breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 0.62rem;
  }

  .rec-proc {
    font-weight: 700;
    color: rgba(228, 238, 255, 0.9);
  }

  .rec-sep {
    opacity: 0.35;
  }

  .rec-spec {
    color: rgba(226, 232, 240, 0.65);
  }

  .rec-close {
    background: none;
    border: none;
    color: rgba(226, 232, 240, 0.4);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 2px 4px;
    flex-shrink: 0;
  }

  .rec-close:hover {
    color: rgba(226, 232, 240, 0.9);
  }

  .rec-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .rec-track {
    flex: 1;
    height: 4px;
    background: var(--border-dim);
    border-radius: 2px;
    overflow: hidden;
  }

  .rec-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.2s;
  }

  .rec-pct-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.55;
    white-space: nowrap;
  }

  .rec-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rec-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .rec-label {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    opacity: 0.42;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .rec-qty-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .rec-input-qty {
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 3px 6px;
    width: 90px;
  }

  .rec-input-ts {
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 3px 6px;
  }

  .rec-input-notes {
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 3px 6px;
    resize: vertical;
  }

  .rec-exact-btn {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    padding: 2px 6px;
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: rgba(226, 232, 240, 0.55);
    cursor: pointer;
  }

  .rec-exact-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
  }

  .rec-submit {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 4px 12px;
    background: rgba(56, 161, 105, 0.18);
    border: 1px solid rgba(56, 161, 105, 0.38);
    border-radius: 3px;
    color: #68d391;
    cursor: pointer;
    align-self: flex-start;
    margin-top: 2px;
  }

  .rec-submit:hover:not(:disabled) {
    background: rgba(56, 161, 105, 0.32);
  }

  .rec-submit:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  .rec-error {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: #fc8181;
    padding: 2px 0;
  }

  .rec-past {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-top: 1px solid var(--border-faint);
    margin-top: 8px;
    padding-top: 8px;
  }

  .rec-past-header {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    opacity: 0.38;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 3px;
  }

  .rec-past-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.65;
  }

  .rec-past-ts {
    color: rgba(210, 228, 255, 0.55);
    flex-shrink: 0;
  }

  .rec-past-qty {
    color: #7ee8a2;
    flex-shrink: 0;
  }

  .rec-past-note {
    color: rgba(210, 228, 255, 0.45);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
