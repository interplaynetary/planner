<script lang="ts">
	interface Props {
		userId: string;
		displayName?: string;
		truncateLength?: number;
		removable?: boolean;
		onClick?: (userId: string, event?: MouseEvent) => void;
		onRemove?: (userId: string) => void;
	}

	let {
		userId,
		displayName = userId,
		truncateLength = 10,
		removable = true,
		onClick = () => {},
		onRemove = () => {}
	}: Props = $props();

	function hashColor(id: string): string {
		let h = 0;
		for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
		return `hsl(${h % 360}, 55%, 72%)`;
	}

	function getFormattedName(name: string): string {
		return name.length > truncateLength ? name.substring(0, truncateLength - 2) + '...' : name;
	}

	function handlePillClick(event: MouseEvent): void {
		if ((event.target as HTMLElement).classList.contains('remove-tag')) return;
		event.stopPropagation();
		onClick(userId, event);
	}

	function handleRemoveClick(event: MouseEvent): void {
		event.stopPropagation();
		onRemove(userId);
	}
</script>

<div
	class="tag-pill"
	data-user-id={userId}
	style="background: {hashColor(userId)}"
	role="button"
	tabindex="0"
	onclick={handlePillClick}
	title={removable
				? `${displayName}: Click to view tree, click × to remove`
				: `${displayName}: Click to view tree`}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			// Create a synthetic MouseEvent for consistency
			const syntheticEvent = new MouseEvent('click', {
				bubbles: true,
				cancelable: true
			});
			handlePillClick(syntheticEvent);
		}
	}}
>
	<span>{getFormattedName(displayName)}</span>

	{#if removable}
		<span 
			class="remove-tag" 
			role="button"
			tabindex="0"
			onclick={handleRemoveClick}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					// Create a synthetic MouseEvent for consistency
					const syntheticEvent = new MouseEvent('click', {
						bubbles: true,
						cancelable: true
					});
					handleRemoveClick(syntheticEvent);
				}
			}}
		>×</span>
	{/if}
</div>

<style>
	.tag-pill {
		display: flex;
		align-items: center;
		border-radius: 12px;
		padding: 3px 10px;
		margin: 2px;
		height: 22px;
		font-size: 12px;
		white-space: nowrap;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		opacity: 0.9;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.tag-pill:hover {
		opacity: 1;
		transform: translateY(-1px);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
	}

	.tag-pill span {
		color: #000;
		margin-right: 5px;
		font-weight: 500;
		text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
	}

	.remove-tag {
		color: #000;
		font-size: 14px;
		line-height: 14px;
		opacity: 0.7;
		font-weight: bold;
		margin-left: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.4);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.remove-tag:hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.7);
	}
</style>
