<script lang="ts">
  import type { Scenario } from "$lib/utils/space-time-scenario";
  import type { BufferZone } from "$lib/schemas";
  import { averageOnHandTarget } from "$lib/algorithms/ddmrp";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    scenarios: Scenario[];
    bufferZones?: BufferZone[];
    class?: string;
  }

  let { scenarios, bufferZones = [], class: cls = "" }: Props = $props();

  // Limit display to 4 columns
  const visible = $derived(scenarios.slice(0, 4));

  // Best scenario: highest coverage, tiebreak = lowest effort
  const bestIdx = $derived.by(() => {
    if (visible.length === 0) return -1;
    return visible.reduce((best, s, i) => {
      const b = visible[best];
      if (s.score.coverage > b.score.coverage) return i;
      if (
        s.score.coverage === b.score.coverage &&
        s.score.total_effort_hours < b.score.total_effort_hours
      )
        return i;
      return best;
    }, 0);
  });

  // Working capital reference: same for all scenarios, depends only on buffer zones
  const workingCapital = $derived(
    bufferZones.reduce((sum, bz) => sum + averageOnHandTarget(bz), 0),
  );

  function coverageZone(pct: number): "red" | "yellow" | "green" {
    return pct < 50 ? "red" : pct < 80 ? "yellow" : "green";
  }
</script>

<div class="scv {cls}">
  {#if visible.length === 0}
    <p class="empty">No scenarios to compare.</p>
  {:else}
    <div class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th class="label-col"></th>
            {#each visible as s, i (s.id)}
              <th class:best={i === bestIdx}>
                <div class="scenario-id">{s.id.slice(0, 8)}</div>
                <div class="res-label">res {s.resolution}</div>
                {#if i === bestIdx}
                  <span class="best-chip">best</span>
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          <!-- Row 1: Coverage -->
          <tr>
            <td class="row-label">Coverage</td>
            {#each visible as s, i (s.id)}
              {@const pct = s.score.coverage * 100}
              {@const zone = coverageZone(pct)}
              <td class:best={i === bestIdx}>
                <div class="cov-wrap">
                  <div class="cov-bar">
                    <div
                      class="cov-fill {zone}"
                      style="width:{Math.min(100, pct).toFixed(1)}%"
                    ></div>
                  </div>
                  <ZoneBadge {zone} pct={pct} />
                </div>
              </td>
            {/each}
          </tr>

          <!-- Row 2: Intents satisfied -->
          <tr>
            <td class="row-label">Intents</td>
            {#each visible as s, i (s.id)}
              <td class:best={i === bestIdx} class="mono">
                {s.score.intents_satisfied} / {s.score.intents_total}
              </td>
            {/each}
          </tr>

          <!-- Row 3: Total effort -->
          <tr>
            <td class="row-label">Effort</td>
            {#each visible as s, i (s.id)}
              <td class:best={i === bestIdx} class="mono">
                {s.score.total_effort_hours.toFixed(1)}h
              </td>
            {/each}
          </tr>

          <!-- Row 4: Deficits -->
          <tr>
            <td class="row-label">Deficits</td>
            {#each visible as s, i (s.id)}
              <td class:best={i === bestIdx}>
                {#if s.score.deficit_specs.length === 0}
                  <span class="none">none</span>
                {:else}
                  <div class="badge-list">
                    <span class="count-badge red"
                      >{s.score.deficit_specs.length}</span
                    >
                    {#each s.score.deficit_specs.slice(0, 3) as spec (spec)}
                      <span class="spec-badge">{spec.slice(0, 10)}</span>
                    {/each}
                    {#if s.score.deficit_specs.length > 3}
                      <span class="more"
                        >+{s.score.deficit_specs.length - 3}</span
                      >
                    {/if}
                  </div>
                {/if}
              </td>
            {/each}
          </tr>

          <!-- Row 5: Surpluses -->
          <tr>
            <td class="row-label">Surpluses</td>
            {#each visible as s, i (s.id)}
              {@const totalQty = s.surpluses.reduce(
                (sum, sp) => sum + sp.quantity,
                0,
              )}
              <td class:best={i === bestIdx} class="mono">
                {s.surpluses.length} ({totalQty.toFixed(0)})
              </td>
            {/each}
          </tr>

          <!-- Row 6: Working capital (same for all; buffer-zone reference) -->
          <tr>
            <td class="row-label">Working Capital</td>
            {#each visible as _, i (i)}
              <td class:best={i === bestIdx} class="mono wc">
                {#if bufferZones.length === 0}
                  <span class="muted">n/a</span>
                {:else}
                  {workingCapital.toFixed(1)}
                {/if}
              </td>
            {/each}
          </tr>
        </tbody>
      </table>
    </div>
    {#if scenarios.length > 4}
      <p class="overflow-note">
        Showing 4 of {scenarios.length} scenarios.
      </p>
    {/if}
  {/if}
</div>

<style>
  .scv {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .table-wrap {
    overflow-x: auto;
  }

  .tbl {
    border-collapse: collapse;
    font-size: var(--text-xs);
    width: 100%;
  }

  th {
    font-weight: 500;
    text-align: center;
    padding: var(--gap-sm);
    white-space: nowrap;
    vertical-align: top;
  }

  th.best {
    background: var(--bg-overlay);
    border-bottom: 2px solid var(--zone-green);
  }

  td {
    padding: 5px var(--gap-sm);
    vertical-align: middle;
  }

  td.best {
    background: rgba(255, 255, 255, 0.03);
  }

  tbody tr + tr {
    border-top: 1px solid var(--border-faint);
  }

  .label-col {
    text-align: left;
    min-width: 100px;
  }

  .row-label {
    font-weight: 500;
    opacity: var(--muted);
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-mono);
    text-align: right;
  }

  .wc {
    opacity: var(--muted);
  }

  .scenario-id {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .res-label {
    font-size: calc(var(--text-xs) - 1px);
    opacity: var(--muted);
  }

  .best-chip {
    display: inline-block;
    font-size: calc(var(--text-xs) - 1px);
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--zone-green);
    background: var(--zone-green-fill);
    border-radius: 2px;
    padding: 0 4px;
    margin-top: 2px;
    text-transform: uppercase;
  }

  /* Coverage bar */
  .cov-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .cov-bar {
    flex: 1;
    height: 5px;
    background: var(--border-dim);
    border-radius: 2px;
    overflow: hidden;
    min-width: 40px;
  }

  .cov-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .cov-fill.red {
    background: var(--zone-red);
  }
  .cov-fill.yellow {
    background: var(--zone-yellow);
  }
  .cov-fill.green {
    background: var(--zone-green);
  }

  /* Deficit badges */
  .badge-list {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    align-items: center;
  }

  .count-badge {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 0 4px;
    border-radius: 2px;
  }

  .count-badge.red {
    color: var(--zone-red);
    background: var(--zone-red-fill);
  }

  .spec-badge {
    font-family: var(--font-mono);
    font-size: calc(var(--text-xs) - 1px);
    opacity: var(--muted);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0 3px;
    border-radius: 2px;
  }

  .more {
    font-size: calc(var(--text-xs) - 1px);
    opacity: var(--muted);
    font-family: var(--font-mono);
  }

  .none {
    font-family: var(--font-mono);
    color: var(--zone-green);
    font-size: var(--text-xs);
  }

  .muted {
    opacity: var(--muted);
  }

  .empty,
  .overflow-note {
    font-size: var(--text-xs);
    opacity: var(--muted);
    margin: 0;
  }
</style>
