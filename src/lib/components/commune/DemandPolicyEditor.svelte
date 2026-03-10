<script lang="ts">
  import { untrack } from 'svelte';
  import type { CommuneDemandPolicy, DerivedDependentPolicy } from '$lib/observation/demand-policy';
  import { deriveDependentDemand } from '$lib/observation/demand-policy';

  interface Props {
    kind: 'independent' | 'dependent';
    specId: string;
    unit: string;
    memberCount?: number;
    dependentTotal?: number;
    independentTotal?: number;
    policy?: CommuneDemandPolicy | DerivedDependentPolicy;
    onSave: (p: CommuneDemandPolicy | DerivedDependentPolicy) => void;
    onDelete?: () => void;
  }

  let {
    kind,
    specId,
    unit,
    memberCount = 0,
    dependentTotal = 0,
    independentTotal = 0,
    policy,
    onSave,
    onDelete,
  }: Props = $props();

  // ── Independent form state ────────────────────────────────────────────────
  let indepFactorType = $state<'per_member' | 'fixed'>(
    untrack(() => (policy as CommuneDemandPolicy)?.factorType ?? 'per_member'),
  );
  let indepQtyPerMember = $state<number>(untrack(() => (policy as CommuneDemandPolicy)?.qtyPerMember ?? 1));
  let indepFixedQty = $state<number>(untrack(() => (policy as CommuneDemandPolicy)?.fixedQty ?? 0));
  let indepName = $state<string>(untrack(() => (policy as CommuneDemandPolicy)?.name ?? unit));

  // ── Dependent form state ──────────────────────────────────────────────────
  let depFactorType = $state<'replenishment_rate' | 'buffer_fraction' | 'fixed'>(
    untrack(() => (policy as DerivedDependentPolicy)?.factorType ?? 'replenishment_rate'),
  );
  let depRatePct = $state<number>(untrack(() => ((policy as DerivedDependentPolicy)?.rate ?? 0.1) * 100));
  let depFixedQty = $state<number>(untrack(() => (policy as DerivedDependentPolicy)?.fixedQty ?? 0));

  // ── Formula preview ───────────────────────────────────────────────────────
  const formulaPreview = $derived.by(() => {
    if (kind === 'independent') {
      if (indepFactorType === 'per_member') {
        const total = indepQtyPerMember * memberCount;
        return `${indepQtyPerMember} ${unit} × ${memberCount} members = ${total.toFixed(1)} ${unit}`;
      }
      return `${indepFixedQty} ${unit} (fixed)`;
    } else {
      const mock: DerivedDependentPolicy = {
        id: 'preview',
        specId,
        unit,
        factorType: depFactorType,
        rate: depRatePct / 100,
        fixedQty: depFixedQty,
      };
      return deriveDependentDemand(mock, dependentTotal, independentTotal).formulaLabel;
    }
  });

  function save() {
    if (kind === 'independent') {
      const p: CommuneDemandPolicy = {
        id: (policy as CommuneDemandPolicy)?.id ?? `cdp-${specId}-${Date.now()}`,
        name: indepName || unit,
        specId,
        unit,
        factorType: indepFactorType,
        qtyPerMember: indepFactorType === 'per_member' ? indepQtyPerMember : undefined,
        fixedQty: indepFactorType === 'fixed' ? indepFixedQty : undefined,
      };
      onSave(p);
    } else {
      const p: DerivedDependentPolicy = {
        id: (policy as DerivedDependentPolicy)?.id ?? `ddp-${specId}-${Date.now()}`,
        specId,
        unit,
        factorType: depFactorType,
        rate: depFactorType !== 'fixed' ? depRatePct / 100 : undefined,
        fixedQty: depFactorType === 'fixed' ? depFixedQty : undefined,
      };
      onSave(p);
    }
  }
</script>

