<script lang="ts">
  import type { RollupResult } from "$lib/algorithms/rollup";

  interface Props {
    standard?: RollupResult;
    actual?: RollupResult;
    unit?: string;
    class?: string;
  }

  let { standard, actual, unit = "", class: cls = "" }: Props = $props();

  const variance = $derived(
    standard && actual ? actual.totalValue - standard.totalValue : null,
  );
</script>

<div class="cr {cls}">
  <div class="totals">
    {#if standard}
      <div>
        <span class="lbl">Standard</span>
        <span class="val">{standard.totalValue.toFixed(2)} {unit}</span>
      </div>
    {/if}
    {#if actual}
      <div>
        <span class="lbl">Actual</span>
        <span class="val">{actual.totalValue.toFixed(2)} {unit}</span>
      </div>
    {/if}
    {#if variance !== null}
      <div>
        <span class="lbl">Variance</span>
        <span class="val" class:over={variance > 0} class:under={variance < 0}>
          {variance > 0 ? "+" : ""}{variance.toFixed(2)}
          {unit}
        </span>
      </div>
    {/if}
  </div>

  {#if standard?.stages?.length}
    <table class="stages">
      <thead>
        <tr
          ><th>Stage</th><th class="num">Standard</th>{#if actual}<th
              class="num">Actual</th
            >{/if}</tr
        >
      </thead>
      <tbody>
        {#each standard.stages as stage, i}
          <tr>
            <td>{stage.processName}</td>
            <td class="num">{stage.stageTotalValue.toFixed(2)}</td>
            {#if actual?.stages?.[i] !== undefined}
              <td class="num">{actual.stages[i].stageTotalValue.toFixed(2)}</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .cr {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
  }

  .totals {
    display: flex;
    gap: var(--gap-lg);
    flex-wrap: wrap;
  }
  .totals > div {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .lbl {
    font-size: var(--text-xs);
    opacity: var(--muted);
    font-family: var(--font-mono);
  }
  .val {
    font-size: var(--text-sm);
    font-weight: 700;
    font-family: var(--font-mono);
  }
  .over {
    color: var(--zone-red);
  }
  .under {
    color: var(--zone-green);
  }

  .stages {
    border-collapse: collapse;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    width: 100%;
  }
  th {
    opacity: var(--muted);
    font-weight: 500;
    text-align: left;
    padding: 2px var(--gap-sm);
  }
  td {
    padding: 1px var(--gap-sm);
  }
  .num {
    text-align: right;
  }
</style>
