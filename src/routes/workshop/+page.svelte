<script lang="ts">
	import { interpretArrangement } from '$lib/workshop/interpret';
	import type { CardArrangement } from '$lib/workshop/card-schemas';
	import type { VFInstances } from '$lib/workshop/card-to-vf';
	import type { ComponentSpec } from '$lib/workshop/component-selector';
	import WorkshopRenderer from '$lib/components/workshop/WorkshopRenderer.svelte';

	// ---------- State ----------
	let imageData = $state<string | null>(null);
	let imageMediaType = $state<string>('image/jpeg');
	let processing = $state(false);
	let error = $state<string | null>(null);

	// Results
	let arrangement = $state<CardArrangement | null>(null);
	let vfInstances = $state<VFInstances | null>(null);
	let componentTree = $state<ComponentSpec | null>(null);
	let svelteCode = $state<string>('');

	// Scenario history
	let scenarios = $state<Array<{
		id: string;
		thumbnail: string;
		arrangement: CardArrangement;
		vfInstances: VFInstances;
		svelteCode: string;
		timestamp: Date;
	}>>([]);

	// Active panel
	let activePanel = $state<'live' | 'cards' | 'code' | 'data'>('live');

	// Demo mode
	let demoMode = $state(false);

	// ---------- File handling ----------
	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const file = e.dataTransfer?.files[0];
		if (file) loadFile(file);
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) loadFile(file);
	}

	function loadFile(file: File) {
		imageMediaType = file.type || 'image/jpeg';
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			// Extract base64 data (remove data URL prefix)
			const base64 = result.includes(',') ? result.split(',')[1] : result;
			imageData = base64;
			processImage();
		};
		reader.readAsDataURL(file);
	}

	// ---------- Processing ----------
	async function processImage() {
		if (!imageData) return;
		processing = true;
		error = null;

		try {
			if (demoMode) {
				const demo = buildDemoArrangement();
				const result = interpretArrangement(demo);
				arrangement = result.arrangement;
				vfInstances = result.vfInstances;
				componentTree = result.componentTree;
				svelteCode = result.svelteCode;
			} else {
				// Send photo to server-side API for vision interpretation
				const response = await fetch('/api/workshop/interpret', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						imageBase64: imageData,
						mediaType: imageMediaType,
						mode: 'photo',
					}),
				});

				if (!response.ok) {
					const err = await response.json();
					throw new Error(err.error || `API error: ${response.status}`);
				}

				const result = await response.json();
				arrangement = result.arrangement;
				vfInstances = result.vfInstances;
				componentTree = result.componentTree;
				svelteCode = result.svelteCode;
			}

			// Save to scenario history
			if (arrangement && vfInstances) {
				scenarios = [...scenarios, {
					id: `scenario-${scenarios.length + 1}`,
					thumbnail: `data:${imageMediaType};base64,${imageData}`,
					arrangement,
					vfInstances,
					svelteCode,
					timestamp: new Date(),
				}];
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			processing = false;
		}
	}

	function runDemo() {
		demoMode = true;
		const demo = buildDemoArrangement();
		const result = interpretArrangement(demo);
		arrangement = result.arrangement;
		vfInstances = result.vfInstances;
		componentTree = result.componentTree;
		svelteCode = result.svelteCode;
	}

	function loadScenario(idx: number) {
		const s = scenarios[idx];
		arrangement = s.arrangement;
		vfInstances = s.vfInstances;
		svelteCode = s.svelteCode;
	}

	// ---------- Demo data: "Bakery" starter ----------
	function buildDemoArrangement(): CardArrangement {
		return {
			cards: [
				{
					category: 'entity', type: 'agent', id: 'c1',
					position: { x: 0.1, y: 0.2 },
					fields: { name: 'Baker', agentType: 'Person', location: 'Kitchen' },
				},
				{
					category: 'entity', type: 'agent', id: 'c2',
					position: { x: 0.9, y: 0.2 },
					fields: { name: 'Customer', agentType: 'Person' },
				},
				{
					category: 'entity', type: 'resourceType', id: 'c3',
					position: { x: 0.3, y: 0.1 },
					fields: { name: 'Flour', unit: 'kg' },
				},
				{
					category: 'entity', type: 'resourceType', id: 'c4',
					position: { x: 0.7, y: 0.1 },
					fields: { name: 'Bread', unit: 'loaves' },
				},
				{
					category: 'entity', type: 'process', id: 'c5',
					position: { x: 0.5, y: 0.1 },
					fields: { name: 'Baking', duration: '2 hours' },
				},
				{
					category: 'flow', type: 'intent', id: 'c6',
					position: { x: 0.3, y: 0.5 },
					action: 'produce',
					fields: { description: 'Bake fresh bread', what: 'Bread', howMuch: '50 loaves', when: 'tomorrow', provider: 'Baker' },
				},
				{
					category: 'flow', type: 'commitment', id: 'c7',
					position: { x: 0.5, y: 0.5 },
					action: 'transfer',
					fields: { description: 'Deliver bread order', what: 'Bread', howMuch: '20 loaves', when: 'tomorrow', provider: 'Baker', receiver: 'Customer' },
				},
				{
					category: 'flow', type: 'event', id: 'c8',
					position: { x: 0.7, y: 0.5 },
					action: 'produce',
					fields: { description: 'Baked 50 loaves', what: 'Bread', howMuch: '50 loaves', when: '2026-03-25' },
				},
				{
					category: 'lens', type: 'observer', id: 'c9',
					position: { x: 0.5, y: 0.45 },
					coversCardIds: ['c8'],
					fields: { note: 'Track baking events' },
				},
				{
					category: 'signal', type: 'surplus', id: 'c10',
					position: { x: 0.8, y: 0.55 },
					nearCardId: 'c4',
					fields: { note: '30 loaves extra' },
				},
			],
			connections: [
				{ fromId: 'c3', toId: 'c5', type: 'adjacent' },
				{ fromId: 'c5', toId: 'c4', type: 'adjacent' },
				{ fromId: 'c1', toId: 'c6', type: 'adjacent' },
				{ fromId: 'c6', toId: 'c7', type: 'adjacent' },
				{ fromId: 'c7', toId: 'c8', type: 'adjacent' },
				{ fromId: 'c7', toId: 'c2', type: 'adjacent' },
			],
			annotations: [
				{ text: 'Weekly bread run', nearCardId: 'c5' },
			],
		};
	}
