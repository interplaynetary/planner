<script lang="ts">
  import type { RoutingGeometry, DecouplingCandidateResult } from '$lib/algorithms/positioning';

  interface Chain {
    recipeId: string;
    name: string;
    geometry: RoutingGeometry[];
  }

  interface Props {
    chains: Chain[];
    candidates?: DecouplingCandidateResult[];
    onselect?: (processId: string) => void;
    selectedProcessId?: string | null;
    class?: string;
  }

  let { chains, candidates, onselect, selectedProcessId, class: cls = '' }: Props = $props();

  const candidateMap = $derived(new Map(candidates?.map(c => [c.processId, c]) ?? []));

  function nodeColor(g: RoutingGeometry): string {
    if (g.isConvergent) return 'excess';
    if (g.isDivergent)  return 'yellow';
    if (g.isGatingPoint) return 'green';
    return 'other';
  }
</script>

<div class="dpm {cls}">
  {#each chains as chain}
    <div class="chain">
      <span class="chain-name muted">{chain.name}</span>
      <div class="nodes">
        {#each chain.geometry as g}
          {@const cand = candidateMap.get(g.processId)}
          <button
            class="node {nodeColor(g)}"
            class:selected={g.processId === selectedProcessId}
            style="width: {Math.max(24, g.durationDays * 8)}px"
            onclick={() => onselect?.(g.processId)}
            title={g.processId}
          >
            {#if cand}<span class="score">{cand.positioningScore.toFixed(0)}</span>{/if}
          </button>
          <span class="arrow muted">→</span>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .dpm { display: flex; flex-direction: column; gap: var(--gap-sm); }
  .chain { display: flex; flex-direction: column; gap: 2px; }
  .chain-name { font-size: var(--text-xs); }
  .nodes { display: flex; align-items: center; gap: var(--gap-sm); flex-wrap: wrap; }
  .node {
    height: 20px;
    min-width: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: 0.7;
    border: none;
    outline: none;
  }
  .node:hover { opacity: 1; }
  .node.excess  { background: var(--zone-excess-fill); color: var(--zone-excess); }
  .node.yellow  { background: var(--zone-yellow-fill); color: var(--zone-yellow); }
  .node.green   { background: var(--zone-green-fill);  color: var(--zone-green); }
  .node.other   { background: var(--border-dim);  color: inherit; }
  .node.selected { outline: 2px solid var(--zone-green); opacity: 1; }
  .arrow { font-size: var(--text-xs); }
  .score { font-size: 9px; }
  .muted { opacity: var(--muted); }
</style>
