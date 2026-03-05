<script lang="ts">
  interface FlowException {
    orderId: string;
    date: string;
    domain: string;
    duration?: number;
    dueDate?: string;
  }

  interface Props {
    entries: FlowException[];
    class?: string;
  }

  let { entries, class: cls = '' }: Props = $props();

  function domainColor(domain: string): string {
    switch (domain) {
      case 'execution':  return 'excess';
      case 'planning':   return 'yellow';
      case 'scheduling': return 'green';
      default:           return 'other';
    }
  }
</script>

<div class="fer {cls}">
  {#each entries as e}
    <div class="row">
      <span class="muted">{e.orderId.slice(0, 8)}</span>
      <span class="badge {domainColor(e.domain)}">{e.domain}</span>
      <span>{e.date}</span>
      {#if e.duration !== undefined}<span class="mono">{e.duration}d</span>{/if}
      {#if e.dueDate}<span class="muted">{e.dueDate}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .fer { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .muted { opacity: var(--muted); }
  .mono { font-family: var(--font-mono); }
  .badge { font-size: var(--text-xs); font-family: var(--font-mono); font-weight: 600; text-transform: uppercase; }
  .badge.excess  { color: var(--zone-excess); }
  .badge.yellow  { color: var(--zone-yellow); }
  .badge.green   { color: var(--zone-green); }
  .badge.other   { opacity: var(--muted); }
</style>
