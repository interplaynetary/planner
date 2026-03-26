<script lang="ts">
  import type { EconomicResource } from "$lib/schemas";
  import type { RecipeStore } from "$lib/knowledge/recipes";

  interface AIFlow {
    id: string;
    action: string;
    resourceConformsTo?: string;
    resourceQuantity?: { hasNumericalValue: number; hasUnit: string };
    effortQuantity?: { hasNumericalValue: number; hasUnit: string };
    recipeInputOf?: string;
    recipeOutputOf?: string;
  }

  interface AIProcess {
    id: string;
    name: string;
    sequenceGroup?: number;
  }

  interface AISuggestion {
    recipe: { id: string; name: string; note?: string; primaryOutput?: string };
    processes: AIProcess[];
    flows: AIFlow[];
  }

  interface Props {
    scopeId: string;
    recipeStore: RecipeStore;
    specNames: Record<string, string>;
    resources?: EconomicResource[];
    /** Output spec IDs this scope can produce — used to look up relevant recipes. */
    outputSpecs?: string[];
  }

  let { scopeId, recipeStore, specNames, resources = [], outputSpecs = [] }: Props = $props();

  const recipes = $derived(
    [...new Set(outputSpecs)].flatMap(spec => recipeStore.recipesForOutput(spec)),
  );

  // ---------------------------------------------------------------------------
  // AI suggestion
  // ---------------------------------------------------------------------------

  let aiLoading = $state(false);
  let aiSuggestion = $state<AISuggestion | null>(null);
  let aiError = $state<string | null>(null);

  async function suggestRecipe() {
    aiLoading = true;
    aiSuggestion = null;
    aiError = null;

    const resourceList = resources.length > 0
      ? resources.map(r =>
          `${r.name ?? r.conformsTo} (${r.conformsTo}) — ${r.onhandQuantity?.hasNumericalValue ?? "?"} ${r.onhandQuantity?.hasUnit ?? ""}`
        ).join("; ")
      : "none";

    const specList = Object.keys(specNames).join(", ");

    const prompt =
      `Scope: ${scopeId}\n` +
      `On-hand resources: ${resourceList}\n` +
      `Known federation specs (use exact strings for resourceConformsTo): ${specList}\n\n` +
      `Suggest ONE new production recipe that makes creative use of the on-hand resources, ` +
      `optionally combining inputs from other federation specs. ` +
      `Do not repeat a recipe that already obviously produces the primary resource of this scope. ` +
      `1–3 processes, 3–8 flows. Recipe id must start with "ai-".`;

    try {
      const res = await fetch("/api/generate-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.success) {
        aiSuggestion = data.data as AISuggestion;
      } else {
        aiError = data.error ?? "Unknown error";
      }
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
    } finally {
      aiLoading = false;
    }
  }

  // Group flows by process ID for display
  function flowsForAIProcess(proc: AIProcess, flows: AIFlow[]) {
    const inputs = flows.filter(
      f => f.recipeInputOf === proc.id && (f.resourceConformsTo || f.effortQuantity),
    );
    const outputs = flows.filter(
      f => f.recipeOutputOf === proc.id && f.resourceConformsTo,
    );
    return { inputs, outputs };
  }

  // Sort processes by sequenceGroup then original order
  function sortedProcesses(processes: AIProcess[]): AIProcess[] {
    return [...processes].sort(
      (a, b) => (a.sequenceGroup ?? 99) - (b.sequenceGroup ?? 99),
    );
  }

  function chipLabel(f: AIFlow): string {
    if (f.resourceConformsTo) {
      const qty = f.resourceQuantity
        ? ` ${f.resourceQuantity.hasNumericalValue}${f.resourceQuantity.hasUnit}`
        : "";
      return (specNames[f.resourceConformsTo] ?? f.resourceConformsTo) + qty;
    }
    if (f.effortQuantity) {
      return `work ${f.effortQuantity.hasNumericalValue}${f.effortQuantity.hasUnit}`;
    }
    return f.action;
  }
</script>

<div class="recipes-panel">
  <div class="panel-head">
    <span class="panel-lbl">RECIPES</span>
    <button
      class="ai-btn"
      onclick={suggestRecipe}
      disabled={aiLoading}
      title="Ask AI to suggest a new recipe for this scope"
    >
      {#if aiLoading}
        <span class="ai-spin">⟳</span>
      {:else}
        ✦ suggest
      {/if}
    </button>
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

  {#if aiError}
    <div class="ai-error">{aiError}</div>
  {/if}

  {#if aiSuggestion}
    {@const procs = sortedProcesses(aiSuggestion.processes)}
    <div class="recipe-card ai-card">
      <div class="ai-badge">✦ AI</div>
      <div class="recipe-name ai-name">{aiSuggestion.recipe.name}</div>
      {#if aiSuggestion.recipe.note}
        <div class="ai-note">{aiSuggestion.recipe.note}</div>
      {/if}
      <div class="process-chain">
        {#each procs as proc, i (proc.id)}
          {@const { inputs, outputs } = flowsForAIProcess(proc, aiSuggestion.flows)}
          {#if i > 0}<span class="chain-sep">→</span>{/if}
          <div class="process-step">
            <div class="step-name">{proc.name}</div>
            <div class="step-flows">
              {#each inputs as f (f.id)}
                <span class="flow-chip flow-in">{chipLabel(f)}</span>
              {/each}
              {#if inputs.length > 0 && outputs.length > 0}
                <span class="flow-sep">→</span>
              {/if}
              {#each outputs as f (f.id)}
                <span class="flow-chip flow-out">{chipLabel(f)}</span>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <button class="dismiss-btn" onclick={() => (aiSuggestion = null)}>dismiss</button>
    </div>
  {/if}
</div>

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

  .ai-btn {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.48rem;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border-radius: 3px;
    border: 1px solid rgba(167, 139, 250, 0.35);
    background: rgba(167, 139, 250, 0.08);
    color: rgba(196, 181, 253, 0.85);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .ai-btn:hover:not(:disabled) {
    background: rgba(167, 139, 250, 0.16);
    border-color: rgba(167, 139, 250, 0.55);
  }

  .ai-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ai-spin {
    display: inline-block;
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .recipe-card {
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.02);
    position: relative;
  }

  .ai-card {
    border-color: rgba(167, 139, 250, 0.30);
    background: rgba(167, 139, 250, 0.04);
  }

  .ai-badge {
    position: absolute;
    top: 5px;
    right: 7px;
    font-size: 0.42rem;
    letter-spacing: 0.08em;
    color: rgba(196, 181, 253, 0.6);
  }

  .recipe-name {
    font-size: 0.58rem;
    font-weight: 600;
    color: rgba(228, 238, 255, 0.9);
    margin-bottom: 5px;
  }

  .ai-name {
    color: rgba(216, 200, 255, 0.95);
    padding-right: 28px;
  }

  .ai-note {
    font-size: 0.46rem;
    color: rgba(196, 181, 253, 0.55);
    margin-bottom: 5px;
    line-height: 1.4;
  }

  .ai-error {
    font-size: 0.5rem;
    color: rgba(252, 88, 88, 0.75);
    padding: 4px 6px;
    border: 1px solid rgba(252, 88, 88, 0.2);
    border-radius: 3px;
  }

  .dismiss-btn {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 0.44rem;
    letter-spacing: 0.06em;
    padding: 1px 6px;
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: rgba(255, 255, 255, 0.3);
    cursor: pointer;
  }

  .dismiss-btn:hover {
    color: rgba(255, 255, 255, 0.55);
    border-color: rgba(255, 255, 255, 0.2);
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
