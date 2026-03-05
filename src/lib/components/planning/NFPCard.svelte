<script lang="ts">
  import type { NFPResult } from "$lib/algorithms/ddmrp";
  import type { BufferZone } from "$lib/schemas";
  import BufferZoneBar from "$lib/components/ui/BufferZoneBar.svelte";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    nfp: NFPResult;
    bufferZone: BufferZone;
    spec?: string;
    class?: string;
  }

  let { nfp, bufferZone, spec, class: cls = "" }: Props = $props();

  const pct = $derived(Math.round(nfp.priority * 100));
</script>

<div class="nfp {cls}">
  {#if spec}
    <span class="spec">{spec}</span>
  {/if}

  <div class="row">
    <ZoneBadge zone={nfp.zone} {pct} />
    <span class="nfp-val" class:negative={nfp.nfp < 0}>
      {nfp.nfp >= 0 ? "+" : ""}{nfp.nfp.toFixed(1)}
    </span>
  </div>

  <BufferZoneBar
    value={nfp.nfp}
    tor={bufferZone.tor}
    toy={bufferZone.toy}
    tog={bufferZone.tog}
    unit={bufferZone.aduUnit}
  />

  <div class="breakdown">
    <span title="On-Hand">OH <b>{nfp.onhand.toFixed(1)}</b></span>
    <span title="On-Order">+OO <b>{nfp.onorder.toFixed(1)}</b></span>
    <span title="Qualified Demand"
      >−QD <b>{nfp.qualifiedDemand.toFixed(1)}</b></span
    >
  </div>
</div>

<style>
  .nfp {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    min-width: 160px;
  }

  .spec {
    font-size: var(--text-xs);
    opacity: var(--muted);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
  }

  .nfp-val {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .nfp-val.negative {
    color: var(--zone-red);
  }

  .breakdown {
    display: flex;
    gap: var(--gap-lg);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
  }
  .breakdown b {
    opacity: 1;
    font-weight: 600;
  }
</style>
