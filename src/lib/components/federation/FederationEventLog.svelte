<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import type { FederationEvent, FederationEventKind } from '$lib/planning/plan-federation';

  interface Props {
    events: FederationEvent[];
  }

  let { events }: Props = $props();

  const grouped = $derived.by(() => {
    const rounds = new SvelteMap<number, FederationEvent[]>();
    for (const e of events) {
      if (!rounds.has(e.round)) rounds.set(e.round, []);
      rounds.get(e.round)!.push(e);
    }
    return [...rounds.entries()].sort(([a], [b]) => a - b);
  });

  const ROUND_LABELS: Record<number, string> = {
    0: 'PASS 0  BOTTOM-UP',
    1: 'PASS 1  LATERAL',
    2: 'PASS 2  RESIDUALS',
  };

  function eventIcon(kind: FederationEventKind): string {
    switch (kind) {
      case 'scope-planned':       return '◆';
      case 'deficit-announced':   return '▽';
      case 'surplus-offered':     return '△';
      case 'lateral-match':       return '⇄';
      case 'deficit-propagated':  return '↑';
      case 'residual-unresolved': return '✕';
      default: return '·';
    }
  }

  function eventColor(kind: FederationEventKind): string {
    switch (kind) {
      case 'scope-planned':       return 'rgba(255,255,255,0.45)';
      case 'deficit-announced':   return '#e53e3e';
      case 'surplus-offered':     return '#68d391';
      case 'lateral-match':       return '#63b3ed';
      case 'deficit-propagated':  return '#d69e2e';
      case 'residual-unresolved': return '#fc8181';
      default: return 'rgba(255,255,255,0.3)';
    }
  }

  function chipTitle(e: FederationEvent): string {
    const parts = [e.kind, e.scopeId];
    if (e.targetScopeId) parts.push('→ ' + e.targetScopeId);
    if (e.specId) parts.push('| ' + e.specId);
    if (e.quantity !== undefined) parts.push('× ' + e.quantity);
    return parts.join('  ');
  }
</script>

<div class="event-log">
  <div class="log-label">FEDERATION EVENT LOG</div>
  <div class="rounds-wrap">
    {#each grouped as [round, evts] (round)}
      <div class="round-group">
        <div class="round-header">
          <span class="round-label">{ROUND_LABELS[round] ?? `PASS ${round}`}</span>
          <span class="round-count">{evts.length}</span>
        </div>
        <div class="events-row">
          {#each evts as evt, i (`${round}-${i}`)}
            {@const color = eventColor(evt.kind)}
            <div
              class="event-chip"
              style="--chip-color:{color}; border-color:{color}22"
              title={chipTitle(evt)}
            >
              <span class="evt-icon" style="color:{color}">{eventIcon(evt.kind)}</span>
              <span class="evt-scope">{evt.scopeId}</span>
              {#if evt.targetScopeId}
                <span class="evt-arrow" style="color:{color}">→</span>
                <span class="evt-scope">{evt.targetScopeId}</span>
              {/if}
              {#if evt.specId}
                <span class="evt-spec" style="color:{color}bb">{evt.specId}</span>
              {/if}
              {#if evt.quantity !== undefined}
                <span class="evt-qty" style="color:{color}88">×{evt.quantity}</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .event-log {
    display: flex;
    align-items: stretch;
    gap: 0;
    background: #0d0d0d;
    border-top: 1px solid rgba(255,255,255,0.06);
    height: 90px;
    flex-shrink: 0;
    overflow: hidden;
  }

  .log-label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    transform: rotate(180deg);
    font-family: var(--font-mono);
    font-size: 0.48rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    opacity: 0.2;
    padding: 8px 10px;
    flex-shrink: 0;
    border-right: 1px solid rgba(255,255,255,0.05);
    white-space: nowrap;
  }

  .rounds-wrap {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }

  .round-group {
    display: flex;
    flex-direction: column;
    border-right: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }

  .round-group:last-child {
    border-right: none;
  }

  .round-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 4px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }

  .round-label {
    font-family: var(--font-mono);
    font-size: 0.48rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.3;
    white-space: nowrap;
  }

  .round-count {
    font-family: var(--font-mono);
    font-size: 0.48rem;
    opacity: 0.2;
    background: rgba(255,255,255,0.06);
    border-radius: 2px;
    padding: 0 4px;
  }

  .events-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .events-row::-webkit-scrollbar { display: none; }

  .event-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 3px;
    padding: 3px 7px;
    white-space: nowrap;
    cursor: default;
    transition: background 0.1s;
    flex-shrink: 0;
  }

  .event-chip:hover {
    background: rgba(255,255,255,0.07);
  }

  .evt-icon {
    font-size: 0.6rem;
    flex-shrink: 0;
  }

  .evt-scope {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    color: rgba(255,255,255,0.6);
    letter-spacing: 0.04em;
  }

  .evt-arrow {
    font-size: 0.55rem;
    opacity: 0.7;
  }

  .evt-spec {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.06em;
  }

  .evt-qty {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.04em;
  }
</style>
