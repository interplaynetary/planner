<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";
  import type { EconomicResource } from "$lib/schemas";
  import type { ScopePlanResult } from "$lib/planning/plan-for-scope";
  import type { TradeProposal } from "$lib/planning/plan-federation";

  interface Props {
    planOrder: string[];
    byScope: Map<string, ScopePlanResult>;
    parentOf: (id: string) => string | undefined;
    tradeProposals?: TradeProposal[];
    resourcesByScope?: Map<string, EconomicResource[]>;
    selected?: string;
    onselect?: (id: string) => void;
  }

  let {
    planOrder,
    byScope,
    parentOf,
    tradeProposals = [],
    resourcesByScope = new Map(),
    selected = "",
    onselect,
  }: Props = $props();

  // Deterministic hue from a string (spec ID → consistent color)
  function specColor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
    return `hsl(${h % 360}, 62%, 58%)`;
  }

  let svgWidth = $state(800);
  let svgHeight = $state(520);

  // Distinct colors for each trade proposal
  const TRADE_COLORS = [
    "#63b3ed",
    "#f6ad55",
    "#b794f4",
    "#4fd1c5",
    "#f687b3",
    "#7ee8a2",
  ];

  // ---------------------------------------------------------------------------
  // Node role detection
  // ---------------------------------------------------------------------------

  function nodeRole(id: string): "root" | "federation" | "leaf" {
    const p = parentOf(id);
    if (!p || !planOrder.includes(p)) return "root";
    return planOrder.some((o) => parentOf(o) === id) ? "federation" : "leaf";
  }

  // ---------------------------------------------------------------------------
  // Radial layout: UC at center, federations on inner ring, communes on outer ring
  // ---------------------------------------------------------------------------

  const positions = $derived.by(() => {
    const pos = new SvelteMap<string, { x: number; y: number }>();
    const cx = svgWidth / 2;
    const cy = svgHeight / 2 + 14;

    const root = planOrder.find((id) => nodeRole(id) === "root");
    if (!root) return pos;
    pos.set(root, { x: cx, y: cy });

    const feds = planOrder.filter((id) => parentOf(id) === root);
    if (feds.length === 0) return pos;

    // Rings sized to fit within SVG bounds with padding
    const R1 = Math.min(svgWidth * 0.22, svgHeight * 0.21);
    const R2 = Math.min(svgWidth * 0.44, svgHeight * 0.41);
    const COM_SPREAD = Math.PI / 8; // ±22.5° between sibling communes

    feds.forEach((fid, i) => {
      const angle = -Math.PI / 2 + ((2 * Math.PI) / feds.length) * i;
      pos.set(fid, {
        x: cx + R1 * Math.cos(angle),
        y: cy + R1 * Math.sin(angle),
      });

      const communes = planOrder.filter((id) => parentOf(id) === fid);
      communes.forEach((cid, j) => {
        const offset =
          communes.length > 1
            ? (j - (communes.length - 1) / 2) * COM_SPREAD * 2.2
            : 0;
        const ca = angle + offset;
        pos.set(cid, { x: cx + R2 * Math.cos(ca), y: cy + R2 * Math.sin(ca) });
      });
    });

    return pos;
  });

  // ---------------------------------------------------------------------------
  // Hierarchy edges
  // ---------------------------------------------------------------------------

  const hierarchyEdges = $derived.by(() => {
    const list: Array<{ from: string; to: string }> = [];
    for (const id of planOrder) {
      const p = parentOf(id);
      if (p && planOrder.includes(p)) list.push({ from: p, to: id });
    }
    return list;
  });

  function hierPath(from: string, to: string): string {
    const f = positions.get(from);
    const t = positions.get(to);
    if (!f || !t) return "";
    return `M ${f.x} ${f.y} L ${t.x} ${t.y}`;
  }

  function hierColor(toId: string): string {
    const r = byScope.get(toId);
    if (!r) return "var(--border-faint)";
    if (r.deficits.some((d) => d.shortfall > 0)) return "rgba(252,88,88,0.50)";
    if (r.deficits.some((d) => (d.originalShortfall ?? 0) > 0)) return "rgba(126,232,162,0.45)";
    if (r.surplus.length > 0) return "rgba(126,232,162,0.35)";
    return "var(--border-dim)";
  }

  // ---------------------------------------------------------------------------
  // Trade edges — quadratic bezier arcing OUTWARD from UC center
  // ---------------------------------------------------------------------------

  function tradeArcPath(fromId: string, toId: string): string {
    const f = positions.get(fromId);
    const t = positions.get(toId);
    if (!f || !t) return "";
    const cx = svgWidth / 2;
    const cy = svgHeight / 2 + 14;
    const mx = (f.x + t.x) / 2;
    const my = (f.y + t.y) / 2;
    // Vector from graph center to midpoint, normalized
    const dx = mx - cx;
    const dy = my - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const chord = Math.sqrt((f.x - t.x) ** 2 + (f.y - t.y) ** 2);
    // Push control point outward proportional to chord length
    const push = chord * 0.3 + 55;
    return `M ${f.x} ${f.y} Q ${mx + (dx / len) * push} ${my + (dy / len) * push} ${t.x} ${t.y}`;
  }

  function tradeLabelPos(
    fromId: string,
    toId: string,
  ): { x: number; y: number } | null {
    const f = positions.get(fromId);
    const t = positions.get(toId);
    if (!f || !t) return null;
    const cx = svgWidth / 2;
    const cy = svgHeight / 2 + 14;
    const mx = (f.x + t.x) / 2;
    const my = (f.y + t.y) / 2;
    const dx = mx - cx;
    const dy = my - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const chord = Math.sqrt((f.x - t.x) ** 2 + (f.y - t.y) ** 2);
    const push = chord * 0.3 + 55;
    return { x: mx + (dx / len) * push, y: my + (dy / len) * push };
  }

  // ---------------------------------------------------------------------------
  // Node rendering helpers
  // ---------------------------------------------------------------------------

  function cardDims(role: "root" | "federation" | "leaf"): {
    w: number;
    h: number;
  } {
    if (role === "root") return { w: 160, h: 72 };
    if (role === "federation") return { w: 140, h: 62 };
    return { w: 130, h: 80 };
  }

  function displayLines(id: string): [string, string?] {
    if (id === "universal-commune") return ["UNIVERSAL", "COMMUNE"];
    if (id.endsWith("-federation"))
      return [id.replace("-federation", "").toUpperCase(), "FEDERATION"];
    if (id.startsWith("commune-"))
      return [id.replace("commune-", "").toUpperCase()];
    return [id.toUpperCase()];
  }

  function nodeStroke(id: string): string {
    const r = byScope.get(id);
    if (r?.deficits.some((d) => d.shortfall > 0)) return "#fc5858";
    if (r?.metabolicDebt?.length) return "#e8b04e";
    if (r?.deficits.some((d) => (d.originalShortfall ?? 0) > 0)) return "#7ee8a2";
    const role = nodeRole(id);
    if (role === "root") return "rgba(120,195,255,0.85)";
    if (role === "federation") return "rgba(160,210,255,0.40)";
    if (tradeProposals.some((t) => t.fromScopeId === id || t.toScopeId === id))
      return "rgba(120,195,255,0.60)";
    return "rgba(160,210,255,0.26)";
  }

  function nodeFill(id: string): string {
    if (id === selected) return "#1d3358";
    const role = nodeRole(id);
    if (role === "root") return "#142248";
    if (role === "federation") return "#192740";
    return "#161f33";
  }

  function hexPoints(rx: number, ry: number): string {
    return [
      [-rx, 0],
      [-rx * 0.5, -ry],
      [rx * 0.5, -ry],
      [rx, 0],
      [rx * 0.5, ry],
      [-rx * 0.5, ry],
    ]
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
  }

  function hexRx(role: string): number {
    if (role === "root") return 105;
    if (role === "federation") return 92;
    return 88;
  }

  function hexRy(role: string): number {
    if (role === "root") return 50;
    if (role === "federation") return 43;
    return 40;
  }
