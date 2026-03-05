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
  } from '$lib/vf-stores.svelte';
  import { seedExample } from '$lib/vf-seed';
  import { resetStores } from '$lib/vf-stores.svelte';

  // Build specName lookup for row components
  const specNameMap = $derived(
    new Map(resourceSpecs.map(s => [s.id, s.name]))
  );

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
      <NetworkDiagram />
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
</style>
