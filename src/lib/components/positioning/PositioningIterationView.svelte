<script lang="ts">
  import type { RecipeStore } from '$lib/knowledge/recipes';
  import type { Recipe, BufferZone, BufferProfile, ResourceSpecification } from '$lib/schemas';
  import type { DecouplingCandidateResult } from '$lib/algorithms/positioning';
  import { rankDecouplingCandidates, decouplingTests } from '$lib/algorithms/positioning';
  import { computeBufferZone } from '$lib/algorithms/ddmrp';
  import DecouplingPointMap from './DecouplingPointMap.svelte';
  import BufferStackBar from './BufferStackBar.svelte';
  import { routingGeometry } from '$lib/algorithms/positioning';

  interface Props {
    recipes: RecipeStore;
    recipeList: Recipe[];
    bufferZoneList: BufferZone[];
    bufferProfileList: BufferProfile[];
    resourceSpecs: ResourceSpecification[];
    selectedRecipeId: string | null;
    selectedCandidateProcessId: string | null;
    onRecipeSelect: (id: string | null) => void;
    onCandidateSelect: (processId: string | null) => void;
    onAcceptCandidate: (newZone: Omit<BufferZone, 'id'>, affectedZoneId: string, newDltDays: number, parentProfileId?: string | null) => void;
  }

  let {
    recipes,
    recipeList,
    bufferZoneList,
    bufferProfileList,
    resourceSpecs,
    selectedRecipeId,
    selectedCandidateProcessId,
    onRecipeSelect,
    onCandidateSelect,
    onAcceptCandidate,
  }: Props = $props();

  // ── New buffer inputs (local $state) ──────────────────────────────────────
  let newBufferAdu = $state(1);
  let aduUnit = $state('ea');
  let selectedProfileId = $state<string | null>(null);
  let customerToleranceTimeDays      = $state<number | null>(null);
  let marketPotentialLeadTimeDays    = $state<number | null>(null);
  let salesOrderVisibilityHorizonDays = $state<number | null>(null);
  let demandVariability              = $state<'high' | 'medium' | 'low' | ''>('');
  let supplyVariability              = $state<'high' | 'medium' | 'low' | ''>('');
  let hasCriticalOperation           = $state(false);
  let parentAfterProfileId           = $state<string | null>(null);

  // ── Derived lookups ──────────────────────────────────────────────────────
  const zoneBySpecId = $derived(new Map(bufferZoneList.map(z => [z.specId, z])));
  const profileById  = $derived(new Map(bufferProfileList.map(p => [p.id, p])));
  const specNameMap  = $derived(new Map(resourceSpecs.map(s => [s.id, s.name])));

  const selectedRecipe = $derived(recipeList.find(r => r.id === selectedRecipeId) ?? null);

  const existingBufferedSpecIds = $derived(new Set(bufferZoneList.map(z => z.specId)));

  const candidates = $derived.by((): DecouplingCandidateResult[] => {
    if (!selectedRecipeId) return [];
    return rankDecouplingCandidates(selectedRecipeId, recipes, existingBufferedSpecIds);
  });

  const selectedCandidate = $derived(
    candidates.find(c => c.processId === selectedCandidateProcessId) ?? null
  );

  const primaryOutputSpecId = $derived(selectedRecipe?.primaryOutput ?? null);
  const currentOutputZone   = $derived(
    primaryOutputSpecId ? (zoneBySpecId.get(primaryOutputSpecId) ?? null) : null
  );
  const currentOutputProfile = $derived(
    currentOutputZone ? (profileById.get(currentOutputZone.profileId) ?? null) : null
  );

  const afterProfile = $derived(
    parentAfterProfileId ? (profileById.get(parentAfterProfileId) ?? currentOutputProfile) : currentOutputProfile
  );

  const whatIfZone = $derived.by(() => {
    if (!selectedCandidate || !currentOutputZone || !afterProfile) return null;
    return computeBufferZone(
      afterProfile,
      currentOutputZone.adu,
      currentOutputZone.aduUnit,
      selectedCandidate.decoupledDltDays,
      currentOutputZone.moq,
      currentOutputZone.moqUnit,
    );
  });

  const barMaxTog = $derived(Math.max(currentOutputZone?.tog ?? 0, whatIfZone?.tog ?? 0));

  const testResult = $derived.by(() => {
    if (!selectedRecipeId || !selectedCandidateProcessId) return null;
    return decouplingTests(selectedRecipeId, selectedCandidateProcessId, recipes);
  });

  const selectedProfile = $derived(
    selectedProfileId ? (profileById.get(selectedProfileId) ?? null) : null
  );

  // Chains for the map
  const chains = $derived.by(() => {
    if (!selectedRecipeId) return [];
    const recipe = recipeList.find(r => r.id === selectedRecipeId);
    if (!recipe) return [];
    try {
      const geometry = routingGeometry(selectedRecipeId, recipes);
      return [{ recipeId: selectedRecipeId, name: recipe.name, geometry }];
    } catch {
      return [];
    }
  });

  // Δ percentages
  function deltaPct(before: number, after: number): string {
    if (before === 0) return '—';
    const pct = ((after - before) / before) * 100;
    return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  }

  function accept() {
    if (!selectedCandidate || !selectedProfile || !currentOutputZone) return;
    const comp = computeBufferZone(
      selectedProfile,
      newBufferAdu,
      aduUnit,
      selectedCandidate.upstreamDays,
      0,
      aduUnit,
    );
    const newZone: Omit<BufferZone, 'id'> = {
      specId: selectedCandidate.specId!,
      profileId: selectedProfile.id,
      bufferClassification: 'replenished',
      adu: newBufferAdu,
      aduUnit,
      dltDays: selectedCandidate.upstreamDays,
      moq: 0,
      moqUnit: aduUnit,
      tor: comp.tor,
      toy: comp.toy,
      tog: comp.tog,
      lastComputedAt: new Date().toISOString(),
    };
    onAcceptCandidate(newZone, currentOutputZone.id, selectedCandidate.decoupledDltDays, parentAfterProfileId);
  }

  const canAccept = $derived(
    !!selectedCandidate?.specId && !!selectedProfile && newBufferAdu > 0
  );

  const suggestedAdu = $derived.by(() => {
    if (!selectedCandidate || !currentOutputZone) return null;
    const specName = selectedCandidate.specId ? specNameMap.get(selectedCandidate.specId) : null;
    return {
      min: currentOutputZone.adu,
      leverageCount: selectedCandidate.leverageScore + 1,
      specName,
    };
  });

  const tests = $derived(testResult ? [
    { label: 'Decouples horizon',          pass: testResult.decouplesHorizon },
    { label: 'Bi-directional benefit',     pass: testResult.biDirectionalBenefit },
    { label: 'Order independence',         pass: testResult.orderIndependence },
    { label: 'Primary planning mechanism', pass: testResult.isPrimaryPlanningMechanism },
    { label: 'Relative priority met',      pass: testResult.relativePriorityMet },
    { label: 'Dynamic adjustment ready',   pass: testResult.dynamicAdjustmentReady },
  ] : []);
