<script lang="ts">
  interface SNEEntry {
    specId: string;
    specName?: string;
    sne: number;
    unit: string;
  }

  interface Props {
    entries: SNEEntry[];
    class?: string;
  }

  let { entries, class: cls = '' }: Props = $props();
</script>

<div class="sne {cls}">
  <div class="header row">
    <span>spec</span>
    <span>sne</span>
    <span>unit</span>
  </div>
  {#each entries as e}
    <div class="row">
      <span>{e.specName ?? e.specId.slice(0, 12)}</span>
      <span class="val">{e.sne.toFixed(3)}</span>
      <span class="muted">{e.unit}</span>
    </div>
  {/each}
</div>

<style>
  .sne { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: var(--gap-sm); font-size: var(--text-xs); }
  .header { opacity: var(--muted); }
  .val { font-family: var(--font-mono); font-weight: 700; }
  .muted { opacity: var(--muted); }
</style>
