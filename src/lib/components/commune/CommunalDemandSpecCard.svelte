<script lang="ts">
  import type { DemandSlot } from '$lib/indexes/independent-demand';
  import type { Intent } from '$lib/schemas';
  import type { CommunalDemandEntry } from '$lib/observation/demand-policy';
  import { formatWhen } from '$lib/utils/time';

  interface Props {
    specName: string;
    derivedRows: CommunalDemandEntry[];
    intentRows: Array<{ slot: DemandSlot; intent: Intent }>;
  }

  let { specName, derivedRows, intentRows }: Props = $props();
</script>

<div class="spec-card">
  <div class="spec-name">{specName}</div>

  {#each intentRows as { slot, intent } (slot.intent_id)}
    {@const when = formatWhen(intent.availability_window, slot.due)}
    {@const isRecurring = !!intent.availability_window}
    {@const pct = slot.required_quantity > 0 ? Math.min(1, slot.fulfilled_quantity / slot.required_quantity) : 0}
    <div class="row">
      <div class="row-top">
        <span class="qty">{slot.required_quantity}</span><span class="unit"> {intent.resourceQuantity?.hasUnit ?? ''}</span>
        {#if when}<span class="when">{when}</span>{/if}
      </div>
      {#if isRecurring}
        <span class="ongoing">ongoing</span>
      {:else}
        <div class="bar-row">
          <div class="bar-track">
            <div class="bar-fill" style="width: {(pct * 100).toFixed(1)}%"></div>
          </div>
          <span class="fulfillment">{slot.fulfilled_quantity}/{slot.required_quantity}</span>
        </div>
      {/if}
    </div>
  {/each}

  {#each derivedRows as entry (entry.policyId)}
    {@const when = formatWhen(entry.availability_window)}
    {@const qpm = entry.qtyPerMember}
    <div class="row">
      <div class="row-top">
        <span class="qty">{entry.derivedQty}</span><span class="unit"> {entry.unit}</span>
        {#if when}<span class="when">{when}</span>{/if}
      </div>
      {#if entry.factorType === 'per_member' && qpm !== undefined}
        <span class="formula">[{qpm}×{entry.memberCount}]</span>
      {:else}
        <span class="formula">[fixed]</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .spec-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 160px;
    flex-shrink: 0;
    padding: 8px 10px 9px;
    background: #0d0d0d;
    border: 1px solid rgba(104, 211, 145, 0.12);
    border-radius: 4px;
    font-family: var(--font-mono);
    color: #e2e8f0;
  }

  .spec-name {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--zone-green);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 2px;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row-top {
    display: flex;
    align-items: baseline;
    gap: 0;
    flex-wrap: wrap;
    column-gap: 4px;
  }

  .qty {
    font-size: 1rem;
    font-weight: 700;
    color: var(--zone-green);
  }

  .unit {
    font-size: 0.58rem;
    font-weight: 400;
    opacity: 0.5;
  }

  .when {
    font-size: 0.58rem;
    opacity: 0.5;
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .bar-track {
    flex: 1;
    height: 4px;
    background: rgba(104, 211, 145, 0.12);
    border-radius: 2px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: var(--zone-green);
    border-radius: 2px;
    transition: width 0.2s;
  }

  .fulfillment {
    font-size: 0.58rem;
    opacity: 0.45;
    white-space: nowrap;
  }

  .ongoing {
    font-size: 0.58rem;
    opacity: 0.35;
    font-style: italic;
  }

  .formula {
    font-size: 0.58rem;
    opacity: 0.4;
    font-family: var(--font-mono);
  }
</style>
