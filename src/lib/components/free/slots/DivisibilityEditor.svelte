<script lang="ts">
	/**
	 * DivisibilityEditor — Minimum Quantity constraint editor.
	 *
	 * Maps to Intent.minimumQuantity.hasNumericalValue in VF.
	 */

	interface Props {
		minAtomicSize?: number;
		onUpdate: (minAtomicSize?: number) => void;
	}

	import { untrack } from 'svelte';

	let { minAtomicSize, onUpdate }: Props = $props();

	let localMinAtomicSize = $state(untrack(() => minAtomicSize));

	function handleNumericInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		localMinAtomicSize = val ? parseFloat(val) : undefined;
		onUpdate(localMinAtomicSize);
	}
</script>

<div class="divisibility-editor">
	<h4 class="editor-title">⚙️ Minimum Quantity</h4>

	<div class="constraint-fields">
		<div class="constraint-field">
			<label for="atomic-size">
				Min Atomic Size
				<span class="help-icon" title="The smallest divisible unit. E.g., '1 hour shift' or '1 crate'.">ⓘ</span>
			</label>
			<input
				id="atomic-size"
				type="number"
				min="0"
				step="any"
				value={localMinAtomicSize}
				placeholder="0 (No minimum)"
				oninput={handleNumericInput}
				class="constraint-input"
			/>
			<p class="field-hint">Defines the "Packet Size". Anything smaller is rejected.</p>
		</div>
	</div>

	<div class="constraints-preview">
		<strong>Minimum:</strong>
		<span>{localMinAtomicSize ? `>= ${localMinAtomicSize}` : 'Any'}</span>
	</div>
</div>

<style>
	.divisibility-editor {
		padding: 1rem;
		background: #f8fafc;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	
	.editor-title {
		margin: 0 0 0.5rem 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: #1f2937;
	}
	
	.constraint-fields {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	
	.constraint-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.constraint-field label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #475569;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.help-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		background: #e0e7ff;
		color: #4f46e5;
		font-size: 0.7rem;
		cursor: help;
	}
	
	.constraint-input {
		padding: 0.5rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 0.875rem;
		color: #1f2937;
		background: white;
		transition: all 0.2s ease;
	}
	
	.constraint-input:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}
	
	.field-hint {
		margin: 0;
		font-size: 0.7rem;
		color: #94a3b8;
		font-style: italic;
	}
	
	.constraints-preview {
		margin-top: 1rem;
		padding: 0.75rem;
		background: #eff6ff;
		border: 1px solid #bfdbfe;
		border-radius: 6px;
		font-size: 0.75rem;
	}
	
	.constraints-preview strong {
		color: #1e40af;
	}
	

</style>

