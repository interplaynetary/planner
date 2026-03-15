<script lang="ts">
	import { tune as tuneState } from '$lib/tune-state.svelte';
</script>

<header class="appbar">
	<button
		class="sat-btn"
		class:open={tuneState.expanded}
		class:connecting={tuneState.status === 'connecting'}
		class:live={tuneState.status === 'live'}
		class:fault={tuneState.status === 'error'}
		title="Open channel"
		onclick={() => (tuneState.expanded = !tuneState.expanded)}
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
</header>

<style>
	.appbar {
		position: sticky;
		top: 0;
		z-index: 900;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		padding: 4px 10px;
		background: var(--bg-surface);
		border-bottom: 1px solid rgba(130, 175, 255, 0.12);
		height: 34px;
		box-sizing: border-box;
	}

	.sat-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid rgba(72, 187, 120, 0.3);
		border-radius: 5px;
		cursor: pointer;
		padding: 3px 7px;
		color: rgba(72, 187, 120, 0.45);
		transition: color 0.2s, border-color 0.2s, box-shadow 0.2s;
	}

	.sat-btn:hover {
		color: var(--zone-green);
		border-color: rgba(72, 187, 120, 0.7);
	}

	.sat-btn.open,
	.sat-btn.live {
		color: var(--zone-green);
		border-color: var(--zone-green);
		box-shadow: 0 0 8px rgba(72, 187, 120, 0.3);
	}

	.sat-btn.connecting {
		color: var(--zone-yellow);
		border-color: rgba(232, 176, 78, 0.6);
	}

	.sat-btn.fault {
		color: var(--zone-red);
		border-color: rgba(252, 88, 88, 0.6);
	}

	.sat-btn svg {
		width: 22px;
		height: 17px;
		display: block;
	}

	/* idle: arcs pulse gently */
	.sat-btn:not(.open):not(.live):not(.connecting) .sig1 {
		animation: sig-pulse 2.6s ease-in-out infinite;
	}
	.sat-btn:not(.open):not(.live):not(.connecting) .sig2 {
		animation: sig-pulse 2.6s ease-in-out 0.6s infinite;
	}

	/* connecting: arcs flash fast */
	.sat-btn.connecting .sig1 { animation: sig-pulse 0.6s ease-in-out infinite; }
	.sat-btn.connecting .sig2 { animation: sig-pulse 0.6s ease-in-out 0.15s infinite; }

	@keyframes sig-pulse {
		0%, 100% { opacity: 0.12; }
		50%       { opacity: 1; }
	}
</style>