</script>

<svg
  bind:clientWidth={svgWidth}
  bind:clientHeight={svgHeight}
  class="net-svg"
  role="img"
  aria-label="Federation network graph"
>
  <defs>
    {#each TRADE_COLORS as color, i (i)}
      <marker
        id="tarrow-{i}"
        markerWidth="7"
        markerHeight="7"
        refX="6"
        refY="3.5"
        orient="auto"
      >
        <path d="M0,0 L7,3.5 L0,7 Z" fill={color} opacity="0.9" />
      </marker>
    {/each}
  </defs>

  <!-- ── Hierarchy edges (bottom layer) ───────────────────────────────── -->
  {#each hierarchyEdges as { from, to } (`${from}-${to}`)}
    {@const p = hierPath(from, to)}
    {#if p}
      <path d={p} stroke={hierColor(to)} stroke-width="1" fill="none" />
    {/if}
  {/each}

  <!-- ── INTER-SCOPE SUPPORT arcs ───────────────────────────────────────────── -->
  {#each tradeProposals as proposal, idx (proposal.id)}
    {@const color = TRADE_COLORS[idx % TRADE_COLORS.length]}
    {@const path = tradeArcPath(proposal.fromScopeId, proposal.toScopeId)}
    {@const lp = tradeLabelPos(proposal.fromScopeId, proposal.toScopeId)}
    {#if path}
      <path
        d={path}
        stroke={color}
        stroke-width="1.5"
        fill="none"
        stroke-dasharray="6 3"
        opacity="0.72"
        marker-end="url(#tarrow-{idx % TRADE_COLORS.length})"
        class="trade-arc"
      />
      {#if lp}
        <rect
          x={lp.x - 32}
          y={lp.y - 9}
          width={64}
          height={16}
          rx={2}
          fill="#111e30"
          stroke={color}
          stroke-width="0.5"
          opacity="0.95"
        />
        <text
          x={lp.x}
          y={lp.y + 3}
          text-anchor="middle"
          class="trade-lbl"
          fill={color}
        >
          {proposal.specId} ×{proposal.quantity}
        </text>
      {/if}
    {/if}
  {/each}

  <!-- ── Nodes (top layer) ────────────────────────────────────────────── -->
  {#each planOrder as id (id)}
    {@const pos = positions.get(id)}
    {#if pos}
      {@const role = nodeRole(id)}
      {@const { w, h } = cardDims(role)}
      {@const result = byScope.get(id)}
      {@const [line1, line2] = displayLines(id)}
      {@const isSelected = id === selected}
      {@const hasTrade = tradeProposals.some(
        (t) => t.fromScopeId === id || t.toScopeId === id,
      )}
      {@const surplusQty =
        result?.surplus.reduce((s, x) => s + x.quantity, 0) ?? 0}
      {@const defCount =
        result?.deficits.filter((d) => d.shortfall > 0).length ?? 0}
      {@const hasDebt = (result?.metabolicDebt?.length ?? 0) > 0}
      {@const totalOrig =
        result?.deficits.reduce(
          (s, d) => s + (d.originalShortfall ?? d.shortfall),
          0,
        ) ?? 0}
      {@const totalShort =
        result?.deficits.reduce((s, d) => s + d.shortfall, 0) ?? 0}
      {@const resolvedW =
        totalOrig > 0 ? ((totalOrig - totalShort) / totalOrig) * (w - 14) : 0}
      <g
        transform="translate({pos.x},{pos.y})"
        onclick={() => onselect?.(id)}
        role="button"
        tabindex="0"
        aria-label="Scope {id}"
        onkeydown={(e) => e.key === "Enter" && onselect?.(id)}
        style="cursor:pointer"
      >
        <!-- Card background -->
        <polygon
          points={hexPoints(hexRx(role), hexRy(role))}
          fill={nodeFill(id)}
          stroke={nodeStroke(id)}
          stroke-width={isSelected ? 2 : role === "root" ? 1.5 : 1}
          stroke-dasharray={role === "federation" ? "5 3" : "none"}
        />

        {#if role === "root"}
          <!-- Universal Commune -->
          <text x={0} y={-10} text-anchor="middle" class="node-name root-name"
            >{line1}</text
          >
          <text x={0} y={8} text-anchor="middle" class="node-sub">{line2}</text>
          <text x={0} y={24} text-anchor="middle" class="node-stat dim-txt">
            {planOrder.filter((i) => nodeRole(i) === "federation").length} federations
          </text>
        {:else if role === "federation"}
          {@const fedKids = planOrder.filter((i) => parentOf(i) === id)}
          {@const coherentKids = fedKids.filter((i) => {
            const r = byScope.get(i);
            return !r || !r.deficits.some((d) => d.shortfall > 0);
          }).length}
          {@const coherence = fedKids.length > 0 ? coherentKids / fedKids.length : 1}
          {@const pieR = 11}
          {@const pieCy = 26}
          {@const pieAngle = coherence * 2 * Math.PI}
          {@const pieEndX = +(pieR * Math.sin(pieAngle)).toFixed(2)}
          {@const pieEndY = +(pieCy - pieR * Math.cos(pieAngle)).toFixed(2)}
          {@const pieLarge = coherence > 0.5 ? 1 : 0}
          <!-- Federation node -->
          <text x={0} y={-7} text-anchor="middle" class="node-name fed-name"
            >{line1}</text
          >
          <text x={0} y={8} text-anchor="middle" class="node-sub">{line2}</text>
          <!-- Coherence pie -->
          <circle cx={0} cy={pieCy} r={pieR} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" stroke-width="0.5" />
          {#if coherence >= 1}
            <circle cx={0} cy={pieCy} r={pieR} fill="rgba(126,232,162,0.30)" />
          {:else if coherence > 0}
            <path
              d="M 0 {pieCy} L 0 {pieCy - pieR} A {pieR} {pieR} 0 {pieLarge} 1 {pieEndX} {pieEndY} Z"
              fill="rgba(126,232,162,0.30)"
            />
          {/if}
          <text x={0} y={pieCy + 4} text-anchor="middle" class="pie-pct"
            >{Math.round(coherence * 100)}%</text
          >
        {:else}
          <!-- Leaf commune -->
          {@const tradeIdxFrom = tradeProposals.findIndex(
            (t) => t.fromScopeId === id,
          )}
          {@const tradeIdxTo = tradeProposals.findIndex(
            (t) => t.toScopeId === id,
          )}
          {@const tradeColor =
            tradeIdxFrom >= 0
              ? TRADE_COLORS[tradeIdxFrom % TRADE_COLORS.length]
              : tradeIdxTo >= 0
                ? TRADE_COLORS[tradeIdxTo % TRADE_COLORS.length]
                : null}

          <!-- Trade accent dot -->
          {#if tradeColor}
            <circle cx={60} cy={-22} r={4} fill={tradeColor} opacity="0.5" />
          {/if}

          <text x={0} y={-6} text-anchor="middle" class="node-name leaf-name"
            >{line1}</text
          >

          <!-- Resource squares -->
          {@const scopeRes = resourcesByScope.get(id) ?? []}
          {#if scopeRes.length > 0}
            {@const sqSize = 6}
            {@const sqGap = 2}
            {@const totalW = scopeRes.length * sqSize + (scopeRes.length - 1) * sqGap}
            {@const startX = -totalW / 2}
            {#each scopeRes as res, ri (res.id)}
              <rect
                x={startX + ri * (sqSize + sqGap)}
                y={18}
                width={sqSize}
                height={sqSize}
                rx={1}
                fill={specColor(res.conformsTo ?? res.id)}
                opacity="0.82"
              >
                <title>{res.name ?? res.conformsTo ?? res.id} · {res.onhandQuantity?.hasNumericalValue ?? "?"} {res.onhandQuantity?.hasUnit ?? ""}</title>
              </rect>
            {/each}
          {/if}

          <!-- Surplus -->
          {#if surplusQty > 0}
            <text x={-62} y={22} class="node-stat green-txt"
              >+{Math.round(surplusQty)}</text
            >
          {/if}

          <!-- Deficit badge — red if unresolved, green ✓ if all resolved -->
          {#if defCount > 0}
            <rect x={20} y={-28} width={30} height={13} rx={2} fill="rgba(252,88,88,0.30)" />
            <text x={35} y={-19} text-anchor="middle" class="badge-txt" fill="#fc5858">{defCount}D</text>
          {:else if result && result.deficits.length > 0}
            <rect x={20} y={-28} width={30} height={13} rx={2} fill="rgba(126,232,162,0.20)" />
            <text x={35} y={-19} text-anchor="middle" class="badge-txt" fill="#7ee8a2">✓</text>
          {/if}

          <!-- Debt label -->
          {#if hasDebt}
            <text x={-44} y={32} class="node-stat yellow-txt">debt</text>
          {/if}

          <!-- Residual bar -->
          {#if result && result.deficits.length > 0}
            <rect
              x={-72}
              y={6}
              width={144}
              height={4}
              rx={2}
              fill="rgba(140,180,255,0.12)"
            />
            {#if resolvedW > 0}
              <rect
                x={-72}
                y={6}
                width={resolvedW}
                height={4}
                rx={2}
                fill="#7ee8a2"
                opacity="0.85"
              />
            {/if}
            {#if resolvedW < w - 14}
              <rect
                x={-72 + resolvedW}
                y={6}
                width={w - 14 - resolvedW}
                height={4}
                rx={2}
                fill="#fc5858"
                opacity="0.60"
              />
            {/if}
          {/if}
        {/if}
      </g>
    {/if}
  {/each}
</svg>

<style>
  .net-svg {
    width: 100%;
    height: 100%;
    min-height: 400px;
    display: block;
    background: var(--bg-base);
  }

  :global(.trade-arc) {
    animation: trade-flow 2.2s linear infinite;
  }

  @keyframes trade-flow {
    to {
      stroke-dashoffset: -27;
    }
  }

  :global(.node-name) {
    font-family: var(--font-mono);
    font-size: 0.64rem;
    letter-spacing: 0.07em;
    fill: rgba(220, 235, 255, 0.92);
    font-weight: 600;
  }
  :global(.root-name) {
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    fill: #63b3ed;
  }
  :global(.fed-name) {
    font-size: 0.62rem;
    fill: rgba(200, 220, 255, 0.8);
  }
  :global(.leaf-name) {
    font-size: 0.62rem;
    letter-spacing: 0.06em;
  }
  :global(.node-sub) {
    font-family: var(--font-mono);
    font-size: 0.46rem;
    letter-spacing: 0.13em;
    fill: rgba(160, 195, 255, 0.52);
    text-transform: uppercase;
  }
  :global(.node-stat) {
    font-family: var(--font-mono);
    font-size: 0.56rem;
    letter-spacing: 0.04em;
  }
  :global(.pie-pct) {
    font-family: var(--font-mono);
    font-size: 7.5px;
    fill: rgba(200, 228, 255, 0.72);
  }

  :global(.green-txt) {
    fill: #7ee8a2;
  }
  :global(.yellow-txt) {
    fill: #e8b04e;
  }
  :global(.dim-txt) {
    fill: rgba(160, 195, 255, 0.45);
    font-size: 0.48rem;
  }
  :global(.badge-txt) {
    font-family: var(--font-mono);
    font-size: 0.48rem;
    letter-spacing: 0.05em;
    font-weight: 600;
  }
  :global(.trade-lbl) {
    font-family: var(--font-mono);
    font-size: 0.49rem;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
</style>
