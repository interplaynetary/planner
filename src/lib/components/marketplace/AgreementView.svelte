<script lang="ts">
  import type { Agreement, Commitment } from '$lib/schemas';
  import CommitmentRow from '$lib/components/vf/CommitmentRow.svelte';

  interface Props {
    agreement: Agreement;
    commitments: Commitment[];
    specNames?: Map<string, string>;
    class?: string;
  }

  let { agreement, commitments, specNames, class: cls = '' }: Props = $props();

  const primaryIds = $derived(new Set(agreement.stipulates ?? []));
  const reciprocalIds = $derived(new Set(agreement.stipulatesReciprocal ?? []));

  const primaryCommitments = $derived(
    commitments.filter(c => c.clauseOf === agreement.id && primaryIds.has(c.id))
  );
  const reciprocalCommitments = $derived(
    commitments.filter(c => c.clauseOf === agreement.id && reciprocalIds.has(c.id))
  );
</script>

<div class="av {cls}">
  {#if agreement.name}<span class="title">{agreement.name}</span>{/if}
  {#if agreement.created}<span class="muted">{agreement.created.slice(0, 10)}</span>{/if}
  {#if primaryCommitments.length}
    <span class="section">Primary</span>
    {#each primaryCommitments as c}
      <CommitmentRow commitment={c} specName={specNames?.get(c.resourceConformsTo ?? '') } />
    {/each}
  {/if}
  {#if reciprocalCommitments.length}
    <span class="section">Reciprocal</span>
    {#each reciprocalCommitments as c}
      <CommitmentRow commitment={c} specName={specNames?.get(c.resourceConformsTo ?? '')} />
    {/each}
  {/if}
</div>

<style>
  .av { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-xs); }
  .title { font-weight: 500; }
  .section { opacity: var(--muted); font-size: var(--text-xs); margin-top: 4px; }
  .muted { opacity: var(--muted); }
</style>
