<script lang="ts">
  interface Props {
    value: number;
    max: number;
    label?: string;
    zone?: string; // optional zone tint on the fill
    class?: string;
  }

  let { value, max, label, zone, class: cls = "" }: Props = $props();

  const pct = $derived(max > 0 ? Math.min(100, (value / max) * 100) : 0);
</script>

<div class="qb {cls}" title="{value} / {max}{label ? ` ${label}` : ''}">
  <div class="track">
    <div class="fill {zone ?? 'neutral'}" style="width:{pct}%"></div>
  </div>
  {#if label}
    <span class="lbl">{value} / {max} {label}</span>
  {/if}
</div>

<style>
  .qb {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
  }

  .track {
    flex: 1;
    height: 4px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }
  .fill.neutral {
    background: rgba(255, 255, 255, 0.5);
  }
  .fill.red {
    background: var(--zone-red);
  }
  .fill.yellow {
    background: var(--zone-yellow);
  }
  .fill.green {
    background: var(--zone-green);
  }
  .fill.excess {
    background: var(--zone-excess);
  }

  .lbl {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
    white-space: nowrap;
  }
</style>
