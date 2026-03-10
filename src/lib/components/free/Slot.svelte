<script lang="ts">
	import { untrack } from 'svelte';
	import type { Intent } from '$lib/schemas';
	import { formatWhen, type AvailabilityWindow } from '$lib/utils/time';
	import {
		TimePatternEditor,
		DivisibilityEditor,
		LocationEditor,
		type LocationData
	} from './slots';

	interface Props {
		intent: Intent;
		isCapacity?: boolean;  // provider-only (capacity) vs receiver-only (need)
		canDelete: boolean;
		fulfilledQty?: number;
		onupdate?: (intent: Intent) => void;
		ondelete?: (intentId: string) => void;
	}

	let { intent, isCapacity = false, canDelete, fulfilledQty, onupdate, ondelete }: Props = $props();

	// UI state for expanded sections
	let timeExpanded = $state(false);
	let locationExpanded = $state(false);
	let constraintsExpanded = $state(false);

	// Local editable fields
	const slotEmoji = $derived(intent.image ?? '📦');
	let localName = $state(untrack(() => intent.name ?? ''));
	let localQty = $state(untrack(() => intent.resourceQuantity?.hasNumericalValue ?? 0));
	let localUnit = $state(untrack(() => intent.resourceQuantity?.hasUnit ?? 'units'));
	let localNote = $state(untrack(() => intent.note ?? ''));

	// Local location state (not stored in Intent directly; caller maps to SpatialThing)
	let localLocation = $state<LocationData>({ locationType: 'Undefined' });

	function updateIntent(updates: Partial<Intent>) {
		onupdate?.({ ...intent, ...updates });
	}

	function handleNameBlur() {
		if (localName !== intent.name) updateIntent({ name: localName });
	}

	function handleQtyBlur() {
		updateIntent({ resourceQuantity: { hasNumericalValue: localQty, hasUnit: localUnit } });
	}

	function handleUnitBlur() {
		updateIntent({ resourceQuantity: { hasNumericalValue: localQty, hasUnit: localUnit } });
	}

	function handleNoteBlur() {
		if (localNote !== intent.note) updateIntent({ note: localNote });
	}

	function handleTimePatternUpdate(recurrence: string | null, availabilityWindow?: AvailabilityWindow) {
		updateIntent({ availability_window: availabilityWindow });
	}

	function handleLocationUpdate(location: LocationData) {
		localLocation = location;
	}

	function handleDivisibilityUpdate(minAtomicSize?: number) {
		updateIntent({
			minimumQuantity: minAtomicSize != null
				? { hasNumericalValue: minAtomicSize, hasUnit: localUnit }
				: undefined
		});
	}

	function handleDelete() {
		ondelete?.(intent.id);
	}

	function toggleTime() {
		timeExpanded = !timeExpanded;
		if (timeExpanded) { locationExpanded = false; constraintsExpanded = false; }
	}

	function toggleLocation() {
		locationExpanded = !locationExpanded;
		if (locationExpanded) { timeExpanded = false; constraintsExpanded = false; }
	}

	function toggleConstraints() {
		constraintsExpanded = !constraintsExpanded;
		if (constraintsExpanded) { timeExpanded = false; locationExpanded = false; }
	}

	function formatTimeDisplay(): string {
		const result = formatWhen(intent.availability_window);
		if (result) return result;
		if (intent.hasBeginning) return new Date(intent.hasBeginning).toLocaleDateString();
		return 'Not specified';
	}

	function formatLocationDisplay(): string {
		const lt = localLocation.locationType;
		if (!lt || lt === 'Undefined') return 'Not specified';
		if (lt === 'Online') return localLocation.note ? 'Online' : 'Online (no link)';
		if (lt === 'Specific') return localLocation.mappableAddress?.split('\n')[0] ?? 'Specific';
		if (lt === 'Coordinates' && localLocation.lat != null && localLocation.long != null)
			return `${localLocation.lat.toFixed(2)}, ${localLocation.long.toFixed(2)}`;
		return lt;
	}

	function formatConstraintsDisplay(): string {
		const min = intent.minimumQuantity?.hasNumericalValue;
		return min != null ? `Min >= ${min}` : 'None';
	}
</script>

