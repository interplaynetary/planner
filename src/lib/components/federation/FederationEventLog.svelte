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
      case 'scope-planned':         return '◆';
      case 'deficit-announced':     return '▽';
      case 'surplus-offered':       return '△';
      case 'lateral-match':         return '⇄';
      case 'deficit-propagated':    return '↑';
      case 'residual-unresolved':   return '✕';
      case 'sacrifice-rebalanced':  return '⚖';
      default: return '·';
    }
  }

  function eventColor(kind: FederationEventKind): string {
    switch (kind) {
      case 'scope-planned':         return 'rgba(255,255,255,0.45)';
      case 'deficit-announced':     return '#e53e3e';
      case 'surplus-offered':       return '#68d391';
      case 'lateral-match':         return '#63b3ed';
      case 'deficit-propagated':    return '#d69e2e';
      case 'residual-unresolved':   return '#fc8181';
      case 'sacrifice-rebalanced':  return '#b794f4';
      default: return 'rgba(255,255,255,0.3)';
    }
  }

  function chipTitle(e: FederationEvent): string {
    const parts = [e.kind, e.scopeId];
    if (e.targetScopeId) parts.push('→ ' + e.targetScopeId);
    if (e.specId) parts.push('| ' + e.specId);
    if (e.quantity !== undefined) parts.push('× ' + e.quantity);
    if (e.sacrificePerMember !== undefined) parts.push(`actual ${e.sacrificePerMember.toFixed(2)}/member`);
    if (e.targetSacrificePerMember !== undefined) parts.push(`target ${e.targetSacrificePerMember.toFixed(2)}/member`);
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
    flex-direction: column;
    width: 148px;
    min-width: 148px;
    background: var(--bg-base);
    border-right: 1px solid var(--border-faint);
    flex-shrink: 0;
    overflow: hidden;
  }

  .log-label {
    font-family: var(--font-mono);
    font-size: 0.44rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    opacity: 0.50;
    padding: 10px 10px 6px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-faint);
    white-space: nowrap;
  }

  .rounds-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }

  .round-group {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .round-group:last-child {
    border-bottom: none;
  }

  .round-header {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px 3px;
    border-bottom: 1px solid var(--border-faint);
  }

  .round-label {
    font-family: var(--font-mono);
    font-size: 0.44rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.55;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .round-count {
    font-family: var(--font-mono);
    font-size: 0.44rem;
    opacity: 0.55;
    background: var(--border-faint);
    border-radius: 2px;
    padding: 0 3px;
    flex-shrink: 0;
  }

  .events-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 6px;
  }

  .event-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    padding: 2px 5px;
    cursor: default;
    transition: background 0.1s;
    min-width: 0;
    overflow: hidden;
  }

  .event-chip:hover {
    background: var(--bg-overlay);
  }

  .evt-icon {
    font-size: 0.55rem;
    flex-shrink: 0;
  }

  .evt-scope {
    font-family: var(--font-mono);
    font-size: 0.54rem;
    color: rgba(255,255,255,0.6);
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .evt-arrow {
    font-size: 0.5rem;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .evt-spec {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .evt-qty {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }
</style>
