<script lang="ts">
  import type { DependentDemandResult } from '$lib/algorithms/dependent-demand';
  import CommitmentRow from '$lib/components/vf/CommitmentRow.svelte';
  import IntentRow from '$lib/components/vf/IntentRow.svelte';
  import ProcessRow from '$lib/components/vf/ProcessRow.svelte';

  interface Props {
    result: DependentDemandResult;
    depth?: number;
    class?: string;
  }

  let { result, depth = 0, class: cls = '' }: Props = $props();
</script>

<ul class="et {cls}" style="--depth:{depth}">
  <li>
    {#each result.processes as p}
      <ProcessRow process={p} />
    {/each}
    {#each result.commitments as c}
      <CommitmentRow commitment={c} />
    {/each}
    {#each result.intents as i}
      <IntentRow intent={i} />
    {/each}
    {#each result.purchaseIntents as i}
      <IntentRow intent={i} specName="[purchase]" />
    {/each}
  </li>
</ul>

<style>
  .et {
    list-style: none;
    padding-left: calc(var(--depth, 0) * 16px);
    margin: 0;
    font-size: var(--text-xs);
  }
  li { display: flex; flex-direction: column; gap: 2px; padding: 2px 0; }
</style>
