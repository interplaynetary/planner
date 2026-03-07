<script lang="ts">
  import type { FlowNode } from "$lib/algorithms/track-trace";

  interface Props {
    nodes: FlowNode[];
    /** Depth for indentation (used recursively) */
    depth?: number;
    class?: string;
  }

  let { nodes, depth = 0, class: cls = "" }: Props = $props();

  const icon: Record<string, string> = {
    event: "·",
    process: "▷",
    resource: "◈",
  };
</script>

<ul class="ft {cls}" style="--depth:{depth}">
  {#each nodes as n}
    <li>
      <span class="icon {n.kind}">{icon[n.kind] ?? "·"}</span>
      <span class="label {n.kind}">
        {n.label ?? n.id.slice(0, 12)}
      </span>
      {#if n.action}
        <span class="action">{n.action}</span>
      {/if}
      {#if n.quantity !== undefined}
        <span class="qty">{n.quantity.toFixed(2)}</span>
      {/if}
      {#if n.date}
        <span class="date">{new Date(n.date).toLocaleDateString()}</span>
      {/if}
      {#if n.children?.length}
        <svelte:self nodes={n.children} depth={depth + 1} />
      {/if}
    </li>
  {/each}
</ul>

<style>
  .ft {
    list-style: none;
    padding: 0;
    margin: 0;
    padding-left: calc(var(--depth, 0) * 16px);
  }
  li {
    display: flex;
    align-items: baseline;
    gap: var(--gap-sm);
    padding: 1px 0;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }
  .icon {
    width: 1ch;
    text-align: center;
    opacity: var(--muted);
  }
  .icon.process {
    color: var(--zone-excess);
    opacity: 0.8;
  }
  .icon.resource {
    color: var(--zone-green);
    opacity: 0.8;
  }

  .label {
    font-weight: 500;
  }
  .label.process {
    color: var(--zone-excess);
  }
  .label.resource {
    color: var(--zone-green);
  }

  .action {
    opacity: var(--muted);
    font-size: var(--text-xs);
  }
  .qty {
    font-weight: 600;
  }
  .date {
    opacity: var(--muted);
    margin-left: auto;
  }
</style>
