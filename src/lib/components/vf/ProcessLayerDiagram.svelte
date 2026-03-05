<script lang="ts">
  import type {
    EconomicEvent, EconomicResource, RecipeFlow, RecipeProcess,
    ResourceSpecification, ProcessSpecification, Commitment, Process,
  } from '$lib/schemas';
  import {
    recipes, resourceSpecs, processSpecs, recipeList,
    processList, commitmentList, eventList, resourceList,
  } from '$lib/vf-stores.svelte';

  // Layout constants
  const BOX_W    = 100;
  const BOX_H    = 36;
  const ROW_GAP  = 8;
  const LAYER_PAD = 20;
  const COL_W    = 130;
  const COL_GAP  = 16;
  const LABEL_W  = 36;
  const LAYER_GAP = 30;
  const MT       = 8;   // MARGIN_TOP
  const MR       = 20;  // MARGIN_RIGHT
  const GG       = 24;  // GROUP_GAP between process groups

  const COLORS = [
    { fill: 'rgba(214,158,46,0.12)', stroke: 'rgba(214,158,46,0.7)', bg: 'rgba(214,158,46,0.05)', label: '#d69e2e', anchor: 'rgba(214,158,46,0.22)' },
    { fill: 'rgba(56,161,105,0.12)', stroke: 'rgba(56,161,105,0.7)', bg: 'rgba(56,161,105,0.05)', label: '#38a169', anchor: 'rgba(56,161,105,0.22)' },
    { fill: 'rgba(49,130,206,0.12)', stroke: 'rgba(49,130,206,0.7)', bg: 'rgba(49,130,206,0.05)', label: '#3182ce', anchor: 'rgba(49,130,206,0.22)' },
  ] as const;

  interface Row {
    specId: string;
    spec?: ResourceSpecification;
    flow?: RecipeFlow;
    commitment?: Commitment;
    event?: EconomicEvent;
    resource?: EconomicResource;
  }

  interface PGroup {
    proc: Process;
    procSpec?: ProcessSpecification;
    rp?: RecipeProcess;
    inputRows: Row[];
    outputRows: Row[];
  }

  // Build process groups reactively
  const groups = $derived.by((): PGroup[] =>
    processList.map(proc => {
      const procSpec = proc.basedOn
        ? processSpecs.find(s => s.id === proc.basedOn)
        : undefined;

      let rp: RecipeProcess | undefined;
      if (proc.basedOn) {
        search: for (const r of recipeList) {
          for (const p of recipes.processesForRecipe(r.id)) {
            if (p.processConformsTo === proc.basedOn) { rp = p; break search; }
          }
        }
      }

      const { inputs: iF, outputs: oF } = rp
        ? recipes.flowsForProcess(rp.id)
        : { inputs: [] as RecipeFlow[], outputs: [] as RecipeFlow[] };

      const iC = commitmentList.filter(c => c.inputOf === proc.id);
      const oC = commitmentList.filter(c => c.outputOf === proc.id);
      const iE = eventList.filter(e => e.inputOf === proc.id);
      const oE = eventList.filter(e => e.outputOf === proc.id);

      function buildRows(flows: RecipeFlow[], commits: Commitment[], evts: EconomicEvent[]): Row[] {
        const ids: string[] = [];
        const seen = new Set<string>();
        for (const item of [...flows, ...commits]) {
          const sid = item.resourceConformsTo;
          if (sid && !seen.has(sid)) { seen.add(sid); ids.push(sid); }
        }
        return ids.map(specId => ({
          specId,
          spec:       resourceSpecs.find(s => s.id === specId),
          flow:       flows.find(f => f.resourceConformsTo === specId),
          commitment: commits.find(c => c.resourceConformsTo === specId),
          event:      evts.find(e => e.resourceConformsTo === specId),
          resource:   resourceList.find(r => r.conformsTo === specId),
        }));
      }

      return {
        proc, procSpec, rp,
        inputRows:  buildRows(iF, iC, iE),
        outputRows: buildRows(oF, oC, oE),
      };
    })
  );

  // SVG dimensions derived from content
  const maxR   = $derived(groups.length === 0 ? 1 : Math.max(...groups.map(g => Math.max(g.inputRows.length, g.outputRows.length, 1))));
  const layerH = $derived(maxR * BOX_H + Math.max(0, maxR - 1) * ROW_GAP + 2 * LAYER_PAD);
  const bY     = $derived([MT, MT + layerH + LAYER_GAP, MT + 2 * (layerH + LAYER_GAP)] as [number, number, number]);
  const svgW   = $derived(LABEL_W + Math.max(1, groups.length) * (5 * COL_W + 4 * COL_GAP) + Math.max(0, groups.length - 1) * GG + MR);
  const svgH   = $derived(3 * layerH + 2 * LAYER_GAP + MT + 8);

  /** Column center X for group gi, column col (0–4) */
  function gx(gi: number, col: number): number {
    return LABEL_W + gi * (5 * COL_W + 4 * COL_GAP + GG) + col * (COL_W + COL_GAP) + COL_W / 2;
  }

  /** Row center Y for layer l, row i of n */
  function ry(l: 0 | 1 | 2, i: number, n: number): number {
    return bY[l] + layerH / 2 + (i - (n - 1) / 2) * (BOX_H + ROW_GAP);
  }

  function fmt(m?: { hasNumericalValue: number; hasUnit: string } | null): string {
    return m ? `${m.hasNumericalValue} ${m.hasUnit}` : '';
  }

  function trunc(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
</script>

{#if processList.length === 0}
  <div class="empty-diagram">Load example to see the process layer diagram</div>
{:else}
  {#snippet box(cx: number, cy: number, label: string, sublabel: string, l: 0 | 1 | 2, anchor?: boolean)}
    {@const c = COLORS[l]}
    <rect
      x={cx - BOX_W / 2} y={cy - BOX_H / 2}
      width={BOX_W} height={BOX_H} rx="3"
      fill={anchor ? c.anchor : c.fill}
      stroke={c.stroke}
      stroke-width={anchor ? 1.5 : 1}
    />
    <text x={cx} y={cy - BOX_H / 2 + 13} text-anchor="middle" font-size="9" font-weight="600" fill="#e2e8f0">{trunc(label, 14)}</text>
    {#if sublabel}
      <text x={cx} y={cy - BOX_H / 2 + 26} text-anchor="middle" font-size="8" fill="rgba(226,232,240,0.55)">{trunc(sublabel, 16)}</text>
    {/if}
  {/snippet}

  {#snippet harrow(x1: number, y1: number, x2: number, y2: number)}
    {#if Math.abs(y1 - y2) < 1}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" stroke-width="1" marker-end="url(#arr)" opacity="0.65" />
    {:else}
      {@const dx = x2 - x1}
      <path
        d="M {x1} {y1} C {x1 + dx * 0.4} {y1}, {x2 - dx * 0.4} {y2}, {x2} {y2}"
        fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#arr)" opacity="0.65"
      />
    {/if}
  {/snippet}

  {#snippet vdash(cx: number, y1: number, y2: number)}
    <line x1={cx} y1={y1} x2={cx} y2={y2} stroke="currentColor" stroke-dasharray="3,5" stroke-width="1" opacity="0.3" />
  {/snippet}

  <svg width={svgW} height={svgH} style="color: #e2e8f0; font-family: var(--font-mono); display: block;">
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.7" />
      </marker>
    </defs>

    <!-- Layer backgrounds -->
    <rect x={0} y={bY[0]} width={svgW} height={layerH} fill={COLORS[0].bg} />
    <rect x={0} y={bY[1]} width={svgW} height={layerH} fill={COLORS[1].bg} />
    <rect x={0} y={bY[2]} width={svgW} height={layerH} fill={COLORS[2].bg} />

    <!-- Layer labels -->
    <text x={4} y={bY[0] + layerH / 2 + 4} font-size="11" font-weight="700" fill={COLORS[0].label}>K</text>
    <text x={4} y={bY[1] + layerH / 2 + 4} font-size="11" font-weight="700" fill={COLORS[1].label}>P</text>
    <text x={4} y={bY[2] + layerH / 2 + 4} font-size="11" font-weight="700" fill={COLORS[2].label}>O</text>

    {#each groups as g, gi}
      {@const ni = g.inputRows.length}
      {@const no = g.outputRows.length}
      {@const pStatus = g.proc.finished ? 'done' : g.proc.hasBeginning ? 'active' : 'planned'}

      <!-- ── BOXES ─────────────────────────────────────────────────────── -->

      <!-- K: col0 input resource specs -->
      {#each g.inputRows as row, i}
        {#if row.spec}
          {@render box(gx(gi, 0), ry(0, i, ni), row.spec.name, row.spec.defaultUnitOfResource ?? '', 0)}
        {/if}
      {/each}

      <!-- K: col1 input recipe flows -->
      {#each g.inputRows as row, i}
        {#if row.flow}
          {@render box(gx(gi, 1), ry(0, i, ni), row.flow.action, fmt(row.flow.resourceQuantity), 0)}
        {/if}
      {/each}

      <!-- K: col2 recipe process / process spec (centered anchor) -->
      {#if g.rp || g.procSpec}
        {@const lbl = g.rp?.name ?? g.procSpec?.name ?? ''}
        {@const sub = g.rp?.hasDuration ? `${g.rp.hasDuration.hasNumericalValue}${g.rp.hasDuration.hasUnit}` : ''}
        {@render box(gx(gi, 2), ry(0, 0, 1), lbl, sub, 0, true)}
      {/if}

      <!-- K: col3 output recipe flows -->
      {#each g.outputRows as row, i}
        {#if row.flow}
          {@render box(gx(gi, 3), ry(0, i, no), row.flow.action, fmt(row.flow.resourceQuantity), 0)}
        {/if}
      {/each}

      <!-- K: col4 output resource specs -->
      {#each g.outputRows as row, i}
        {#if row.spec}
          {@render box(gx(gi, 4), ry(0, i, no), row.spec.name, row.spec.defaultUnitOfResource ?? '', 0)}
        {/if}
      {/each}

      <!-- P: col1 input commitments -->
      {#each g.inputRows as row, i}
        {#if row.commitment}
          {@render box(gx(gi, 1), ry(1, i, ni), row.commitment.action, fmt(row.commitment.resourceQuantity), 1)}
        {/if}
      {/each}

      <!-- P: col2 process (centered anchor) -->
      {@render box(gx(gi, 2), ry(1, 0, 1), g.proc.name, pStatus, 1, true)}

      <!-- P: col3 output commitments -->
      {#each g.outputRows as row, i}
        {#if row.commitment}
          {@render box(gx(gi, 3), ry(1, i, no), row.commitment.action, fmt(row.commitment.resourceQuantity), 1)}
        {/if}
      {/each}

      <!-- O: col0 input resources -->
      {#each g.inputRows as row, i}
        {#if row.resource}
          {@const sub = row.resource.onhandQuantity ? `OH: ${fmt(row.resource.onhandQuantity)}` : ''}
          {@render box(gx(gi, 0), ry(2, i, ni), row.spec?.name ?? row.specId.slice(0, 8), sub, 2)}
        {/if}
      {/each}

      <!-- O: col1 input events -->
      {#each g.inputRows as row, i}
        {#if row.event}
          {@render box(gx(gi, 1), ry(2, i, ni), row.event.action, fmt(row.event.resourceQuantity), 2)}
        {/if}
      {/each}

      <!-- O: col3 output events -->
      {#each g.outputRows as row, i}
        {#if row.event}
          {@render box(gx(gi, 3), ry(2, i, no), row.event.action, fmt(row.event.resourceQuantity), 2)}
        {/if}
      {/each}

      <!-- O: col4 output resources -->
      {#each g.outputRows as row, i}
        {#if row.resource}
          {@const sub = row.resource.onhandQuantity ? `OH: ${fmt(row.resource.onhandQuantity)}` : ''}
          {@render box(gx(gi, 4), ry(2, i, no), row.spec?.name ?? row.specId.slice(0, 8), sub, 2)}
        {/if}
      {/each}

      <!-- ── HORIZONTAL ARROWS ─────────────────────────────────────────── -->

      <!-- K: col0 spec → col1 flow (per input row) -->
      {#each g.inputRows as row, i}
        {#if row.spec && row.flow}
          {@render harrow(gx(gi, 0) + BOX_W / 2, ry(0, i, ni), gx(gi, 1) - BOX_W / 2, ry(0, i, ni))}
        {/if}
      {/each}

      <!-- K: col1 input flows → col2 process (converging) -->
      {#if g.rp || g.procSpec}
        {#each g.inputRows as row, i}
          {#if row.flow}
            {@render harrow(gx(gi, 1) + BOX_W / 2, ry(0, i, ni), gx(gi, 2) - BOX_W / 2, ry(0, 0, 1))}
          {/if}
        {/each}
        <!-- K: col2 process → col3 output flows (diverging) -->
        {#each g.outputRows as row, i}
          {#if row.flow}
            {@render harrow(gx(gi, 2) + BOX_W / 2, ry(0, 0, 1), gx(gi, 3) - BOX_W / 2, ry(0, i, no))}
          {/if}
        {/each}
      {/if}

      <!-- K: col3 flow → col4 spec (per output row) -->
      {#each g.outputRows as row, i}
        {#if row.flow && row.spec}
          {@render harrow(gx(gi, 3) + BOX_W / 2, ry(0, i, no), gx(gi, 4) - BOX_W / 2, ry(0, i, no))}
        {/if}
      {/each}

      <!-- P: col1 input commitments → col2 process (converging) -->
      {#each g.inputRows as row, i}
        {#if row.commitment}
          {@render harrow(gx(gi, 1) + BOX_W / 2, ry(1, i, ni), gx(gi, 2) - BOX_W / 2, ry(1, 0, 1))}
        {/if}
      {/each}

      <!-- P: col2 process → col3 output commitments (diverging) -->
      {#each g.outputRows as row, i}
        {#if row.commitment}
          {@render harrow(gx(gi, 2) + BOX_W / 2, ry(1, 0, 1), gx(gi, 3) - BOX_W / 2, ry(1, i, no))}
        {/if}
      {/each}

      <!-- O: input resource → input event -->
      {#each g.inputRows as row, i}
        {#if row.resource && row.event}
          {@render harrow(gx(gi, 0) + BOX_W / 2, ry(2, i, ni), gx(gi, 1) - BOX_W / 2, ry(2, i, ni))}
        {/if}
      {/each}

      <!-- O: output event → output resource -->
      {#each g.outputRows as row, i}
        {#if row.event && row.resource}
          {@render harrow(gx(gi, 3) + BOX_W / 2, ry(2, i, no), gx(gi, 4) - BOX_W / 2, ry(2, i, no))}
        {/if}
      {/each}

      <!-- ── VERTICAL DASHED LINES ─────────────────────────────────────── -->

      <!-- col0: K input spec → O input resource (spans P band) -->
      {#each g.inputRows as row, i}
        {#if row.spec && row.resource}
          {@render vdash(gx(gi, 0), ry(0, i, ni) + BOX_H / 2 + 1, ry(2, i, ni) - BOX_H / 2 - 1)}
        {/if}
      {/each}

      <!-- col1 input: K flow → P commitment, then P commitment → O event -->
      {#each g.inputRows as row, i}
        {#if row.flow && row.commitment}
          {@render vdash(gx(gi, 1), ry(0, i, ni) + BOX_H / 2 + 1, ry(1, i, ni) - BOX_H / 2 - 1)}
        {/if}
        {#if row.commitment && row.event}
          {@render vdash(gx(gi, 1), ry(1, i, ni) + BOX_H / 2 + 1, ry(2, i, ni) - BOX_H / 2 - 1)}
        {/if}
        {#if row.flow && !row.commitment && row.event}
          {@render vdash(gx(gi, 1), ry(0, i, ni) + BOX_H / 2 + 1, ry(2, i, ni) - BOX_H / 2 - 1)}
        {/if}
      {/each}

      <!-- col2: K recipe process → P process -->
      {#if g.rp || g.procSpec}
        {@render vdash(gx(gi, 2), ry(0, 0, 1) + BOX_H / 2 + 1, ry(1, 0, 1) - BOX_H / 2 - 1)}
      {/if}

      <!-- col3 output: K flow → P commitment, then P commitment → O event -->
      {#each g.outputRows as row, i}
        {#if row.flow && row.commitment}
          {@render vdash(gx(gi, 3), ry(0, i, no) + BOX_H / 2 + 1, ry(1, i, no) - BOX_H / 2 - 1)}
        {/if}
        {#if row.commitment && row.event}
          {@render vdash(gx(gi, 3), ry(1, i, no) + BOX_H / 2 + 1, ry(2, i, no) - BOX_H / 2 - 1)}
        {/if}
        {#if row.flow && !row.commitment && row.event}
          {@render vdash(gx(gi, 3), ry(0, i, no) + BOX_H / 2 + 1, ry(2, i, no) - BOX_H / 2 - 1)}
        {/if}
      {/each}

      <!-- col4: K output spec → O output resource (spans P band) -->
      {#each g.outputRows as row, i}
        {#if row.spec && row.resource}
          {@render vdash(gx(gi, 4), ry(0, i, no) + BOX_H / 2 + 1, ry(2, i, no) - BOX_H / 2 - 1)}
        {/if}
      {/each}
    {/each}
  </svg>
{/if}

<style>
  .empty-diagram {
    padding: 8px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.3;
    text-align: center;
  }
</style>
