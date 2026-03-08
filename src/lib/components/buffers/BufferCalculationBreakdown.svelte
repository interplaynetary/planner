<script lang="ts">
  import type { BufferZone, BufferProfile } from '$lib/schemas';
  import { showTip, hideTip, moveTip } from '$lib/tooltip.svelte';

  interface Props {
    bufferZone: BufferZone;
    profile: BufferProfile;
    specName: string;
  }

  let { bufferZone, profile, specName }: Props = $props();

  // Zone calculations
  const redBase   = $derived(bufferZone.dltDays * bufferZone.adu * profile.leadTimeFactor);
  const redSafety = $derived(redBase * profile.variabilityFactor);
  const tor       = $derived(redBase + redSafety);
  const yellow    = $derived(bufferZone.dltDays * bufferZone.adu);
  const docDays   = $derived(profile.orderCycleDays ?? 7);
  const green     = $derived(Math.max(docDays * bufferZone.adu, redBase, bufferZone.moq));
  const tog       = $derived(tor + yellow + green);

  // Insight badges
  const orderFreq = $derived(bufferZone.adu > 0 ? (green / bufferZone.adu).toFixed(1) : '—');
  const safetyCov = $derived(bufferZone.adu > 0 ? (tor / bufferZone.adu).toFixed(1) : '—');
  const avgOpenOrders = $derived.by(() => {
    const y = yellow;
    const g = green;
    return g > 0 ? (y / g).toFixed(1) : '—';
  });

  // Funnel SVG dimensions
  const W = 80;
  const H = 150;
  const gH = $derived(tog > 0 ? (green / tog) * H : H / 3);
  const yH = $derived(tog > 0 ? (yellow / tog) * H : H / 3);
  const rH = $derived(tog > 0 ? (tor / tog) * H : H / 3);

  // trapezoid widths: wider at top, narrower at bottom
  const topW = W;
  const botW = W * 0.55;

  function trapezoid(yOffset: number, h: number, taper: number): string {
    const t = taper;
    const b = taper + (topW - botW) * (h / H);
    // 4 corners of trapezoid band
    const x1 = (W - topW) / 2 + t;
    const x2 = (W + topW) / 2 - t;
    const x3 = (W + topW) / 2 - (t + (topW - botW) * (h / H));
    const x4 = (W - topW) / 2 + t + (topW - botW) * (h / H);
    return `${x1},${yOffset} ${x2},${yOffset} ${x3},${yOffset + h} ${x4},${yOffset + h}`;
  }

  type FormulaRow = {
    label: string;
    value: string;
    formula: string;
    color: string;
  };

  const formulaRows = $derived<FormulaRow[]>([
    {
      label: 'Red Base',
      value: redBase.toFixed(2),
      formula: `DLT × ADU × LTF = ${bufferZone.dltDays} × ${bufferZone.adu} × ${profile.leadTimeFactor} = ${redBase.toFixed(2)}`,
      color: 'var(--zone-red)',
    },
    {
      label: 'Red Safety',
      value: redSafety.toFixed(2),
      formula: `Red Base × VF = ${redBase.toFixed(2)} × ${profile.variabilityFactor} = ${redSafety.toFixed(2)}`,
      color: 'var(--zone-red)',
    },
    {
      label: 'TOR',
      value: tor.toFixed(2),
      formula: `Red Base + Red Safety = ${redBase.toFixed(2)} + ${redSafety.toFixed(2)} = ${tor.toFixed(2)}`,
      color: 'var(--zone-red)',
    },
    {
      label: 'Yellow',
      value: yellow.toFixed(2),
      formula: `DLT × ADU = ${bufferZone.dltDays} × ${bufferZone.adu} = ${yellow.toFixed(2)}`,
      color: 'var(--zone-yellow)',
    },
    {
      label: 'Green',
      value: green.toFixed(2),
      formula: `max(DOC×ADU, Red Base, MOQ) = max(${(docDays * bufferZone.adu).toFixed(2)}, ${redBase.toFixed(2)}, ${bufferZone.moq}) = ${green.toFixed(2)}`,
      color: 'var(--zone-green)',
    },
    {
      label: 'TOG',
      value: tog.toFixed(2),
      formula: `TOR + Yellow + Green = ${tor.toFixed(2)} + ${yellow.toFixed(2)} + ${green.toFixed(2)} = ${tog.toFixed(2)}`,
      color: '#e2e8f0',
    },
  ]);
</script>

