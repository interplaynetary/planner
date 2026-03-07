<script lang="ts">
  import type { DemandSlot } from "$lib/indexes/independent-demand";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";
  import QuantityBar from "$lib/components/ui/QuantityBar.svelte";

  interface Props {
    slot: DemandSlot;
    class?: string;
  }

  let { slot, class: cls = "" }: Props = $props();

  const urgencyZone = $derived(
    slot.remaining_quantity <= 0
      ? "green"
      : slot.remaining_quantity >= slot.required_quantity
        ? "red"
        : "yellow",
  );
</script>

<div class="dsc {cls}">
  <div class="top">
    <span class="spec">{(slot.spec_id ?? "").slice(0, 14)}</span>
    <span class="action">{slot.action}</span>
    {#if slot.classification}
      <ZoneBadge zone="excess" label={slot.classification} />
    {/if}
  </div>

  <QuantityBar
    value={slot.required_quantity - slot.remaining_quantity}
    max={slot.required_quantity}
    label="fulfilled"
    zone={urgencyZone}
  />

  <div class="meta">
    {#if slot.due}
      <span>due {new Date(slot.due).toLocaleDateString()}</span>
    {/if}
    {#if slot.atLocation}
      <span class="loc">{slot.atLocation}</span>
    {/if}
    <span class="rem">{slot.remaining_quantity.toFixed(1)} remaining</span>
  </div>
</div>

<style>
  .dsc {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 140px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    flex-wrap: wrap;
  }
  .spec {
    font-size: var(--text-sm);
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action {
    font-size: var(--text-xs);
    opacity: var(--muted);
    font-family: var(--font-mono);
  }
  .meta {
    display: flex;
    gap: var(--gap-md);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
  }
  .rem {
    margin-left: auto;
  }
</style>
