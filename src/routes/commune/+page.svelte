<script lang="ts">
  import "$lib/components/ui/tokens.css";
  import CommitmentRow from "$lib/components/vf/CommitmentRow.svelte";
  import IntentRow from "$lib/components/vf/IntentRow.svelte";
  import ProcessRow from "$lib/components/vf/ProcessRow.svelte";
  import EventRow from "$lib/components/vf/EventRow.svelte";
  import ProcessLayerDiagram from "$lib/components/vf/ProcessLayerDiagram.svelte";
  import ResourceSpecCard from "$lib/components/vf/ResourceSpecCard.svelte";
  import ResourceSpecFormPanel from "$lib/components/vf/ResourceSpecFormPanel.svelte";
  import CommunePanel from "$lib/components/commune/CommunePanel.svelte";
  import PoolStackBar from "$lib/components/commune/PoolStackBar.svelte";
  import EconomicResourceCard from "$lib/components/vf/EconomicResourceCard.svelte";
  import FilterChips from "$lib/components/ui/FilterChips.svelte";
  import {
    recipes,
    resourceSpecs,
    processSpecs,
    recipeList,
    planList,
    processList,
    commitmentList,
    intentList,
    resourceList,
    eventList,
    agentList,
    commune,
    observer,
    communeState,
    accountState,
    resourcePriceSvc,
    refresh,
  } from "$lib/vf-stores.svelte";
  import { seedExample } from "$lib/vf-seed";
  import { resetStores } from "$lib/vf-stores.svelte";
  import type { EconomicResource } from "$lib/schemas";

  let showForm = $state(false);
  let specFilter = $state<string | null>(null);
  let resFilter = $state<string | null>(null);

  // Build specName lookup for row components
  const specNameMap = $derived(
    new Map(resourceSpecs.map((s) => [s.id, s.name])),
  );

  // All recipe processes and flows for the Knowledge band
  const allRecipeProcesses = $derived(
    recipeList.flatMap((r) => recipes.processesForRecipe(r.id)),
  );
  const allRecipeFlows = $derived(
    allRecipeProcesses.flatMap((rp) => {
      const { inputs, outputs } = recipes.flowsForProcess(rp.id);
      return [...inputs, ...outputs];
    }),
  );

  const specTags = $derived([
    ...new Set(resourceSpecs.flatMap((s) => s.resourceClassifiedAs ?? [])),
  ]);
  const resTags = $derived([
    ...new Set(resourceList.flatMap((r) => r.classifiedAs ?? [])),
  ]);

  const filteredSpecs = $derived(
    specFilter
      ? resourceSpecs.filter((s) =>
          s.resourceClassifiedAs?.includes(specFilter!),
        )
      : resourceSpecs,
  );
  // RESOURCES band: exclude individually-owned (primaryAccountable !== 'ose' means claimed/personal)
  const communalRes = $derived(
    resourceList.filter(
      (r) => r.primaryAccountable === "ose" || !r.primaryAccountable,
    ),
  );
  const filteredRes = $derived(
    resFilter
      ? communalRes.filter((r) => r.classifiedAs?.includes(resFilter!))
      : communalRes,
  );

  // INVENTORY band: resources owned by the active agent
  const myResources = $derived(
    communeState.activeAgentId
      ? resourceList.filter(
          (r) => r.primaryAccountable === communeState.activeAgentId,
        )
      : [],
  );

  function claimResource(resource: EconomicResource) {
    const agentId = communeState.activeAgentId;
    if (!agentId) return;
    const cost = resourcePriceSvc.get(resource.conformsTo) ?? 1;
    const unit =
      resource.onhandQuantity?.hasUnit ??
      resource.accountingQuantity?.hasUnit ??
      "units";

    // Debit SVC from commune account — returns false if insufficient capacity
    const acct = commune.accountFor(agentId);
    if (!acct || !acct.claimGoods(cost)) return;

    // Record VF transfer: communal resource → individual resource (auto-created if needed)
    const toId = `inv-${agentId}-${resource.conformsTo}`;
    observer.record({
      id: `ev-claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: "transfer",
      resourceInventoriedAs: resource.id,
      toResourceInventoriedAs: toId,
      resourceConformsTo: resource.conformsTo,
      resourceClassifiedAs: resource.classifiedAs,
      resourceQuantity: { hasNumericalValue: 1, hasUnit: unit },
      provider: resource.primaryAccountable ?? "ose",
      receiver: agentId,
      hasPointInTime: new Date().toISOString(),
    });
    // observer triggers refresh() → syncCommune() automatically
  }
</script>

<svelte:head>
  <title>VF Inspector</title>
</svelte:head>

<ResourceSpecFormPanel open={showForm} onclose={() => (showForm = false)} />

<div class="page">
  <!-- ── COMMUNE PANEL ─────────────────────────────────────────────────────── -->
  <CommunePanel />

  <!-- ── RESOURCES BAND ─────────────────────────────────────────────────────── -->
  <section class="band resources">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-yellow)">RESOURCES</span>
      <span class="count">EconomicResources({resourceList.length})</span>
      <button class="all-btn" class:all-active={resFilter === null} onclick={() => (resFilter = null)}>ALL</button>
      <PoolStackBar pools={communeState.pools} bind:active={resFilter} />
    </div>
    <div class="band-body">
      <div class="res-cards">
        {#if filteredRes.length === 0}
          <span class="empty">—</span>
        {:else}
          {#each filteredRes as resource (resource.id)}
            <EconomicResourceCard
              {resource}
              specName={specNameMap.get(resource.conformsTo) ??
                resource.conformsTo.slice(0, 12)}
              price={resourcePriceSvc.get(resource.conformsTo) ?? 0}
              canClaim={!!communeState.activeAgentId &&
                (resource.classifiedAs?.includes("individual-claimable") ??
                  false) &&
                accountState.current_actual_claim_capacity >=
                  (resourcePriceSvc.get(resource.conformsTo) ?? 0)}
              onclaim={() => claimResource(resource)}
            />
          {/each}
        {/if}
      </div>
    </div>
  </section>

  <!-- ── INVENTORY BAND ────────────────────────────────────────────────────── -->
  {#if communeState.activeAgentId}
    <section class="band inventory">
      <div class="band-header">
        <span class="band-title" style="color: var(--zone-green)"
          >MY INVENTORY</span
        >
        <span class="counts">
          <span class="count">{communeState.activeAgentId}</span>
          <span class="count">Resources({myResources.length})</span>
        </span>
      </div>
      <div class="band-body">
        <div class="res-cards">
          {#if myResources.length === 0}
            <span class="empty"
              >No resources claimed yet — use Claim in the RESOURCES band above</span
            >
          {:else}
            {#each myResources as resource (resource.id)}
              <EconomicResourceCard
                {resource}
                specName={specNameMap.get(resource.conformsTo) ??
                  resource.conformsTo.slice(0, 12)}
                price={resourcePriceSvc.get(resource.conformsTo) ?? 0}
                canClaim={false}
                onclaim={() => {}}
              />
            {/each}
          {/if}
        </div>
      </div>
    </section>
  {/if}

  <!-- ── KNOWLEDGE BAND ───────────────────────────────────────────────────── -->
  <section class="band knowledge">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-yellow)">KNOWLEDGE</span
      >
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
      <div class="column spec-column">
        <div class="col-header spec-col-header">
          <span>Resource Specs</span>
          {#if specTags.length > 0}
            <FilterChips tags={specTags} bind:active={specFilter} />
          {/if}
        </div>
        <div class="spec-cards">
          <button
            class="add-spec-card"
            onclick={() => (showForm = true)}
            title="Add Resource Spec"
          >
            <span class="add-icon">+</span>
            <span class="add-label">Add Spec</span>
          </button>
          {#each filteredSpecs as spec (spec.id)}
            <ResourceSpecCard {spec} />
          {/each}
        </div>
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
                <span class="muted"
                  >→ {specNameMap.get(recipe.primaryOutput) ??
                    recipe.primaryOutput.slice(0, 8)}</span
                >
              {/if}
            </div>
            {#each recipes.processesForRecipe(recipe.id) as rp (rp.id)}
              <div class="entity-row indent">
                <span class="muted">▷</span>
                <span>{rp.name}</span>
                {#if rp.hasDuration}
                  <span class="muted"
                    >{rp.hasDuration.hasNumericalValue}{rp.hasDuration
                      .hasUnit}</span
                  >
                {/if}
              </div>
            {/each}
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
                <span class="muted">{plan.due.slice(0, 10)}</span>
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
            <CommitmentRow
              commitment={c}
              specName={specNameMap.get(c.resourceConformsTo ?? "")}
            />
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
            <IntentRow
              {intent}
              specName={specNameMap.get(intent.resourceConformsTo ?? "")}
            />
          {/each}
        {/if}
      </div>
    </div>
  </section>

  <!-- ── OBSERVATION BAND ──────────────────────────────────────────────────── -->
  <section class="band observation">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-excess)"
        >OBSERVATION</span
      >
      <span class="counts">
        <span class="count">Agents({agentList.length})</span>
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
              <span class="agent-type muted">{agent.type.slice(0, 3)}</span>
              <span class="entity-name">{agent.name ?? agent.id}</span>
            </div>
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
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    overflow: hidden;
  }

  .band-header {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-sm) var(--gap-md);
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
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
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #e2e8f0;
    cursor: pointer;
    border-radius: 3px;
  }

  button:hover {
    background: rgba(255, 255, 255, 0.12);
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

  .spec-column {
    min-width: unset;
    max-height: unset;
    overflow-y: visible;
  }

  .spec-col-header {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    flex-wrap: wrap;
    max-height: unset;
  }

  .spec-cards {
    display: flex;
    flex-direction: row;
    gap: var(--gap-sm);
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .all-btn {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    padding: 0 10px;
    height: 26px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 3px;
    color: rgba(255,255,255,0.45);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
  }

  .all-btn:hover,
  .all-btn.all-active {
    background: rgba(255,255,255,0.12);
    color: #e2e8f0;
    border-color: rgba(255,255,255,0.3);
  }

  .filter-wrap {
    margin-left: auto;
  }

  .res-cards {
    display: flex;
    flex-direction: row;
    gap: var(--gap-sm);
    overflow-x: auto;
    padding-bottom: 4px;
    flex-wrap: wrap;
  }

  .add-spec-card {
    width: 160px;
    min-height: 240px;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.3);
    font-family: var(--font-sans);
    transition:
      background 0.15s,
      color 0.15s,
      border-color 0.15s;
  }

  .add-spec-card:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.3);
    color: rgba(255, 255, 255, 0.7);
  }

  .add-icon {
    font-size: 24px;
    line-height: 1;
    font-weight: 300;
  }

  .add-label {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .col-header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.4;
    padding-bottom: var(--gap-xs);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
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
    background: rgba(214, 158, 46, 0.15);
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
