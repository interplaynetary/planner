<script lang="ts">
  import type { Process, ProcessSpecification, BufferZone, DemandAdjustmentFactor } from '$lib/schemas';
  import { ACTION_DEFINITIONS } from '$lib/schemas';
  import {
    processSpecs, processList, commitmentList, eventList,
    resourceList, bufferZoneList, resourceSpecs, capacityBufferList,
    locationList, agentList,
  } from '$lib/vf-stores.svelte';
  import { capacityBufferStatus } from '$lib/algorithms/ddmrp';
  import { showTip, hideTip, moveTip } from '$lib/tooltip.svelte';
  import EntityPanel from '$lib/components/shared/EntityPanel.svelte';
  import type { EntityType } from '$lib/vf-descriptors';
  import type { FlowSelectCtx } from './observe-types';

  // ── Layout constants ──────────────────────────────────────────────────────
  const ML       = 30;    // left margin
  const MT       = 16;    // top margin
  const MB       = 56;    // bottom margin (legend)
  const COL_W    = 420;   // column center-to-center
  const PROC_W   = 108;
  const PROC_H   = 44;
  const CARD_W   = 114;   // resource card width
  const CARD_H   = 46;    // resource card height
  const CARD_RX  = 4;     // card border radius
  const RES_GAP  = 12;    // gap: process box edge → card center
  const ROW_H    = 52;    // vertical spacing between resource rows
  const SLOT_BOT = 16;    // padding below last resource row in slot
  const SLOT_GAP = 14;    // gap between stacked slots in same column
  const BUF_W    = 16;    // buffer funnel width
  const BUF_H    = 22;    // buffer funnel height
  const CAP_H    = 5;     // capacity bar height in px
  const CAP_GAP  = 3;     // gap from process box bottom to bar top

  /** Distance from process center-X to resource card center-X */
  const IO_X = PROC_W / 2 + RES_GAP + CARD_W / 2; // 54 + 12 + 57 = 123

  // ── Distribution layout constants ─────────────────────────────────────────
  const DN_SEC_GAP = 36;   // gap from mfg content bottom to section header
  const DN_HDR_H   = 22;   // section header row height
  const DN_NODE_W  = 136;  // distribution node width
  const DN_NODE_H  = 56;   // distribution node height
  const DN_COL_W   = 210;  // tier column center-to-center
  const DN_ROW_H   = 80;   // row height within a tier
  const DN_BUF_GAP = 8;    // gap from node right edge to first funnel

  const ACTION_COLORS: Record<string, string> = {
    produce: '#38a169',
    consume: '#e53e3e',
    use:     '#4299e1',
    work:    '#9f7aea',
    cite:    '#718096',
  };

  function fulfillColor(pct: number): string {
    if (pct >= 100) return '#38a169';
    if (pct >= 50)  return '#d69e2e';
    return '#e53e3e';
  }

  function handleFlowClick(node: ProcNode, row: ResRow, isInput: boolean) {
    if (mode !== 'observe') return;
    const commitment = row.commitmentId
      ? commitmentList.find(c => c.id === row.commitmentId)
      : undefined;
    const existingEvents = eventList.filter(e =>
      (isInput ? e.inputOf === node.proc.id : e.outputOf === node.proc.id) &&
      e.resourceConformsTo === row.specId
    );
    onflowselect?.({
      processId: node.proc.id, procName: node.proc.name,
      specId: row.specId, specName: row.specName, action: row.action,
      isInput, commitmentId: row.commitmentId, commitment,
      existingEvents, fulfilledQty: row.fulfilledQty ?? 0,
      plannedQty: row.plannedQty ?? 0, unit: row.unit,
    });
  }

  // ── Types ─────────────────────────────────────────────────────────────────
  interface ResRow {
    specId:          string;
    specName:        string;
    action:          string;
    qty:             string;
    onhand:          number;
    unit:            string;
    bufferZone?:     BufferZone;
    y:               number;
    // observe mode fields (optional, zero overhead in plan mode)
    commitmentId?:   string;
    fulfilledQty?:   number;
    plannedQty?:     number;
    fulfillmentPct?: number;
    eventCount?:     number;
  }

  interface ProcNode {
    proc:      Process;
    procSpec?: ProcessSpecification;
    col:       number;
    x:         number;
    y:         number;
    inputs:    ResRow[];
    outputs:   ResRow[];
  }

  interface NetEdge {
    fromProcId:       string;
    toProcId:         string;
    specId:           string;
    specName:         string;
    fromX:            number;
    fromY:            number;
    toX:              number;
    toY:              number;
    hasEvent:         boolean;
    action:           string;
    onhandEffect:     string;
    accountingEffect: string;
  }

  // ── Step 1: raw edge list (proc-to-proc via shared spec) ──────────────────
  const rawEdges = $derived.by(() => {
    type RE = {
      fromId: string; toId: string; specId: string; hasEvent: boolean;
      action: string; onhandEffect: string; accountingEffect: string;
    };
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
        const def = ACTION_DEFINITIONS[c1.action as keyof typeof ACTION_DEFINITIONS];
        result.push({
          fromId: c1.outputOf, toId: c2.inputOf, specId: c1.resourceConformsTo, hasEvent,
          action:           c1.action,
          onhandEffect:     def?.onhandEffect     ?? 'noEffect',
          accountingEffect: def?.accountingEffect ?? 'noEffect',
        });
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
        const bz     = side === 'output' ? bufferZoneList.find(b => b.specId === specId) : undefined;
        // Aggregate all matching resources; filter by location when bz has one
        const pool = bz?.atLocation
          ? resourceList.filter(r => r.conformsTo === specId && r.currentLocation === bz.atLocation)
          : resourceList.filter(r => r.conformsTo === specId);
        const onhand = pool.reduce((s, r) => s + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
        const unit   = pool[0]?.onhandQuantity?.hasUnit ?? spec?.defaultUnitOfResource ?? '';

        // Observe mode: compute fulfillment from eventList (reactive, covers user-created events too)
        let commitmentId: string | undefined;
        let fulfilledQty: number | undefined;
        let plannedQty: number | undefined;
        let fulfillmentPct: number | undefined;
        let eventCount: number | undefined;
        if (mode === 'observe') {
          const fillingEvents = eventList.filter(e => e.fulfills === c.id);
          fulfilledQty  = fillingEvents.reduce((s, e) => s + (e.resourceQuantity?.hasNumericalValue ?? 0), 0);
          plannedQty    = c.resourceQuantity?.hasNumericalValue ?? 0;
          fulfillmentPct = plannedQty > 0 ? Math.min(100, fulfilledQty / plannedQty * 100) : 0;
          commitmentId  = c.id;
          eventCount    = fillingEvents.length;
        }

        return {
          specId,
          specName:   spec?.name ?? specId.slice(0, 8),
          action:     c.action,
          qty:        c.resourceQuantity ? `${c.resourceQuantity.hasNumericalValue} ${c.resourceQuantity.hasUnit}` : '',
          onhand,
          unit,
          bufferZone: bz,
          commitmentId,
          fulfilledQty,
          plannedQty,
          fulfillmentPct,
          eventCount,
        };
      });
    }

    function slotH(pid: string): number {
      const ni = commitmentList.filter(c => c.inputOf  === pid && c.resourceConformsTo).length;
      const no = commitmentList.filter(c => c.outputOf === pid && c.resourceConformsTo).length;
      return Math.max(ni, no, 1) * ROW_H + SLOT_BOT;
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
        const procY     = slotTop + (maxRows * ROW_H) / 2;

        const inputs: ResRow[]  = inBase.map((r, i) => ({
          ...r, y: procY + (i - (inBase.length  - 1) / 2) * ROW_H,
        }));
        const outputs: ResRow[] = outBase.map((r, i) => ({
          ...r, y: procY + (i - (outBase.length - 1) / 2) * ROW_H,
        }));

        nodes.push({ proc, procSpec, col, x, y: procY, inputs, outputs });
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
        fromProcId:       re.fromId,
        toProcId:         re.toId,
        specId:           re.specId,
        specName:         outRow.specName,
        fromX:            src.x + IO_X + CARD_W / 2,
        fromY:            outRow.y,
        toX:              tgt.x - IO_X - CARD_W / 2,
        toY:              inRow.y,
        hasEvent:         re.hasEvent,
        action:           re.action,
        onhandEffect:     re.onhandEffect,
        accountingEffect: re.accountingEffect,
      }];
    });
  });

  // ── Distribution network types & layout ───────────────────────────────────
  interface DistZone { bz: BufferZone; specName: string; onhand: number; unit: string; }
  interface DistNodeLayout {
    locationId:   string;
    locationName: string;
    agentName?:   string;
    role:         'sourcingUnit' | 'hub' | 'regional';
    tier:         number;
    x:            number;
    y:            number;
    zones:        DistZone[];
  }
  interface DistEdgeLayout {
    fromId:       string;
    toId:         string;
    fromX:        number;
    fromY:        number;
    toX:          number;
    toY:          number;
    transitDays?: number;
  }

  // Height of manufacturing content (0 when no processes)
  const mfgContentH = $derived(
    netLayout.length === 0 ? 0
      : Math.max(
          MT,
          ...netLayout.flatMap(n => [...n.inputs, ...n.outputs].map(r => r.y + CARD_H / 2)),
          ...netLayout.map(n => n.y + PROC_H / 2 + CAP_GAP + CAP_H),
        )
  );

  // Y of the "DISTRIBUTION NETWORK" section header
  const distSectionY = $derived(mfgContentH > 0 ? mfgContentH + DN_SEC_GAP : MT);

  const distNetLayout = $derived.by((): { nodes: DistNodeLayout[]; edges: DistEdgeLayout[]; totalH: number } => {
    // Distribution BZs = those with upstreamLocationId set
    const distBzs = bufferZoneList.filter(bz => bz.upstreamLocationId);
    if (distBzs.length === 0) return { nodes: [], edges: [], totalH: 0 };

    // Collect all unique location IDs (both ends of each routing edge)
    const allLocIds = new Set<string>();
    for (const bz of distBzs) {
      if (bz.atLocation) allLocIds.add(bz.atLocation);
      allLocIds.add(bz.upstreamLocationId!);
    }

    const atLocationSet  = new Set(distBzs.map(bz => bz.atLocation).filter(Boolean) as string[]);
    const upstreamLocSet = new Set(distBzs.map(bz => bz.upstreamLocationId!));

    function getRole(locId: string): 'sourcingUnit' | 'hub' | 'regional' {
      const isAtLoc    = atLocationSet.has(locId);
      const isUpstream = upstreamLocSet.has(locId);
      if (!isAtLoc && isUpstream) return 'sourcingUnit';
      if (isAtLoc  && isUpstream) return 'hub';
      return 'regional';
    }

    // Build deduplicated location-to-location edges
    const edgeSet = new Set<string>();
    const rawEdges: { fromLocId: string; toLocId: string; transitDays: number }[] = [];
    for (const bz of distBzs) {
      if (!bz.atLocation || !bz.upstreamLocationId) continue;
      const key = `${bz.upstreamLocationId}→${bz.atLocation}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        rawEdges.push({ fromLocId: bz.upstreamLocationId, toLocId: bz.atLocation, transitDays: bz.dltDays });
      }
    }

    // BFS tier assignment from roots (locations that are never a downstream atLocation)
    const inDegree = new Map<string, number>();
    for (const locId of allLocIds) inDegree.set(locId, 0);
    const adj = new Map<string, string[]>();
    for (const locId of allLocIds) adj.set(locId, []);
    for (const e of rawEdges) {
      inDegree.set(e.toLocId, (inDegree.get(e.toLocId) ?? 0) + 1);
      adj.get(e.fromLocId)?.push(e.toLocId);
    }
    const tierMap = new Map<string, number>();
    const queue: { locId: string; t: number }[] = [];
    for (const [locId, deg] of inDegree) if (deg === 0) queue.push({ locId, t: 0 });
    const vis = new Set<string>();
    while (queue.length) {
      const { locId, t } = queue.shift()!;
      if (vis.has(locId)) continue;
      vis.add(locId); tierMap.set(locId, t);
      for (const next of adj.get(locId) ?? []) if (!vis.has(next)) queue.push({ locId: next, t: t + 1 });
    }
    for (const locId of allLocIds) if (!tierMap.has(locId)) tierMap.set(locId, 0);

    // Group by tier
    const tierGroups = new Map<number, string[]>();
    for (const locId of allLocIds) {
      const t = tierMap.get(locId) ?? 0;
      if (!tierGroups.has(t)) tierGroups.set(t, []);
      tierGroups.get(t)!.push(locId);
    }

    const maxInTier = Math.max(...[...tierGroups.values()].map(g => g.length), 1);
    const secH = maxInTier * DN_ROW_H;
    const baseY = distSectionY + DN_HDR_H;

    // Node positions
    const nodeMap = new Map<string, DistNodeLayout>();
    for (const [t, locIds] of tierGroups) {
      const cx = ML + t * DN_COL_W + DN_NODE_W / 2;
      for (let i = 0; i < locIds.length; i++) {
        const locId = locIds[i];
        const cy    = baseY + secH / 2 + (i - (locIds.length - 1) / 2) * DN_ROW_H;
        const loc   = locationList.find(l => l.id === locId);
        const warehouseRes = resourceList.find(r => r.currentLocation === locId);
        const agentName    = warehouseRes?.primaryAccountable
          ? agentList.find(a => a.id === warehouseRes.primaryAccountable)?.name
          : undefined;
        const zones: DistZone[] = bufferZoneList
          .filter(bz => bz.atLocation === locId)
          .map(bz => {
            const spec = resourceSpecs.find(s => s.id === bz.specId);
            const pool = resourceList.filter(r => r.conformsTo === bz.specId && r.currentLocation === locId);
            const onhand = pool.reduce((s, r) => s + (r.onhandQuantity?.hasNumericalValue ?? 0), 0);
            return {
              bz,
              specName: spec?.name ?? bz.specId,
              onhand,
              unit:     pool[0]?.onhandQuantity?.hasUnit ?? spec?.defaultUnitOfResource ?? '',
            };
          });
        nodeMap.set(locId, {
          locationId: locId, locationName: loc?.name ?? locId,
          agentName, role: getRole(locId), tier: t, x: cx, y: cy, zones,
        });
      }
    }

    // Edges with coordinates
    const edges: DistEdgeLayout[] = rawEdges.flatMap(re => {
      const src = nodeMap.get(re.fromLocId);
      const tgt = nodeMap.get(re.toLocId);
      if (!src || !tgt) return [];
      return [{ fromId: re.fromLocId, toId: re.toLocId,
        fromX: src.x + DN_NODE_W / 2, fromY: src.y,
        toX: tgt.x - DN_NODE_W / 2,   toY: tgt.y,
        transitDays: re.transitDays }];
    });

    return { nodes: [...nodeMap.values()], edges, totalH: secH };
  });

  // ── SVG dimensions ─────────────────────────────────────────────────────────
  const svgW = $derived(
    netLayout.length === 0 ? 420
      : ML + (Math.max(...netLayout.map(n => n.col)) + 1) * COL_W
        + IO_X + CARD_W / 2 + BUF_W + 28
  );
  const distContentH = $derived(
    distNetLayout.nodes.length === 0 ? 0 : distSectionY + DN_HDR_H + distNetLayout.totalH
  );
  const svgH = $derived(
    processList.length === 0 && distNetLayout.nodes.length === 0 ? 120
      : (distContentH > 0 ? distContentH : mfgContentH) + MB
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

  function fmtTransit(days: number): string {
    return days < 1 ? `${(days * 24).toFixed(0)}h` : `${days.toFixed(1)}d`;
  }

  function distNodeLines(n: DistNodeLayout): string[] {
    const lines: string[] = [n.locationName];
    if (n.agentName) lines.push(`Operator: ${n.agentName}`);
    lines.push(`Role: ${n.role}`);
    for (const { specName, bz, onhand, unit } of n.zones) {
      lines.push(`── ${specName}`);
      lines.push(`TOR ${bz.tor.toFixed(2)} · TOY ${bz.toy.toFixed(2)} · TOG ${bz.tog.toFixed(2)}`);
      const status = onhand <= bz.tor ? 'RED' : onhand <= bz.toy ? 'YELLOW' : 'GREEN';
      lines.push(`On-hand: ${onhand} ${unit}  [${status}]`);
    }
    return lines;
  }

  // ── External props ─────────────────────────────────────────────────────────
  interface Props {
    /** Called when a buffer funnel is clicked. Passes the BufferZone.id. */
    onbufferselect?: (bzId: string) => void;
    /** Highlights the funnel matching this BufferZone.id. */
    selectedBzId?: string;
    /** All DemandAdjustmentFactor records — used to badge active-adjustment funnels. */
    adjustments?: DemandAdjustmentFactor[];
    /** Diagram mode: 'plan' (default) or 'observe' (shows fulfillment, clickable cards). */
    mode?: 'plan' | 'observe';
    /** Called when a resource card is clicked in observe mode. */
    onflowselect?: (ctx: FlowSelectCtx) => void;
    /** Highlights the card matching this context. */
    selectedFlow?: FlowSelectCtx | null;
  }
  let { onbufferselect, selectedBzId, adjustments = [], mode = 'plan', onflowselect, selectedFlow }: Props = $props();

  const _todayStr = new Date().toISOString().slice(0, 10);

  function isFactorActive(f: DemandAdjustmentFactor): boolean {
    return f.validFrom <= _todayStr && f.validTo >= _todayStr;
  }

  /** Returns active factors for a given specId, or empty array. */
  function activeForSpec(specId: string): DemandAdjustmentFactor[] {
    return adjustments.filter(f => f.specId === specId && isFactorActive(f));
  }

  /** Badge color: demand (orange) takes precedence; zone=teal; leadTime=blue. */
  function badgeColor(factors: DemandAdjustmentFactor[]): string {
    if (factors.some(f => f.type === 'demand'))   return '#ed8936';
    if (factors.some(f => f.type === 'zone'))     return '#4fd1c5';
    return '#4299e1';
  }

  /** Badge label: show what's active. */
  function badgeLabel(factors: DemandAdjustmentFactor[]): string {
    if (factors.some(f => f.type === 'demand'))   return '×DAF';
    if (factors.some(f => f.type === 'zone'))     return '×ZAF';
    return '×LTAF';
  }

  // ── Selection state ────────────────────────────────────────────────────────
  let selected = $state<{ type: EntityType; id: string } | null>(null);

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
</script>

{#if processList.length === 0 && distNetLayout.nodes.length === 0}
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
        {#if mode === 'observe'}
          {@const eCnt = eventList.filter(ev =>
            ev.outputOf === e.fromProcId && ev.resourceConformsTo === e.specId).length}
          <circle cx={mx} cy={my} r="5.5" fill="#1a202c" stroke="#38a169" stroke-width="1.2" />
          <text x={mx} y={my + 3.5} text-anchor="middle" font-size="6.5" font-weight="700"
            fill="#38a169" style="pointer-events:none">{eCnt}</text>
        {:else}
          <circle cx={mx} cy={my} r="3.5" fill="#38a169" stroke="rgba(226,232,240,0.5)" stroke-width="0.8" />
        {/if}
      {/if}
    {/each}

    <!-- ── Nodes ─────────────────────────────────────────────────────────── -->
    {#each netLayout as node (node.proc.id)}
      {@const ps = node.procSpec}

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
        {@const isSelected = selected?.id === ps.id}
        <text
          x={node.x}
          y={node.y + 9}
          text-anchor="middle"
          font-size="7.5"
          fill={isSelected ? '#90cdf4' : 'rgba(226,232,240,0.4)'}
          style="pointer-events:{ps?.id ? 'auto' : 'none'}; cursor:{ps?.id ? 'pointer' : 'default'};"
          role="button"
          tabindex="0"
          onclick={() => { if (ps?.id) selected = { type: 'processSpec', id: ps.id }; }}
          onkeydown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ps?.id) selected = { type: 'processSpec', id: ps.id }; }}
        >{trunc(ps.name, 18)}</text>
        {#if isSelected}
          <line
            x1={node.x - trunc(ps.name, 18).length * 2.4}
            y1={node.y + 10.5}
            x2={node.x + trunc(ps.name, 18).length * 2.4}
            y2={node.y + 10.5}
            stroke="#90cdf4"
            stroke-width="0.6"
            style="pointer-events:none"
          />
        {/if}
      {/if}

      <!-- Status dot (top-right corner of process box) -->
      {@const proc = node.proc as any}
      {@const statusColor = proc.finished ? '#38a169' : proc.hasBeginning ? '#d69e2e' : 'rgba(226,232,240,0.25)'}
      <circle
        cx={node.x + PROC_W / 2 - 7}
        cy={node.y - PROC_H / 2 + 7}
        r="3.5"
        fill={statusColor}
        style="pointer-events:none"
      />

      <!-- Observe mode: fulfillment ring overlay on status dot -->
      {#if mode === 'observe'}
        {@const avgPct = node.outputs.length === 0 ? 0
          : node.outputs.reduce((s, r) => s + (r.fulfillmentPct ?? 0), 0) / node.outputs.length}
        {@const ringR = 5}
        {@const dotX = node.x + PROC_W / 2 - 7}
        {@const dotY = node.y - PROC_H / 2 + 7}
        <circle cx={dotX} cy={dotY} r={ringR} fill="#1a202c"
          stroke="rgba(255,255,255,0.1)" stroke-width="0.8" style="pointer-events:none" />
        <circle cx={dotX} cy={dotY} r={ringR - 1} fill="none"
          stroke={fulfillColor(avgPct)} stroke-width="2"
          stroke-dasharray="{(avgPct / 100) * (2 * Math.PI * (ringR - 1))} {2 * Math.PI * (ringR - 1)}"
          stroke-dashoffset={(2 * Math.PI * (ringR - 1)) / 4}
          style="pointer-events:none" />
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

      <!-- Capacity utilisation bar (below process box) -->
      {@const capBuf = capacityBufferList.find(cb => cb.processSpecId === ps?.id)}
      {#if capBuf}
        {@const cbr    = capacityBufferStatus(
          capBuf.currentLoadHours, capBuf.totalCapacityHours,
          capBuf.greenThreshold ?? 0.80, capBuf.yellowThreshold ?? 0.95)}
        {@const barX   = node.x - PROC_W / 2}
        {@const barY   = node.y + PROC_H / 2 + CAP_GAP}
        {@const gt     = capBuf.greenThreshold  ?? 0.80}
        {@const yt     = capBuf.yellowThreshold ?? 0.95}
        <!-- Zone background segments: green | yellow | red -->
        <rect x={barX}                   y={barY} width={PROC_W * gt}        height={CAP_H} rx="1" fill="#276749" opacity="0.75" style="pointer-events:none" />
        <rect x={barX + PROC_W * gt}     y={barY} width={PROC_W * (yt - gt)} height={CAP_H}        fill="#b7791f" opacity="0.75" style="pointer-events:none" />
        <rect x={barX + PROC_W * yt}     y={barY} width={PROC_W * (1 - yt)}  height={CAP_H} rx="1" fill="#9b2c2c" opacity="0.75" style="pointer-events:none" />
        <!-- Current load cursor (clamped to 110% max) -->
        {@const loadFrac = Math.min(cbr.utilizationPct / 100, 1.10)}
        <line
          x1={barX + PROC_W * loadFrac} y1={barY - 1}
          x2={barX + PROC_W * loadFrac} y2={barY + CAP_H + 1}
          stroke="white" stroke-width="1.5" opacity="0.9"
          style="pointer-events:none"
        />
        <!-- Invisible hit area for tooltip -->
        <rect
          x={barX} y={barY} width={PROC_W} height={CAP_H}
          fill="transparent"
          role="img"
          onmouseenter={(ev) => showTip(ev, [
            `Capacity (${ps?.name ?? ''})`,
            `Load: ${capBuf.currentLoadHours}h / ${capBuf.totalCapacityHours}h per ${capBuf.periodDays}d`,
            `Utilisation: ${cbr.utilizationPct.toFixed(0)}%  [${cbr.zone.toUpperCase()}]`,
          ])}
          onmouseleave={hideTip}
          onmousemove={moveTip}
        />
      {/if}

      <!-- ── Input resource cards (left of process) ──────────────────────── -->
      {#each node.inputs as row (row.specId + 'in')}
        {@const ox    = node.x - IO_X}
        {@const acol  = ACTION_COLORS[row.action] ?? '#718096'}
        {@const cardX = ox - CARD_W / 2}
        {@const cardY = row.y - CARD_H / 2}
        <!-- Connector arrow: input card right edge → process box left edge -->
        <line
          x1={ox + CARD_W / 2}
          y1={row.y}
          x2={node.x - PROC_W / 2}
          y2={node.y}
          stroke="rgba(226,232,240,0.2)"
          stroke-width="1"
          marker-end="url(#nd-arr)"
          style="pointer-events:none"
        />
        <!-- Input card -->
        <rect
          x={cardX}
          y={cardY}
          width={CARD_W}
          height={CARD_H}
          rx={CARD_RX}
          fill="rgba(74,85,104,0.25)"
          stroke="rgba(160,174,192,0.4)"
          stroke-width="1"
          style={mode === 'observe' ? 'cursor:pointer' : 'cursor:default'}
          role="img"
          onmouseenter={(ev) => showTip(ev, resLines(row, 'input'))}
          onmouseleave={hideTip}
          onmousemove={moveTip}
          onclick={() => handleFlowClick(node, row, true)}
        />
        <!-- Observe mode: selected highlight overlay -->
        {#if mode === 'observe' && selectedFlow?.processId === node.proc.id
            && selectedFlow?.specId === row.specId && selectedFlow?.isInput}
          <rect x={cardX - 1} y={cardY - 1} width={CARD_W + 2} height={CARD_H + 2}
            rx={CARD_RX + 1} fill="none" stroke="#f6ad55" stroke-width="1.5"
            style="pointer-events:none" />
        {/if}
        <!-- specName -->
        {@const inSelected = selected?.id === row.specId}
        <text
          x={ox}
          y={cardY + 13}
          text-anchor="middle"
          font-size="8"
          font-weight="500"
          fill={inSelected ? '#90cdf4' : '#e2e8f0'}
          style="cursor:pointer; pointer-events:auto;"
          role="button"
          tabindex="0"
          onclick={() => { selected = { type: 'resourceSpec', id: row.specId }; }}
          onkeydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') selected = { type: 'resourceSpec', id: row.specId }; }}
        >{trunc(row.specName, 15)}</text>
        {#if inSelected}
          <line
            x1={ox - trunc(row.specName, 15).length * 2.6}
            y1={cardY + 14.5}
            x2={ox + trunc(row.specName, 15).length * 2.6}
            y2={cardY + 14.5}
            stroke="#90cdf4"
            stroke-width="0.6"
            style="pointer-events:none"
          />
        {/if}
        <!-- action -->
        <text
          x={ox}
          y={cardY + 25}
          text-anchor="middle"
          font-size="7.5"
          fill={acol}
          style="pointer-events:none"
        >{row.action}</text>
        <!-- qty / onhand (input card) -->
        {#if mode === 'observe' && row.plannedQty != null}
          <text x={ox} y={cardY + 34} text-anchor="middle" font-size="6.5"
            fill="rgba(226,232,240,0.3)" style="pointer-events:none"
          >plan {row.qty}</text>
          <text x={ox} y={cardY + 42} text-anchor="middle" font-size="7"
            fill={fulfillColor(row.fulfillmentPct ?? 0)} style="pointer-events:none"
          >act {(row.fulfilledQty ?? 0).toFixed(1)} {row.unit}</text>
          {@const barW = ((row.fulfillmentPct ?? 0) / 100) * (CARD_W - 6)}
          <rect x={cardX + 3} y={cardY + CARD_H - 4} width={Math.max(0, barW)} height={3}
            rx="1" fill={fulfillColor(row.fulfillmentPct ?? 0)} opacity="0.9"
            style="pointer-events:none" />
        {:else if row.qty || row.onhand > 0}
          <text x={ox} y={cardY + 37} text-anchor="middle" font-size="7"
            fill="rgba(226,232,240,0.4)" style="pointer-events:none"
          >{row.qty}{row.onhand > 0 ? ` OH:${row.onhand}` : ''}</text>
        {/if}
      {/each}

      <!-- ── Output resource cards + buffer funnels (right of process) ───── -->
      {#each node.outputs as row (row.specId + 'out')}
        {@const ox    = node.x + IO_X}
        {@const bz    = row.bufferZone}
        {@const acol  = ACTION_COLORS[row.action] ?? '#718096'}
        {@const cardX = ox - CARD_W / 2}
        {@const cardY = row.y - CARD_H / 2}
        {@const tor   = bz?.tor ?? 1}
        {@const toy   = bz?.toy ?? 2}
        {@const tog   = bz?.tog ?? 3}
        <!-- Connector arrow: process box right edge → output card left edge -->
        <line
          x1={node.x + PROC_W / 2}
          y1={node.y}
          x2={ox - CARD_W / 2}
          y2={row.y}
          stroke="rgba(226,232,240,0.2)"
          stroke-width="1"
          marker-end="url(#nd-arr)"
          style="pointer-events:none"
        />
        <!-- Output card -->
        <rect
          x={cardX}
          y={cardY}
          width={CARD_W}
          height={CARD_H}
          rx={CARD_RX}
          fill="rgba(49,130,206,0.12)"
          stroke={bz ? procStroke(ps) : 'rgba(49,130,206,0.6)'}
          stroke-width={bz ? '1.5' : '1'}
          style={mode === 'observe' ? 'cursor:pointer' : 'cursor:default'}
          role="img"
          onmouseenter={(ev) => showTip(ev, resLines(row, 'output'))}
          onmouseleave={hideTip}
          onmousemove={moveTip}
          onclick={() => handleFlowClick(node, row, false)}
        />
        <!-- Observe mode: selected highlight overlay -->
        {#if mode === 'observe' && selectedFlow?.processId === node.proc.id
            && selectedFlow?.specId === row.specId && selectedFlow?.isInput === false}
          <rect x={cardX - 1} y={cardY - 1} width={CARD_W + 2} height={CARD_H + 2}
            rx={CARD_RX + 1} fill="none" stroke="#f6ad55" stroke-width="1.5"
            style="pointer-events:none" />
        {/if}
        <!-- specName -->
        {@const outSelected = selected?.id === row.specId}
        <text
          x={ox}
          y={cardY + 13}
          text-anchor="middle"
          font-size="8"
          font-weight="500"
          fill={outSelected ? '#90cdf4' : '#e2e8f0'}
          style="cursor:pointer; pointer-events:auto;"
          role="button"
          tabindex="0"
          onclick={() => { selected = { type: 'resourceSpec', id: row.specId }; }}
          onkeydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') selected = { type: 'resourceSpec', id: row.specId }; }}
        >{trunc(row.specName, 15)}</text>
        {#if outSelected}
          <line
            x1={ox - trunc(row.specName, 15).length * 2.6}
            y1={cardY + 14.5}
            x2={ox + trunc(row.specName, 15).length * 2.6}
            y2={cardY + 14.5}
            stroke="#90cdf4"
            stroke-width="0.6"
            style="pointer-events:none"
          />
        {/if}
        <!-- action -->
        <text
          x={ox}
          y={cardY + 25}
          text-anchor="middle"
          font-size="7.5"
          fill={acol}
          style="pointer-events:none"
        >{row.action}</text>
        <!-- qty / onhand (output card) -->
        {#if mode === 'observe' && row.plannedQty != null}
          <text x={ox} y={cardY + 34} text-anchor="middle" font-size="6.5"
            fill="rgba(226,232,240,0.3)" style="pointer-events:none"
          >plan {row.qty}</text>
          <text x={ox} y={cardY + 42} text-anchor="middle" font-size="7"
            fill={fulfillColor(row.fulfillmentPct ?? 0)} style="pointer-events:none"
          >act {(row.fulfilledQty ?? 0).toFixed(1)} {row.unit}</text>
          {@const barW = ((row.fulfillmentPct ?? 0) / 100) * (CARD_W - 6)}
          <rect x={cardX + 3} y={cardY + CARD_H - 4} width={Math.max(0, barW)} height={3}
            rx="1" fill={fulfillColor(row.fulfillmentPct ?? 0)} opacity="0.9"
            style="pointer-events:none" />
        {:else if row.qty || row.onhand > 0}
          <text x={ox} y={cardY + 37} text-anchor="middle" font-size="7"
            fill="rgba(226,232,240,0.4)" style="pointer-events:none"
          >{row.qty}{row.onhand > 0 ? ` OH:${row.onhand}` : ''}</text>
        {/if}

        <!-- Buffer zone funnel (right of output card, when buffer exists) -->
        {#if bz}
          {@const gF     = 1 - toy / tog}
          {@const yF     = 1 - tor / tog}
          {@const fx     = ox + CARD_W / 2 + 5}
          {@const fy     = row.y - BUF_H / 2}
          {@const curF   = 1 - Math.min(Math.max(row.onhand / tog, 0), 1)}
          {@const curHW  = BUF_W / 2 - curF * BUF_W / 4}
          {@const active = activeForSpec(bz.specId)}
          <g
            transform="translate({fx + BUF_W / 2},{fy})"
            style="cursor:pointer"
            role="button"
            tabindex="0"
            onmouseenter={(ev) => showTip(ev, resLines(row, 'output'))}
            onmouseleave={hideTip}
            onmousemove={moveTip}
            onclick={() => { onbufferselect?.(bz.id); }}
            onkeydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') onbufferselect?.(bz.id); }}
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
            {#if bz.id === selectedBzId}
              <rect
                x={-BUF_W / 2 - 3} y={-3}
                width={BUF_W + 6} height={BUF_H + 6}
                rx="2" fill="none"
                stroke="#90cdf4" stroke-width="1.5"
                style="pointer-events:none"
              />
            {/if}
            <!-- Active adjustment badge (top-right corner) -->
            {#if active.length > 0}
              {@const bc = badgeColor(active)}
              {@const bl = badgeLabel(active)}
              <rect x={BUF_W / 4 - 1} y={-8} width={bl.length * 4.5 + 3} height={8}
                rx="1" fill={bc} opacity="0.9" style="pointer-events:none" />
              <text x={BUF_W / 4 + 1} y={-1.5} font-size="5.5" fill="#0d0d0d" font-weight="700"
                style="pointer-events:none">{bl}</text>
            {/if}
          </g>
        {/if}
      {/each}
    {/each}

    <!-- ── Distribution Network ───────────────────────────────────────────── -->
    {#if distNetLayout.nodes.length > 0}
      <!-- Section divider + header -->
      <line x1={ML} y1={distSectionY - 8} x2={svgW - ML} y2={distSectionY - 8}
        stroke="rgba(226,232,240,0.1)" stroke-width="1" style="pointer-events:none" />
      <text x={ML} y={distSectionY + 10} font-size="8" font-weight="600" letter-spacing="0.08em"
        fill="rgba(226,232,240,0.35)" style="pointer-events:none">DISTRIBUTION NETWORK</text>

      <!-- Edges first (behind nodes) -->
      {#each distNetLayout.edges as e (e.fromId + e.toId)}
        {@const dx = e.toX - e.fromX}
        {@const mx = (e.fromX + e.toX) / 2}
        {@const my = (e.fromY + e.toY) / 2}
        <path
          d="M{e.fromX},{e.fromY} C{e.fromX + dx * 0.4},{e.fromY} {e.toX - dx * 0.4},{e.toY} {e.toX},{e.toY}"
          fill="none" stroke="rgba(226,232,240,0.35)" stroke-width="1.5"
          marker-end="url(#nd-arr)" style="pointer-events:none"
        />
        {#if e.transitDays !== undefined}
          <text x={mx} y={my - 6} text-anchor="middle" font-size="7.5"
            fill="rgba(226,232,240,0.5)" style="pointer-events:none">{fmtTransit(e.transitDays)}</text>
        {/if}
      {/each}

      <!-- Nodes -->
      {#each distNetLayout.nodes as n (n.locationId)}
        {@const roleColor = n.role === 'sourcingUnit' ? '#d69e2e' : n.role === 'hub' ? '#4fd1c5' : '#90cdf4'}
        {@const roleFill  = n.role === 'sourcingUnit' ? 'rgba(214,158,46,0.08)' : n.role === 'hub' ? 'rgba(79,209,197,0.08)' : 'rgba(49,130,206,0.08)'}
        {@const roleLabel = n.role === 'sourcingUnit' ? 'Sourcing' : n.role === 'hub' ? 'Hub' : 'Regional'}
        <!-- Node box -->
        <rect
          x={n.x - DN_NODE_W / 2} y={n.y - DN_NODE_H / 2}
          width={DN_NODE_W} height={DN_NODE_H} rx="5"
          fill={roleFill} stroke={roleColor} stroke-width="1.5"
          style="cursor:default" role="img"
          onmouseenter={(ev) => showTip(ev, distNodeLines(n))}
          onmouseleave={hideTip} onmousemove={moveTip}
        />
        <!-- Location name -->
        <text x={n.x} y={n.y - 9} text-anchor="middle" font-size="9" font-weight="600"
          fill="#e2e8f0" style="pointer-events:none">{trunc(n.locationName, 17)}</text>
        <!-- Agent name -->
        {#if n.agentName}
          <text x={n.x} y={n.y + 6} text-anchor="middle" font-size="7.5"
            fill="rgba(226,232,240,0.45)" style="pointer-events:none">{trunc(n.agentName, 17)}</text>
        {/if}
        <!-- Role badge (bottom-left of node) -->
        <text x={n.x - DN_NODE_W / 2 + 6} y={n.y + DN_NODE_H / 2 - 5} font-size="7"
          fill={roleColor} style="pointer-events:none">{roleLabel}</text>

        <!-- Buffer zone funnels (right of node, one per zone) -->
        {#each n.zones as zone, zi (zone.bz.id)}
          {@const { bz, specName, onhand, unit } = zone}
          {@const gF     = 1 - bz.toy / bz.tog}
          {@const yF     = 1 - bz.tor / bz.tog}
          {@const fx     = n.x + DN_NODE_W / 2 + DN_BUF_GAP + BUF_W / 2 + zi * (BUF_W + 18)}
          {@const fy     = n.y - BUF_H / 2}
          {@const curF   = 1 - Math.min(Math.max(onhand / bz.tog, 0), 1)}
          {@const curHW  = BUF_W / 2 - curF * BUF_W / 4}
          {@const active = activeForSpec(bz.specId)}
          <g
            transform="translate({fx},{fy})"
            style="cursor:pointer" role="button" tabindex="0"
            onmouseenter={(ev) => showTip(ev, [
              specName,
              `TOR ${bz.tor.toFixed(2)} · TOY ${bz.toy.toFixed(2)} · TOG ${bz.tog.toFixed(2)}`,
              onhand > 0 ? `On-hand: ${onhand} ${unit}` : 'No inventory',
              onhand <= bz.tor ? '● RED zone' : onhand <= bz.toy ? '● YELLOW zone' : '● GREEN zone',
            ])}
            onmouseleave={hideTip} onmousemove={moveTip}
            onclick={() => { onbufferselect?.(bz.id); }}
            onkeydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') onbufferselect?.(bz.id); }}
          >
            <path d={funSlice(0, gF)} fill="#276749" opacity="0.9" />
            <path d={funSlice(gF, yF)} fill="#b7791f" opacity="0.9" />
            <path d={funSlice(yF, 1)} fill="#9b2c2c" opacity="0.9" />
            <path d={funSlice(0, 1)} fill="none" stroke="rgba(226,232,240,0.4)" stroke-width="0.6" />
            <line x1={-curHW - 2} y1={curF * BUF_H} x2={curHW + 2} y2={curF * BUF_H}
              stroke="white" stroke-width="1.5" opacity="0.9" />
            {#if bz.id === selectedBzId}
              <rect
                x={-BUF_W / 2 - 3} y={-3}
                width={BUF_W + 6} height={BUF_H + 6}
                rx="2" fill="none"
                stroke="#90cdf4" stroke-width="1.5"
                style="pointer-events:none"
              />
            {/if}
            <!-- Active adjustment badge -->
            {#if active.length > 0}
              {@const bc = badgeColor(active)}
              {@const bl = badgeLabel(active)}
              <rect x={BUF_W / 4 - 1} y={-8} width={bl.length * 4.5 + 3} height={8}
                rx="1" fill={bc} opacity="0.9" style="pointer-events:none" />
              <text x={BUF_W / 4 + 1} y={-1.5} font-size="5.5" fill="#0d0d0d" font-weight="700"
                style="pointer-events:none">{bl}</text>
            {/if}
          </g>
          <text x={fx} y={fy + BUF_H + 10} text-anchor="middle" font-size="6.5"
            fill="rgba(226,232,240,0.35)" style="pointer-events:none">{trunc(specName, 10)}</text>
        {/each}
      {/each}
    {/if}

    <!-- ── Legend ─────────────────────────────────────────────────────────── -->
    <text x={ML} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)" font-weight="600">KEY</text>
    <!-- Input card icon -->
    <rect x={ML + 28} y={legendY - 10} width="28" height="14" rx="2" fill="rgba(74,85,104,0.25)" stroke="rgba(160,174,192,0.4)" stroke-width="1" />
    <text x={ML + 60} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Input</text>
    <!-- Output card icon -->
    <rect x={ML + 96} y={legendY - 10} width="28" height="14" rx="2" fill="rgba(49,130,206,0.12)" stroke="rgba(49,130,206,0.6)" stroke-width="1" />
    <text x={ML + 128} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Output</text>
    <!-- Event dot -->
    <circle cx={ML + 180} cy={legendY - 4} r="3.5" fill="#38a169" stroke="rgba(226,232,240,0.5)" stroke-width="0.8" />
    <text x={ML + 187} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Event fulfilled</text>
    <!-- Buffer funnel icon -->
    <g transform="translate({ML + 278},{legendY - BUF_H + 6})">
      <path d={funSlice(0, 0.4)} fill="#276749" opacity="0.9" />
      <path d={funSlice(0.4, 0.7)} fill="#b7791f" opacity="0.9" />
      <path d={funSlice(0.7, 1)} fill="#9b2c2c" opacity="0.9" />
    </g>
    <text x={ML + 288} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Buffer zone</text>
    <!-- Capacity bar icon (3-segment horizontal bar) -->
    <rect x={ML + 330}                  y={legendY - 5} width={28 * 0.80} height={4} fill="#276749" opacity="0.75" />
    <rect x={ML + 330 + 28 * 0.80}     y={legendY - 5} width={28 * 0.15} height={4} fill="#b7791f" opacity="0.75" />
    <rect x={ML + 330 + 28 * 0.95}     y={legendY - 5} width={28 * 0.05} height={4} fill="#9b2c2c" opacity="0.75" />
    <text x={ML + 362} y={legendY} font-size="7.5" fill="rgba(226,232,240,0.3)">Capacity</text>
  </svg>

  {#if selected}
    {#key `${selected.type}-${selected.id}`}
      <EntityPanel type={selected.type} id={selected.id} onclose={() => selected = null} />
    {/key}
  {/if}
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
