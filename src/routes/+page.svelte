<script lang="ts">
  import '$lib/components/ui/tokens.css';
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
  import { bufferHealthHistory, aggregateAdjustmentFactors } from '$lib/algorithms/ddmrp';
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
    return bufferHealthHistory(selectedBz.specId, eventList, selectedBzOnhand, selectedBz, _from30, _today);
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

  // ── BUFFER PROFILES band state ─────────────────────────────────────────────
  let selectedProfileCode = $state<string | null>(null);
  let selectedSpecId = $state<string | null>(null);

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
  <title>VF Inspector</title>
</svelte:head>

<div class="page">
  <!-- ── NETWORK DIAGRAM ────────────────────────────────────────────────────── -->
  <section class="band diagram">
    <div class="band-header">
      <span class="band-title" style="color: #9f7aea">NETWORK DIAGRAM</span>
      <span class="counts">
        <span class="count">Processes({processList.length})</span>
        <span class="count">Agents({agentList.length})</span>
        <span class="count">Buffers({bufferZoneList.length})</span>
      </span>
    </div>
    <div class="diagram-wrap">
      <NetworkDiagram
        onbufferselect={(id) => { selectedBzId = id; }}
        selectedBzId={selectedBzId ?? undefined}
        adjustments={adjustmentFactorList}
      />
    </div>
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
          <ADUComparisonChart specId={selectedSpecId} events={eventList} intents={intentList} today={_today} />
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
    background: #0d0d0d;
    color: #e2e8f0;
    min-height: 100vh;
    padding: var(--gap-md);
    gap: var(--gap-md);
  }

  .band {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    overflow: hidden;
  }

  .band-header {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-sm) var(--gap-md);
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.06);
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
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.15);
    color: #e2e8f0;
    cursor: pointer;
    border-radius: 3px;
  }

  button:hover {
    background: rgba(255,255,255,0.12);
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
    border-bottom: 1px solid rgba(255,255,255,0.06);
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
    opacity: 0.25;
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
    border-top: 1px solid rgba(255,255,255,0.06);
    align-items: flex-start;
  }

  .profiles-detail > :global(*) {
    flex: 1;
    min-width: 300px;
    max-width: 520px;
  }
</style>
