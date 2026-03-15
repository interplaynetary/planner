<script lang="ts">
  import type { RecipeStore } from "$lib/knowledge/recipes";

  interface Props {
    scopeId: string;
    recipeStore: RecipeStore;
    specNames: Record<string, string>;
  }

  let { scopeId, recipeStore, specNames }: Props = $props();

  // Map each leaf commune to all output specs it can produce
  const scopeOutputSpecs: Record<string, string[]> = {
    "commune-grain":    ["wheat", "flour", "bread", "porridge", "ale"],
    "commune-dairy":    ["dairy", "butter", "cheese", "yogurt"],
    "commune-forge":    ["tools", "nails", "agri-tools"],
    "commune-workshop": ["goods", "tools", "rope", "bread"],
    "commune-olive":    ["olive-oil", "soap", "infused-oil"],
    "commune-citrus":   ["citrus", "juice", "citrus-preserve", "vinegar"],
    "commune-mill":     ["flour", "pasta", "flatbread", "bread"],
    "commune-bakery":   ["bread", "olive-bread", "citrus-loaf"],
    "commune-fisher":   ["fish", "salted-fish", "smoked-fish", "fish-chowder"],
    "commune-salter":   ["salt", "brine", "bread", "fish"],
  };

  const recipes = $derived(
    (scopeOutputSpecs[scopeId] ?? []).flatMap(spec => recipeStore.recipesForOutput(spec)),
  );
</script>

{#if recipes.length > 0}
  <div class="recipes-panel">
    <div class="panel-head">
      <span class="panel-lbl">RECIPES</span>
    </div>
    {#each recipes as recipe (recipe.id)}
      {@const chain = recipeStore.getProcessChain(recipe.id)}
      <div class="recipe-card">
        <div class="recipe-name">{recipe.name}</div>
        <div class="process-chain">
          {#each chain as rp, i (rp.id)}
            {@const { inputs, outputs } = recipeStore.flowsForProcess(rp.id)}
            {#if i > 0}<span class="chain-sep">→</span>{/if}
            <div class="process-step">
              <div class="step-name">{rp.name}</div>
              <div class="step-flows">
                {#each inputs.filter((f) => f.resourceConformsTo) as f (f.id)}
                  <span class="flow-chip flow-in"
                    >{specNames[f.resourceConformsTo!] ?? f.resourceConformsTo}</span
                  >
                {/each}
                {#if inputs.filter((f) => f.resourceConformsTo).length > 0 && outputs.filter((f) => f.resourceConformsTo).length > 0}
                  <span class="flow-sep">→</span>
                {/if}
                {#each outputs.filter((f) => f.resourceConformsTo) as f (f.id)}
                  <span class="flow-chip flow-out"
                    >{specNames[f.resourceConformsTo!] ?? f.resourceConformsTo}</span
                  >
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .recipes-panel {
    font-family: var(--font-mono);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .panel-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }

  .panel-lbl {
    font-size: 0.48rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.55;
  }

  .recipe-card {
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.02);
  }

  .recipe-name {
    font-size: 0.58rem;
    font-weight: 600;
    color: rgba(228, 238, 255, 0.9);
    margin-bottom: 5px;
  }

  .process-chain {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .chain-sep {
    font-size: 0.55rem;
    opacity: 0.5;
    padding: 0 2px;
    align-self: center;
  }

  .process-step {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .step-name {
    font-size: 0.5rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.55;
  }

  .step-flows {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    align-items: center;
  }

  .flow-sep {
    font-size: 0.52rem;
    opacity: 0.5;
  }

  .flow-chip {
    font-size: 0.5rem;
    padding: 1px 5px;
    border-radius: 2px;
    white-space: nowrap;
  }

  .flow-in {
    background: rgba(118, 195, 245, 0.1);
    border: 1px solid rgba(118, 195, 245, 0.25);
    color: rgba(180, 215, 255, 0.85);
  }

  .flow-out {
    background: rgba(104, 211, 145, 0.1);
    border: 1px solid rgba(104, 211, 145, 0.25);
    color: rgba(150, 240, 180, 0.85);
  }
</style>