<div class="bcb">
  <div class="bcb-title">{specName} — Buffer Calculation</div>
  <div class="bcb-body">

    <!-- Left: inputs -->
    <div class="inputs">
      <div class="col-hdr">Inputs</div>
      <dl>
        <dt>ADU</dt><dd>{bufferZone.adu} {bufferZone.aduUnit}/day</dd>
        <dt>DLT</dt><dd>{bufferZone.dltDays.toFixed(2)} days</dd>
        <dt>LTF</dt><dd>{profile.leadTimeFactor} ({profile.leadTimeCategory ?? '—'})</dd>
        <dt>VF</dt><dd>{profile.variabilityFactor} ({profile.variabilityCategory ?? '—'})</dd>
        <dt>MOQ</dt><dd>{bufferZone.moq} {bufferZone.moqUnit}</dd>
        <dt>DOC</dt><dd>{docDays} days</dd>
        <dt>Profile</dt><dd>{profile.code ?? profile.name}</dd>
      </dl>
    </div>

    <!-- Middle: formula steps -->
    <div class="formula">
      <div class="col-hdr">Formula Steps</div>
      <div class="formula-rows">
        {#each formulaRows as row}
          <div
            class="frow"
            role="row"
            tabindex="0"
            onmouseenter={(e) => showTip(e, [row.formula])}
            onmouseleave={hideTip}
            onmousemove={moveTip}
          >
            <span class="flabel" style:color={row.color}>{row.label}</span>
            <span class="fvalue" style:color={row.color}>{row.value}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Right: funnel SVG -->
    <div class="funnel">
      <div class="col-hdr">Buffer Zones</div>
      <svg width={W} height={H} style="display:block;margin:0 auto;">
        <!-- Green zone (top) -->
        <polygon
          points={trapezoid(0, gH, 0)}
          fill="var(--zone-green)"
          fill-opacity="0.25"
          stroke="var(--zone-green)"
          stroke-width="1"
        />
        <text x={W / 2} y={gH / 2 + 4} text-anchor="middle" font-family="var(--font-mono)" font-size="9" fill="var(--zone-green)">
          G {green.toFixed(1)}
        </text>
        <!-- Yellow zone (middle) -->
        <polygon
          points={trapezoid(gH, yH, (topW - botW) * (gH / H))}
          fill="var(--zone-yellow)"
          fill-opacity="0.25"
          stroke="var(--zone-yellow)"
          stroke-width="1"
        />
        <text x={W / 2} y={gH + yH / 2 + 4} text-anchor="middle" font-family="var(--font-mono)" font-size="9" fill="var(--zone-yellow)">
          Y {yellow.toFixed(1)}
        </text>
        <!-- Red zone (bottom) -->
        <polygon
          points={trapezoid(gH + yH, rH, (topW - botW) * ((gH + yH) / H))}
          fill="var(--zone-red)"
          fill-opacity="0.25"
          stroke="var(--zone-red)"
          stroke-width="1"
        />
        <text x={W / 2} y={gH + yH + rH / 2 + 4} text-anchor="middle" font-family="var(--font-mono)" font-size="9" fill="var(--zone-red)">
          R {tor.toFixed(1)}
        </text>
      </svg>
    </div>

  </div>

  <!-- Insight badges -->
  <div class="insights">
    <span class="badge">Order freq: {orderFreq} days</span>
    <span class="badge">Safety: {safetyCov} days</span>
    <span class="badge">Avg open orders: ~{avgOpenOrders}</span>
    <span class="badge muted">{bufferZone.bufferClassification}</span>
  </div>
</div>

<style>
  .bcb {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
  }

  .bcb-title {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.5;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .bcb-body {
    display: flex;
    gap: var(--gap-lg);
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .col-hdr {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.4;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    margin-bottom: 4px;
    white-space: nowrap;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px var(--gap-md);
    margin: 0;
    font-family: var(--font-mono);
  }

  dt { opacity: var(--muted); }
  dd { margin: 0; font-weight: 600; }

  .formula-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .frow {
    display: flex;
    gap: var(--gap-md);
    cursor: default;
    padding: 2px 4px;
    border-radius: 2px;
    font-family: var(--font-mono);
  }

  .frow:hover {
    background: rgba(255,255,255,0.05);
  }

  .flabel {
    opacity: 0.7;
    min-width: 72px;
  }

  .fvalue {
    font-weight: 700;
  }

  .insights {
    display: flex;
    gap: var(--gap-sm);
    flex-wrap: wrap;
  }

  .badge {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    padding: 2px 6px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
    white-space: nowrap;
  }

  .badge.muted {
    opacity: 0.4;
  }
</style>