</script>

<div class="workshop-page">
	<header class="workshop-header">
		<h1>Workshop</h1>
		<p class="subtitle">Compose cards, take a photo, generate interfaces</p>
	</header>

	{#if !arrangement}
		<!-- Upload / Demo area -->
		<div class="upload-area" role="region"
			ondragover={(e) => e.preventDefault()}
			ondrop={handleDrop}
		>
			<div class="upload-content">
				<div class="upload-icon">&#x1F4F7;</div>
				<p>Drop a photo of your card arrangement here</p>
				<label class="upload-btn">
					Choose file
					<input type="file" accept="image/*" capture="environment" onchange={handleFileInput} hidden />
				</label>
				<p class="or">or</p>
				<button class="demo-btn" onclick={runDemo}>
					Try the Bakery demo
				</button>
			</div>
		</div>
	{:else}
		<!-- Results -->
		<div class="results">
			<!-- Tab bar -->
			<div class="tab-bar">
				<button class="tab" class:active={activePanel === 'live'} onclick={() => activePanel = 'live'}>
					Live Preview
				</button>
				<button class="tab" class:active={activePanel === 'cards'} onclick={() => activePanel = 'cards'}>
					Detected Cards
				</button>
				<button class="tab" class:active={activePanel === 'code'} onclick={() => activePanel = 'code'}>
					Svelte Code
				</button>
				<button class="tab" class:active={activePanel === 'data'} onclick={() => activePanel = 'data'}>
					Data
				</button>
				<div class="tab-spacer"></div>
				<button class="reset-btn" onclick={() => { arrangement = null; imageData = null; }}>
					New photo
				</button>
			</div>

			{#if activePanel === 'live'}
				<!-- Live rendered interface -->
				<div class="panel live-panel">
					{#if componentTree && vfInstances}
						<WorkshopRenderer tree={componentTree} vf={vfInstances} />
					{/if}
				</div>
			{:else if activePanel === 'cards'}
				<!-- Detected card arrangement -->
				<div class="panel cards-panel">
					<div class="card-grid">
						{#each arrangement.cards as card}
							<div class="detected-card detected-{card.category}" style="left: {card.position.x * 100}%; top: {card.position.y * 100}%;">
								<span class="card-type">{card.category === 'entity' ? card.type : card.category === 'flow' ? card.type : card.category === 'lens' ? card.type : card.type}</span>
								{#if 'fields' in card && card.fields}
									{#if 'name' in card.fields && card.fields.name}
										<span class="card-name">{card.fields.name}</span>
									{/if}
									{#if 'what' in card.fields && card.fields.what}
										<span class="card-name">{card.fields.what}</span>
									{/if}
								{/if}
							</div>
						{/each}
					</div>
					<div class="connections-list">
						<h3>Connections ({arrangement.connections.length})</h3>
						{#each arrangement.connections as conn}
							<div class="conn-row">
								<span class="conn-from">{conn.fromId}</span>
								<span class="conn-arrow">{conn.type === 'dashed' ? '- - >' : '→'}</span>
								<span class="conn-to">{conn.toId}</span>
								{#if conn.label}<span class="conn-label">{conn.label}</span>{/if}
							</div>
						{/each}
					</div>
				</div>
			{:else if activePanel === 'code'}
				<!-- Generated Svelte code -->
				<div class="panel code-panel">
					<pre class="code-block"><code>{svelteCode}</code></pre>
				</div>
			{:else if activePanel === 'data'}
				<!-- VF Instances JSON -->
				<div class="panel data-panel">
					<h3>VF Instances</h3>
					<pre class="code-block"><code>{JSON.stringify(vfInstances, null, 2)}</code></pre>
				</div>
			{/if}
		</div>

		<!-- Scenario history -->
		{#if scenarios.length > 1}
			<div class="scenario-bar">
				<span class="scenario-label">Scenarios:</span>
				{#each scenarios as s, i}
					<button class="scenario-thumb" onclick={() => loadScenario(i)} title="Scenario {i + 1}">
						{i + 1}
					</button>
				{/each}
			</div>
		{/if}
	{/if}

	{#if processing}
		<div class="processing-overlay">
			<div class="spinner"></div>
			<p>Interpreting card arrangement...</p>
		</div>
	{/if}

	{#if error}
		<div class="error-bar">
			{error}
			<button onclick={() => error = null}>dismiss</button>
		</div>
	{/if}
</div>

<style>
	.workshop-page {
		padding: var(--gap-lg, 16px);
		max-width: 1200px;
		margin: 0 auto;
		font-family: var(--font-sans, Inter, system-ui);
	}

	.workshop-header {
		margin-bottom: var(--gap-lg, 16px);
	}

	.workshop-header h1 {
		font-family: var(--font-mono, monospace);
		font-size: 1.2rem;
		color: var(--text-primary, #e4eeff);
		margin: 0;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.subtitle {
		font-size: var(--text-sm, 0.8rem);
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
		margin: 4px 0 0;
	}

	/* Upload area */
	.upload-area {
		border: 2px dashed var(--border-dim, rgba(130, 175, 255, 0.35));
		border-radius: 12px;
		padding: 48px;
		text-align: center;
		transition: border-color 0.2s, background 0.2s;
	}

	.upload-area:hover {
		border-color: var(--zone-green);
		background: rgba(72, 187, 120, 0.03);
	}

	.upload-icon {
		font-size: 3rem;
		margin-bottom: 12px;
	}

	.upload-content p {
		color: var(--text-secondary, rgba(188, 212, 252, 0.8));
		margin: 8px 0;
	}

	.upload-btn {
		display: inline-block;
		padding: 8px 20px;
		background: var(--bg-elevated, #222e48);
		color: var(--text-primary, #e4eeff);
		border: 1px solid var(--border-dim, rgba(130, 175, 255, 0.35));
		border-radius: 6px;
		cursor: pointer;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-sm, 0.8rem);
		transition: background 0.15s;
	}

	.upload-btn:hover {
		background: var(--bg-overlay, rgba(99, 155, 255, 0.09));
	}

	.or {
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
		font-size: var(--text-xs, 0.7rem);
	}

	.demo-btn {
		padding: 8px 20px;
		background: rgba(72, 187, 120, 0.12);
		color: var(--zone-green, #48bb78);
		border: 1px solid rgba(72, 187, 120, 0.3);
		border-radius: 6px;
		cursor: pointer;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-sm, 0.8rem);
		transition: background 0.15s;
	}

	.demo-btn:hover {
		background: rgba(72, 187, 120, 0.2);
	}

	/* Tab bar */
	.tab-bar {
		display: flex;
		gap: 2px;
		margin-bottom: var(--gap-md, 8px);
		align-items: center;
	}

	.tab {
		padding: 6px 14px;
		background: none;
		border: 1px solid transparent;
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		border-radius: 4px;
		transition: color 0.15s, background 0.15s;
	}

	.tab:hover {
		color: var(--text-secondary, rgba(188, 212, 252, 0.8));
		background: var(--bg-overlay, rgba(99, 155, 255, 0.09));
	}

	.tab.active {
		color: var(--zone-green, #48bb78);
		border-color: rgba(72, 187, 120, 0.3);
		background: rgba(72, 187, 120, 0.06);
	}

	.tab-spacer {
		flex: 1;
	}

	.reset-btn {
		padding: 4px 12px;
		background: none;
		border: 1px solid var(--border-faint, rgba(130, 175, 255, 0.18));
		color: var(--text-dim, rgba(150, 185, 235, 0.55));
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
		cursor: pointer;
		border-radius: 4px;
	}

	.reset-btn:hover {
		color: var(--text-secondary);
		border-color: var(--border-dim);
	}

	/* Panels */
	.panel {
		background: var(--bg-surface, #1b2336);
		border: 1px solid var(--border-faint, rgba(130, 175, 255, 0.18));
		border-radius: 8px;
		padding: var(--gap-lg, 16px);
		min-height: 400px;
		overflow: auto;
	}

	.live-panel {
		background: var(--bg-base, #111827);
		padding: var(--gap-lg, 16px) var(--gap-lg, 16px) var(--gap-lg, 16px) var(--gap-lg, 16px);
	}

	/* Card grid */
	.card-grid {
		position: relative;
		height: 300px;
		background: var(--bg-base, #111827);
		border-radius: 6px;
		margin-bottom: var(--gap-md, 8px);
	}

	.detected-card {
		position: absolute;
		padding: 4px 8px;
		border-radius: 4px;
		font-size: var(--text-xs, 0.7rem);
		font-family: var(--font-mono, monospace);
		display: flex;
		flex-direction: column;
		gap: 2px;
		transform: translate(-50%, -50%);
	}

	.detected-entity { background: rgba(79, 209, 197, 0.2); border: 1px solid rgba(79, 209, 197, 0.5); }
	.detected-flow { background: rgba(237, 137, 54, 0.2); border: 1px solid rgba(237, 137, 54, 0.5); }
	.detected-lens { background: rgba(49, 130, 206, 0.2); border: 1px solid rgba(49, 130, 206, 0.5); }
	.detected-signal { background: rgba(252, 88, 88, 0.2); border: 1px solid rgba(252, 88, 88, 0.5); }

	.card-type {
		font-size: 0.6rem;
		text-transform: uppercase;
		opacity: 0.6;
	}

	.card-name {
		font-weight: 500;
		color: var(--text-primary, #e4eeff);
	}

	/* Connections */
	.connections-list h3 {
		font-size: var(--text-sm, 0.8rem);
		color: var(--text-secondary);
		margin: var(--gap-md, 8px) 0 var(--gap-sm, 4px);
	}

	.conn-row {
		display: flex;
		gap: var(--gap-sm, 4px);
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
		color: var(--text-dim);
		padding: 2px 0;
	}

	.conn-arrow { color: var(--zone-yellow); }
	.conn-label { color: var(--text-secondary); font-style: italic; }

	/* Code block */
	.code-block {
		background: var(--bg-base, #111827);
		border-radius: 6px;
		padding: var(--gap-md, 8px);
		overflow: auto;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
		color: var(--text-secondary, rgba(188, 212, 252, 0.8));
		line-height: 1.5;
		white-space: pre;
		tab-size: 2;
		max-height: 600px;
	}

	.data-panel h3 {
		font-size: var(--text-sm, 0.8rem);
		color: var(--text-secondary);
		margin: 0 0 var(--gap-sm, 4px);
	}

	/* Scenario bar */
	.scenario-bar {
		display: flex;
		align-items: center;
		gap: var(--gap-sm, 4px);
		margin-top: var(--gap-md, 8px);
		padding: 6px 10px;
		background: var(--bg-surface, #1b2336);
		border-radius: 6px;
		border: 1px solid var(--border-faint, rgba(130, 175, 255, 0.18));
	}

	.scenario-label {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.scenario-thumb {
		width: 28px;
		height: 28px;
		border-radius: 4px;
		background: var(--bg-elevated, #222e48);
		border: 1px solid var(--border-faint, rgba(130, 175, 255, 0.18));
		color: var(--text-secondary);
		cursor: pointer;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.scenario-thumb:hover {
		border-color: var(--zone-green);
		color: var(--zone-green);
	}

	/* Processing overlay */
	.processing-overlay {
		position: fixed;
		inset: 0;
		background: rgba(17, 24, 39, 0.8);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.processing-overlay p {
		color: var(--text-secondary);
		font-family: var(--font-mono, monospace);
		font-size: var(--text-sm, 0.8rem);
		margin-top: var(--gap-md, 8px);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 2px solid var(--border-faint);
		border-top-color: var(--zone-green);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Error bar */
	.error-bar {
		position: fixed;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(252, 88, 88, 0.15);
		border: 1px solid rgba(252, 88, 88, 0.4);
		color: var(--zone-red);
		padding: 8px 16px;
		border-radius: 6px;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-sm, 0.8rem);
		display: flex;
		gap: var(--gap-md, 8px);
		align-items: center;
		z-index: 1001;
	}

	.error-bar button {
		background: none;
		border: 1px solid rgba(252, 88, 88, 0.4);
		color: var(--zone-red);
		padding: 2px 8px;
		border-radius: 3px;
		cursor: pointer;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 0.7rem);
	}
</style>
