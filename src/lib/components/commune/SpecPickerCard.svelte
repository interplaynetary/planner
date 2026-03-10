<script lang="ts">
  import type { ResourceSpecification } from "$lib/schemas";

  interface Props {
    specs: ResourceSpecification[];
    onPick: (specId: string) => void;
    label?: string;
  }

  let { specs, onPick, label = "Add" }: Props = $props();

  let open = $state(false);
  let selected = $state("");

  function pick() {
    if (!selected) return;
    onPick(selected);
    open = false;
    selected = "";
  }
</script>

{#if specs.length > 0}
  <div class="picker-card" class:open>
    {#if !open}
      <button class="add-btn" onclick={() => (open = true)}>
        <span class="add-icon">+</span>
        <span class="add-label">{label}</span>
      </button>
    {:else}
      <div class="select-wrap">
        <select bind:value={selected} onchange={pick}>
          <option value="">— pick spec —</option>
          {#each specs as spec (spec.id)}
            <option value={spec.id}>{spec.image ?? ""} {spec.name}</option>
          {/each}
        </select>
        <button class="cancel-btn" onclick={() => { open = false; selected = ""; }}>✕</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .picker-card {
    width: 200px;
    min-height: 80px;
    flex-shrink: 0;
    background: #16161e;
    border: 1px dashed rgba(124, 58, 237, 0.35);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-btn {
    width: 100%;
    height: 100%;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    color: rgba(167, 139, 250, 0.45);
    background: transparent;
    border: none;
    font-family: var(--font-sans);
    transition: color 0.15s, background 0.15s;
  }

  .add-btn:hover {
    color: rgba(167, 139, 250, 0.85);
    background: rgba(124, 58, 237, 0.08);
  }

  .add-icon {
    font-size: 24px;
    line-height: 1;
    font-weight: 300;
  }

  .add-label {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .select-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px;
    width: 100%;
  }

  select {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(124, 58, 237, 0.4);
    color: #e2e8f0;
    border-radius: 3px;
    padding: 3px 5px;
    cursor: pointer;
    min-width: 0;
  }

  select:focus {
    outline: none;
    border-color: rgba(124, 58, 237, 0.8);
  }

  .cancel-btn {
    flex-shrink: 0;
    padding: 2px 5px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.4);
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.65rem;
    font-family: var(--font-mono);
  }

  .cancel-btn:hover {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.3);
    color: rgba(239, 68, 68, 0.7);
  }
</style>
