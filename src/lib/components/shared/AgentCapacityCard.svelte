<script lang="ts">
  import type { AgentCapacity } from "$lib/indexes/agents";

  interface Props {
    capacity: AgentCapacity;
    agentName?: string;
    class?: string;
  }

  let { capacity, agentName, class: cls = "" }: Props = $props();


</script>

<div class="acc {cls}">
  <div class="top">
    <span class="name">{agentName ?? capacity.agent_id.slice(0, 12)}</span>
    <span class="window">{capacity.space_time_signature ?? ""}</span>
  </div>

  <!-- Capacity bar: total available hours -->
  <div class="bar-wrap">
    <div class="bar">
      <div
        class="fill"
        style="width:100%"
      ></div>
    </div>
    <span class="hrs">
      {capacity.total_hours.toFixed(1)}h avail.
    </span>
  </div>

  {#if capacity.resource_specs?.length}
    <div class="skills">
      {#each capacity.resource_specs as s}
        <span class="skill">{s.slice(0, 10)}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .acc {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 140px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .name {
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .window {
    font-size: var(--text-xs);
    opacity: var(--muted);
    font-family: var(--font-mono);
  }

  .bar-wrap {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
  }
  .bar {
    flex: 1;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--zone-green);
    border-radius: 2px;
    transition: width 0.3s;
  }
  .fill.warn {
    background: var(--zone-yellow);
  }
  .hrs {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
    white-space: nowrap;
  }

  .skills {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .skill {
    font-size: calc(var(--text-xs) - 1px);
    font-family: var(--font-mono);
    opacity: var(--muted);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0 3px;
    border-radius: 2px;
  }
</style>
