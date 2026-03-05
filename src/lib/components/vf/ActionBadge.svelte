<script lang="ts">
  import type { VfAction } from '$lib/schemas';

  interface Props {
    action: VfAction | string;
    class?: string;
  }

  let { action, class: cls = '' }: Props = $props();

  const group = $derived((): string => {
    switch (action) {
      case 'produce': case 'modify': case 'combine': case 'separate': case 'accept':
        return 'out';
      case 'consume': case 'use': case 'work': case 'cite': case 'deliverService':
        return 'in';
      case 'transferAllRights': case 'transferCustody': case 'transfer': case 'move':
        return 'transfer';
      case 'pickup': case 'dropoff':
        return 'move';
      default:
        return 'other';
    }
  });
</script>

<span class="ab {group()} {cls}">{action}</span>

<style>
  .ab {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .out      { color: var(--zone-green); }
  .in       { color: var(--zone-yellow); }
  .transfer { color: var(--zone-excess); }
  .move     { color: var(--zone-early); }
  .other    { opacity: var(--muted); }
</style>
