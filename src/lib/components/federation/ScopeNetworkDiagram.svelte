<script lang="ts">
  import type { PlanStore } from '$lib/planning/planning';
  import type { Observer } from '$lib/observation/observer';
  import { capacityBufferStatus } from '$lib/algorithms/ddmrp';

  export interface SimpleBufferZone {
    specId: string; tor: number; toy: number; tog: number;
  }
  export interface SimpleCapacityBuffer {
    processId: string;
    currentLoadHours: number;
    totalCapacityHours: number;
    greenThreshold?: number;
    yellowThreshold?: number;
  }

  interface Props {
    planStore: PlanStore;
    observer: Observer;
    specNames: Record<string, string>;
    mode: 'plan' | 'observe';
    bufferZones?: SimpleBufferZone[];
    capacityBuffers?: SimpleCapacityBuffer[];
  }

  let { planStore, observer, specNames, mode, bufferZones = [], capacityBuffers = [] }: Props = $props();

  // ── Layout constants ───────────────────────────────────────────────────────
  const ML       = 20;
  const MT       = 16;
  const COL_W    = 380;
  const PROC_W   = 100;
  const PROC_H   = 44;
  const CARD_W   = 106;
  const CARD_H   = 46;
  const CARD_RX  = 3;
  const RES_GAP  = 10;
  const ROW_H    = 52;
  const SLOT_BOT = 16;
  const SLOT_GAP = 12;
  const BUF_W    = 14;
  const BUF_H    = 20;
  const CAP_H    = 5;
  const CAP_GAP  = 3;
  const IO_X     = PROC_W / 2 + RES_GAP + CARD_W / 2; // 50 + 10 + 53 = 113

  // ── Derived state ──────────────────────────────────────────────────────────
  const processes = $derived(planStore.processes.all());
  const allCmts   = $derived(planStore.allCommitments());
  const observed  = $derived(observer.allResources());

  const onhandBySpec = $derived(
    observed.reduce<Record<string, number>>((acc, r) => {
      acc[r.conformsTo] = (acc[r.conformsTo] ?? 0) + (r.onhandQuantity?.hasNumericalValue ?? 0);
      return acc;
    }, {})
  );

  // ── rawEdges — inter-process connections ───────────────────────────────────
  const rawEdges = $derived.by(() => {
    const result: { fromId: string; toId: string; specId: string }[] = [];
    const seen = new Set<string>();
    for (const c1 of allCmts) {
      if (!c1.outputOf || !c1.resourceConformsTo) continue;
      for (const c2 of allCmts) {
        if (!c2.inputOf || c2.resourceConformsTo !== c1.resourceConformsTo) continue;
        const key = `${c1.outputOf}→${c2.inputOf}:${c1.resourceConformsTo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ fromId: c1.outputOf, toId: c2.inputOf, specId: c1.resourceConformsTo });
      }
    }
    return result;
  });

  // ── Data interfaces ────────────────────────────────────────────────────────
  interface ResCard {
    specId: string; specName: string; action: string;
    qty: number; unit: string;
    isWork: boolean; providerName?: string;
    onhand: number;
    fulfillPct?: number;
    bufferZone?: SimpleBufferZone;
    y: number;
  }
  interface ProcNode {
    proc: { id: string; name: string };
    col: number; x: number; y: number;
    inputs: ResCard[]; outputs: ResCard[];
    capBuf?: SimpleCapacityBuffer;
  }

  // ── netLayout — topo sort + column assignment ──────────────────────────────
  const netLayout = $derived.by((): ProcNode[] => {
    if (processes.length === 0) return [];
    const procIds = processes.map(p => p.id);
    const edges = rawEdges;

    // Adjacency + DFS topo sort
    const adj = new Map<string, string[]>();
    for (const pid of procIds) adj.set(pid, []);
    for (const e of edges) adj.get(e.fromId)?.push(e.toId);
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
      for (const e of edges)
        if (e.toId === pid && colMap.has(e.fromId))
          col = Math.max(col, (colMap.get(e.fromId) ?? 0) + 1);
      colMap.set(pid, col);
    }
    for (const pid of procIds) if (!colMap.has(pid)) colMap.set(pid, 0);

    // Group by column
    const colGroups = new Map<number, string[]>();
    for (const pid of procIds) {
      const col = colMap.get(pid) ?? 0;
      (colGroups.get(col) ?? colGroups.set(col, []).get(col)!).push(pid);
    }

    function makeCards(pid: string, side: 'input' | 'output'): ResCard[] {
      const cmts = side === 'input'
        ? allCmts.filter(c => c.inputOf === pid)
        : allCmts.filter(c => c.outputOf === pid);
      return cmts.map(c => {
        const isWork = c.action === 'work';
        const specId = c.resourceConformsTo ?? '';
        const qty    = isWork ? (c.effortQuantity?.hasNumericalValue ?? 0)
                              : (c.resourceQuantity?.hasNumericalValue ?? 0);
        const unit   = isWork ? (c.effortQuantity?.hasUnit ?? 'hr')
                              : (c.resourceQuantity?.hasUnit ?? '');
        const onhand = isWork ? 0 : (onhandBySpec[specId] ?? 0);
        const bz     = side === 'output' && !isWork
          ? bufferZones.find(b => b.specId === specId)
          : undefined;
        const fulfillPct = mode === 'observe' && !isWork && qty > 0
          ? Math.min(100, (onhand / qty) * 100) : undefined;
        return {
          specId, specName: specNames[specId] ?? specId,
          action: c.action, qty, unit, isWork,
          providerName: isWork ? c.provider : undefined,
          onhand, fulfillPct, bufferZone: bz, y: 0,
        };
      });
    }

    function slotH(pid: string): number {
      const ni = allCmts.filter(c => c.inputOf === pid).length;
      const no = allCmts.filter(c => c.outputOf === pid).length;
      return Math.max(ni, no, 1) * ROW_H + SLOT_BOT;
    }

    // Column heights for vertical centering
    const colHeights = new Map<number, number>();
    for (const [col, pids] of colGroups)
      colHeights.set(col, pids.reduce((acc, pid, i) => acc + slotH(pid) + (i > 0 ? SLOT_GAP : 0), 0));
    const maxH = Math.max(...colHeights.values(), 1);

    const procMap = new Map(processes.map(p => [p.id, p]));
    const nodes: ProcNode[] = [];

    for (const [col, pids] of colGroups) {
      const colOffset = (maxH - (colHeights.get(col) ?? 0)) / 2;
      const x = ML + col * COL_W + COL_W / 2;
      let slotTop = MT + colOffset;
      for (const pid of pids) {
        const proc    = procMap.get(pid)!;
        const inBase  = makeCards(pid, 'input');
        const outBase = makeCards(pid, 'output');
        const maxRows = Math.max(inBase.length, outBase.length, 1);
        const procY   = slotTop + (maxRows * ROW_H) / 2;
        const inputs  = inBase.map((r, i)  => ({ ...r, y: procY + (i - (inBase.length  - 1) / 2) * ROW_H }));
        const outputs = outBase.map((r, i) => ({ ...r, y: procY + (i - (outBase.length - 1) / 2) * ROW_H }));
        const capBuf  = capacityBuffers.find(cb => cb.processId === pid);
        nodes.push({ proc, col, x, y: procY, inputs, outputs, capBuf });
        slotTop += slotH(pid) + SLOT_GAP;
      }
    }
    return nodes;
  });

  // ── netEdges — bezier arrows between process columns ───────────────────────
  const netEdges = $derived.by(() =>
    rawEdges.flatMap(re => {
      const src = netLayout.find(n => n.proc.id === re.fromId);
      const tgt = netLayout.find(n => n.proc.id === re.toId);
      if (!src || !tgt) return [];
      const outRow = src.outputs.find(r => r.specId === re.specId);
      const inRow  = tgt.inputs.find(r => r.specId === re.specId);
      if (!outRow || !inRow) return [];
      return [{
        specId: re.specId,
        fromX: src.x + IO_X + CARD_W / 2, fromY: outRow.y,
        toX:   tgt.x - IO_X - CARD_W / 2, toY:   inRow.y,
      }];
    })
  );

  // ── SVG dimensions ─────────────────────────────────────────────────────────
  const svgW = $derived(
    netLayout.length === 0 ? 420
      : ML + (Math.max(...netLayout.map(n => n.col)) + 1) * COL_W
          + IO_X + CARD_W / 2 + BUF_W + 20
  );
  const svgH = $derived.by(() => {
    if (netLayout.length === 0) return 80;
    return Math.max(
      MT,
      ...netLayout.flatMap(n => [...n.inputs, ...n.outputs].map(r => r.y + CARD_H / 2)),
      ...netLayout.map(n => n.y + PROC_H / 2 + CAP_GAP + CAP_H),
    ) + 16;
  });

  // ── Helper functions ───────────────────────────────────────────────────────
  const ACTION_COLORS: Record<string, string> = {
    produce: '#38a169', consume: '#e53e3e',
    use: '#4299e1', work: '#9f7aea', cite: '#718096',
  };
  function fulfillColor(pct: number) {
    return pct >= 100 ? '#38a169' : pct >= 50 ? '#d69e2e' : '#e53e3e';
  }
  function trunc(s: string, n: number) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function funSlice(y1f: number, y2f: number): string {
    const hw1 = BUF_W / 2 - y1f * (BUF_W / 2 - BUF_W / 4);
    const hw2 = BUF_W / 2 - y2f * (BUF_W / 2 - BUF_W / 4);
    return `M${-hw1},${y1f * BUF_H} L${hw1},${y1f * BUF_H} L${hw2},${y2f * BUF_H} L${-hw2},${y2f * BUF_H} Z`;
  }
</script>

<div class="net-wrap">
  {#if netLayout.length === 0}
    <p class="empty">No commitments.</p>
  {:else}
    <svg width={svgW} height={svgH} class="net-svg">
      <defs>
        <marker id="snd-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 Z" fill="rgba(226,232,240,0.6)" />
        </marker>
      </defs>

      <!-- Inter-process arrows (behind nodes) -->
      {#each netEdges as e (e.fromX + '-' + e.toX + '-' + e.specId)}
        {@const dx = e.toX - e.fromX}
        <path
          d="M{e.fromX},{e.fromY} C{e.fromX + dx * 0.5},{e.fromY} {e.toX - dx * 0.5},{e.toY} {e.toX},{e.toY}"
          fill="none" stroke="rgba(226,232,240,0.28)" stroke-width="1.5"
          marker-end="url(#snd-arr)"
        />
      {/each}

      {#each netLayout as node (node.proc.id)}
        <!-- Process box -->
        <rect
          x={node.x - PROC_W / 2} y={node.y - PROC_H / 2}
          width={PROC_W} height={PROC_H} rx="4"
          fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"
        />
        <text x={node.x} y={node.y - 6} text-anchor="middle" font-size="9" font-weight="600" fill="#e2e8f0">
          {trunc(node.proc.name, 14)}
        </text>
        <text x={node.x} y={node.y + 10} text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.35)">
          PROCESS
        </text>

        <!-- Status dot / fulfillment ring (top-right of process box) -->
        {#if mode === 'observe'}
          {@const nonWorkOutputs = node.outputs.filter(r => !r.isWork)}
          {@const avgPct = nonWorkOutputs.length === 0 ? 0
            : nonWorkOutputs.reduce((s, r) => s + (r.fulfillPct ?? 0), 0) / nonWorkOutputs.length}
          {@const ringR = 5}
          {@const dotX = node.x + PROC_W / 2 - 7}
          {@const dotY = node.y - PROC_H / 2 + 7}
          {@const circ = 2 * Math.PI * (ringR - 1)}
          <circle cx={dotX} cy={dotY} r={ringR} fill="#1a202c" stroke="rgba(255,255,255,0.1)" stroke-width="0.8" />
          <circle
            cx={dotX} cy={dotY} r={ringR - 1} fill="none"
            stroke={fulfillColor(avgPct)} stroke-width="2"
            stroke-dasharray="{(avgPct / 100) * circ} {circ}"
            stroke-dashoffset={circ / 4}
          />
        {:else}
          <circle
            cx={node.x + PROC_W / 2 - 7} cy={node.y - PROC_H / 2 + 7} r="3.5"
            fill="rgba(226,232,240,0.25)"
          />
        {/if}

        <!-- Capacity bar (below process box) -->
        {#if node.capBuf}
          {@const cb = node.capBuf}
          {@const cbr = capacityBufferStatus(cb.currentLoadHours, cb.totalCapacityHours, cb.greenThreshold ?? 0.80, cb.yellowThreshold ?? 0.95)}
          {@const barX = node.x - PROC_W / 2}
          {@const barY = node.y + PROC_H / 2 + CAP_GAP}
          {@const gt = cb.greenThreshold ?? 0.80}
          {@const yt = cb.yellowThreshold ?? 0.95}
          <rect x={barX}               y={barY} width={PROC_W * gt}        height={CAP_H} rx="1" fill="#276749" opacity="0.75" />
          <rect x={barX + PROC_W * gt} y={barY} width={PROC_W * (yt - gt)} height={CAP_H}        fill="#b7791f" opacity="0.75" />
          <rect x={barX + PROC_W * yt} y={barY} width={PROC_W * (1 - yt)}  height={CAP_H} rx="1" fill="#9b2c2c" opacity="0.75" />
          {@const loadFrac = Math.min(cbr.utilizationPct / 100, 1.10)}
          <line
            x1={barX + PROC_W * loadFrac} y1={barY - 1}
            x2={barX + PROC_W * loadFrac} y2={barY + CAP_H + 1}
            stroke="white" stroke-width="1.5" opacity="0.9"
          />
        {/if}

        <!-- Input cards -->
        {#each node.inputs as row (row.specId + '-' + row.action + '-in')}
          {@const ox    = node.x - IO_X}
          {@const acol  = ACTION_COLORS[row.action] ?? '#718096'}
          {@const cardX = ox - CARD_W / 2}
          {@const cardY = row.y - CARD_H / 2}
          <line
            x1={ox + CARD_W / 2} y1={row.y} x2={node.x - PROC_W / 2} y2={node.y}
            stroke="rgba(226,232,240,0.2)" stroke-width="1" marker-end="url(#snd-arr)"
          />
          <rect
            x={cardX} y={cardY} width={CARD_W} height={CARD_H} rx={CARD_RX}
            fill={row.isWork ? 'rgba(159,122,234,0.12)' : 'rgba(74,85,104,0.25)'}
            stroke={row.isWork ? 'rgba(159,122,234,0.45)' : 'rgba(160,174,192,0.4)'}
            stroke-width="1"
          />
          <text x={ox} y={cardY + 13} text-anchor="middle" font-size="8" font-weight="500" fill="#e2e8f0">
            {trunc(row.specName, 14)}
          </text>
          <text x={ox} y={cardY + 25} text-anchor="middle" font-size="7.5" fill={acol}>
            {row.action}
          </text>
          {#if row.isWork && row.providerName}
            <text x={ox} y={cardY + 37} text-anchor="middle" font-size="6.5" fill="rgba(159,122,234,0.7)">
              {trunc(row.providerName, 14)}
            </text>
            <text x={ox} y={cardY + 44} text-anchor="middle" font-size="6.5" fill="rgba(226,232,240,0.4)">
              {row.qty} {row.unit}
            </text>
          {:else}
            <text x={ox} y={cardY + 37} text-anchor="middle" font-size="7" fill="rgba(226,232,240,0.4)">
              {row.qty} {row.unit}
            </text>
          {/if}
        {/each}

        <!-- Output cards + buffer funnels -->
        {#each node.outputs as row (row.specId + '-' + row.action + '-out')}
          {@const ox    = node.x + IO_X}
          {@const bz    = row.bufferZone}
          {@const acol  = ACTION_COLORS[row.action] ?? '#718096'}
          {@const cardX = ox - CARD_W / 2}
          {@const cardY = row.y - CARD_H / 2}
          <line
            x1={node.x + PROC_W / 2} y1={node.y} x2={ox - CARD_W / 2} y2={row.y}
            stroke="rgba(226,232,240,0.2)" stroke-width="1" marker-end="url(#snd-arr)"
          />
          <rect
            x={cardX} y={cardY} width={CARD_W} height={CARD_H} rx={CARD_RX}
            fill="rgba(49,130,206,0.12)"
            stroke={bz ? 'rgba(214,158,46,0.55)' : 'rgba(49,130,206,0.6)'}
            stroke-width={bz ? 1.5 : 1}
          />
          <text x={ox} y={cardY + 13} text-anchor="middle" font-size="8" font-weight="500" fill="#e2e8f0">
            {trunc(row.specName, 14)}
          </text>
          <text x={ox} y={cardY + 25} text-anchor="middle" font-size="7.5" fill={acol}>
            {row.action}
          </text>
          {#if mode === 'observe' && row.fulfillPct !== undefined}
            <text x={ox} y={cardY + 36} text-anchor="middle" font-size="6.5" fill="rgba(226,232,240,0.3)">
              plan {row.qty} {row.unit}
            </text>
            <text x={ox} y={cardY + 43} text-anchor="middle" font-size="7" fill={fulfillColor(row.fulfillPct)}>
              OH {row.onhand} {row.unit}
            </text>
            {@const barW = (row.fulfillPct / 100) * (CARD_W - 6)}
            <rect
              x={cardX + 3} y={cardY + CARD_H - 4}
              width={Math.max(0, barW)} height={3} rx="1"
              fill={fulfillColor(row.fulfillPct)} opacity="0.9"
            />
          {:else}
            <text x={ox} y={cardY + 37} text-anchor="middle" font-size="7" fill="rgba(226,232,240,0.4)">
              {row.qty} {row.unit}
            </text>
          {/if}

          <!-- Buffer funnel (right of output card) -->
          {#if bz}
            {@const fx = ox + CARD_W / 2 + BUF_W / 2 + 6}
            {@const fy = row.y}
            {@const onhandFrac = Math.min(row.onhand / bz.tog, 1.0)}
            {@const hw = (BUF_W / 2) * (1 - onhandFrac / 2)}
            <g transform="translate({fx},{fy - BUF_H / 2})">
              <path d={funSlice(bz.tor / bz.tog, 1)}              fill="rgba(197,48,48,0.5)" />
              <path d={funSlice(bz.toy / bz.tog, bz.tor / bz.tog)} fill="rgba(214,158,46,0.5)" />
              <path d={funSlice(0, bz.toy / bz.tog)}               fill="rgba(56,161,105,0.5)" />
              <line
                x1={-hw} y1={BUF_H * (1 - onhandFrac)}
                x2={hw}  y2={BUF_H * (1 - onhandFrac)}
                stroke="white" stroke-width="1.5"
              />
            </g>
          {/if}
        {/each}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .net-wrap {
    overflow-x: auto;
    overflow-y: hidden;
  }

  .net-svg {
    display: block;
    font-family: var(--font-mono);
  }

  .empty {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.55;
    margin: 0;
  }
</style>
