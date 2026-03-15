<script lang="ts">
	/**
	 * LocationEditor - Flexible location input backed by SpatialThing fields.
	 */

	export interface LocationData {
		locationType: 'Undefined' | 'Specific' | 'Coordinates' | 'Online' | 'Live';
		mappableAddress?: string;  // street address
		city?: string;
		region?: string;           // state / province
		postalCode?: string;
		country?: string;
		lat?: number;
		long?: number;
		note?: string;             // used for online URL
	}

	interface Props {
		locationType?: LocationData['locationType'];
		mappableAddress?: string;
		city?: string;
		region?: string;
		postalCode?: string;
		country?: string;
		lat?: number;
		long?: number;
		note?: string;
		onUpdate: (location: LocationData) => void;
	}

	import { untrack } from 'svelte';

	let {
		locationType = 'Undefined',
		mappableAddress,
		city,
		region,
		postalCode,
		country,
		lat,
		long,
		note,
		onUpdate
	}: Props = $props();

	let localLocationType  = $state<LocationData['locationType']>(untrack(() => locationType));
	let localAddress       = $state(untrack(() => mappableAddress));
	let localCity          = $state(untrack(() => city));
	let localRegion        = $state(untrack(() => region));
	let localPostalCode    = $state(untrack(() => postalCode));
	let localCountry       = $state(untrack(() => country));
	let localLat           = $state(untrack(() => lat));
	let localLong          = $state(untrack(() => long));
	let localNote          = $state(untrack(() => note));

	function emitUpdate() {
		onUpdate({
			locationType: localLocationType,
			mappableAddress: localAddress,
			city: localCity,
			region: localRegion,
			postalCode: localPostalCode,
			country: localCountry,
			lat: localLat,
			long: localLong,
			note: localNote,
		});
	}
</script>

<div class="location-editor">
	<h4 class="editor-title">📍 Location</h4>

	<div class="location-tabs">
		{#each ['Undefined', 'Specific', 'Coordinates', 'Online', 'Live'] as type (type)}
			<button
				class="tab-button"
				class:active={localLocationType === type}
				onclick={() => { localLocationType = type as LocationData['locationType']; emitUpdate(); }}
			>
				{type === 'Undefined' ? 'None' : type}
			</button>
		{/each}
	</div>

	{#if localLocationType === 'Specific'}
		<div class="address-fields">
			<div class="form-field">
				<label for="loc-address">Street Address</label>
				<input id="loc-address" type="text" class="text-input" bind:value={localAddress}
					onblur={emitUpdate} placeholder="123 Main St" />
			</div>
			<div class="form-row">
				<div class="form-field">
					<label for="loc-city">City</label>
					<input id="loc-city" type="text" class="text-input" bind:value={localCity}
						onblur={emitUpdate} placeholder="City" />
				</div>
				<div class="form-field">
					<label for="loc-region">State / Province</label>
					<input id="loc-region" type="text" class="text-input" bind:value={localRegion}
						onblur={emitUpdate} placeholder="State" />
				</div>
			</div>
			<div class="form-row">
				<div class="form-field">
					<label for="loc-postal">Postal Code</label>
					<input id="loc-postal" type="text" class="text-input" bind:value={localPostalCode}
						onblur={emitUpdate} placeholder="12345" />
				</div>
				<div class="form-field">
					<label for="loc-country">Country</label>
					<input id="loc-country" type="text" class="text-input" bind:value={localCountry}
						onblur={emitUpdate} placeholder="Country" />
				</div>
			</div>
		</div>

	{:else if localLocationType === 'Coordinates'}
		<div class="coordinates-fields">
			<div class="form-row">
				<div class="form-field">
					<label for="loc-lat">Latitude</label>
					<input id="loc-lat" type="number" class="text-input" step="0.000001" min="-90" max="90"
						bind:value={localLat} onblur={emitUpdate} placeholder="37.7749" />
				</div>
				<div class="form-field">
					<label for="loc-long">Longitude</label>
					<input id="loc-long" type="number" class="text-input" step="0.000001" min="-180" max="180"
						bind:value={localLong} onblur={emitUpdate} placeholder="-122.4194" />
				</div>
			</div>
		</div>

	{:else if localLocationType === 'Online'}
		<div class="online-fields">
			<div class="form-field">
				<label for="loc-url">Meeting Link</label>
				<input id="loc-url" type="url" class="text-input" bind:value={localNote}
					onblur={emitUpdate} placeholder="https://zoom.us/j/..." />
			</div>
		</div>

	{:else if localLocationType === 'Live'}
		<div class="live-location-info">
			<div class="info-box">
				<div class="info-icon">📍</div>
				<div class="info-content">
					<h5>Live Location Sharing</h5>
					<p>Your current location will be shared during your availability window</p>
					<p class="privacy-note">Location shared only during active availability times</p>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.location-editor {
		padding: 8px 6px 6px;
		background: transparent;
	}

	.location-editor * {
		box-sizing: border-box;
	}

	.editor-title {
		margin: 0 0 6px 0;
		font-size: 0.62rem;
		font-weight: 600;
		color: rgba(167, 139, 250, 0.7);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* Tab bar — wraps onto 2 rows if needed */
	.location-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 2px;
		background: var(--border-faint);
		border-radius: 4px;
		margin-bottom: 7px;
	}

	.tab-button {
		flex: 1 1 auto;
		padding: 3px 5px;
		font-size: 0.58rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.4);
		background: transparent;
		border: none;
		border-radius: 3px;
		cursor: pointer;
		transition: all 0.12s;
		text-align: center;
		white-space: nowrap;
	}

	.tab-button:hover {
		color: rgba(255, 255, 255, 0.7);
		background: var(--border-faint);
	}

	.tab-button.active {
		color: #c4b5fd;
		background: rgba(124, 58, 237, 0.25);
		font-weight: 600;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 5px;
		min-width: 0;
	}

	.form-field label {
		font-size: 0.58rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.35);
	}

	.form-row {
		display: flex;
		gap: 4px;
	}

	.form-row > .form-field {
		flex: 1 1 0;
		min-width: 0;
	}

	.text-input {
		width: 100%;
		padding: 3px 5px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 3px;
		font-size: 0.65rem;
		color: #e2e8f0;
		background: var(--border-faint);
		transition: border-color 0.15s;
		appearance: textfield;
	}

	.text-input::-webkit-inner-spin-button,
	.text-input::-webkit-outer-spin-button { display: none; }

	.text-input:focus {
		outline: none;
		border-color: rgba(124, 58, 237, 0.5);
		background: rgba(124, 58, 237, 0.07);
	}

	.address-fields,
	.coordinates-fields,
	.online-fields,
	.live-location-info {
		margin-top: 2px;
	}

	.live-location-info .info-box {
		display: flex;
		gap: 6px;
		padding: 7px 8px;
		background: rgba(124, 58, 237, 0.08);
		border: 1px solid rgba(124, 58, 237, 0.25);
		border-radius: 4px;
	}

	.live-location-info .info-icon {
		font-size: 0.9rem;
		line-height: 1.2;
		flex-shrink: 0;
	}

	.live-location-info .info-content h5 {
		margin: 0 0 3px 0;
		font-size: 0.62rem;
		font-weight: 600;
		color: #c4b5fd;
	}

	.live-location-info .info-content p {
		margin: 0 0 2px 0;
		font-size: 0.6rem;
		color: rgba(255, 255, 255, 0.45);
		line-height: 1.4;
	}

	.live-location-info .privacy-note {
		font-size: 0.56rem;
		color: rgba(255, 255, 255, 0.28);
		font-style: italic;
	}
</style>