<div class="editor">
  {#if kind === 'independent'}
    <!-- Independent: per_member | fixed -->
    <div class="row">
      <span class="label">type</span>
      <div class="toggle-group">
        <button
          class="toggle"
          class:active={indepFactorType === 'per_member'}
          onclick={() => (indepFactorType = 'per_member')}
        >per member</button>
        <button
          class="toggle"
          class:active={indepFactorType === 'fixed'}
          onclick={() => (indepFactorType = 'fixed')}
        >fixed</button>
      </div>
    </div>

    <div class="row">
      <span class="label">name</span>
      <input class="val-input" type="text" bind:value={indepName} placeholder="Policy name" />
    </div>

    {#if indepFactorType === 'per_member'}
      <div class="row">
        <span class="label">qty / member</span>
        <input class="val-input num" type="number" bind:value={indepQtyPerMember} min="0" step="0.1" />
        <span class="unit-tag">{unit}</span>
      </div>
    {:else}
      <div class="row">
        <span class="label">fixed qty</span>
        <input class="val-input num" type="number" bind:value={indepFixedQty} min="0" step="1" />
        <span class="unit-tag">{unit}</span>
      </div>
    {/if}

  {:else}
    <!-- Dependent: replenishment_rate | buffer_fraction | fixed -->
    <div class="row">
      <span class="label">type</span>
      <div class="toggle-group">
        <button
          class="toggle"
          class:active={depFactorType === 'replenishment_rate'}
          onclick={() => (depFactorType = 'replenishment_rate')}
        >replenish %</button>
        <button
          class="toggle"
          class:active={depFactorType === 'buffer_fraction'}
          onclick={() => (depFactorType = 'buffer_fraction')}
        >buffer %</button>
        <button
          class="toggle"
          class:active={depFactorType === 'fixed'}
          onclick={() => (depFactorType = 'fixed')}
        >fixed</button>
      </div>
    </div>

    {#if depFactorType !== 'fixed'}
      <div class="row">
        <span class="label">rate %</span>
        <input class="val-input num" type="number" bind:value={depRatePct} min="0" max="200" step="1" />
        <span class="unit-tag">%</span>
      </div>
    {:else}
      <div class="row">
        <span class="label">fixed qty</span>
        <input class="val-input num" type="number" bind:value={depFixedQty} min="0" step="1" />
        <span class="unit-tag">{unit}</span>
      </div>
    {/if}
  {/if}

  <!-- Formula preview -->
  <div class="formula">{formulaPreview}</div>

  <!-- Actions -->
  <div class="actions">
    <button class="save-btn" onclick={save}>Save</button>
    {#if onDelete && policy}
      <button class="del-btn" onclick={onDelete}>Delete</button>
    {/if}
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 7px 8px;
    background: rgba(0, 0, 0, 0.3);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .label {
    font-family: monospace;
    font-size: 0.58rem;
    color: rgba(255, 255, 255, 0.35);
    width: 64px;
    flex-shrink: 0;
  }

  .toggle-group {
    display: flex;
    gap: 2px;
  }

  .toggle {
    font-family: monospace;
    font-size: 0.58rem;
    padding: 2px 5px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.4);
    border-radius: 3px;
    cursor: pointer;
  }

  .toggle.active {
    background: rgba(124, 58, 237, 0.25);
    border-color: rgba(124, 58, 237, 0.5);
    color: #c4b5fd;
  }

  .val-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 0.68rem;
    font-family: monospace;
  }

  .val-input:focus {
    outline: none;
    border-color: rgba(124, 58, 237, 0.5);
  }

  .val-input.num {
    width: 52px;
    flex: none;
    text-align: right;
    appearance: textfield;
  }

  .val-input.num::-webkit-inner-spin-button,
  .val-input.num::-webkit-outer-spin-button { display: none; }

  .unit-tag {
    font-family: monospace;
    font-size: 0.58rem;
    color: rgba(167, 139, 250, 0.7);
    flex-shrink: 0;
  }

  .formula {
    font-family: monospace;
    font-size: 0.6rem;
    color: rgba(167, 139, 250, 0.65);
    padding: 3px 4px;
    background: rgba(124, 58, 237, 0.07);
    border-radius: 3px;
    border: 1px solid rgba(124, 58, 237, 0.15);
    line-height: 1.4;
    word-break: break-word;
  }

  .actions {
    display: flex;
    gap: 4px;
    margin-top: 1px;
  }

  .save-btn {
    font-family: monospace;
    font-size: 0.62rem;
    padding: 2px 8px;
    background: rgba(124, 58, 237, 0.3);
    border: 1px solid rgba(124, 58, 237, 0.5);
    color: #c4b5fd;
    border-radius: 3px;
    cursor: pointer;
  }

  .save-btn:hover { background: rgba(124, 58, 237, 0.45); }

  .del-btn {
    font-family: monospace;
    font-size: 0.62rem;
    padding: 2px 6px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: rgba(239, 68, 68, 0.7);
    border-radius: 3px;
    cursor: pointer;
  }

  .del-btn:hover { background: rgba(239, 68, 68, 0.18); }
</style>