</script>

<div class="piv">
  <!-- LEFT PANEL -->
  <div class="left">
    <!-- Recipe selector -->
    <div class="section-label">Recipe</div>
    <select
      class="recipe-select"
      value={selectedRecipeId ?? ''}
      onchange={(e) => onRecipeSelect((e.currentTarget as HTMLSelectElement).value || null)}
    >
      <option value="">— select recipe —</option>
      {#each recipeList as recipe (recipe.id)}
        <option value={recipe.id}>{recipe.name}</option>
      {/each}
    </select>

    {#if selectedRecipeId && candidates.length > 0}
      <!-- Candidates table -->
      <div class="section-label" style="margin-top: var(--gap-md)">
        Decoupling Candidates ({candidates.length})
      </div>
      <table class="cand-table">
        <thead>
          <tr>
            <th>Score</th>
            <th>Spec</th>
            <th>Compress%</th>
            <th>Tests</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.processId)}
            <tr
              class:selected={c.processId === selectedCandidateProcessId}
              onclick={() => onCandidateSelect(c.processId)}
            >
              <td class="mono">{c.positioningScore.toFixed(0)}</td>
              <td>{c.specId ? (specNameMap.get(c.specId) ?? c.specId.slice(0, 10)) : '—'}</td>
              <td class="mono">{c.compressionPct.toFixed(0)}%</td>
              <td class="mono">
                {#if c.processId === selectedCandidateProcessId && testResult}
                  {testResult.testsPassed}/6
                {:else}
                  —
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if selectedRecipeId}
      <span class="empty" style="margin-top: var(--gap-sm)">
        {candidates.length === 0 ? 'No unbuffered candidates.' : ''}
      </span>
    {/if}

    <!-- Decoupling point map -->
    {#if chains.length > 0}
      <div class="section-label" style="margin-top: var(--gap-md)">Process Map</div>
      <DecouplingPointMap
        {chains}
        {candidates}
        selectedProcessId={selectedCandidateProcessId}
        onselect={(id) => onCandidateSelect(id)}
      />
    {/if}
  </div>

  <!-- RIGHT PANEL -->
  <div class="right">
    <!-- 6 Positioning Factors (Ch. 6 Fig 6-3) -->
    <div class="section-label">Positioning Criteria — Ch. 6 (6 factors)</div>
    <div class="criteria-panel">

      <!-- 1. Customer Tolerance Time -->
      <div class="factor-row">
        <span class="factor-num">1</span>
        <span class="factor-name">Customer Tolerance Time</span>
        <div class="factor-inputs">
          <input type="number" min="0" bind:value={customerToleranceTimeDays} class="num-input" placeholder="days" />
          <span class="input-label muted">d</span>
        </div>
        {#if customerToleranceTimeDays != null}
          {@const dlt = selectedCandidate?.decoupledDltDays ?? currentOutputZone?.dltDays ?? null}
          {#if dlt != null}
            {@const gap = dlt - customerToleranceTimeDays}
            <span class="fbadge {gap <= 0 ? 'good' : 'warn'}">{gap <= 0 ? `✓ ${dlt}d ≤ CTT` : `✗ ${gap.toFixed(0)}d gap`}</span>
          {/if}
        {/if}
      </div>

      <!-- 2. Market Potential Lead Time -->
      <div class="factor-row">
        <span class="factor-num">2</span>
        <span class="factor-name">Market Potential Lead Time</span>
        <div class="factor-inputs">
          <input type="number" min="0" bind:value={marketPotentialLeadTimeDays} class="num-input" placeholder="days" />
          <span class="input-label muted">d</span>
        </div>
        {#if marketPotentialLeadTimeDays != null && selectedCandidate}
          {@const meets = selectedCandidate.decoupledDltDays <= marketPotentialLeadTimeDays}
          <span class="fbadge {meets ? 'good' : 'neutral'}">{meets ? '✓ opportunity open' : `need ${selectedCandidate.decoupledDltDays - marketPotentialLeadTimeDays}d more`}</span>
        {:else if marketPotentialLeadTimeDays != null && currentOutputZone}
          {@const gap = currentOutputZone.dltDays - marketPotentialLeadTimeDays}
          {#if gap <= 0}
            <span class="fbadge good">✓ current DLT already qualifies</span>
          {:else}
            <span class="fbadge neutral">{gap.toFixed(0)}d to opportunity</span>
          {/if}
        {/if}
      </div>

      <!-- 3. Sales Order Visibility Horizon -->
      <div class="factor-row">
        <span class="factor-num">3</span>
        <span class="factor-name">Sales Order Visibility Horizon</span>
        <div class="factor-inputs">
          <input type="number" min="0" bind:value={salesOrderVisibilityHorizonDays} class="num-input" placeholder="days" />
          <span class="input-label muted">d</span>
        </div>
        {#if salesOrderVisibilityHorizonDays != null}
          {@const dlt = selectedCandidate?.decoupledDltDays ?? currentOutputZone?.dltDays ?? null}
          {#if dlt != null}
            <span class="fbadge {salesOrderVisibilityHorizonDays >= dlt ? 'good' : 'neutral'}">
              {salesOrderVisibilityHorizonDays >= dlt ? '✓ demand visible ≥ DLT' : 'forecast gap exists'}
            </span>
          {/if}
        {/if}
      </div>

      <!-- 4. External Variability -->
      <div class="factor-row">
        <span class="factor-num">4</span>
        <span class="factor-name">External Variability</span>
        <div class="factor-inputs">
          <span class="input-label">Demand</span>
          <select class="var-select" bind:value={demandVariability}>
            <option value="">—</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <span class="input-label">Supply</span>
          <select class="var-select" bind:value={supplyVariability}>
            <option value="">—</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        {#if demandVariability === 'high' || supplyVariability === 'high'}
          <span class="fbadge good">✓ high variability — buffer warranted</span>
        {:else if demandVariability === 'low' && supplyVariability === 'low'}
          <span class="fbadge neutral">low variability — weaker case</span>
        {:else if demandVariability || supplyVariability}
          <span class="fbadge neutral">medium variability</span>
        {/if}
      </div>

      <!-- 5. Inventory Leverage & Flexibility -->
      <div class="factor-row">
        <span class="factor-num">5</span>
        <span class="factor-name">Inventory Leverage</span>
        <div class="factor-inputs">
          {#if selectedCandidate}
            <span class="mono" style="font-size: var(--text-xs); opacity: 0.8">
              {selectedCandidate.leverageScore + 1} chain{selectedCandidate.leverageScore + 1 !== 1 ? 's' : ''} share this spec
            </span>
          {:else}
            <span style="font-size: var(--text-xs); opacity: 0.3">— select a candidate</span>
          {/if}
        </div>
        {#if selectedCandidate && selectedCandidate.leverageScore > 0}
          <span class="fbadge good">✓ shared component</span>
        {:else if selectedCandidate}
          <span class="fbadge neutral">unique to this chain</span>
        {/if}
      </div>

      <!-- 6. Critical Operation Protection -->
      <div class="factor-row">
        <span class="factor-num">6</span>
        <span class="factor-name">Critical Operation Protection</span>
        <div class="factor-inputs">
          <label class="input-row" style="gap: 6px; min-width: unset">
            <input type="checkbox" bind:checked={hasCriticalOperation} style="accent-color: #b794f4; width: 12px; height: 12px; flex-shrink: 0" />
            <span style="font-size: var(--text-xs); opacity: 0.55">upstream of convergent / capacity-constrained op</span>
          </label>
        </div>
        {#if hasCriticalOperation}
          <span class="fbadge good">✓ protects bottleneck</span>
        {/if}
      </div>

    </div>
    <p class="hint">Ch. 6 Fig 6-3: Apply all six factors across BOM, routing, and supply network to determine the best decoupling positions (CTT = primary gate; MPLT = revenue opportunity; SOVH = demand signal quality; variability = buffer urgency; leverage = shared-component efficiency; critical op = convergent/constraint protection).</p>

    {#if currentOutputZone && primaryOutputSpecId}
      <div class="section-label">Current output buffer</div>
      <div class="current-bar">
        <BufferStackBar
          label={specNameMap.get(primaryOutputSpecId) ?? primaryOutputSpecId.slice(0, 10)}
          tor={currentOutputZone.tor}
          toy={currentOutputZone.toy}
          tog={currentOutputZone.tog}
          maxTog={barMaxTog}
        />
        <div class="zone-stats mono">
          <span>DLT {currentOutputZone.dltDays}d</span>
          <span>TOR {currentOutputZone.tor.toFixed(1)}</span>
          <span>TOY {currentOutputZone.toy.toFixed(1)}</span>
          <span>TOG {currentOutputZone.tog.toFixed(1)}</span>
        </div>
      </div>
    {/if}

    {#if selectedCandidate && whatIfZone}
      <div class="compression-summary mono">
        DLT: {currentOutputZone?.dltDays ?? '?'}d → {selectedCandidate.decoupledDltDays}d
        <span class="muted">(−{(currentOutputZone?.dltDays ?? 0) - selectedCandidate.decoupledDltDays}d)</span>
      </div>
      <p class="hint">
        Placing a buffer at <strong>{specNameMap.get(selectedCandidate.specId ?? '') ?? 'this point'}</strong> breaks the upstream lead time chain. The parent item now replenishes against a stable on-hand buffer rather than waiting on upstream production.
      </p>

      <!-- Before / After bars -->
      <div class="section-label">Before / After</div>
      <div class="bars-row">
        {#if currentOutputZone}
          <BufferStackBar
            label="BEFORE"
            tor={currentOutputZone.tor}
            toy={currentOutputZone.toy}
            tog={currentOutputZone.tog}
            maxTog={barMaxTog}
          />
        {/if}
        <BufferStackBar
          label="AFTER"
          tor={whatIfZone.tor}
          toy={whatIfZone.toy}
          tog={whatIfZone.tog}
          maxTog={barMaxTog}
        />
      </div>

      <!-- Δ badges -->
      {#if currentOutputZone}
        <div class="delta-row">
          <span class="delta-badge">ΔTOR {deltaPct(currentOutputZone.tor, whatIfZone.tor)}</span>
          <span class="delta-badge">ΔTOY {deltaPct(currentOutputZone.toy, whatIfZone.toy)}</span>
          <span class="delta-badge">ΔTOG {deltaPct(currentOutputZone.tog, whatIfZone.tog)}</span>
        </div>
      {/if}

      <!-- Profile shift -->
      <div class="section-label">Parent profile after decoupling (optional)</div>
      <select
        class="profile-select"
        value={parentAfterProfileId ?? ''}
        onchange={(e) => { parentAfterProfileId = (e.currentTarget as HTMLSelectElement).value || null; }}
      >
        <option value="">— same profile ({currentOutputProfile?.code ?? currentOutputProfile?.name ?? '?'}) —</option>
        {#each bufferProfileList as p (p.id)}
          {#if p.id !== currentOutputZone?.profileId}
            <option value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>
          {/if}
        {/each}
      </select>
      <p class="hint">
        Decoupling absorbs upstream supply variability. The parent item's profile may shift to a lower lead-time or lower variability band (e.g. MLM → MML per Figs 7-27/28). Select the reassigned profile to see the true AFTER zone size.
      </p>

      <!-- 6-test matrix -->
      {#if tests.length > 0}
        <div class="section-label">Decoupling Tests</div>
        <ul class="tests">
          {#each tests as t}
            <li class:pass={t.pass} class:fail={!t.pass}>
              <span class="icon">{t.pass ? '✓' : '✗'}</span>
              <span>{t.label}</span>
            </li>
          {/each}
        </ul>
        <span class="summary mono">{testResult?.testsPassed ?? 0}/6 tests passed</span>
      {/if}

      <!-- New buffer inputs -->
      <div class="section-label" style="margin-top: var(--gap-md)">New Buffer Inputs</div>
      <div class="inputs-grid">
        <label class="input-row">
          <span class="input-label">ADU</span>
          <input
            type="number"
            min="0"
            step="0.1"
            bind:value={newBufferAdu}
            class="num-input"
          />
        </label>
        {#if suggestedAdu}
          <p class="hint">
            Suggested minimum: {suggestedAdu.min.toFixed(1)} {aduUnit} (parent chain ADU).
            {#if suggestedAdu.leverageCount > 1}
              This spec is consumed by {suggestedAdu.leverageCount} recipe chains — sum their ADUs for correct sizing (Fig 7-30).
            {/if}
          </p>
        {/if}
        <label class="input-row">
          <span class="input-label">Unit</span>
          <input
            type="text"
            bind:value={aduUnit}
            class="text-input"
            placeholder="ea"
          />
        </label>
        <label class="input-row">
          <span class="input-label">Profile</span>
          <select
            class="profile-select"
            value={selectedProfileId ?? ''}
            onchange={(e) => {
              selectedProfileId = (e.currentTarget as HTMLSelectElement).value || null;
            }}
          >
            <option value="">— select profile —</option>
            {#each bufferProfileList as p (p.id)}
              <option value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>
            {/each}
          </select>
        </label>
      </div>

      <button
        class="accept-btn"
        disabled={!canAccept}
        onclick={accept}
      >
        Accept — Create Buffer
      </button>
    {:else if !selectedRecipeId}
      <div class="explainer">
        <p class="explainer-title">Strategic Inventory Positioning — DDMRP Ch. 6–7</p>
        <p>Fill in the 6-factor criteria above, then work through the loop:</p>
        <ol>
          <li><strong>CTT</strong> — sets the target. Any DLT above CTT requires a buffer to compress it.</li>
          <li><strong>MPLT</strong> — lead time reduction that opens new business or enables price increases. May set a more aggressive target than CTT alone.</li>
          <li><strong>SOVH</strong> — if orders arrive visible ≥ DLT, actual demand drives. If not, a buffer absorbs the forecast gap.</li>
          <li><strong>External Variability</strong> — high demand or supply variability strengthens the case for a buffer at any candidate position.</li>
          <li><strong>Leverage</strong> — shared components across multiple product structures multiply the benefit of a single buffer placement (matrix BOM concept, Fig 6-14).</li>
          <li><strong>Critical Operation</strong> — protect convergent points and constrained resources from upstream supply disruption (resource Z concept, Fig 6-2).</li>
        </ol>
        <p>Select a recipe → pick a candidate → accept → repeat until compressed DLT ≤ CTT.</p>
      </div>
    {:else if !selectedCandidateProcessId}
      <span class="empty">Click a candidate row or map node to see before/after comparison.</span>
      <p class="hint" style="margin-top: var(--gap-sm)">
        Candidates are ranked by compression% × leverage. Higher score = more flow benefit per buffer placed.
      </p>
    {/if}
  </div>
</div>

<style>
  .piv {
    display: flex;
    gap: var(--gap-lg);
    padding: var(--gap-md);
    align-items: flex-start;
  }

  .left {
    flex: 0 0 360px;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .right {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .section-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.4;
    padding-bottom: 2px;
    border-bottom: 1px solid var(--border-faint);
  }

  .recipe-select,
  .profile-select {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--border-faint);
    border: 1px solid rgba(255,255,255,0.12);
    color: #e2e8f0;
    padding: 3px 6px;
    border-radius: 3px;
    width: 100%;
  }

  .cand-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }

  .cand-table th {
    font-family: var(--font-mono);
    text-align: left;
    opacity: 0.4;
    padding: 2px 4px;
    font-weight: 400;
    border-bottom: 1px solid var(--border-faint);
  }

  .cand-table td {
    padding: 3px 4px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }

  .cand-table tr {
    cursor: pointer;
  }

  .cand-table tr:hover td { background: var(--bg-overlay); }
  .cand-table tr.selected td { background: rgba(183,148,244,0.12); }

  .mono { font-family: var(--font-mono); }
  .muted { opacity: var(--muted); }

  .current-bar {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-md);
  }

  .zone-stats {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--text-xs);
    opacity: 0.7;
    padding-top: var(--gap-sm);
  }

  .compression-summary {
    font-size: var(--text-xs);
    padding: 4px 8px;
    background: rgba(183,148,244,0.08);
    border-left: 2px solid #b794f4;
    border-radius: 2px;
  }

  .bars-row {
    display: flex;
    gap: var(--gap-lg);
    align-items: flex-end;
  }

  .delta-row {
    display: flex;
    gap: var(--gap-sm);
    flex-wrap: wrap;
  }

  .delta-badge {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 6px;
    background: var(--border-faint);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px;
  }

  .tests {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--text-xs);
  }

  .tests li {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .tests .pass .icon { color: var(--zone-green); }
  .tests .fail .icon { color: var(--zone-red); }

  .summary {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: var(--muted);
  }

  .inputs-grid {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }

  .input-label {
    font-family: var(--font-mono);
    opacity: 0.5;
    min-width: 50px;
  }

  .num-input,
  .text-input {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--border-faint);
    border: 1px solid rgba(255,255,255,0.12);
    color: #e2e8f0;
    padding: 3px 6px;
    border-radius: 3px;
    width: 80px;
  }

  .accept-btn {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 4px 12px;
    background: rgba(183,148,244,0.15);
    border: 1px solid rgba(183,148,244,0.4);
    color: #b794f4;
    cursor: pointer;
    border-radius: 3px;
    margin-top: var(--gap-sm);
  }

  .accept-btn:hover:not(:disabled) {
    background: rgba(183,148,244,0.25);
  }

  .accept-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .empty {
    opacity: 0.50;
    font-size: var(--text-xs);
  }

  .hint { font-size: var(--text-xs); opacity: 0.45; margin: 2px 0; line-height: 1.5; }

  /* 6-factor criteria panel */
  .criteria-panel {
    display: flex;
    flex-direction: column;
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    padding: 4px 6px;
    gap: 0;
  }
  .factor-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
    padding: 4px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    flex-wrap: wrap;
  }
  .factor-row:last-child { border-bottom: none; }
  .factor-num {
    font-family: var(--font-mono);
    opacity: 0.50;
    min-width: 12px;
    flex-shrink: 0;
  }
  .factor-name {
    font-family: var(--font-mono);
    opacity: 0.5;
    min-width: 190px;
    flex-shrink: 0;
  }
  .factor-inputs {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    flex-wrap: wrap;
  }
  .fbadge {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 1px 6px;
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .fbadge.good    { background: rgba(72,187,120,0.15);  color: var(--zone-green); border: 1px solid var(--zone-green); }
  .fbadge.warn    { background: rgba(245,101,101,0.12); color: var(--zone-red);   border: 1px solid var(--zone-red); }
  .fbadge.neutral { background: var(--border-faint); color: rgba(226,232,240,0.45); border: 1px solid rgba(255,255,255,0.1); }
  .var-select {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--border-faint);
    border: 1px solid rgba(255,255,255,0.12);
    color: #e2e8f0;
    padding: 2px 4px;
    border-radius: 3px;
    width: 90px;
  }

  .explainer { display: flex; flex-direction: column; gap: var(--gap-sm); max-width: 520px; }
  .explainer-title { font-family: var(--font-mono); font-size: var(--text-xs); opacity: 0.5; }
  .explainer p, .explainer ol { font-size: var(--text-xs); opacity: 0.65; line-height: 1.6; margin: 0; }
  .explainer ol { padding-left: 1.2em; }
  .explainer li { margin-bottom: 4px; }
</style>
