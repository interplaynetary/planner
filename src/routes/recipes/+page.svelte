<script lang="ts">
  import '$lib/components/ui/tokens.css';

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  interface AIFlow {
    id: string;
    action: string;
    resourceConformsTo?: string;
    resourceQuantity?: { hasNumericalValue: number; hasUnit: string };
    effortQuantity?: { hasNumericalValue: number; hasUnit: string };
    recipeInputOf?: string;
    recipeOutputOf?: string;
    note?: string;
  }

  interface AIProcess {
    id: string;
    name: string;
    note?: string;
    hasDuration?: { hasNumericalValue: number; hasUnit: string };
    sequenceGroup?: number;
  }

  interface GeneratedRecipe {
    recipe: { id: string; name: string; note?: string; primaryOutput?: string };
    processes: AIProcess[];
    flows: AIFlow[];
    active: boolean;
  }

  // ---------------------------------------------------------------------------
  // Example prompts
  // ---------------------------------------------------------------------------

  const EXAMPLES = [
    'Bake sourdough bread from flour, water, and salt',
    'Forge iron tools from ore and charcoal via smelting and smithing',
    'Press olive oil from fresh olives',
    'Mill wheat into flour using stone grinding',
    'Brew ale from malted barley, hops, and yeast',
    'Cure fish with salt for long-term preservation',
    'Weave linen fabric from flax fibre',
    'Make cheese from fresh dairy milk',
  ];

  // ---------------------------------------------------------------------------
  // Page state
  // ---------------------------------------------------------------------------

  let prompt     = $state('');
  let generating = $state(false);
  let errorMsg   = $state('');
  let generated  = $state<GeneratedRecipe[]>([]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function generate() {
    if (!prompt.trim() || generating) return;
    generating = true;
    errorMsg   = '';
    try {
      const res = await fetch('/api/generate-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.success) {
        generated = [{ ...data.data, active: true }, ...generated];
      } else {
        errorMsg = data.error ?? 'Generation failed.';
      }
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Network error.';
    }
    generating = false;
  }

  function toggleActive(r: GeneratedRecipe) {
    r.active = !r.active;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const ACTION_COLORS: Record<string, string> = {
    produce:          '#7ee8a2',
    consume:          '#fc5858',
    work:             '#76c3f5',
    transfer:         '#e8b04e',
    use:              '#b0c4f0',
    move:             '#b0c4f0',
    transferAllRights:'#e8b04e',
    transferCustody:  '#e8b04e',
    transferComplete: '#e8b04e',
  };

  function actionColor(action: string): string {
    return ACTION_COLORS[action] ?? 'rgba(255,255,255,0.45)';
  }

  function sortedProcesses(processes: AIProcess[]): AIProcess[] {
    return [...processes].sort(
      (a, b) => (a.sequenceGroup ?? 99) - (b.sequenceGroup ?? 99),
    );
  }

  function inputFlows(r: GeneratedRecipe, procId: string): AIFlow[] {
    return r.flows.filter((f) => f.recipeInputOf === procId);
  }

  function outputFlows(r: GeneratedRecipe, procId: string): AIFlow[] {
    return r.flows.filter((f) => f.recipeOutputOf === procId);
  }
</script>

<div class="page">
  <!-- ---- Header ---- -->
  <header class="page-header">
    <span class="page-title">RECIPE WORKSHOP</span>
    {#if generated.length > 0}
      <span class="recipe-count">{generated.length} recipe{generated.length !== 1 ? 's' : ''}</span>
    {/if}
  </header>

  <!-- ---- Prompt area ---- -->
  <div class="prompt-area">
    <div class="examples-row">
      <span class="examples-lbl">EXAMPLES</span>
      {#each EXAMPLES as ex (ex)}
        <button class="chip" onclick={() => (prompt = ex)}>{ex}</button>
      {/each}
    </div>

    <div class="input-row">
      <textarea
        class="prompt-input"
        bind:value={prompt}
        placeholder="Describe a production process — inputs, outputs, steps…"
        rows="3"
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();
        }}
      ></textarea>
      <button
        class="generate-btn"
        onclick={generate}
        disabled={generating || !prompt.trim()}
      >
        {#if generating}
          <span class="spinner"></span> GENERATING…
        {:else}
          GENERATE RECIPE
        {/if}
      </button>
    </div>

    {#if errorMsg}
      <div class="error-msg">{errorMsg}</div>
    {/if}
  </div>

  <!-- ---- Cards grid ---- -->
  <div class="cards-area">
    {#if generated.length === 0}
      <div class="empty-state">
        <span class="empty-label">No recipes yet.</span>
        <span class="empty-sub">Pick an example or describe a process above.</span>
      </div>
    {:else}
      {#each generated as r (r.recipe.id)}
        <div class="recipe-card" class:active={r.active} class:inactive={!r.active}>
          <!-- Card header -->
          <div class="card-head">
            <div class="card-name-wrap">
              <span class="card-name">{r.recipe.name}</span>
              {#if r.recipe.primaryOutput}
                <span class="card-output">{r.recipe.primaryOutput}</span>
              {/if}
            </div>
            <button
              class="toggle-pill"
              class:pill-on={r.active}
              onclick={() => toggleActive(r)}
            >
              {r.active ? 'ACTIVE' : 'INACTIVE'}
            </button>
          </div>

          {#if r.recipe.note}
            <div class="card-note">{r.recipe.note}</div>
          {/if}

          <!-- Processes + flows -->
          <div class="proc-section">
            {#each sortedProcesses(r.processes) as p (p.id)}
              <div class="proc-block">
                <div class="proc-head">
                  {#if p.sequenceGroup !== undefined}
                    <span class="proc-seq">{p.sequenceGroup}</span>
                  {/if}
                  <span class="proc-name">{p.name}</span>
                  {#if p.hasDuration}
                    <span class="proc-dur">
                      {p.hasDuration.hasNumericalValue} {p.hasDuration.hasUnit}
                    </span>
                  {/if}
                </div>

                <!-- Input flows -->
                {#each inputFlows(r, p.id) as f (f.id)}
                  <div class="flow-row">
                    <span class="action-badge" style="color:{actionColor(f.action)};border-color:{actionColor(f.action)}40">{f.action}</span>
                    <span class="flow-spec">{f.resourceConformsTo ?? '—'}</span>
                    {#if f.resourceQuantity}
                      <span class="flow-qty">{f.resourceQuantity.hasNumericalValue} {f.resourceQuantity.hasUnit}</span>
                    {:else if f.effortQuantity}
                      <span class="flow-qty">{f.effortQuantity.hasNumericalValue} {f.effortQuantity.hasUnit}</span>
                    {/if}
                  </div>
                {/each}

                <!-- Output flows -->
                {#each outputFlows(r, p.id) as f (f.id)}
                  <div class="flow-row">
                    <span class="action-badge" style="color:{actionColor(f.action)};border-color:{actionColor(f.action)}40">{f.action}</span>
                    <span class="flow-spec">{f.resourceConformsTo ?? '—'}</span>
                    {#if f.resourceQuantity}
                      <span class="flow-qty">{f.resourceQuantity.hasNumericalValue} {f.resourceQuantity.hasUnit}</span>
                    {:else if f.effortQuantity}
                      <span class="flow-qty">{f.effortQuantity.hasNumericalValue} {f.effortQuantity.hasUnit}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}

            <!-- Flows not linked to any process -->
            {#each r.flows.filter(f => !f.recipeInputOf && !f.recipeOutputOf) as f (f.id)}
              <div class="flow-row unlinked">
                <span class="action-badge" style="color:{actionColor(f.action)};border-color:{actionColor(f.action)}40">{f.action}</span>
                <span class="flow-spec">{f.resourceConformsTo ?? '—'}</span>
                {#if f.resourceQuantity}
                  <span class="flow-qty">{f.resourceQuantity.hasNumericalValue} {f.resourceQuantity.hasUnit}</span>
                {:else if f.effortQuantity}
                  <span class="flow-qty">{f.effortQuantity.hasNumericalValue} {f.effortQuantity.hasUnit}</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  /* ---- Layout ---- */
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-base);
    color: rgba(228, 238, 255, 0.92);
    font-family: var(--font-mono);
    overflow: hidden;
  }

  /* ---- Header ---- */
  .page-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .page-title {
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.85;
    margin-right: auto;
  }

  .recipe-count {
    font-size: 0.58rem;
    opacity: 0.5;
    letter-spacing: 0.06em;
  }

  /* ---- Prompt area ---- */
  .prompt-area {
    flex-shrink: 0;
    padding: 14px 20px 12px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .examples-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .examples-lbl {
    font-size: 0.46rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.45;
    flex-shrink: 0;
    margin-right: 2px;
  }

  .chip {
    background: none;
    border: 1px solid rgba(232, 176, 78, 0.28);
    color: rgba(232, 176, 78, 0.75);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    padding: 3px 9px;
    border-radius: 3px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
    white-space: nowrap;
  }

  .chip:hover {
    border-color: rgba(232, 176, 78, 0.65);
    color: #e8b04e;
    background: rgba(232, 176, 78, 0.07);
  }

  .input-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .prompt-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-dim);
    border-radius: 4px;
    color: rgba(228, 238, 255, 0.92);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    padding: 9px 12px;
    resize: none;
    line-height: 1.55;
    transition: border-color 0.15s;
    min-width: 0;
  }

  .prompt-input::placeholder {
    opacity: 0.35;
  }

  .prompt-input:focus {
    outline: none;
    border-color: rgba(126, 232, 162, 0.4);
  }

  .generate-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    background: none;
    border: 1px solid rgba(126, 232, 162, 0.4);
    color: #7ee8a2;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    padding: 0 20px;
    height: 70px;
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, opacity 0.15s;
  }

  .generate-btn:hover:not(:disabled) {
    border-color: rgba(126, 232, 162, 0.7);
    background: rgba(126, 232, 162, 0.07);
  }

  .generate-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(126, 232, 162, 0.3);
    border-top-color: #7ee8a2;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-msg {
    font-size: 0.58rem;
    color: #fc5858;
    opacity: 0.85;
  }

  /* ---- Cards area ---- */
  .cards-area {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 16px;
  }

  .empty-state {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding-top: 60px;
    opacity: 0.4;
  }

  .empty-label {
    font-size: 0.75rem;
    letter-spacing: 0.06em;
  }

  .empty-sub {
    font-size: 0.58rem;
    opacity: 0.7;
  }

  /* ---- Recipe card ---- */
  .recipe-card {
    width: 280px;
    flex-shrink: 0;
    border-radius: 5px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: border-color 0.2s, background 0.2s, box-shadow 0.2s, opacity 0.2s;
  }

  .recipe-card.active {
    border: 1px solid rgba(126, 232, 162, 0.55);
    background: rgba(126, 232, 162, 0.05);
    box-shadow: 0 0 20px rgba(126, 232, 162, 0.14);
  }

  .recipe-card.inactive {
    border: 1px solid rgba(255, 255, 255, 0.09);
    background: rgba(255, 255, 255, 0.03);
    opacity: 0.45;
  }

  /* ---- Card header ---- */
  .card-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .card-name-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }

  .card-name {
    font-size: 0.72rem;
    font-weight: 600;
    color: rgba(228, 238, 255, 0.96);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-output {
    font-size: 0.5rem;
    opacity: 0.55;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .card-note {
    font-size: 0.58rem;
    opacity: 0.6;
    line-height: 1.5;
  }

  /* ---- Toggle pill ---- */
  .toggle-pill {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 0.44rem;
    letter-spacing: 0.1em;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }

  .toggle-pill.pill-on {
    background: rgba(126, 232, 162, 0.12);
    border: 1px solid rgba(126, 232, 162, 0.45);
    color: #7ee8a2;
  }

  .toggle-pill:not(.pill-on) {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.4);
  }

  .toggle-pill:hover {
    opacity: 0.8;
  }

  /* ---- Processes ---- */
  .proc-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .proc-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-left: 2px solid rgba(255, 255, 255, 0.1);
    padding-left: 8px;
  }

  .proc-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .proc-seq {
    font-size: 0.48rem;
    opacity: 0.4;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    padding: 1px 4px;
    flex-shrink: 0;
  }

  .proc-name {
    font-size: 0.62rem;
    font-weight: 600;
    color: rgba(210, 228, 255, 0.9);
    flex: 1;
  }

  .proc-dur {
    font-size: 0.5rem;
    opacity: 0.5;
    flex-shrink: 0;
  }

  /* ---- Flows ---- */
  .flow-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 4px;
  }

  .flow-row.unlinked {
    padding-left: 0;
    border-left: none;
    opacity: 0.7;
  }

  .action-badge {
    font-size: 0.44rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    border: 1px solid;
    border-radius: 2px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  .flow-spec {
    font-size: 0.58rem;
    color: rgba(210, 228, 255, 0.85);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .flow-qty {
    font-size: 0.52rem;
    opacity: 0.6;
    flex-shrink: 0;
    white-space: nowrap;
  }
</style>
