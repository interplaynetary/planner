<script lang="ts">
  import type { RecipeProcess, RecipeFlow } from '$lib/schemas';

  interface Props {
    processes: RecipeProcess[];
    flows: RecipeFlow[];
    specNames?: Map<string, string>;
    depth?: number;
    class?: string;
  }

  let { processes, flows, specNames, depth = 0, class: cls = '' }: Props = $props();

  // Build a map: outputSpecId -> RecipeProcess (the one that produces it)
  const outputToProcess = $derived(() => {
    const map = new Map<string, RecipeProcess>();
    for (const p of processes) {
      const outputFlows = flows.filter(f => f.recipeOutputOf === p.id);
      for (const f of outputFlows) {
        if (f.resourceConformsTo) map.set(f.resourceConformsTo, p);
      }
    }
    return map;
  });

  // Find root processes: processes that are NOT produced as output by another process
  const producedSpecs = $derived(() => {
    const set = new Set<string>();
    for (const f of flows) {
      if (f.recipeOutputOf && f.resourceConformsTo) set.add(f.recipeOutputOf);
    }
    return set;
  });
</script>

<ul class="bom {cls}" style="--depth:{depth}">
  {#each processes as p}
    {@const childFlows = flows.filter(f => f.recipeInputOf === p.id)}
    <li>
      <span class="proc">{p.name}</span>
      {#if p.hasDuration}<span class="muted">{p.hasDuration.hasNumericalValue}{p.hasDuration.hasUnit}</span>{/if}
      {#if childFlows.length}
        <ul class="bom" style="--depth:{depth + 1}">
          {#each childFlows as f}
            <li>
              <span class="flow">{specNames?.get(f.resourceConformsTo ?? '') ?? f.resourceConformsTo?.slice(0, 12) ?? '?'}</span>
              {#if f.resourceQuantity}<span class="mono">{f.resourceQuantity.hasNumericalValue} {f.resourceQuantity.hasUnit}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .bom {
    list-style: none;
    padding-left: calc(var(--depth, 0) * 16px);
    margin: 0;
    font-size: var(--text-xs);
  }
  li { padding: 2px 0; }
  .proc { font-weight: 500; }
  .flow { opacity: 0.85; }
  .muted { opacity: var(--muted); }
  .mono { font-family: var(--font-mono); }
</style>
