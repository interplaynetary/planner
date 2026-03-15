<script lang="ts">
	import '$lib/components/ui/tokens.css';
	import favicon from '$lib/assets/favicon.svg';
	import TooltipOverlay from '$lib/components/ui/TooltipOverlay.svelte';
	import TuneWidget from '$lib/components/ui/TuneWidget.svelte';
	import AppBar from '$lib/components/ui/AppBar.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<AppBar />
{@render children()}
<TooltipOverlay />
<TuneWidget />