<div class="slot-item">
	<!-- Basic Metadata Row -->
	<div class="slot-metadata">
		<span class="slot-emoji" title="Emoji">{slotEmoji}</span>
		<input
			type="text"
			class="slot-input name"
			bind:value={localName}
			onblur={handleNameBlur}
			placeholder="Slot name"
			required
		/>
	</div>

	<!-- Note (optional) -->
	{#if intent.note || localNote}
		<div class="slot-description">
			<textarea
				bind:value={localNote}
				onblur={handleNoteBlur}
				placeholder="Note..."
				rows="2"
			></textarea>
		</div>
	{/if}

	<!-- Slot Header Row -->
	<div class="slot-header">
		<input
			type="number"
			class="slot-input qty"
			min="0"
			step="0.01"
			bind:value={localQty}
			onblur={handleQtyBlur}
			placeholder="Qty"
		/>

		<input
			type="text"
			class="slot-input unit-inline"
			bind:value={localUnit}
			onblur={handleUnitBlur}
			placeholder="units"
		/>

		<button
			type="button"
			class="section-btn time-btn"
			class:active={timeExpanded}
			onclick={toggleTime}
			title="Edit time pattern"
		>
			⏰ {formatTimeDisplay()}
		</button>

		<button
			type="button"
			class="section-btn location-btn"
			class:active={locationExpanded}
			onclick={toggleLocation}
			title="Edit location"
		>
			📍 {formatLocationDisplay()}
		</button>

		<button
			type="button"
			class="section-btn constraints-btn"
			class:active={constraintsExpanded}
			onclick={toggleConstraints}
			title="Edit constraints"
		>
			⚙️ {formatConstraintsDisplay()}
		</button>

		<button
			type="button"
			class="delete-btn"
			onclick={handleDelete}
			disabled={!canDelete}
			title="Delete slot"
		>
			✖️
		</button>
	</div>

	<!-- Expanded Sections -->

	{#if timeExpanded}
		<div class="slot-details time-details">
			<TimePatternEditor
				availabilityWindow={intent.availability_window}
				onUpdate={handleTimePatternUpdate}
			/>
		</div>
	{/if}

	{#if locationExpanded}
		<div class="slot-details location-details">
			<LocationEditor
				locationType={localLocation.locationType}
				mappableAddress={localLocation.mappableAddress}
				lat={localLocation.lat}
				long={localLocation.long}
				note={localLocation.note}
				onUpdate={handleLocationUpdate}
			/>
		</div>
	{/if}

	{#if constraintsExpanded}
		<div class="slot-details constraints-details">
			<DivisibilityEditor
				minAtomicSize={intent.minimumQuantity?.hasNumericalValue}
				onUpdate={handleDivisibilityUpdate}
			/>
		</div>
	{/if}
</div>

<style>
	.slot-item {
		padding: 1rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		transition: all 0.2s ease;
	}
	
	.slot-item:hover {
		border-color: #cbd5e1;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}
	
	.slot-metadata {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.5rem;
		background: #f8fafc;
		border-radius: 6px;
	}
	
	.slot-emoji {
		font-size: 1.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
	}
	
	.slot-input {
		padding: 0.375rem 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		font-size: 0.875rem;
		color: #1f2937;
		background: white;
		transition: all 0.2s ease;
	}
	
	.slot-input:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}
	
	.slot-input.name {
		flex: 1;
		min-width: 150px;
	}
	
	.slot-input.qty {
		width: 5rem;
		text-align: right;
	}
	
	.slot-input.unit-inline {
		width: 5rem;
		font-size: 0.9rem;
	}
	
	.slot-description {
		padding: 0.5rem;
		background: #fffbeb;
		border-radius: 4px;
		border: 1px solid #fde68a;
	}
	
	.slot-description textarea {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid #fbbf24;
		border-radius: 4px;
		font-size: 0.813rem;
		color: #78350f;
		background: white;
		resize: vertical;
	}
	
	.slot-description textarea:focus {
		outline: none;
		border-color: #f59e0b;
		box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
	}
	
	.slot-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	.section-btn {
		padding: 0.375rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		background: white;
		color: #475569;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		white-space: nowrap;
	}
	
	.section-btn:hover {
		background: #f8fafc;
		border-color: #94a3b8;
	}
	
	.section-btn.active {
		background: #eff6ff;
		border-color: #3b82f6;
		color: #1e40af;
	}
	
	.delete-btn {
		margin-left: auto;
		padding: 0.375rem 0.5rem;
		border: 1px solid #fecaca;
		border-radius: 6px;
		background: #fef2f2;
		color: #dc2626;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}
	
	.delete-btn:hover:not(:disabled) {
		background: #fee2e2;
		border-color: #fca5a5;
		transform: scale(1.05);
	}
	
	.delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	
	.slot-details {
		margin-top: 0.5rem;
		animation: slideDown 0.2s ease-out;
	}
	
	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
