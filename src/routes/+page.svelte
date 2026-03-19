<script lang="ts">
  import '$lib/components/ui/tokens.css';
  import { base } from '$app/paths';
  import CommitmentRow   from '$lib/components/vf/CommitmentRow.svelte';
  import IntentRow       from '$lib/components/vf/IntentRow.svelte';
  import ProcessRow      from '$lib/components/vf/ProcessRow.svelte';
  import ResourceRow     from '$lib/components/vf/ResourceRow.svelte';
  import EventRow        from '$lib/components/vf/EventRow.svelte';
  import ProcessLayerDiagram from '$lib/components/vf/ProcessLayerDiagram.svelte';
  import NetworkDiagram      from '$lib/components/vf/NetworkDiagram.svelte';

  import {
    recipes,
    resourceSpecs, processSpecs, recipeList,
    planList, processList, commitmentList, intentList,
    resourceList, eventList, agentList, bufferZoneList,
    capacityBufferList, bufferZones, refresh,
    adjustmentFactorList, upsertAdjustmentFactor,
    bufferProfileList,
  } from '$lib/vf-stores.svelte';
  import BufferProfileMatrix         from '$lib/components/buffers/BufferProfileMatrix.svelte';
  import PartProfileTable            from '$lib/components/buffers/PartProfileTable.svelte';
  import ADUComparisonChart          from '$lib/components/buffers/ADUComparisonChart.svelte';
  import BufferCalculationBreakdown  from '$lib/components/buffers/BufferCalculationBreakdown.svelte';
  import { seedExample } from '$lib/vf-seed';
  import { resetStores } from '$lib/vf-stores.svelte';
  import { bufferHealthHistory, aggregateAdjustmentFactors, computeBufferZone } from '$lib/algorithms/ddmrp';
  import { rankDecouplingCandidates } from '$lib/algorithms/positioning';
  import PositioningIterationView from '$lib/components/positioning/PositioningIterationView.svelte';
  import BufferHealthRunChart      from '$lib/components/execution/BufferHealthRunChart.svelte';
  import CapacityLoadingView       from '$lib/components/execution/CapacityLoadingView.svelte';
  import BufferOutlierPanel        from '$lib/components/execution/BufferOutlierPanel.svelte';
  import ScenarioComparisonView    from '$lib/components/planning/ScenarioComparisonView.svelte';
  import AdjustmentFactorTimeline  from '$lib/components/execution/AdjustmentFactorTimeline.svelte';
  import ZoneAdjustmentBreakdown   from '$lib/components/execution/ZoneAdjustmentBreakdown.svelte';
  import DemandAdjustmentFactorEditor from '$lib/components/settings/DemandAdjustmentFactorEditor.svelte';

  // Build specName lookup for row components
  const specNameMap = $derived(
    new Map(resourceSpecs.map(s => [s.id, s.name]))
  );

  // ── DDMRP inspection state ─────────────────────────────────────────────────
  const processSpecNameMap = $derived(new Map(processSpecs.map(s => [s.id, s.name])));

  let selectedBzId = $state<string | null>(null);
  const selectedBz = $derived(bufferZoneList.find(bz => bz.id === selectedBzId) ?? null);

  const selectedBzOnhand = $derived.by(() => {
    if (!selectedBz) return 0;
    const pool = selectedBz.atLocation
      ? resourceList.filter(r => r.conformsTo === selectedBz.specId && r.currentLocation === selectedBz.atLocation)
      : resourceList.filter(r => r.conformsTo === selectedBz.specId);
    return pool.reduce((s, r) => s + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
  });

  const _today = new Date().toISOString().slice(0, 10);
  const _from30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const healthEntries = $derived.by(() => {
    if (!selectedBz) return [];
    return bufferHealthHistory(selectedBz.specId, eventList, resourceList, selectedBzOnhand, selectedBz, _from30, _today);
  });

  // Aggregated adjustment factors for the selected buffer zone
  const selectedBzFactors = $derived.by(() => {
    if (!selectedBz) return null;
    return aggregateAdjustmentFactors(
      adjustmentFactorList,
      new Date(_today),
      selectedBz.specId,
      selectedBz.atLocation,
    );
  });

  // Adjustment factors filtered to the selected spec
  const selectedBzAdjFactors = $derived(
    selectedBz
      ? adjustmentFactorList.filter(f => f.specId === selectedBz.specId)
      : []
  );

  // ── STRATEGIC POSITIONING band state ──────────────────────────────────────
  let selectedPositioningRecipeId    = $state<string | null>(null);
  let selectedPositioningCandidateId = $state<string | null>(null);

  const positioningCandidateCount = $derived.by(() => {
    if (!selectedPositioningRecipeId) return 0;
    const existing = new Set(bufferZoneList.map(z => z.specId));
    return rankDecouplingCandidates(selectedPositioningRecipeId, recipes, existing).length;
  });

  function handleAcceptCandidate(
    newZone: Omit<import('$lib/schemas').BufferZone, 'id'>,
    affectedZoneId: string,
    newDltDays: number,
    parentProfileId?: string | null,
  ) {
    bufferZones.addBufferZone(newZone);
    if (affectedZoneId) {
      const existing = bufferZoneList.find(z => z.id === affectedZoneId);
      const profile  = bufferProfileList.find(p => p.id === (parentProfileId ?? existing?.profileId));
      if (existing && profile) {
        const recomp = computeBufferZone(profile, existing.adu, existing.aduUnit,
          newDltDays, existing.moq, existing.moqUnit);
        bufferZones.updateZone(affectedZoneId, {
          dltDays: newDltDays,
          profileId: profile.id,
          tor: recomp.tor, toy: recomp.toy, tog: recomp.tog,
          lastComputedAt: new Date().toISOString(),
        });
      }
    }
    refresh();
    selectedPositioningCandidateId = null;
  }

  // ── BUFFER PROFILES band state ─────────────────────────────────────────────
  let selectedProfileCode = $state<string | null>(null);
  let selectedSpecId = $state<string | null>(null);

  // ── AI RECIPE WORKSHOP ────────────────────────────────────────────────────
  interface GeneratedRecipe {
    recipe: { id: string; name: string; note?: string; primaryOutput?: string };
    processes: { id: string; name: string; note?: string; hasDuration?: { hasNumericalValue: number; hasUnit: string }; sequenceGroup?: number }[];
    flows: { id: string; action: string; resourceConformsTo?: string; resourceQuantity?: { hasNumericalValue: number; hasUnit: string }; effortQuantity?: { hasNumericalValue: number; hasUnit: string }; recipeInputOf?: string; recipeOutputOf?: string }[];
    active: boolean;
  }

  const EXAMPLES = [
    'Bake sourdough bread from flour, water, and salt',
    'Forge iron tools from ore and charcoal via smelting and smithing',
    'Press olive oil from fresh olives',
    'Mill wheat into flour using stone grinding',
    'Brew ale from malted barley, hops, and yeast',
    'Cure fish with salt for preservation',
    'Weave linen fabric from flax fibre',
    'Make cheese from fresh dairy milk',
  ];

  let networkTab = $state<'diagram' | 'plan' | 'observe'>('diagram');
  let showRecipes = $state(false);
  let aiPrompt = $state('');
  let generating = $state(false);
  let errorMsg = $state('');
  let generated = $state<GeneratedRecipe[]>([]);

  async function generateRecipe() {
    if (!aiPrompt.trim() || generating) return;
    generating = true;
    errorMsg = '';
    const res = await fetch('/api/generate-recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: aiPrompt }),
    });
    const payload = await res.json();
    if (payload.success) {
      generated = [{ ...payload.data, active: true }, ...generated];
    } else {
      errorMsg = payload.error ?? 'Generation failed';
    }
    generating = false;
  }

  // All recipe processes and flows for the Knowledge band
  const allRecipeProcesses = $derived(
    recipeList.flatMap(r => recipes.processesForRecipe(r.id))
  );
  const allRecipeFlows = $derived(
    allRecipeProcesses.flatMap(rp => {
      const { inputs, outputs } = recipes.flowsForProcess(rp.id);
      return [...inputs, ...outputs];
    })
  );
