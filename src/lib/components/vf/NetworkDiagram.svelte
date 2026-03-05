<script lang="ts">
  import type { Process, ProcessSpecification, Agent, BufferZone } from '$lib/schemas';
  import {
    processSpecs, processList, commitmentList, eventList,
    resourceList, agentList, bufferZoneList, resourceSpecs,
  } from '$lib/vf-stores.svelte';
  import { showTip, hideTip, moveTip } from '$lib/tooltip.svelte';

  // ── Layout constants ──────────────────────────────────────────────────────
  const ML        = 30;    // left margin
  const MT        = 16;    // top margin
  const MB        = 56;    // bottom margin (legend)
  const COL_W     = 360;   // column center-to-center
  const PROC_W    = 108;
  const PROC_H    = 44;
  const AGENT_H   = 22;
  const AGENT_W   = 80;
  const AGENT_GAP = 6;     // gap between agent bottom and process top
  const RES_RX    = 40;
  const RES_RY    = 13;
  const RES_GAP   = 12;    // gap: process box edge → resource oval center
  const ROW_H     = 34;    // vertical spacing between resource rows
  const SLOT_BOT  = 16;    // padding below last resource row in slot
  const SLOT_GAP  = 14;    // gap between stacked slots in same column
  const BUF_W     = 16;    // buffer funnel width
  const BUF_H     = 22;    // buffer funnel height

  /** Distance from process center-X to resource oval center-X */
  const IO_X = PROC_W / 2 + RES_GAP + RES_RX; // 54 + 12 + 40 = 106

  const AGENT_COLORS = ['#805ad5', '#38a169', '#dd6b20', '#d53f8c', '#3182ce', '#718096'] as const;

  // ── Types ─────────────────────────────────────────────────────────────────
  interface ResRow {
    specId:     string;
    specName:   string;
    action:     string;
    qty:        string;
    onhand:     number;
    unit:       string;
    bufferZone?: BufferZone;
    y:          number;   // computed center-y
  }

  interface ProcNode {
    proc:      Process;
    procSpec?: ProcessSpecification;
    col:       number;
    x:         number;    // center-x of process box
    y:         number;    // center-y of process box
    agents:    Agent[];
    inputs:    ResRow[];
    outputs:   ResRow[];
  }

  interface NetEdge {
    fromProcId: string;
    toProcId:   string;
    specId:     string;
    specName:   string;
    fromX:      number;
    fromY:      number;
    toX:        number;
    toY:        number;
    hasEvent:   boolean;
  }

  // ── Step 1: raw edge list (proc-to-proc via shared spec) ──────────────────
  const rawEdges = $derived.by(() => {
    type RE = { fromId: string; toId: string; specId: string; hasEvent: boolean };
    const result: RE[] = [];
    const seen = new Set<string>();
    for (const c1 of commitmentList) {
      if (!c1.outputOf || !c1.resourceConformsTo) continue;
      for (const c2 of commitmentList) {
        if (!c2.inputOf || c2.resourceConformsTo !== c1.resourceConformsTo) continue;
        const key = `${c1.outputOf}→${c2.inputOf}:${c1.resourceConformsTo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hasEvent = eventList.some(
          e => e.outputOf === c1.outputOf && e.resourceConformsTo === c1.resourceConformsTo
        );
        result.push({ fromId: c1.outputOf, toId: c2.inputOf, specId: c1.resourceConformsTo, hasEvent });
      }
    }
    return result;
  });

  // ── Step 2: layout (topo sort → columns → positions) ─────────────────────
  const netLayout = $derived.by((): ProcNode[] => {
    if (processList.length === 0) return [];

    const procIds = processList.map(p => p.id);
    const edges   = rawEdges;

    // Adjacency + DFS topo sort
    const adj = new Map<string, string[]>();
    for (const pid of procIds) adj.set(pid, []);
    for (const e of edges) { if (procIds.includes(e.toId)) adj.get(e.fromId)?.push(e.toId); }

    const visited = new Set<string>();
    const topo: string[] = [];
    function dfs(pid: string, stk: Set<string>) {
      if (stk.has(pid) || visited.has(pid)) return;
      stk.add(pid);
      for (const s of adj.get(pid) ?? []) dfs(s, stk);
      stk.delete(pid); visited.add(pid); topo.unshift(pid);
    }
    for (const pid of procIds) dfs(pid, new Set());

    // Column = longest path from source
    const colMap = new Map<string, number>();
    for (const pid of topo) {
      let col = 0;
      for (const e of edges) {
        if (e.toId === pid && colMap.has(e.fromId))
          col = Math.max(col, (colMap.get(e.fromId) ?? 0) + 1);
      }
      colMap.set(pid, col);
    }
    for (const pid of procIds) { if (!colMap.has(pid)) colMap.set(pid, 0); }

    // Group by column (preserve processList order within column)
    const colGroups = new Map<number, string[]>();
    for (const pid of procIds) {
      const col = colMap.get(pid) ?? 0;
      if (!colGroups.has(col)) colGroups.set(col, []);
      colGroups.get(col)!.push(pid);
    }

    // Helper: build resource rows for a process
    function makeRows(pid: string, side: 'input' | 'output'): Omit<ResRow, 'y'>[] {
      const commits = side === 'input'
        ? commitmentList.filter(c => c.inputOf  === pid && c.resourceConformsTo)
        : commitmentList.filter(c => c.outputOf === pid && c.resourceConformsTo);
      return commits.map(c => {
        const specId = c.resourceConformsTo!;
        const spec   = resourceSpecs.find(s => s.id === specId);
        const res    = resourceList.find(r => r.conformsTo === specId);
        const bz     = side === 'output' ? bufferZoneList.find(b => b.specId === specId) : undefined;
        return {
          specId,
          specName:   spec?.name ?? specId.slice(0, 8),
          action:     c.action,
          qty:        c.resourceQuantity ? `${c.resourceQuantity.hasNumericalValue} ${c.resourceQuantity.hasUnit}` : '',
          onhand:     res?.onhandQuantity?.hasNumericalValue ?? 0,
          unit:       res?.onhandQuantity?.hasUnit ?? spec?.defaultUnitOfResource ?? '',
          bufferZone: bz,
        };
      });
    }

    function slotH(pid: string): number {
      const ni = commitmentList.filter(c => c.inputOf  === pid && c.resourceConformsTo).length;
      const no = commitmentList.filter(c => c.outputOf === pid && c.resourceConformsTo).length;
      return AGENT_H + AGENT_GAP + Math.max(ni, no, 1) * ROW_H + SLOT_BOT;
    }

    // Column heights for vertical centering
    const colHeights = new Map<number, number>();
    for (const [col, pids] of colGroups) {
      const h = pids.reduce((acc, pid, i) => acc + slotH(pid) + (i > 0 ? SLOT_GAP : 0), 0);
      colHeights.set(col, h);
    }
    const maxH = Math.max(...colHeights.values(), 1);

    const procMap = new Map(processList.map(p => [p.id, p]));
    const nodes: ProcNode[] = [];

    for (const [col, pids] of colGroups) {
      const colOffset = (maxH - (colHeights.get(col) ?? 0)) / 2;
      const x = ML + col * COL_W + COL_W / 2;
      let slotTop = MT + colOffset;

      for (const pid of pids) {
        const proc      = procMap.get(pid)!;
        const procSpec  = processSpecs.find(s => s.id === proc.basedOn);
        const inBase    = makeRows(pid, 'input');
        const outBase   = makeRows(pid, 'output');
        const maxRows   = Math.max(inBase.length, outBase.length, 1);
        const procY     = slotTop + AGENT_H + AGENT_GAP + (maxRows * ROW_H) / 2;

        const inputs: ResRow[]  = inBase.map((r, i) => ({
          ...r, y: procY + (i - (inBase.length  - 1) / 2) * ROW_H,
        }));
        const outputs: ResRow[] = outBase.map((r, i) => ({
          ...r, y: procY + (i - (outBase.length - 1) / 2) * ROW_H,
        }));

        // Unique agents
        const agentIds = new Set<string>();
        for (const c of commitmentList.filter(c => c.inputOf === pid || c.outputOf === pid)) {
          if (c.provider) agentIds.add(c.provider);
          if (c.receiver) agentIds.add(c.receiver);
        }
        const agents = [...agentIds]
          .map(id => agentList.find(a => a.id === id))
          .filter((a): a is Agent => !!a)
          .slice(0, 3);

        nodes.push({ proc, procSpec, col, x, y: procY, agents, inputs, outputs });
        slotTop += slotH(pid) + SLOT_GAP;
      }
    }
    return nodes;
  });

  // ── Step 3: edges with coordinates ────────────────────────────────────────
  const netEdges = $derived.by((): NetEdge[] => {
    return rawEdges.flatMap(re => {
      const src = netLayout.find(n => n.proc.id === re.fromId);
      const tgt = netLayout.find(n => n.proc.id === re.toId);
      if (!src || !tgt) return [];
      const outRow = src.outputs.find(r => r.specId === re.specId);
      const inRow  = tgt.inputs.find(r => r.specId === re.specId);
      if (!outRow || !inRow) return [];
      return [{
        fromProcId: re.fromId,
        toProcId:   re.toId,
        specId:     re.specId,
        specName:   outRow.specName,
        fromX:      src.x + IO_X + RES_RX,
        fromY:      outRow.y,
        toX:        tgt.x - IO_X - RES_RX,
        toY:        inRow.y,
        hasEvent:   re.hasEvent,
      }];
    });
  });

  // ── SVG dimensions ─────────────────────────────────────────────────────────
  const svgW = $derived(
    netLayout.length === 0 ? 420
      : ML + (Math.max(...netLayout.map(n => n.col)) + 1) * COL_W
        + IO_X + RES_RX + BUF_W + 28
  );
  const svgH = $derived(
    netLayout.length === 0 ? 120
      : Math.max(
          ...netLayout.flatMap(n => [...n.inputs, ...n.outputs].map(r => r.y + RES_RY)),
          ...netLayout.map(n => n.y + PROC_H / 2)
        ) + MB
  );
  const legendY = $derived(svgH - MB + 18);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function trunc(s: string, n: number) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function procStroke(spec?: ProcessSpecification): string {
    if (spec?.isDecouplingPoint) return '#d69e2e';
    if (spec?.isControlPoint)    return '#4fd1c5';
    return 'rgba(255,255,255,0.25)';
  }

  function procFill(spec?: ProcessSpecification): string {
    if (spec?.isDecouplingPoint) return 'rgba(214,158,46,0.08)';
    if (spec?.isControlPoint)    return 'rgba(79,209,197,0.08)';
    return 'rgba(255,255,255,0.04)';
  }

  /** Trapezoid funnel slice from fraction y1f to y2f (0=top,1=bottom). */
  function funSlice(y1f: number, y2f: number): string {
    const hw1 = BUF_W / 2 - y1f * (BUF_W / 2 - BUF_W / 4);
    const hw2 = BUF_W / 2 - y2f * (BUF_W / 2 - BUF_W / 4);
    return `M${-hw1},${y1f * BUF_H} L${hw1},${y1f * BUF_H} L${hw2},${y2f * BUF_H} L${-hw2},${y2f * BUF_H} Z`;
  }

  // ── Tooltip helpers ────────────────────────────────────────────────────────
  function procLines(n: ProcNode): string[] {
    const ps = n.procSpec;
    const lines: string[] = [n.proc.name];
    if (ps?.name) lines.push(`Spec: ${ps.name}`);
    if (ps?.isDecouplingPoint) lines.push('Type: Decoupling Point');
    if (ps?.isControlPoint)    lines.push('Type: Control Point');
    const p = n.proc as any;
    lines.push(`Status: ${p.finished ? 'finished' : p.hasBeginning ? 'active' : 'planned'}`);
    return lines;
  }

  function resLines(r: ResRow, side: 'input' | 'output'): string[] {
    const lines: string[] = [`${r.specName}  (${side})`];
    lines.push(`Action: ${r.action}`);
    if (r.qty) lines.push(`Qty: ${r.qty}`);
    if (r.onhand > 0) lines.push(`On-hand: ${r.onhand} ${r.unit}`);
    if (r.bufferZone) {
      const bz = r.bufferZone;
      lines.push(`TOR ${bz.tor.toFixed(1)} · TOY ${bz.toy.toFixed(1)} · TOG ${bz.tog.toFixed(1)}`);
      const status = r.onhand <= bz.tor ? 'RED zone' : r.onhand <= bz.toy ? 'YELLOW zone' : 'GREEN zone';
      lines.push(`Buffer: ${status}`);
    }
    return lines;
  }

  function agentLines(a: Agent): string[] {
    return [`${a.name ?? a.id}`, `Type: ${a.type}`];
  }
</script>

{#if processList.length === 0}
  <div class="empty-diagram">Load example to see the network diagram</div>
{:else}
  <svg
    width={svgW}
    height={svgH}
    style="color:#e2e8f0;font-family:var(--font-mono);display:block;"
    role="img"
    onmousemove={moveTip}
  >
    <defs>
      <marker id="nd-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 Z" fill="rgba(226,232,240,0.6)" />
      </marker>
    </defs>

    <!-- ── Flow arrows (drawn first, behind all nodes) ───────────────────── -->
    {#each netEdges as e (e.fromProcId + e.specId + e.toProcId)}
      {@const dx = e.toX - e.fromX}
      {@const mx = (e.fromX + e.toX) / 2}
      {@const my = (e.fromY + e.toY) / 2}
      <path
        d="M{e.fromX},{e.fromY} C{e.fromX + dx * 0.5},{e.fromY} {e.toX - dx * 0.5},{e.toY} {e.toX},{e.toY}"
        fill="none"
        stroke="rgba(226,232,240,0.28)"
        stroke-width="1.5"
        marker-end="url(#nd-arr)"
      />
      <!-- Event fulfilled indicator -->
      {#if e.hasEvent}
        <circle cx={mx} cy={my} r="4.5" fill="#38a169" stroke="rgba(226,232,240,0.5)" stroke-width="0.8" />
      {/if}
    {/each}

    <!-- ── Nodes ─────────────────────────────────────────────────────────── -->
    {#each netLayout as node (node.proc.id)}
      {@const ps   = node.procSpec}
      {@const agentY = node.y - PROC_H / 2 - AGENT_GAP - AGENT_H / 2}

      <!-- Agent boxes (above process box) -->
      {#each node.agents as agent, ai (agent.id)}
        {@const total = node.agents.length}
        {@const aw    = Math.min(AGENT_W, (PROC_W - 4) / Math.max(total, 1))}
        {@const ax    = node.x + (ai - (total - 1) / 2) * (aw + 4)}
        <rect
          x={ax - aw / 2}
          y={agentY - AGENT_H / 2}
          width={aw}
          height={AGENT_H}
          rx="3"
          fill="{AGENT_COLORS[ai % AGENT_COLORS.length]}20"
          stroke={AGENT_COLORS[ai % AGENT_COLORS.length]}
          stroke-width="1"
          style="cursor:default"
          role="img"
          onmouseenter={(ev) => showTip(ev, agentLines(agent))}
          onmouseleave={hideTip}
          onmousemove={moveTip}
        />
        <text
          x={ax}
          y={agentY + 4}
          text-anchor="middle"
          font-size="8"
          fill={AGENT_COLORS[ai % AGENT_COLORS.length]}
          style="pointer-events:none"
        >{trunc(agent.name ?? agent.id, 9)}</text>
        <!-- Connector line to process top -->
        <line
          x1={ax}
          y1={agentY + AGENT_H / 2}
          x2={node.x}
          y2={node.y - PROC_H / 2}
          stroke="rgba(226,232,240,0.15)"
          stroke-width="1"
          style="pointer-events:none"
        />
      {/each}

      <!-- Process box -->
      <rect
        x={node.x - PROC_W / 2}
        y={node.y - PROC_H / 2}
        width={PROC_W}
        height={PROC_H}
        rx="4"
        fill={procFill(ps)}
        stroke={procStroke(ps)}
        stroke-width="1.5"
        style="cursor:default"
        role="img"
        onmouseenter={(ev) => showTip(ev, procLines(node))}
        onmouseleave={hideTip}
        onmousemove={moveTip}
      />
      <text
        x={node.x}
        y={node.y - 7}
        text-anchor="middle"
        font-size="9"
        font-weight="600"
        fill="#e2e8f0"
        style="pointer-events:none"
      >{trunc(node.proc.name, 14)}</text>
      {#if ps?.name}
        <text
          x={node.x}
          y={node.y + 9}
          text-anchor="middle"
          font-size="7.5"
          fill="rgba(226,232,240,0.4)"
          style="pointer-events:none"
        >{trunc(ps.name, 18)}</text>
      {/if}

      <!-- Control-point "C" marker (left of process box) -->
      {#if ps?.isControlPoint}
        <circle
          cx={node.x - PROC_W / 2 - 14}
          cy={node.y}
          r="11"
          fill="white"
          stroke="#4fd1c5"
          stroke-width="1.5"
          style="pointer-events:none"
        />
        <text
          x={node.x - PROC_W / 2 - 14}
          y={node.y + 4}
          text-anchor="middle"
          font-size="11"
          font-weight="700"
          fill="#1a202c"
          style="pointer-events:none"
        >C</text>
      {/if}

      <!-- ── Input resource ovals (left of process) ──────────────────────── -->
      {#each node.inputs as row (row.specId + 'in')}
        {@const ox = node.x - IO_X}
        <ellipse
          cx={ox}
          cy={row.y}
          rx={RES_RX}
          ry={RES_RY}
          fill="rgba(74,85,104,0.25)"
          stroke="rgba(160,174,192,0.5)"
          stroke-width="1"
          style="cursor:default"
          role="img"
          onmouseenter={(ev) => showTip(ev, resLines(row, 'input'))}
          onmouseleave={hideTip}
          onmousemove={moveTip}
        />
        <text
          x={ox}
          y={row.y + 4}
          text-anchor="middle"
          font-size="8"
          fill="rgba(226,232,240,0.75)"
          style="pointer-events:none"
        >{trunc(row.specName, 11)}</text>
        <!-- Short arrow: input oval → process box left edge -->
        <line
          x1={ox + RES_RX}
          y1={row.y}
          x2={node.x - PROC_W / 2}
          y2={node.y}
          stroke="rgba(226,232,240,0.2)"
          stroke-width="1"
          marker-end="url(#nd-arr)"
          style="pointer-events:none"
        />
      {/each}

      <!-- ── Output resource ovals + buffer funnels (right of process) ───── -->
      {#each node.outputs as row (row.specId + 'out')}
        {@const ox  = node.x + IO_X}
        {@const bz  = row.bufferZone}
        {@const tor = bz?.tor ?? 1}
        {@const toy = bz?.toy ?? 2}
        {@const tog = bz?.tog ?? 3}
        <!-- Short arrow: process box right edge → output oval -->
        <line
          x1={node.x + PROC_W / 2}
          y1={node.y}
          x2={ox - RES_RX}
          y2={row.y}
          stroke="rgba(226,232,240,0.2)"
          stroke-width="1"
          marker-end="url(#nd-arr)"
          style="pointer-events:none"
        />
        <!-- Output oval -->
        <ellipse
          cx={ox}
          cy={row.y}
          rx={RES_RX}
          ry={RES_RY}
          fill="rgba(49,130,206,0.12)"
          stroke={bz ? procStroke(ps) : 'rgba(49,130,206,0.55)'}
          stroke-width={bz ? '1.5' : '1'}
          style="cursor:default"
          role="img"
          onmouseenter={(ev) => showTip(ev, resLines(row, 'output'))}
          onmouseleave={hideTip}
          onmousemove={moveTip}
        />
        <text
          x={ox}
          y={row.y - 2}
          text-anchor="middle"
          font-size="8"
          font-weight="500"
          fill="#e2e8f0"
          style="pointer-events:none"
        >{trunc(row.specName, 11)}</text>
        {#if row.onhand > 0}
          <text
            x={ox}
            y={row.y + 9}
            text-anchor="middle"
            font-size="7"
            fill="rgba(226,232,240,0.45)"
            style="pointer-events:none"
          >OH:{row.onhand} {row.unit}</text>
        {/if}

        <!-- Buffer zone funnel (right of output oval, when buffer exists) -->
        {#if bz}
          {@const gF   = 1 - toy / tog}
          {@const yF   = 1 - tor / tog}
          {@const fx   = ox + RES_RX + 5}
          {@const fy   = row.y - BUF_H / 2}
          {@const curF = 1 - Math.min(Math.max(row.onhand / tog, 0), 1)}
          {@const curHW = BUF_W / 2 - curF * BUF_W / 4}
          <g
            transform="translate({fx + BUF_W / 2},{fy})"
            style="cursor:default"
            role="img"
            onmouseenter={(ev) => showTip(ev, resLines(row, 'output'))}
            onmouseleave={hideTip}
            onmousemove={moveTip}
          >
            <path d={funSlice(0, gF)} fill="#276749" opacity="0.9" />
            <path d={funSlice(gF, yF)} fill="#b7791f" opacity="0.9" />
            <path d={funSlice(yF, 1)} fill="#9b2c2c" opacity="0.9" />
            <path d={funSlice(0, 1)} fill="none" stroke="rgba(226,232,240,0.4)" stroke-width="0.6" />
            <line
              x1={-curHW - 2} y1={curF * BUF_H}
              x2={curHW + 2}  y2={curF * BUF_H}
              stroke="white" stroke-width="1.5" opacity="0.9"
            />
          </g>
        {/if}
      {/each}
    {/each}

    <!-- ── Legend ─────────────────────────────────────────────────────────── -->
    <text x={ML} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)" font-weight="600">KEY</text>
    <!-- Input oval -->
    <ellipse cx={ML + 42} cy={legendY - 4} rx="11" ry="6" fill="rgba(74,85,104,0.25)" stroke="rgba(160,174,192,0.5)" stroke-width="1" />
    <text x={ML + 56} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Input</text>
    <!-- Output oval -->
    <ellipse cx={ML + 102} cy={legendY - 4} rx="11" ry="6" fill="rgba(49,130,206,0.12)" stroke="rgba(49,130,206,0.55)" stroke-width="1" />
    <text x={ML + 116} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Output</text>
    <!-- Event dot -->
    <circle cx={ML + 168} cy={legendY - 4} r="4.5" fill="#38a169" stroke="rgba(226,232,240,0.5)" stroke-width="0.8" />
    <text x={ML + 176} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Event fulfilled</text>
    <!-- Buffer funnel icon -->
    <g transform="translate({ML + 262},{legendY - BUF_H + 6})">
      <path d={funSlice(0, 0.4)} fill="#276749" opacity="0.9" />
      <path d={funSlice(0.4, 0.7)} fill="#b7791f" opacity="0.9" />
      <path d={funSlice(0.7, 1)} fill="#9b2c2c" opacity="0.9" />
    </g>
    <text x={ML + 272} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Buffer zone</text>
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
