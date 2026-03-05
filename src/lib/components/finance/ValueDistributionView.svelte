<script lang="ts">
  export interface DistributionShare {
    agentId: string;
    agentName?: string;
    share: number; // 0–1
    amount: number;
  }

  interface Props {
    shares: DistributionShare[];
    totalIncome: number;
    unit?: string;
    class?: string;
  }

  let { shares, totalIncome, unit = "", class: cls = "" }: Props = $props();

  // Sorted descending
  const sorted = $derived([...shares].sort((a, b) => b.share - a.share));

  // Colours cycle
  const palette = [
    "var(--zone-excess)",
    "var(--zone-green)",
    "var(--zone-yellow)",
    "rgba(159,122,234,0.8)",
    "rgba(237,137,54,0.8)",
  ];
</script>

<div class="vd {cls}">
  <!-- Horizontal stacked bar -->
  <div class="bar">
    {#each sorted as s, i}
      <div
        class="seg"
        style="width:{s.share * 100}%; background:{palette[i % palette.length]}"
        title="{s.agentName ?? s.agentId}: {(s.share * 100).toFixed(1)}%"
      ></div>
    {/each}
  </div>

  <!-- Legend -->
  <ul class="legend">
    {#each sorted as s, i}
      <li>
        <span class="dot" style="background:{palette[i % palette.length]}"
        ></span>
        <span class="name">{s.agentName ?? s.agentId.slice(0, 10)}</span>
        <span class="amt">{s.amount.toFixed(2)} {unit}</span>
        <span class="pct">({(s.share * 100).toFixed(1)}%)</span>
      </li>
    {/each}
  </ul>

  <div class="total">
    Total <b>{totalIncome.toFixed(2)} {unit}</b>
  </div>
</div>

<style>
  .vd {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
  }

  .bar {
    display: flex;
    height: 8px;
    border-radius: 2px;
    overflow: hidden;
    width: 100%;
  }
  .seg {
    transition: width 0.3s;
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .amt {
    font-weight: 600;
  }
  .pct {
    opacity: var(--muted);
  }

  .total {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
  }
  .total b {
    opacity: 1;
    font-weight: 700;
  }
</style>
