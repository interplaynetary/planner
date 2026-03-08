<script lang="ts">
  interface Props {
    tags: string[];
    active: string | null;
  }

  let { tags, active = $bindable() }: Props = $props();

  const colorMap: Record<string, string> = {
    'individual-claimable': 'var(--zone-yellow)',
    'communal':             'var(--zone-green)',
    'replenishment-required': 'var(--zone-excess)',
  };

  function chipColor(tag: string): string {
    const key = tag.split(':').at(-1) ?? tag;
    return colorMap[key] ?? 'rgba(255,255,255,0.35)';
  }
</script>

<div class="chips">
  <button
    class="chip"
    class:chip-active={active === null}
    style="--chip-color: rgba(255,255,255,0.35)"
    onclick={() => (active = null)}
  >
    All
  </button>
  {#each tags as tag (tag)}
    {@const color = chipColor(tag)}
    {@const label = tag.split(':').at(-1) ?? tag}
    <button
      class="chip"
      class:chip-active={active === tag}
      style="--chip-color: {color}"
      onclick={() => (active = active === tag ? null : tag)}
    >
      {label}
    </button>
  {/each}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .chip {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border-radius: 20px;
    border: 1px solid var(--chip-color);
    background: transparent;
    color: var(--chip-color);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    line-height: 1.5;
  }

  .chip:hover {
    background: color-mix(in srgb, var(--chip-color) 15%, transparent);
  }

  .chip-active {
    background: color-mix(in srgb, var(--chip-color) 25%, transparent);
    color: var(--chip-color);
  }
</style>
