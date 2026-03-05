<script lang="ts">
  import type { BatchLotRecord } from '$lib/schemas';

  interface Props {
    lot: BatchLotRecord;
    class?: string;
  }

  let { lot, class: cls = '' }: Props = $props();

  const expired = $derived(
    lot.expirationDate ? new Date(lot.expirationDate) < new Date() : false
  );
  const expiryStr = $derived(lot.expirationDate?.slice(0, 10));
</script>

<span class="lot-wrap {cls}">
  <span class="lot">{lot.batchLotCode ?? lot.id.slice(0, 8)}</span>
  {#if expiryStr}<span class="exp" class:expired>{expiryStr}</span>{/if}
</span>

<style>
  .lot-wrap { display: inline-flex; align-items: center; gap: 4px; }
  .lot { font-size: var(--text-xs); font-family: var(--font-mono); }
  .exp { font-size: var(--text-xs); font-family: var(--font-mono); opacity: var(--muted); }
  .exp.expired { color: var(--zone-red); opacity: 1; }
</style>
