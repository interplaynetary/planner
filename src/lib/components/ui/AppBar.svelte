<script lang="ts">
	import { tune as tuneState } from '$lib/tune-state.svelte';
	import { page } from '$app/stores';
	import { base } from '$app/paths';

	const NAV = [
		{ href: `${base}/buffers`,    label: 'BUFFERS' },
		{ href: `${base}/federation`, label: 'FEDERATION' },
		{ href: `${base}/inventory`,  label: 'INVENTORY' },
		{ href: `${base}/recipes`,    label: 'RECIPES' },
		{ href: `${base}/workshop`,   label: 'WORKSHOP' },
		{ href: `${base}/settings`,   label: 'SETTINGS' },
	];

	let inputEl = $state<HTMLInputElement | undefined>(undefined);

	function handleSatClick() {
		if (tuneState.status === 'live') {
			tuneState.expanded = !tuneState.expanded;
		} else if (tuneState.inputTopic.trim()) {
			tuneState.tuneRequest++;
		} else {
			inputEl?.focus();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && tuneState.inputTopic.trim()) {
			tuneState.tuneRequest++;
		}
	}
</script>

<header class="appbar">
	<nav class="nav-row">
		{#each NAV as n (n.href)}
			<a
				href={n.href}
				class="nav-link"
				class:nav-active={$page.url.pathname === n.href || $page.url.pathname.startsWith(n.href + '/')}
			>{n.label}</a>
		{/each}
	</nav>
	<div class="tune-cluster" class:connecting={tuneState.status === 'connecting'} class:live={tuneState.status === 'live'} class:fault={tuneState.status === 'error'}>
		<button
			class="sat-btn"
			class:connecting={tuneState.status === 'connecting'}
			class:live={tuneState.status === 'live'}
			class:fault={tuneState.status === 'error'}
			title={tuneState.status === 'live' ? 'Toggle chat panel' : 'Tune in'}
			onclick={handleSatClick}
		>
			<svg viewBox="0 0 28 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<!-- left solar panel -->
				<rect x="0.75" y="8.5" width="7" height="5" rx="0.75"/>
				<line x1="7.75" y1="11" x2="10" y2="11"/>
				<!-- body -->
				<rect x="10" y="7.5" width="8" height="7" rx="1.5"/>
				<!-- right solar panel -->
				<line x1="18" y1="11" x2="20.25" y2="11"/>
				<rect x="20.25" y="8.5" width="7" height="5" rx="0.75"/>
				<!-- dish stem -->
				<line x1="14" y1="7.5" x2="14" y2="4.5"/>
				<!-- dish parabola -->
				<path d="M11 4.5 Q14 1.5 17 4.5"/>
				<!-- signal arcs -->
				<path class="sig sig1" d="M17.5 3 Q19.5 5 17.5 7"/>
				<path class="sig sig2" d="M19.5 1.5 Q22.5 4.5 19.5 7.5"/>
			</svg>
		</button>

		{#if tuneState.status === 'live'}
			<!-- Live: show topic name (clickable = copy link) + peer count + expand toggle -->
			<button class="topic-pill" title="Copy share link" onclick={() => tuneState.liveCopyLink?.()}>
				{tuneState.liveTopic}
			</button>
			<span class="live-dot"></span>
			<span class="peer-ct">{tuneState.peerCount}</span>
			<button class="expand-btn" title={tuneState.expanded ? 'Collapse' : 'Expand'} onclick={() => (tuneState.expanded = !tuneState.expanded)}>
				{tuneState.expanded ? '▲' : '▼'}
			</button>
		{:else}
			<!-- Idle / connecting / error: show topic input -->
			<input
				bind:this={inputEl}
				class="topic-input"
				type="text"
				placeholder="channel…"
				bind:value={tuneState.inputTopic}
				onkeydown={handleKeydown}
				disabled={tuneState.status === 'connecting'}
				spellcheck="false"
				autocomplete="off"
			/>
			{#if tuneState.status === 'connecting'}
				<span class="status-hint connecting">connecting…</span>
			{:else if tuneState.status === 'error'}
				<span class="status-hint fault">error</span>
			{/if}
		{/if}
	</div>
</header>

<style>
	.appbar {
		position: sticky;
		top: 0;
		z-index: 900;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 10px;
		background: var(--bg-surface);
		border-bottom: 1px solid rgba(130, 175, 255, 0.12);
		height: 34px;
		box-sizing: border-box;
		gap: 12px;
	}

	/* ── Nav links ── */
	.nav-row {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.nav-link {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		font-variant: small-caps;
		letter-spacing: 0.07em;
		color: rgba(130, 175, 255, 0.4);
		text-decoration: none;
		padding: 2px 7px;
		border-radius: 3px;
		border: 1px solid transparent;
		transition: color 0.15s, background 0.15s;
		white-space: nowrap;
	}

	.nav-link:hover {
		color: rgba(130, 175, 255, 0.85);
		background: var(--bg-overlay);
	}

	.nav-link.nav-active {
		color: var(--zone-green);
		border-color: rgba(72, 187, 120, 0.3);
		background: rgba(72, 187, 120, 0.06);
	}

	/* ── Cluster ── */
	.tune-cluster {
		display: flex;
		align-items: center;
		gap: 5px;
		background: var(--bg-overlay);
		border: 1px solid rgba(72, 187, 120, 0.2);
		border-radius: 5px;
		padding: 2px 6px 2px 4px;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.tune-cluster.live {
		border-color: var(--zone-green);
		box-shadow: 0 0 8px rgba(72, 187, 120, 0.2);
	}

	.tune-cluster.connecting {
		border-color: rgba(232, 176, 78, 0.5);
	}

	.tune-cluster.fault {
		border-color: rgba(252, 88, 88, 0.5);
	}

	/* ── Satellite button ── */
	.sat-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		color: rgba(72, 187, 120, 0.45);
		transition: color 0.2s;
	}

	.sat-btn:hover { color: var(--zone-green); }
	.sat-btn.live   { color: var(--zone-green); }
	.sat-btn.connecting { color: var(--zone-yellow); }
	.sat-btn.fault  { color: var(--zone-red); }

	.sat-btn svg {
		width: 22px;
		height: 17px;
		display: block;
	}

	/* idle: arcs pulse gently */
	.sat-btn:not(.live):not(.connecting) .sig1 { animation: sig-pulse 2.6s ease-in-out infinite; }
	.sat-btn:not(.live):not(.connecting) .sig2 { animation: sig-pulse 2.6s ease-in-out 0.6s infinite; }

	/* connecting: arcs flash fast */
	.sat-btn.connecting .sig1 { animation: sig-pulse 0.6s ease-in-out infinite; }
	.sat-btn.connecting .sig2 { animation: sig-pulse 0.6s ease-in-out 0.15s infinite; }

	@keyframes sig-pulse {
		0%, 100% { opacity: 0.12; }
		50%       { opacity: 1; }
	}

	/* ── Topic input (idle state) ── */
	.topic-input {
		width: 110px;
		background: transparent;
		border: none;
		outline: none;
		color: rgba(226, 232, 240, 0.8);
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 0;
		letter-spacing: 0.03em;
	}

	.topic-input::placeholder { color: rgba(130, 175, 255, 0.3); }
	.topic-input:disabled { opacity: 0.5; }

	/* ── Live state elements ── */
	.topic-pill {
		background: none;
		border: none;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--zone-yellow);
		padding: 0;
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		letter-spacing: 0.02em;
	}

	.topic-pill:hover { text-decoration: underline; text-decoration-style: dotted; }

	.live-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--zone-green);
		animation: dot-pulse 1.5s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes dot-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.peer-ct {
		font-family: var(--font-mono);
		font-size: 10px;
		color: rgba(72, 187, 120, 0.6);
	}

	.expand-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 9px;
		color: rgba(130, 175, 255, 0.5);
		padding: 0;
		line-height: 1;
	}

	.expand-btn:hover { color: rgba(130, 175, 255, 0.9); }

	/* ── Status hints ── */
	.status-hint {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.05em;
	}

	.status-hint.connecting { color: var(--zone-yellow); opacity: 0.7; }
	.status-hint.fault      { color: var(--zone-red); opacity: 0.8; }
</style>
