<script lang="ts">
	import type { ComponentSpec } from '$lib/workshop/component-selector';
	import type { VFInstances } from '$lib/workshop/card-to-vf';

	// VF components
	import IntentRow from '$lib/components/vf/IntentRow.svelte';
	import CommitmentRow from '$lib/components/vf/CommitmentRow.svelte';
	import EventRow from '$lib/components/vf/EventRow.svelte';
	import ProcessRow from '$lib/components/vf/ProcessRow.svelte';
	import ResourceRow from '$lib/components/vf/ResourceRow.svelte';
	import ResourceSpecCard from '$lib/components/vf/ResourceSpecCard.svelte';
	import ActionBadge from '$lib/components/vf/ActionBadge.svelte';

	interface Props {
		tree: ComponentSpec;
		vf: VFInstances;
	}

	let { tree, vf }: Props = $props();

	// Build lookup maps for resolving spec names
	const specNames = $derived(
		new Map(vf.resourceSpecifications.map(s => [s.id, s.name]))
	);
	const agentNames = $derived(
		new Map(vf.agents.map(a => [a.id, a.name ?? a.id]))
	);
</script>

{#snippet renderNode(node: ComponentSpec)}
	{#if node.component === 'div' || node.component === 'section'}
		<div
			class={node.className ?? ''}
			class:layout-row={node.layout === 'row'}
			class:layout-col={node.layout === 'column'}
		>
			{#each node.children as child, idx (child.sourceCardId ?? idx)}
				{@render renderNode(child)}
			{/each}
		</div>

	{:else if node.component === 'IntentRow'}
		{@const intent = node.props.intent}
		{@const specName = node.props.specName ?? (intent?.resourceConformsTo ? specNames.get(intent.resourceConformsTo) : undefined)}
		<div class="vf-row-wrap">
			<IntentRow intent={intent} specName={specName} />
			{#if intent?.provider}
				<span class="agent-tag provider">{agentNames.get(intent.provider) ?? intent.provider.slice(0, 10)}</span>
			{/if}
			{#if intent?.receiver}
				<span class="agent-tag receiver">{agentNames.get(intent.receiver) ?? intent.receiver.slice(0, 10)}</span>
			{/if}
		</div>

	{:else if node.component === 'CommitmentRow'}
		{@const commitment = node.props.commitment}
		{@const specName = node.props.specName ?? (commitment?.resourceConformsTo ? specNames.get(commitment.resourceConformsTo) : undefined)}
		<div class="vf-row-wrap">
			<CommitmentRow commitment={commitment} specName={specName} />
		</div>

	{:else if node.component === 'EventRow'}
		{@const event = node.props.event}
		<div class="vf-row-wrap">
			<EventRow event={event} />
		</div>

	{:else if node.component === 'ProcessRow'}
		{@const process = node.props.process}
		{@const specName = node.props.specName}
		<div class="vf-row-wrap process-row-wrap">
			<ProcessRow process={process} specName={specName} />
		</div>

	{:else if node.component === 'ResourceRow'}
		{@const resource = node.props.resource}
		{@const specName = node.props.specName ?? (resource?.conformsTo ? specNames.get(resource.conformsTo) : undefined)}
		<div class="vf-row-wrap">
			<ResourceRow resource={resource} specName={specName} />
		</div>

	{:else if node.component === 'ResourceSpecCard'}
		{@const spec = node.props.spec}
		<ResourceSpecCard spec={spec} />

	{:else if node.component === 'AgentCard'}
		{@const agent = node.props.agent}
		<div class="agent-card">
			<span class="agent-icon">{agent?.type === 'Organization' ? '&#x1f3e2;' : agent?.type === 'EcologicalAgent' ? '&#x1f33f;' : '&#x1f464;'}</span>
			<div class="agent-info">
				<strong>{agent?.name ?? 'Agent'}</strong>
				<span class="agent-type">{agent?.type ?? 'Person'}</span>
				{#if agent?.primaryLocation}
					<span class="agent-loc">{agent.primaryLocation}</span>
				{/if}
			</div>
		</div>

	{:else if node.component === 'RecipeCard'}
		{@const recipe = node.props.recipe}
		<div class="recipe-card">
			<span class="recipe-icon">&#x1f4d0;</span>
			<div class="recipe-info">
				<strong>{recipe?.name ?? 'Recipe'}</strong>
				<span class="recipe-label">template</span>
			</div>
		</div>

	{:else if node.component === 'FulfillmentBar'}
		{@const state = node.props.state}
		<div class="fulfillment-bar">
			<div class="fill-track">
				<div class="fill-bar" class:intended={state === 'intended'} class:committed={state === 'committed'} class:fulfilled={state === 'fulfilled'}></div>
			</div>
			<span class="fill-label">{state}</span>
		</div>

	{:else if node.component === 'LensHeader'}
		<div class="lens-header">
			<span class="lens-icon">
				{#if node.props.icon === 'eye'}&#x1f441;{:else if node.props.icon === 'scale'}&#x2696;{:else if node.props.icon === 'shield'}&#x1f6e1;{:else if node.props.icon === 'boundary'}&#x2b55;{:else if node.props.icon === 'bridge'}&#x1f309;{:else}&#x2699;{/if}
			</span>
			<strong>{node.props.title}</strong>
			<span class="lens-subtitle">{node.props.subtitle}</span>
		</div>

	{:else if node.component === 'SignalBadge'}
		<span
			class="signal-badge"
			class:deficit={node.props.type === 'deficit'}
			class:surplus={node.props.type === 'surplus'}
			class:conservation={node.props.type === 'conservation'}
			class:replenishment={node.props.type === 'replenishment'}
		>{node.props.label}</span>

	{:else if node.component === 'BufferZoneBar'}
		<div class="buffer-zone-bar">
			<div class="bz red"></div>
			<div class="bz yellow"></div>
			<div class="bz green"></div>
		</div>

	{:else}
		<!-- Unknown component: render children -->
		<div class="unknown-comp" title={node.component}>
			{#each node.children as child, idx (child.sourceCardId ?? idx)}
				{@render renderNode(child)}
			{/each}
		</div>
	{/if}
{/snippet}

{@render renderNode(tree)}

<style>
	/* Layout */
	.layout-row {
		display: flex;
		flex-direction: row;
		gap: var(--gap-md, 8px);
		align-items: flex-start;
		flex-wrap: wrap;
	}

	.layout-col {
		display: flex;
		flex-direction: column;
		gap: var(--gap-md, 8px);
	}

	/* Generic wrappers from class names */
	:global(.workshop-interface) {
		display: flex;
		flex-direction: column;
		gap: var(--gap-lg, 16px);
	}

	:global(.card-row) {
		display: flex;
		flex-direction: row;
		gap: var(--gap-md, 8px);
		align-items: flex-start;
		flex-wrap: wrap;
	}

	:global(.card-with-signals) {
		display: flex;
		flex-direction: column;
		gap: var(--gap-xs, 2px);
	}

	:global(.fulfillment-chain) {
		display: flex;
		flex-direction: row;
		gap: var(--gap-sm, 4px);
		align-items: center;
		padding: var(--gap-md, 8px);
		border: 1px dashed var(--border-dim, rgba(130, 175, 255, 0.35));
		border-radius: 8px;
		background: var(--bg-overlay, rgba(99, 155, 255, 0.04));
	}

	:global(.fulfillment-chains) {
		display: flex;
		flex-direction: column;
		gap: var(--gap-md, 8px);
	}

	/* Scope panel */
	:global(.scope-panel) {
		border: 2px solid var(--border-dim, rgba(130, 175, 255, 0.35));
		border-radius: 10px;
		padding: var(--gap-md, 8px) var(--gap-lg, 16px);
	}

	/* Observer panel */
	:global(.observer-panel) {
		border-left: 3px solid #4fd1c5;
		padding-left: var(--gap-lg, 16px);
	}

	/* Netter panel */
	:global(.netter-panel) {
		border-left: 3px solid #4ca6f0;
		padding-left: var(--gap-lg, 16px);
	}

	/* Buffer panel */
	:global(.buffer-panel) {
		border-left: 3px solid var(--zone-yellow, #e8b04e);
		padding-left: var(--gap-lg, 16px);
	}

	/* Federation panel */
	:global(.federation-panel) {
		border: 2px dashed #3182ce;
		border-radius: 10px;
		padding: var(--gap-md, 8px) var(--gap-lg, 16px);
	}

	/* Recipe template */
	:global(.recipe-template) {
		border: 2px dashed var(--border-dim, rgba(130, 175, 255, 0.35)) !important;
	}

	/* VF row wrapper */
	.vf-row-wrap {
		display: flex;
		align-items: center;
		gap: var(--gap-sm, 4px);
		padding: 6px 10px;
		background: var(--bg-elevated, #222e48);
		border-radius: 6px;
		border: 1px solid var(--border-faint, rgba(130, 175, 255, 0.18));
	}

	.process-row-wrap {
		border-left: 3px solid #9f7aea;
	}

	/* Agent card */
	.agent-card {
		display: flex;
		align-items: center;
		gap: var(--gap-md, 8px);
		padding: 8px 12px;
		background: var(--bg-elevated, #222e48);
		border-radius: 6px;
		border: 1px solid var(--border-faint, rgba(130, 175, 255, 0.18));
		border-left: 3px solid #4fd1c5;
	}

	.agent-icon {
		font-size: 1.4rem;
	}

	.agent-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.agent-info strong {
		font-size: var(--text-sm, 0.8rem);
		color: var(--text-primary, #e4eeff);
	}

	.agent-type {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.agent-loc {
		font-size: var(--text-xs, 0.7rem);
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
	}

	.agent-tag {
		font-family: var(--font-mono, monospace);
		font-size: 0.6rem;
		padding: 1px 5px;
		border-radius: 3px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.agent-tag.provider {
		background: rgba(72, 187, 120, 0.12);
		color: var(--zone-green, #48bb78);
	}

	.agent-tag.receiver {
		background: rgba(76, 166, 240, 0.12);
		color: var(--zone-excess, #4ca6f0);
	}

	/* Recipe card */
	.recipe-card {
		display: flex;
		align-items: center;
		gap: var(--gap-md, 8px);
		padding: 8px 12px;
		background: var(--bg-elevated, #222e48);
		border-radius: 6px;
		border: 2px dashed var(--border-dim, rgba(130, 175, 255, 0.35));
	}

	.recipe-icon {
		font-size: 1.2rem;
	}

	.recipe-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.recipe-info strong {
		font-size: var(--text-sm, 0.8rem);
		color: var(--text-primary, #e4eeff);
	}

	.recipe-label {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* Fulfillment bar */
	.fulfillment-bar {
		display: flex;
		align-items: center;
		gap: var(--gap-sm, 4px);
		min-width: 80px;
	}

	.fill-track {
		flex: 1;
		height: 6px;
		background: var(--bg-base, #111827);
		border-radius: 3px;
		overflow: hidden;
	}

	.fill-bar {
		height: 100%;
		border-radius: 3px;
		transition: width 0.3s;
	}

	.fill-bar.intended {
		width: 20%;
		background: var(--zone-yellow, #e8b04e);
	}

	.fill-bar.committed {
		width: 60%;
		background: var(--zone-excess, #4ca6f0);
	}

	.fill-bar.fulfilled {
		width: 100%;
		background: var(--zone-green, #48bb78);
	}

	.fill-label {
		font-family: var(--font-mono, monospace);
		font-size: 0.6rem;
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	/* Lens header */
	.lens-header {
		display: flex;
		align-items: center;
		gap: var(--gap-sm, 4px);
		font-size: var(--text-sm, 0.8rem);
		color: var(--text-secondary, rgba(188, 212, 252, 0.8));
		margin-bottom: var(--gap-sm, 4px);
		padding-bottom: var(--gap-sm, 4px);
		border-bottom: 1px solid var(--border-faint, rgba(130, 175, 255, 0.18));
	}

	.lens-icon {
		font-size: 1rem;
	}

	.lens-subtitle {
		font-size: var(--text-xs, 0.7rem);
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
	}

	/* Signal badges */
	.signal-badge {
		display: inline-flex;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.6rem;
		font-weight: 600;
		font-family: var(--font-mono, monospace);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.signal-badge.deficit {
		background: rgba(252, 88, 88, 0.15);
		color: var(--zone-red, #fc5858);
	}

	.signal-badge.surplus {
		background: rgba(72, 187, 120, 0.15);
		color: var(--zone-green, #48bb78);
	}

	.signal-badge.conservation {
		background: rgba(232, 176, 78, 0.15);
		color: var(--zone-yellow, #e8b04e);
	}

	.signal-badge.replenishment {
		background: rgba(76, 166, 240, 0.15);
		color: var(--zone-excess, #4ca6f0);
	}

	/* Buffer zone bar */
	.buffer-zone-bar {
		display: flex;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
		margin: var(--gap-xs, 2px) 0;
	}

	.bz {
		flex: 1;
	}

	.bz.red { background: var(--zone-red, #fc5858); }
	.bz.yellow { background: var(--zone-yellow, #e8b04e); }
	.bz.green { background: var(--zone-green, #48bb78); }

	/* Unknown */
	.unknown-comp {
		border: 1px dashed var(--border-faint, rgba(130, 175, 255, 0.18));
		border-radius: 4px;
		padding: var(--gap-sm, 4px);
	}
</style>
