<script lang="ts">
	import '$lib/components/ui/tokens.css';
	import favicon from '$lib/assets/favicon.svg';
	import TooltipOverlay from '$lib/components/ui/TooltipOverlay.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
<TooltipOverlay />