</script>

<svelte:head>
  <title>Free Association</title>
</svelte:head>

<div class="page">
  <!-- ── NETWORK DIAGRAM ────────────────────────────────────────────────────── -->
  <section class="band diagram">
    <div class="band-header">
      <div class="bh-left">
        <div class="tab-group">
          <button class="tab-btn" class:tab-active={networkTab === 'diagram'} onclick={() => networkTab = 'diagram'}>NETWORK DIAGRAM</button>
          <button class="tab-btn" class:tab-active={networkTab === 'plan'} onclick={() => networkTab = 'plan'}>PLAN</button>
          <button class="tab-btn" class:tab-active={networkTab === 'observe'} onclick={() => networkTab = 'observe'}>OBSERVE</button>
        </div>
        {#if networkTab === 'diagram'}
          <span class="counts">
            <span class="count">Processes({processList.length})</span>
            <span class="count">Agents({agentList.length})</span>
            <span class="count">Buffers({bufferZoneList.length})</span>
          </span>
        {/if}
      </div>
      <button class="recipe-ai-btn" class:open={showRecipes} onclick={() => showRecipes = !showRecipes} title="AI Recipe Workshop">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M8 1 L9.5 6 L14 6 L10.5 9 L12 14 L8 11 L4 14 L5.5 9 L2 6 L6.5 6 Z"/>
        </svg>
        RECIPE AI
        {#if generated.length > 0}<span class="recipe-count-badge">{generated.length}</span>{/if}
      </button>
    </div>

    {#if showRecipes}
      <div class="workshop-wrap">
        <div class="prompt-area">
          <div class="chips">
            {#each EXAMPLES as ex (ex)}
              <button class="chip" onclick={() => aiPrompt = ex}>{ex}</button>
            {/each}
          </div>
          <textarea
            bind:value={aiPrompt}
            placeholder="Describe a production process…"
            rows="3"
            onkeydown={(e) => { if (e.ctrlKey && e.key === 'Enter') generateRecipe(); }}
          ></textarea>
          {#if errorMsg}
            <div class="error-msg">{errorMsg}</div>
          {/if}
          <button class="generate-btn" onclick={generateRecipe} disabled={generating || !aiPrompt.trim()}>
            {generating ? 'GENERATING…' : 'GENERATE RECIPE'}
          </button>
        </div>
        <div class="cards-area">
          {#each generated as r (r.recipe.id)}
            <div class="recipe-card" class:rc-active={r.active} class:rc-inactive={!r.active}>
              <div class="card-head">
                <span class="card-name">{r.recipe.name}</span>
                <button class="toggle-pill" class:pill-active={r.active} onclick={() => r.active = !r.active}>
                  {r.active ? 'ACTIVE' : 'INACTIVE'}
                </button>
              </div>
              {#if r.recipe.note}<div class="card-note">{r.recipe.note}</div>{/if}
              <div class="section-lbl">PROCESSES</div>
              <div class="process-list">
                {#each [...r.processes].sort((a, b) => (a.sequenceGroup ?? 99) - (b.sequenceGroup ?? 99)) as p (p.id)}
                  <div class="process-row">
                    <span class="proc-seq">{p.sequenceGroup ?? '—'}</span>
                    <span class="proc-name">{p.name}</span>
                    {#if p.hasDuration}<span class="proc-dur">{p.hasDuration.hasNumericalValue} {p.hasDuration.hasUnit}</span>{/if}
                  </div>
                {/each}
              </div>
              <div class="section-lbl">FLOWS</div>
              <div class="flow-list">
                {#each r.flows as f (f.id)}
                  <div class="flow-row">
                    <span class="action-badge ab-{f.action}">{f.action}</span>
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
        </div>
      </div>
    {/if}

    {#if networkTab === 'diagram'}
      <div class="diagram-wrap">
        <NetworkDiagram
          onbufferselect={(id) => { selectedBzId = id; }}
          selectedBzId={selectedBzId ?? undefined}
          adjustments={adjustmentFactorList}
        />
      </div>
    {:else}
      <div class="diagram-wrap">
        <span class="empty" style="padding: var(--gap-md); display:block; opacity:0.4">{networkTab} panel — coming soon</span>
      </div>
    {/if}
  </section>

  <!-- ── DDMRP INSPECTION BAND ──────────────────────────────────────────────── -->
  <section class="band ddmrp">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-red)">DDMRP INSPECTION</span>
      {#if selectedBz}
        <span class="counts">
          <span class="count">
            {specNameMap.get(selectedBz.specId) ?? selectedBz.specId.slice(0, 12)}
            · TOR {selectedBz.tor.toFixed(1)} / TOY {selectedBz.toy.toFixed(1)} / TOG {selectedBz.tog.toFixed(1)}
          </span>
        </span>
        <div class="actions">
          <button onclick={() => { selectedBzId = null; }}>✕ Clear</button>
        </div>
      {:else}
        <span class="count" style="opacity:0.4">↑ click a buffer funnel in the network diagram to inspect</span>
      {/if}
    </div>

    <div class="ddmrp-body">
      <!-- Capacity loading: always shown when data exists -->
      {#if capacityBufferList.length > 0}
        <div class="ddmrp-cap">
          <div class="col-header">Capacity Loading — All Resources</div>
          <CapacityLoadingView buffers={capacityBufferList} specNames={processSpecNameMap} />
        </div>
      {:else if !selectedBz}
        <span class="empty" style="padding:var(--gap-md)">No data. Load example to populate.</span>
      {/if}

      <!-- Buffer detail: shown only when a funnel is selected -->
      {#if selectedBz}
        <div class="ddmrp-bz">
          <div class="col-header">
            Buffer Health · {specNameMap.get(selectedBz.specId) ?? selectedBz.specId}
            <span class="muted"> · last 30d</span>
          </div>
          {#if healthEntries.length > 0}
            <BufferHealthRunChart entries={healthEntries} bufferZone={selectedBz} />
          {:else}
            <span class="empty">No event history in this window — showing current position only</span>
            <BufferHealthRunChart
              entries={[{ date: _today, onhand: selectedBzOnhand, pct: selectedBz.tog > 0 ? (selectedBzOnhand / selectedBz.tog) * 100 : 0, zone: selectedBzOnhand <= selectedBz.tor ? 'red' : selectedBzOnhand <= selectedBz.toy ? 'yellow' : selectedBzOnhand <= selectedBz.tog ? 'green' : 'excess' }]}
              bufferZone={selectedBz}
            />
          {/if}
          <div class="col-header" style="margin-top:var(--gap-lg)">Flag Outlier</div>
          <BufferOutlierPanel
            bufferZone={selectedBz}
            onhand={selectedBzOnhand}
            onSave={(reason, note) => {
              if (selectedBzId) {
                bufferZones.updateZone(selectedBzId, {
                  overrideReason: reason,
                  overrideNote: note || undefined,
                });
                refresh();
              }
            }}
          />
        </div>

        <!-- Adjustment Factor Timeline -->
        <div class="ddmrp-adj">
          <AdjustmentFactorTimeline
            factors={selectedBzAdjFactors}
            bufferZone={selectedBz}
            today={_today}
          />
        </div>

        <!-- Zone Adjustment Breakdown -->
        {#if selectedBzFactors}
          <div class="ddmrp-zab">
            <ZoneAdjustmentBreakdown
              bufferZone={selectedBz}
              factors={selectedBzFactors}
            />
          </div>
        {/if}
      {/if}

      <!-- Adjustment Factor Editor -->
      <div class="ddmrp-dafe">
        <div class="col-header">Demand Adjustment Factors ({adjustmentFactorList.length})</div>
        <DemandAdjustmentFactorEditor
          factors={adjustmentFactorList}
          specs={resourceSpecs}
          onupsert={upsertAdjustmentFactor}
        />
      </div>
    </div>
  </section>

  <!-- ── BUFFER PROFILES BAND ───────────────────────────────────────────────── -->
  <section class="band profiles">
    <div class="band-header">
      <span class="band-title" style="color: #4fd1c5">BUFFER PROFILES</span>
      <span class="counts">
        <span class="count">Profiles({bufferProfileList.length})</span>
        <span class="count">Parts({resourceSpecs.length})</span>
      </span>
      {#if selectedProfileCode}
        <div class="actions">
          <button onclick={() => { selectedProfileCode = null; selectedSpecId = null; }}>✕ Clear</button>
        </div>
      {/if}
    </div>

    <div class="profiles-body">
      <BufferProfileMatrix
        profiles={bufferProfileList}
        specs={resourceSpecs}
        zones={bufferZoneList}
        selectedCode={selectedProfileCode}
        onselect={(c) => { selectedProfileCode = c; selectedSpecId = null; }}
      />

      <div class="profiles-table">
        <PartProfileTable
          profiles={bufferProfileList}
          specs={resourceSpecs}
          zones={bufferZoneList}
          filterProfileCode={selectedProfileCode}
          onselect={(id) => { selectedSpecId = id; }}
        />
      </div>

      {#if selectedSpecId}
        {@const selZone = bufferZoneList.find(bz => bz.specId === selectedSpecId)}
        {@const selProfile = bufferProfileList.find(p => p.id === selZone?.profileId)}
        <div class="profiles-detail">
          <ADUComparisonChart specId={selectedSpecId} events={eventList} intents={intentList} today={_today} zone={selZone} />
          {#if selZone && selProfile}
            <BufferCalculationBreakdown
              bufferZone={selZone}
              profile={selProfile}
              specName={specNameMap.get(selectedSpecId) ?? selectedSpecId}
            />
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <!-- ── STRATEGIC POSITIONING BAND ──────────────────────────────────────────── -->
  <section class="band positioning">
    <div class="band-header">
      <span class="band-title" style="color: #b794f4">STRATEGIC POSITIONING</span>
      <span class="counts">
        <span class="count">Recipes({recipeList.length})</span>
        {#if selectedPositioningRecipeId}
          <span class="count">Candidates({positioningCandidateCount})</span>
        {/if}
      </span>
      {#if selectedPositioningCandidateId}
        <div class="actions">
          <button onclick={() => { selectedPositioningCandidateId = null; }}>✕ Clear candidate</button>
        </div>
      {/if}
    </div>
    <div class="positioning-body">
      <PositioningIterationView
        {recipes}
        {recipeList}
        {bufferZoneList}
        {bufferProfileList}
        {resourceSpecs}
        selectedRecipeId={selectedPositioningRecipeId}
        selectedCandidateProcessId={selectedPositioningCandidateId}
        onRecipeSelect={(id) => { selectedPositioningRecipeId = id; selectedPositioningCandidateId = null; }}
        onCandidateSelect={(id) => { selectedPositioningCandidateId = id; }}
        onAcceptCandidate={handleAcceptCandidate}
      />
    </div>
  </section>

  <!-- ── KNOWLEDGE BAND ───────────────────────────────────────────────────── -->
  <section class="band knowledge">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-yellow)">KNOWLEDGE</span>
      <span class="counts">
        <span class="count">ResourceSpecs({resourceSpecs.length})</span>
        <span class="count">ProcessSpecs({processSpecs.length})</span>
        <span class="count">Recipes({recipeList.length})</span>
        <span class="count">RecipeFlows({allRecipeFlows.length})</span>
      </span>
      <div class="actions">
        <button onclick={seedExample}>Load Example</button>
        <button onclick={resetStores}>Reset</button>
      </div>
    </div>

    <div class="band-body">
      <!-- Resource Specs column -->
      <div class="column">
        <div class="col-header">Resource Specs</div>
        {#if resourceSpecs.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each resourceSpecs as spec (spec.id)}
            <div class="entity-row">
              <span class="entity-name">{spec.name}</span>
              {#if spec.defaultUnitOfResource}
                <span class="muted">{spec.defaultUnitOfResource}</span>
              {/if}
              {#if spec.replenishmentRequired}
                <span class="tag">replen</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <!-- Process Specs column -->
      <div class="column">
        <div class="col-header">Process Specs</div>
        {#if processSpecs.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each processSpecs as spec (spec.id)}
            <div class="entity-row">
              <span class="entity-name">{spec.name}</span>
              {#if spec.isDecouplingPoint}
                <span class="tag">decoupling</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <!-- Recipes column -->
      <div class="column">
        <div class="col-header">Recipes</div>
        {#if recipeList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each recipeList as recipe (recipe.id)}
            <div class="entity-row">
              <span class="entity-name">{recipe.name}</span>
              {#if recipe.primaryOutput}
                <span class="muted">→ {specNameMap.get(recipe.primaryOutput) ?? recipe.primaryOutput.slice(0,8)}</span>
              {/if}
            </div>
            {#each recipes.processesForRecipe(recipe.id) as rp (rp.id)}
              <div class="entity-row indent">
                <span class="muted">▷</span>
                <span>{rp.name}</span>
                {#if rp.hasDuration}
                  <span class="muted">{rp.hasDuration.hasNumericalValue}{rp.hasDuration.hasUnit}</span>
                {/if}
              </div>
            {/each}
          {/each}
        {/if}
      </div>

      <!-- Buffer Zones column -->
      <div class="column">
        <div class="col-header">Buffer Zones ({bufferZoneList.length})</div>
        {#if bufferZoneList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each bufferZoneList as bz (bz.id)}
            <div class="entity-row">
              <span class="entity-name">{specNameMap.get(bz.specId) ?? bz.specId.slice(0,8)}</span>
              <span class="muted">ADU={bz.adu}</span>
              <span class="muted">DLT={bz.dltDays}d</span>
              <span style="color: var(--zone-red)">TOR={bz.tor.toFixed(1)}</span>
              <span style="color: var(--zone-yellow)">TOY={bz.toy.toFixed(1)}</span>
              <span style="color: var(--zone-green)">TOG={bz.tog.toFixed(1)}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </section>

  <!-- ── PLAN BAND ─────────────────────────────────────────────────────────── -->
  <section class="band plan">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-green)">PLAN</span>
      <span class="counts">
        <span class="count">Plans({planList.length})</span>
        <span class="count">Processes({processList.length})</span>
        <span class="count">Commitments({commitmentList.length})</span>
        <span class="count">Intents({intentList.length})</span>
      </span>
    </div>

    <div class="band-body">
      <!-- Plans column -->
      <div class="column">
        <div class="col-header">Plans</div>
        {#if planList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each planList as plan (plan.id)}
            <div class="entity-row">
              <span class="entity-name">{plan.name}</span>
              {#if plan.due}
                <span class="muted">{plan.due.slice(0,10)}</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <!-- Processes column -->
      <div class="column">
        <div class="col-header">Processes</div>
        {#if processList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each processList as process (process.id)}
            <ProcessRow {process} />
          {/each}
        {/if}
      </div>

      <!-- Commitments column -->
      <div class="column">
        <div class="col-header">Commitments</div>
        {#if commitmentList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each commitmentList as c (c.id)}
            <CommitmentRow commitment={c} specName={specNameMap.get(c.resourceConformsTo ?? '')} />
          {/each}
        {/if}
      </div>

      <!-- Intents column -->
      <div class="column">
        <div class="col-header">Intents</div>
        {#if intentList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each intentList as intent (intent.id)}
            <IntentRow {intent} specName={specNameMap.get(intent.resourceConformsTo ?? '')} />
          {/each}
        {/if}
      </div>

      <!-- Scenarios column -->
      <div class="column wide">
        <div class="col-header">Scenarios</div>
        <ScenarioComparisonView scenarios={[]} bufferZones={bufferZoneList} />
      </div>
    </div>
  </section>

  <!-- ── OBSERVATION BAND ──────────────────────────────────────────────────── -->
  <section class="band observation">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-excess)">OBSERVATION</span>
      <span class="counts">
        <span class="count">Agents({agentList.length})</span>
        <span class="count">Resources({resourceList.length})</span>
        <span class="count">Events({eventList.length})</span>
      </span>
    </div>

    <div class="band-body">
      <!-- Agents column -->
      <div class="column">
        <div class="col-header">Agents</div>
        {#if agentList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each agentList as agent (agent.id)}
            <div class="entity-row">
              <span class="agent-type muted">{agent.type.slice(0,3)}</span>
              <span class="entity-name">{agent.name ?? agent.id}</span>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Resources column -->
      <div class="column">
        <div class="col-header">Resources</div>
        {#if resourceList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each resourceList as resource (resource.id)}
            <ResourceRow {resource} specName={specNameMap.get(resource.conformsTo)} />
          {/each}
        {/if}
      </div>

      <!-- Events column -->
      <div class="column">
        <div class="col-header">Events</div>
        {#if eventList.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each eventList as event (event.id)}
            <EventRow {event} />
          {/each}
        {/if}
      </div>
    </div>
  </section>

  <!-- ── PROCESS LAYER DIAGRAM ─────────────────────────────────────────────── -->
  <section class="band diagram">
    <div class="band-header">
      <span class="band-title" style="color: #a0aec0">PROCESS LAYER</span>
    </div>
    <div class="diagram-wrap">
      <ProcessLayerDiagram />
    </div>
  </section>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    background: var(--bg-base);
    color: #e2e8f0;
    min-height: 100vh;
    padding: var(--gap-md);
    gap: var(--gap-md);
  }

  .band {
    border: 1px solid var(--border-dim);
    border-radius: 4px;
    overflow: hidden;
  }

  .band-header {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-sm) var(--gap-md);
    background: var(--bg-overlay);
    border-bottom: 1px solid var(--border-faint);
    flex-wrap: wrap;
  }

  .band-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .counts {
    display: flex;
    gap: var(--gap-md);
    flex-wrap: wrap;
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.5;
  }

  .actions {
    margin-left: auto;
    display: flex;
    gap: var(--gap-sm);
  }

  button {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 8px;
    background: var(--bg-overlay);
    border: 1px solid var(--border-dim);
    color: #e2e8f0;
    cursor: pointer;
    border-radius: 3px;
  }

  button:hover {
    background: var(--bg-elevated);
  }

  .band-body {
    display: flex;
    gap: 0;
    overflow-x: auto;
    padding: var(--gap-md);
    gap: var(--gap-lg);
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    min-width: 180px;
    max-height: 200px;
    overflow-y: auto;
  }

  .col-header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.4;
    padding-bottom: var(--gap-xs);
    border-bottom: 1px solid var(--border-faint);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .entity-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
    flex-wrap: wrap;
  }

  .entity-row.indent {
    padding-left: var(--gap-md);
  }

  .entity-name {
    font-weight: 500;
  }

  .agent-type {
    font-family: var(--font-mono);
    text-transform: uppercase;
  }

  .muted {
    opacity: var(--muted);
  }

  .tag {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 1px 4px;
    background: rgba(214,158,46,0.15);
    color: var(--zone-yellow);
    border-radius: 2px;
  }

  .empty {
    opacity: 0.50;
    font-size: var(--text-xs);
  }

  .diagram-wrap {
    overflow-x: auto;
    padding: var(--gap-md);
  }

  /* DDMRP Inspection band */
  .ddmrp-body {
    display: flex;
    gap: var(--gap-lg);
    padding: var(--gap-md);
    overflow-x: auto;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .ddmrp-cap {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    min-width: 480px;
  }

  .ddmrp-bz {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    min-width: 340px;
    max-width: 420px;
  }

  .column.wide {
    min-width: 320px;
    max-height: none;
  }

  .ddmrp-adj {
    flex: 0 0 auto;
    min-width: 460px;
    max-width: 520px;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .ddmrp-zab {
    flex: 0 0 auto;
    min-width: 280px;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .ddmrp-dafe {
    flex: 0 0 auto;
    min-width: 320px;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  /* STRATEGIC POSITIONING band */
  .positioning-body {
    overflow-x: auto;
  }

  /* BUFFER PROFILES band */
  .profiles-body {
    display: flex;
    flex-direction: column;
    gap: var(--gap-lg);
    padding: var(--gap-md);
  }

  .profiles-table {
    overflow-x: auto;
  }

  .profiles-detail {
    display: flex;
    gap: var(--gap-lg);
    flex-wrap: wrap;
    padding-top: var(--gap-sm);
    border-top: 1px solid var(--border-faint);
    align-items: flex-start;
  }

  .profiles-detail > :global(*) {
    flex: 1;
    min-width: 300px;
    max-width: 520px;
  }

  /* ── Tab group ── */
  .tab-group {
    display: flex;
    gap: 2px;
  }

  .tab-btn {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 10px;
    background: transparent;
    border: 1px solid transparent;
    color: rgba(226, 232, 240, 0.4);
    cursor: pointer;
    border-radius: 3px;
    letter-spacing: 0.05em;
  }

  .tab-btn:hover {
    color: rgba(226, 232, 240, 0.8);
    background: var(--bg-overlay);
  }

  .tab-btn.tab-active {
    color: #9f7aea;
    border-color: rgba(159, 122, 234, 0.35);
    background: rgba(159, 122, 234, 0.08);
  }

  .bh-left {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    flex: 1;
    flex-wrap: wrap;
  }

  .recipe-ai-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    padding: 2px 10px 2px 7px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    color: #b794f4;
    background: rgba(159, 122, 234, 0.08);
    border: 1px solid rgba(159, 122, 234, 0.35);
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  }

  .recipe-ai-btn svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  .recipe-ai-btn:hover,
  .recipe-ai-btn.open {
    background: rgba(159, 122, 234, 0.16);
    border-color: rgba(159, 122, 234, 0.7);
    box-shadow: 0 0 8px rgba(159, 122, 234, 0.25);
    color: #d6bcfa;
  }

  .recipe-count-badge {
    background: rgba(159, 122, 234, 0.3);
    border-radius: 8px;
    font-size: 9px;
    padding: 0 5px;
    line-height: 1.6;
  }

  /* ── Recipe Workshop ── */
  .workshop-wrap {
    display: flex;
    flex-direction: column;
    gap: 0;
    height: 520px;
    overflow: hidden;
  }

  .prompt-area {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .chip {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid rgba(214, 158, 46, 0.3);
    color: rgba(214, 158, 46, 0.75);
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
  }

  .chip:hover {
    background: rgba(214, 158, 46, 0.08);
    color: rgba(214, 158, 46, 1);
  }

  textarea {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--bg-overlay);
    border: 1px solid var(--border-dim);
    color: #e2e8f0;
    border-radius: 3px;
    padding: 8px;
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
  }

  textarea:focus {
    outline: none;
    border-color: rgba(126, 232, 162, 0.4);
  }

  .error-msg {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: #fc5858;
    opacity: 0.9;
  }

  .generate-btn {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 5px 16px;
    background: transparent;
    border: 1px solid rgba(126, 232, 162, 0.4);
    color: rgba(126, 232, 162, 0.85);
    cursor: pointer;
    border-radius: 3px;
    align-self: flex-start;
    letter-spacing: 0.08em;
  }

  .generate-btn:hover:not(:disabled) {
    background: rgba(126, 232, 162, 0.08);
    border-color: rgba(126, 232, 162, 0.7);
  }

  .generate-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .cards-area {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 16px;
    overflow-y: auto;
    flex: 1;
    align-content: flex-start;
  }

  .recipe-card {
    font-family: var(--font-mono);
    border-radius: 4px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 260px;
    flex-shrink: 0;
    transition: opacity 0.2s, box-shadow 0.2s;
  }

  .rc-active {
    border: 1px solid rgba(126, 232, 162, 0.55);
    background: rgba(126, 232, 162, 0.05);
    box-shadow: 0 0 18px rgba(126, 232, 162, 0.14);
  }

  .rc-inactive {
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
    opacity: 0.42;
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .card-name {
    font-size: 0.62rem;
    font-weight: 600;
    color: rgba(228, 238, 255, 0.9);
  }

  .toggle-pill {
    font-family: var(--font-mono);
    font-size: 0.48rem;
    padding: 1px 7px;
    border-radius: 20px;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.45);
    letter-spacing: 0.05em;
  }

  .toggle-pill.pill-active {
    background: rgba(126, 232, 162, 0.12);
    border-color: rgba(126, 232, 162, 0.4);
    color: rgba(126, 232, 162, 0.9);
  }

  .card-note {
    font-size: 0.52rem;
    opacity: 0.55;
    line-height: 1.4;
  }

  .section-lbl {
    font-size: 0.45rem;
    letter-spacing: 0.1em;
    opacity: 0.4;
    margin-top: 2px;
  }

  .process-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .process-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.52rem;
  }

  .proc-seq {
    opacity: 0.4;
    font-size: 0.48rem;
    min-width: 10px;
  }

  .proc-name {
    flex: 1;
    color: rgba(228, 238, 255, 0.8);
  }

  .proc-dur {
    opacity: 0.45;
    font-size: 0.48rem;
  }

  .flow-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .flow-row {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.5rem;
  }

  .action-badge {
    font-size: 0.44rem;
    padding: 1px 5px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .ab-produce  { background: rgba(126, 232, 162, 0.12); color: #7ee8a2; }
  .ab-consume  { background: rgba(252,  88,  88, 0.12); color: #fc5858; }
  .ab-work     { background: rgba(118, 195, 245, 0.12); color: #76c3f5; }
  .ab-transfer { background: rgba(232, 176,  78, 0.12); color: #e8b04e; }

  .flow-spec {
    flex: 1;
    color: rgba(228, 238, 255, 0.75);
  }

  .flow-qty {
    opacity: 0.45;
    white-space: nowrap;
  }
</style>
