<script lang="ts">
	/**
	 * SmartChip - Usage:
	 * <SmartChip 
	 *   value={currentValue} 
	 *   options={[{label: 'Mon', value: 'mon'}]} 
	 *   onChange={val => ...} 
	 * />
	 */
	import { fade, scale } from 'svelte/transition';
	
	interface Option {
		label: string;
		value: any;
		disabled?: boolean;
		divider?: boolean;
	}

	interface Props {
		value?: any;
		label?: string; // Explicit label to show instead of derived from value
		placeholder?: string;
		options?: Option[];
		disabled?: boolean;
		onChange?: (value: any) => void;
	}

	let { 
		value = $bindable(), 
		label,
		placeholder = 'Select...',
		options = [],
		disabled = false,
        layout = 'dropdown', // 'dropdown' | 'layer'
		onChange
	}: Props & { layout?: 'dropdown' | 'layer' } = $props();

	let isOpen = $state(false);

	let displayText = $derived.by(() => {
		if (label) return label;
		if (value === undefined || value === null) return placeholder;
		const option = options.find(o => o.value === value);
		return option ? option.label : String(value);
	});

	function toggle() {
		if (!disabled) isOpen = !isOpen;
	}

	function select(opt: Option) {
		if (opt.disabled || opt.divider) return;
		value = opt.value;
		onChange?.(opt.value);
		isOpen = false;
	}

	function handleFocusOut(event: FocusEvent) {
		if (isOpen && !((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node))) {
			isOpen = false;
		}
	}
</script>

<div class="smart-chip-container {layout}" onfocusout={handleFocusOut}>
	<button 
		type="button"
		class="smart-chip" 
		class:active={isOpen}
		class:placeholder={!value && !label}
		{disabled}
		onclick={toggle}
	>
		<span class="chip-text">{displayText}</span>
		<svg class="chevron" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
		</svg>
	</button>

	{#if isOpen}
		<div
			class="chip-menu {layout}"
			transition:scale={{ start: 0.95, duration: 100 }}
		>
			{#each options as opt (opt.value ?? opt.label)}
				{#if opt.divider}
					<div class="menu-divider"></div>
				{:else}
					<button 
						type="button" 
						class="menu-item"
						class:selected={opt.value === value}
						class:disabled={opt.disabled}
						onclick={() => select(opt)}
					>
						{opt.label}
						{#if opt.value === value}
							<svg class="check-icon" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
							</svg>
						{/if}
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	/* Always anchor dropdown to the chip itself */
	.smart-chip-container {
		display: inline-block;
		position: relative;
	}

	.smart-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 5px;
		background: var(--border-faint);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 3px;
		color: #c4b5fd;
		font-family: inherit;
		font-size: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.smart-chip:hover:not(:disabled) {
		background: rgba(124, 58, 237, 0.15);
		border-color: rgba(124, 58, 237, 0.45);
		color: #ddd6fe;
	}

	.smart-chip.active {
		background: rgba(124, 58, 237, 0.2);
		border-color: rgba(124, 58, 237, 0.55);
		color: #ddd6fe;
	}

	.smart-chip.placeholder {
		color: rgba(255, 255, 255, 0.35);
		font-weight: 400;
	}

	.chevron {
		width: 9px;
		height: 9px;
		opacity: 0.5;
		margin-left: 1px;
		transition: transform 0.15s;
		flex-shrink: 0;
	}

	.smart-chip:hover .chevron { opacity: 0.9; }
	.smart-chip.active .chevron { transform: rotate(180deg); opacity: 1; }

	/* Compact vertical list dropdown — same for all layout modes */
	.chip-menu {
		position: absolute;
		top: calc(100% + 3px);
		left: 0;
		z-index: 200;
		display: flex;
		flex-direction: column;
		min-width: 120px;
		max-height: 220px;
		overflow-y: auto;
		padding: 3px;
		background: #181825;
		border: 1px solid rgba(124, 58, 237, 0.4);
		border-radius: 4px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
	}

	.menu-item {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 4px 8px;
		background: transparent;
		border: none;
		border-radius: 3px;
		color: rgba(255, 255, 255, 0.65);
		font-size: 0.68rem;
		font-weight: 400;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
		transition: background 0.1s, color 0.1s;
	}

	.menu-item:hover:not(.disabled) {
		background: rgba(124, 58, 237, 0.2);
		color: #ddd6fe;
	}

	.menu-item.selected {
		background: rgba(124, 58, 237, 0.25);
		color: #c4b5fd;
		font-weight: 600;
	}

	.menu-item.disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.menu-divider {
		height: 1px;
		background: var(--bg-overlay);
		margin: 2px 3px;
	}

	.check-icon {
		display: none;
	}
</style>
