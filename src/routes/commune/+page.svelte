<script lang="ts">
  import "$lib/components/ui/tokens.css";
  import CommitmentRow from "$lib/components/vf/CommitmentRow.svelte";
  import IntentRow from "$lib/components/vf/IntentRow.svelte";
  import ProcessRow from "$lib/components/vf/ProcessRow.svelte";
  import EventRow from "$lib/components/vf/EventRow.svelte";
  import ProcessLayerDiagram from "$lib/components/vf/ProcessLayerDiagram.svelte";
  import NetworkDiagram from "$lib/components/vf/NetworkDiagram.svelte";
  import EventRecorderPanel from "$lib/components/observation/EventRecorderPanel.svelte";
  import type { FlowSelectCtx } from "$lib/components/vf/observe-types";
  import ResourceSpecCard from "$lib/components/vf/ResourceSpecCard.svelte";
  import ResourceSpecFormPanel from "$lib/components/vf/ResourceSpecFormPanel.svelte";
  import CommunePanel from "$lib/components/commune/CommunePanel.svelte";
  import MemberCard from "$lib/components/commune/MemberCard.svelte";
  import CommunalDemandSpecCard from "$lib/components/commune/CommunalDemandSpecCard.svelte";
  import ResourceDemandCard from "$lib/components/commune/ResourceDemandCard.svelte";
  import SpecPickerCard from "$lib/components/commune/SpecPickerCard.svelte";
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
    planner,
    commune,
    observer,
    communeState,
    accountState,
    communeDemandState,
    communeDemandPolicies,
    derivedDependentPolicies,
    communeMembersState,
    setActiveAgentId,
    resourcePriceSvc,
    refresh,
    upsertDemandPolicy,
    removeDemandPolicy,
    upsertDerivedDependentPolicy,
    removeDerivedDependentPolicy,
  } from "$lib/vf-stores.svelte";
  import {
    deriveCommunalDemand,
    deriveDependentDemand,
    type CommuneDemandPolicy,
    type DerivedDependentPolicy,
  } from "$lib/observation/demand-policy";
  import { buildIndependentDemandIndex } from "$lib/indexes/independent-demand";
  import { seedExample } from "$lib/vf-seed";
  import { resetStores } from "$lib/vf-stores.svelte";
  import type { EconomicResource, Intent } from "$lib/schemas";

  let showForm = $state(false);
  let specFilter = $state<string | null>(null);
  let diagramMode  = $state<'plan' | 'observe'>('plan');
  let selectedFlow = $state<FlowSelectCtx | null>(null);

  function addDemandForSpec(specId: string) {
    const spec = resourceSpecs.find((s) => s.id === specId);
    planner.addIntent({
      action: "transfer",
      receiver: "ose",
      name: spec?.name ?? "",
      resourceConformsTo: specId === "__unspecified__" ? undefined : specId,
      resourceQuantity: {
        hasNumericalValue: 1,
        hasUnit: spec?.defaultUnitOfResource ?? "units",
      },
    });
    refresh();
  }
  function updateSlot(intent: (typeof intentList)[number]) {
    planner.addIntent(intent);
    refresh();
  }
  function deleteSlot(id: string) {
    planner.removeRecords({ intentIds: [id] });
    refresh();
  }

  function addDerivedIndepCard(specId: string) {
    const spec = resourceSpecs.find(s => s.id === specId);
    upsertDemandPolicy({
      id: `cdp-${specId}-${Date.now()}`,
      name: spec?.name ?? specId,
      specId,
      unit: spec?.defaultUnitOfResource ?? 'units',
      factorType: 'per_member',
      qtyPerMember: 1,
    });
  }

  function addDerivedDepCard(specId: string) {
    const spec = resourceSpecs.find(s => s.id === specId);
    upsertDerivedDependentPolicy({
      id: `ddp-${specId}-${Date.now()}`,
      specId,
      unit: spec?.defaultUnitOfResource ?? 'units',
      factorType: 'replenishment_rate',
      rate: 0.1,
    });
  }

  let resFilter = $state<string | null>(null);

  // Build specName lookup for row components
  const specNameMap = $derived(
    new Map(resourceSpecs.map((s) => [s.id, s.name])),
  );

  // Group intents by resourceConformsTo for SLOTS band
  const specDemands = $derived.by(() => {
    const groups = new Map<string, typeof intentList>();
    for (const intent of intentList) {
      const key = intent.resourceConformsTo ?? "__unspecified__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(intent);
    }
    return groups;
  });

  const demandGroups = $derived.by(() =>
    [...specDemands.entries()].map(([specId, intents]) => ({
      spec:
        resourceSpecs.find((s) => s.id === specId) ??
        ({ id: specId, name: specId } as any),
      intents,
    })),
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
  const agentNameMap = $derived(
    new Map(agentList.map((a) => [a.id, a.name ?? a.id])),
  );

  // COMMUNAL DEMAND: derive policy entries from store + member count
  const communalDemandEntries = $derived(
    deriveCommunalDemand(communeDemandPolicies, communeMembersState.length),
  );

  // Specs tagged 'communal-demand' — identifies welfare demand specs
  const communalDemandSpecIds = $derived(
    new Set(
      resourceSpecs
        .filter((s) => s.resourceClassifiedAs?.includes("communal-demand"))
        .map((s) => s.id),
    ),
  );

  const communalDemandIndex = $derived(
    buildIndependentDemandIndex(
      intentList.filter(
        (i) =>
          !i.finished &&
          i.resourceConformsTo !== undefined &&
          communalDemandSpecIds.has(i.resourceConformsTo!),
      ),
      commitmentList,
      eventList,
      new Map(),
    ),
  );

  // Merge by spec: all specs that appear in either derived or intent demands
  const communalDemandBySpec = $derived(
    (() => {
      const specIds = new Set([
        ...communalDemandEntries.map((e) => e.specId),
        ...communalDemandIndex.spec_index.keys(),
      ]);
      return [...specIds].map((specId) => ({
        specId,
        specName: specNameMap.get(specId) ?? specId,
        derivedRows: communalDemandEntries.filter((e) => e.specId === specId),
        intentRows: [...(communalDemandIndex.spec_index.get(specId) ?? [])]
          .map((id) => ({
            slot: communalDemandIndex.demands.get(id)!,
            intent: intentList.find((i) => i.id === id)!,
          }))
          .filter((x) => x.slot && x.intent),
      }));
    })(),
  );

  // DEPENDENT DEMAND: commitments from recipe explosion, grouped by spec
  const dependentDemandGroups = $derived.by(() => {
    const groups = new Map<string, typeof commitmentList>();
    for (const c of commitmentList) {
      const key = c.resourceConformsTo ?? '__unspecified__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    return [...groups.entries()].map(([specId, commits]) => ({
      spec: resourceSpecs.find(s => s.id === specId) ?? { id: specId, name: specId } as any,
      intents: commits as unknown as Intent[],
    }));
  });

  // DERIVED INDEPENDENT DEMAND: one card per spec from demandGroups OR communeDemandPolicies
  const derivedIndepGroups = $derived.by(() => {
    const policyBySpec = new Map(communeDemandPolicies.map(p => [p.specId, p]));
    const specIds = new Set([
      ...demandGroups.map(g => g.spec.id),
      ...communeDemandPolicies.map(p => p.specId),
    ]);
    return [...specIds].map(specId => {
      const spec = resourceSpecs.find(s => s.id === specId) ?? { id: specId, name: specId } as any;
      const policy = policyBySpec.get(specId);
      const entry = communalDemandEntries.find(e => e.specId === specId);
      const syntheticIntents: Intent[] = entry ? [{
        id: `derived-indep-${specId}`,
        action: 'transfer' as const,
        resourceConformsTo: specId,
        resourceQuantity: { hasNumericalValue: entry.derivedQty, hasUnit: entry.unit },
      }] : [];
      return { spec, intents: syntheticIntents, policy };
    });
  });

  // DERIVED DEPENDENT DEMAND: one card per spec across all demand bands
  const derivedDepGroups = $derived.by(() => {
    const ddPolicyBySpec = new Map(derivedDependentPolicies.map(p => [p.specId, p]));
    const allSpecIds = new Set([
      ...demandGroups.map(g => g.spec.id),
      ...dependentDemandGroups.map(g => g.spec.id),
      ...derivedDependentPolicies.map(p => p.specId),
    ]);
    return [...allSpecIds].map(specId => {
      const spec = resourceSpecs.find(s => s.id === specId) ?? { id: specId, name: specId } as any;
      const policy = ddPolicyBySpec.get(specId);
      const depTotal = commitmentList
        .filter(c => c.resourceConformsTo === specId)
        .reduce((s, c) => s + (c.resourceQuantity?.hasNumericalValue ?? 0), 0);
      const indepTotal = intentList
        .filter(i => i.resourceConformsTo === specId)
        .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
      const syntheticIntents: Intent[] = policy
        ? [{ id: `dep-derived-${specId}`, action: 'transfer' as const, resourceConformsTo: specId,
            resourceQuantity: { hasNumericalValue: deriveDependentDemand(policy, depTotal, indepTotal).qty, hasUnit: policy.unit } }]
        : [];
      return { spec, intents: syntheticIntents, policy, depTotal, indepTotal };
    });
  });

  // Group demand entries by specId for the INDIVIDUAL DEMAND band
  const demandBySpec = $derived(
    communeDemandState.reduce((map, e) => {
      if (!map.has(e.specId)) map.set(e.specId, []);
      map.get(e.specId)!.push(e);
      return map;
    }, new Map<string, typeof communeDemandState>()),
  );

  // Available specs for each SpecPickerCard
  const availableForIndep = $derived(
    resourceSpecs.filter(s => !demandGroups.some(g => g.spec.id === s.id))
  );
  const availableForDerivedIndep = $derived(
    resourceSpecs.filter(s => !derivedIndepGroups.some(g => g.spec.id === s.id))
  );
  const availableForDerivedDep = $derived(
    resourceSpecs.filter(s => !derivedDepGroups.some(g => g.spec.id === s.id))
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

  <!-- ── MEMBERS BAND ─────────────────────────────────────────────────────────── -->
  {#if communeMembersState.length > 0}
    <section class="band members">
      <div class="band-header">
        <span class="band-title" style="color: var(--zone-yellow)">MEMBERS</span
        >
        <span class="count">{communeMembersState.length} accounts</span>
        <span class="count">
          welfare: {(communeState.welfareAllocationRate * 100).toFixed(1)}% ·
          fund: {communeState.social_welfare_fund.toFixed(1)} SVC
        </span>
      </div>
      <div class="members-body">
        {#each communeMembersState as member (member.agentId)}
          <MemberCard
            {member}
            name={agentNameMap.get(member.agentId) ?? member.agentId}
            active={communeState.activeAgentId === member.agentId}
            onclick={() =>
              setActiveAgentId(
                communeState.activeAgentId === member.agentId
                  ? null
                  : member.agentId,
              )}
          />
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── SLOTS BAND ───────────────────────────────────────────────────────── -->
  <section class="band slots">
    <div class="band-header">
      <span class="band-title" style="color: white">INDEPENDENT DEMAND</span>
      <span class="count" style="color: rgba(255,255,255,0.6)"
        >Intents({intentList.length})</span
      >
    </div>
    <div class="slots-grid">
      {#each demandGroups as { spec, intents } (spec.id)}
        <ResourceDemandCard
          {spec}
          {intents}
          onAddDemand={() => addDemandForSpec(spec.id)}
          onUpdate={updateSlot}
          onDelete={deleteSlot}
        />
      {/each}
      <SpecPickerCard
        specs={availableForIndep}
        onPick={addDemandForSpec}
        label="Add demand"
      />
      {#if intentList.length === 0}
        <span class="slots-empty">No slots yet — load the example.</span>
      {/if}
    </div>
  </section>

  <!-- ── DERIVED INDEPENDENT DEMAND BAND ─────────────────────────────────────── -->
  <section class="band communal-demand">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-green)">DERIVED INDEPENDENT DEMAND</span>
      <span class="count">from members × independent demand · {communeMembersState.length} members</span>
    </div>
    {#if derivedIndepGroups.length === 0}
      <div class="band-empty">Computed from member population and demand policies — load members and independent demand to populate.</div>
    {:else}
      <div class="slots-grid">
        {#each derivedIndepGroups as group (group.spec.id)}
          <ResourceDemandCard
            spec={group.spec}
            intents={group.intents}
            policyKind="independent"
            memberCount={communeMembersState.length}
            policy={group.policy}
            onSavePolicy={(p) => upsertDemandPolicy(p as CommuneDemandPolicy)}
            onDeletePolicy={() => group.policy && removeDemandPolicy(group.policy.id)}
          />
        {/each}
        <SpecPickerCard
          specs={availableForDerivedIndep}
          onPick={addDerivedIndepCard}
          label="Add policy"
        />
      </div>
    {/if}
  </section>

  <!-- ── DEPENDENT DEMAND BAND ─────────────────────────────────────────────── -->
  <section class="band dependent-demand">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-excess)">DEPENDENT DEMAND</span>
      <span class="count">from recipe explosion · {commitmentList.length} commitments</span>
    </div>
    <div class="slots-grid">
      {#each dependentDemandGroups as group (group.spec.id)}
        <ResourceDemandCard spec={group.spec} intents={group.intents} />
      {:else}
        <div class="band-empty">Generated by the planner when recipes are exploded — run the planner to populate.</div>
      {/each}
    </div>
  </section>

  <!-- ── DERIVED DEPENDENT DEMAND BAND ─────────────────────────────────────── -->
  <section class="band derived-dep-demand">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-red)">DERIVED DEPENDENT DEMAND</span>
      <span class="count">replenishment · buffers · administration</span>
    </div>
    {#if derivedDepGroups.length === 0}
      <div class="band-empty">Add independent or dependent demand first — derived demand is computed from those bands.</div>
    {:else}
      <div class="slots-grid">
        {#each derivedDepGroups as group (group.spec.id)}
          <ResourceDemandCard
            spec={group.spec}
            intents={group.intents}
            policyKind="dependent"
            dependentTotal={group.depTotal}
            independentTotal={group.indepTotal}
            policy={group.policy}
            onSavePolicy={(p) => upsertDerivedDependentPolicy(p as DerivedDependentPolicy)}
            onDeletePolicy={() => group.policy && removeDerivedDependentPolicy(group.policy.id)}
          />
        {/each}
        <SpecPickerCard
          specs={availableForDerivedDep}
          onPick={addDerivedDepCard}
          label="Add policy"
        />
      </div>
    {/if}
  </section>

  <!-- ── INDIVIDUAL DEMAND BAND ────────────────────────────────────────────────── -->
  {#if demandBySpec.size > 0}
    <section class="band demand">
      <div class="band-header">
        <span class="band-title" style="color: var(--zone-yellow)"
          >INDIVIDUAL DEMAND</span
        >
        <span class="count">
          {demandBySpec.size} specs · {new Set(
            communeDemandState.map((d) => d.agentId),
          ).size} members
        </span>
        <span class="count">
          pool: {communeState.available_claimable_pool.toFixed(1)} SVC available
        </span>
      </div>
      <div class="demand-body">
        {#each [...demandBySpec.entries()] as [specId, entries] (specId)}
          {@const price = entries[0].pricePerUnit}
          {@const unit = entries[0].unit}
          {@const totalQty = Math.floor(
            communeState.available_claimable_pool / price,
          )}
          <div class="demand-spec-block">
            <div class="demand-spec-header">
              <span class="demand-spec-name"
                >{specNameMap.get(specId) ?? specId}</span
              >
              <span class="demand-price">{price} SVC/{unit}</span>
              <span class="demand-total">{totalQty} {unit}</span>
            </div>
            {#each entries as entry (entry.agentId)}
              <div class="demand-row">
                <span class="demand-agent"
                  >{agentNameMap.get(entry.agentId) ?? entry.agentId}</span
                >
                <span class="demand-budget"
                  >{entry.svcBudget.toFixed(1)} SVC</span
                >
                <span class="demand-qty"
                  >{entry.maxQty}<span class="demand-unit"> {unit}</span></span
                >
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── RESOURCES BAND ─────────────────────────────────────────────────────── -->
  <section class="band resources">
    <div class="band-header">
      <span class="band-title" style="color: var(--zone-yellow)">RESOURCES</span
      >
      <span class="count">EconomicResources({resourceList.length})</span>
      <button
        class="all-btn"
        class:all-active={resFilter === null}
        onclick={() => (resFilter = null)}>ALL</button
      >
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
      <div class="mode-toggle">
        <button class:active={diagramMode === 'plan'}
          onclick={() => { diagramMode = 'plan'; selectedFlow = null; }}>PLAN</button>
        <button class:active={diagramMode === 'observe'}
          onclick={() => diagramMode = 'observe'}>OBSERVE</button>
      </div>
    </div>
    <div class="diagram-wrap">
      <NetworkDiagram
        mode={diagramMode}
        onflowselect={(ctx) => selectedFlow = ctx}
        selectedFlow={selectedFlow}
      />
    </div>
    {#if selectedFlow}
      <div class="observe-panel">
        <EventRecorderPanel
          context={selectedFlow}
          onrecord={() => selectedFlow = null}
          onclose={() => selectedFlow = null}
        />
      </div>
    {/if}
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
    background: var(--border-faint);
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .all-btn:hover,
  .all-btn.all-active {
    background: var(--bg-elevated);
    color: #e2e8f0;
    border-color: rgba(255, 255, 255, 0.3);
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
    border: 1px dashed var(--border-dim);
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
    background: var(--border-faint);
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
    background: rgba(214, 158, 46, 0.15);
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

  /* ── MEMBERS BAND ─────────────────────────────────────────────────────── */
  .members-body {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sm);
    padding: var(--gap-md);
  }

  /* ── SLOTS BAND ───────────────────────────────────────────────────────── */
  .band.slots {
    background: linear-gradient(135deg, #5c6bc0 0%, #7c3aed 100%);
    border-color: rgba(255, 255, 255, 0.12);
  }
  .band.slots .band-header {
    border-color: rgba(255, 255, 255, 0.12);
  }
  .slots-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-md);
    padding: var(--gap-md);
    align-items: flex-start;
  }
  .slots-empty {
    color: rgba(255, 255, 255, 0.4);
    font-size: var(--text-xs);
    padding: var(--gap-md);
  }

  /* ── BAND EMPTY STATE ─────────────────────────────────────────────────── */
  .band-empty {
    padding: var(--gap-md);
    font-size: var(--text-xs);
    color: rgba(255, 255, 255, 0.28);
    font-style: italic;
  }


  /* ── DEMAND BAND ──────────────────────────────────────────────────────── */
  .demand-body {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-md);
    padding: var(--gap-md);
  }

  .demand-spec-block {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 160px;
    border: 1px solid rgba(214, 158, 46, 0.12);
    border-radius: 3px;
    overflow: hidden;
  }

  .demand-spec-header {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 10px 5px;
    background: rgba(214, 158, 46, 0.06);
    border-bottom: 1px solid rgba(214, 158, 46, 0.12);
  }

  .demand-spec-name {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--zone-yellow);
  }

  .demand-price {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.45;
  }

  .demand-total {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--zone-yellow);
    opacity: 0.7;
    margin-top: 2px;
  }

  .demand-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: var(--gap-sm);
    align-items: baseline;
    padding: 3px 10px;
    font-size: var(--text-xs);
  }

  .demand-row:last-child {
    padding-bottom: 6px;
  }

  .demand-agent {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .demand-budget {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.35;
    text-align: right;
  }

  .demand-qty {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 600;
    color: #e2e8f0;
    text-align: right;
    min-width: 40px;
  }

  .demand-unit {
    font-size: 0.55rem;
    opacity: 0.45;
    font-weight: 400;
  }

  /* ── DIAGRAM OBSERVE MODE ─────────────────────────────────────────────── */
  .mode-toggle { display: flex; gap: var(--gap-xs); margin-left: auto; }
  .mode-toggle button {
    font-family: var(--font-mono); font-size: var(--text-xs);
    padding: 2px 8px; border-radius: 3px; cursor: pointer;
    background: var(--bg-overlay); border: 1px solid rgba(255,255,255,0.12);
    color: rgba(226,232,240,0.5);
  }
  .mode-toggle button.active {
    background: var(--bg-elevated); border-color: rgba(255,255,255,0.3);
    color: #e2e8f0;
  }
  .observe-panel {
    padding: var(--gap-md);
    border-top: 1px solid var(--border-faint);
    max-width: 480px;
  }
</style>
