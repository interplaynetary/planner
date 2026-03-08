<script lang="ts">
  import { recipes, refresh } from '$lib/vf-stores.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  let name = $state('');
  let defaultUnitOfResource = $state('');
  let defaultUnitOfEffort = $state('');
  let note = $state('');
  let classifiedAs = $state('');
  let substitutable = $state(false);
  let mediumOfExchange = $state(false);
  let replenishmentRequired = $state(false);

  function reset() {
    name = '';
    defaultUnitOfResource = '';
    defaultUnitOfEffort = '';
    note = '';
    classifiedAs = '';
    substitutable = false;
    mediumOfExchange = false;
    replenishmentRequired = false;
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const resourceClassifiedAs = classifiedAs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (replenishmentRequired) {
      resourceClassifiedAs.push('tag:plan:replenishment-required');
    }

    recipes.addResourceSpec({
      id: crypto.randomUUID(),
      name: name.trim(),
      ...(defaultUnitOfResource.trim() && { defaultUnitOfResource: defaultUnitOfResource.trim() }),
      ...(defaultUnitOfEffort.trim() && { defaultUnitOfEffort: defaultUnitOfEffort.trim() }),
      ...(note.trim() && { note: note.trim() }),
      resourceClassifiedAs,
      ...(substitutable && { substitutable: true }),
      ...(mediumOfExchange && { mediumOfExchange: true }),
      ...(replenishmentRequired && { replenishmentRequired: true }),
    });

    refresh();
    reset();
    onclose();
  }

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={handleBackdrop}>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">New Resource Spec</span>
        <button type="button" class="close-btn" onclick={onclose}>✕</button>
      </div>

      <form onsubmit={handleSubmit} class="panel-form">
        <label class="field">
          <span class="field-label">Name <span class="required">*</span></span>
          <input
            class="input"
            type="text"
            bind:value={name}
            placeholder="e.g. Steel Tubing"
            required
            autocomplete="off"
          />
        </label>

        <label class="field">
          <span class="field-label">Unit of Resource</span>
          <input
            class="input"
            type="text"
            bind:value={defaultUnitOfResource}
            placeholder="kg, m, units, L…"
            autocomplete="off"
          />
        </label>

        <label class="field">
          <span class="field-label">Unit of Effort</span>
          <input
            class="input"
            type="text"
            bind:value={defaultUnitOfEffort}
            placeholder="hours, days…"
            autocomplete="off"
          />
        </label>

        <label class="field">
          <span class="field-label">Classifications</span>
          <input
            class="input"
            type="text"
            bind:value={classifiedAs}
            placeholder="tag:food, tag:raw-material (comma-sep)"
            autocomplete="off"
          />
        </label>

        <label class="field">
          <span class="field-label">Note</span>
          <textarea
            class="input textarea"
            bind:value={note}
            placeholder="Optional description…"
            rows="3"
          ></textarea>
        </label>

        <div class="checks">
          <label class="check">
            <input type="checkbox" bind:checked={substitutable} />
            <span>Substitutable</span>
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={mediumOfExchange} />
            <span>Medium of Exchange</span>
          </label>
          <label class="check replen">
            <input type="checkbox" bind:checked={replenishmentRequired} />
            <span>Replenishment Required <span class="hint">(DDMRP Pass 2)</span></span>
          </label>
        </div>

        <div class="panel-actions">
          <button type="button" class="btn-cancel" onclick={onclose}>Cancel</button>
          <button type="submit" class="btn-submit" disabled={!name.trim()}>Add Spec</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.4);
  }

  .panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 300px;
    height: 100%;
    background: rgba(13, 13, 19, 0.97);
    backdrop-filter: blur(8px);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--zone-yellow);
  }

  .close-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    line-height: 1;
  }

  .close-btn:hover {
    color: #e2e8f0;
  }

  .panel-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    flex: 1;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.55;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .required {
    color: var(--zone-green);
  }

  .input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    color: #e2e8f0;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    padding: 5px 8px;
    outline: none;
    transition: border-color 0.15s;
    width: 100%;
    box-sizing: border-box;
  }

  .input:focus {
    border-color: rgba(255, 255, 255, 0.3);
  }

  .textarea {
    resize: vertical;
    min-height: 60px;
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .check input[type='checkbox'] {
    accent-color: var(--zone-green);
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  .check.replen span {
    color: rgba(56, 161, 105, 0.9);
  }

  .hint {
    opacity: 0.5;
    font-size: 0.65rem;
  }

  .panel-actions {
    display: flex;
    gap: 8px;
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .btn-cancel {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 5px 0;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    border-radius: 3px;
  }

  .btn-cancel:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .btn-submit {
    flex: 2;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 5px 0;
    background: rgba(56, 161, 105, 0.2);
    border: 1px solid rgba(56, 161, 105, 0.4);
    color: var(--zone-green);
    cursor: pointer;
    border-radius: 3px;
  }

  .btn-submit:hover:not(:disabled) {
    background: rgba(56, 161, 105, 0.3);
  }

  .btn-submit:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
