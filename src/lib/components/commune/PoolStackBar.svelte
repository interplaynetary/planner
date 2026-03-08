<script lang="ts">
  interface Props {
    pools:  Record<string, number>;
    active?: string | null;
  }

  let { pools, active = $bindable(null) }: Props = $props();

  const COLOR: Record<string, { bg: string; bgActive: string; fg: string; border: string }> = {
    'individual-claimable': { bg: 'rgba(214,158,46,0.18)', bgActive: 'rgba(214,158,46,0.38)', fg: 'var(--zone-yellow)', border: 'rgba(214,158,46,0.5)'  },
    'communal':             { bg: 'rgba(56,161,105,0.18)',  bgActive: 'rgba(56,161,105,0.38)',  fg: 'var(--zone-green)',  border: 'rgba(56,161,105,0.5)'  },
  };
  const DEFAULT = { bg: 'rgba(255,255,255,0.06)', bgActive: 'rgba(255,255,255,0.15)', fg: 'rgba(255,255,255,0.7)', border: 'rgba(255,255,255,0.2)' };

  function c(name: string) { return COLOR[name] ?? DEFAULT; }

  const entries = $derived(Object.entries(pools).filter(([, v]) => v > 0));
  const total   = $derived(entries.reduce((s, [, v]) => s + v, 0));

  function toggle(name: string) {
    active = active === name ? null : name;
  }
</script>

{#if total > 0}
  <div class="bar" role="group" aria-label="SVC pool distribution">
    {#each entries as [name, value], i (name)}
      {@const pct      = (value / total) * 100}
      {@const col      = c(name)}
      {@const isActive = active === name}
      {@const dimmed   = active !== null && !isActive}
      <button
        class="seg"
        class:active={isActive}
        class:dimmed={dimmed}
        style="flex:{pct}; --bg:{col.bg}; --bg-active:{col.bgActive}; --fg:{col.fg}; --border:{col.border};"
        onclick={() => toggle(name)}
        title="{name}: {value.toFixed(0)} SVC ({pct.toFixed(0)}%)"
        aria-pressed={isActive}
      >
        {#if pct > 18}
          <span class="seg-name">{name.toUpperCase()}</span>
          <span class="seg-val">{value.toFixed(0)}</span>
        {:else if pct > 6}
          <span class="seg-val">{value.toFixed(0)}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    height: 26px;
    flex: 1;
    min-width: 120px;
    gap: 2px;
    align-items: stretch;
  }

  .seg {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 3px;
    min-width: 4px;
    overflow: hidden;
    transition: flex 0.4s ease, background 0.15s, opacity 0.15s;
    gap: 6px;
    background: var(--bg);
    cursor: pointer;
    font-family: inherit;
  }

  .seg:hover {
    background: var(--bg-active);
  }

  .seg.active {
    background: var(--bg-active);
    border-width: 1.5px;
  }

  .seg.dimmed {
    opacity: 0.35;
  }

  .seg-name {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg);
    opacity: 0.85;
  }

  .seg-val {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
    color: var(--fg);
    opacity: 0.9;
  }
</style>
