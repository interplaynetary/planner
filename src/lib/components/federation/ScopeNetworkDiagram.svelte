<script lang="ts">
  import type { PlanStore } from '$lib/planning/planning';
  import type { Observer } from '$lib/observation/observer';

  interface Props {
    planStore: PlanStore;
    observer: Observer;
    specNames: Record<string, string>;
    mode: 'plan' | 'observe';
  }

  let { planStore, observer, specNames, mode }: Props = $props();

  // ── Layout constants ──────────────────────────────────────────────────────
  const SVG_W       = 500;
  const IN_CX       = 80;      // center-x of input cards
  const PROC_CX     = 250;     // center-x of process boxes
  const OUT_CX      = 420;     // center-x of output cards
  const PROC_W      = 120;
  const PROC_H      = 48;
  const CARD_W      = 110;
  const CARD_H      = 46;
  const CARD_ROW_H  = 56;
  const PROC_SLOT_GAP = 18;    // vertical gap between process slots
  const HEADER_H    = 18;

  // ── Derived state ─────────────────────────────────────────────────────────
  const processes    = $derived(planStore.processes.all());
  const allCmts      = $derived(planStore.allCommitments());
  const allIntents   = $derived(planStore.allIntents());
  const observed     = $derived(observer.allResources());

  const onhandBySpec = $derived(
    observed.reduce<Record<string, number>>((acc, r) => {
      acc[r.conformsTo] = (acc[r.conformsTo] ?? 0) + (r.onhandQuantity?.hasNumericalValue ?? 0);
      return acc;
    }, {})
  );

  // ── Process slots ─────────────────────────────────────────────────────────
  interface CmtCard {
    id: string; specId: string; specName: string;
    qty: number; unit: string; action: string;
    cx: number; cy: number;   // center coordinates
  }

  interface ProcSlot {
    id: string; name: string;
    inputs: CmtCard[]; outputs: CmtCard[];
    procCY: number;  // process box center-y
    slotTop: number; slotBot: number;
  }

  const processSlots = $derived.by((): ProcSlot[] => {
    const slots: ProcSlot[] = [];
    let curY = HEADER_H + 8;

    for (const proc of processes) {
      const procCmts = allCmts.filter(c => c.inputOf === proc.id || c.outputOf === proc.id);
      const inputs  = procCmts.filter(c => c.inputOf  === proc.id);
      const outputs = procCmts.filter(c => c.outputOf === proc.id);

      const nRows   = Math.max(inputs.length, outputs.length, 1);
      const slotH   = nRows * CARD_ROW_H + PROC_H * 0.4;
      const procCY  = curY + slotH / 2;

      function makeCards(list: typeof inputs, cx: number): CmtCard[] {
        const n = list.length;
        return list.map((c, i) => {
          const specId = c.resourceConformsTo ?? '';
          return {
            id: c.id, specId,
            specName: specNames[specId] ?? specId,
            qty: c.resourceQuantity?.hasNumericalValue ?? 0,
            unit: c.resourceQuantity?.hasUnit ?? '',
            action: c.action,
            cx,
            cy: procCY + (i - (n - 1) / 2) * CARD_ROW_H,
          };
        });
      }

      slots.push({
        id: proc.id,
        name: (proc as any).name ?? proc.id,
        inputs:  makeCards(inputs,  IN_CX),
        outputs: makeCards(outputs, OUT_CX),
        procCY, slotTop: curY, slotBot: curY + slotH,
      });

      curY += slotH + PROC_SLOT_GAP;
    }

    return slots;
  });

  // ── Standalone items ──────────────────────────────────────────────────────
  interface StandaloneItem {
    id: string; specId: string; specName: string;
    qty: number; unit: string; action: string;
    isIntent: boolean; y: number;
  }

  const linkedCmtIds = $derived(
    new Set(allCmts.filter(c => c.inputOf || c.outputOf).map(c => c.id))
  );

  const standaloneItems = $derived.by((): StandaloneItem[] => {
    const baseY = processSlots.length > 0
      ? processSlots[processSlots.length - 1].slotBot + PROC_SLOT_GAP + 14
      : HEADER_H + 8;

    const items: StandaloneItem[] = [];
    let y = baseY;

    for (const c of allCmts) {
      if (linkedCmtIds.has(c.id)) continue;
      const specId = c.resourceConformsTo ?? '';
      items.push({
        id: c.id, specId, specName: specNames[specId] ?? specId,
        qty: c.resourceQuantity?.hasNumericalValue ?? 0,
        unit: c.resourceQuantity?.hasUnit ?? '',
        action: c.action, isIntent: false, y,
      });
      y += CARD_ROW_H;
    }

    for (const i of allIntents) {
      const specId = i.resourceConformsTo ?? '';
      items.push({
        id: i.id, specId, specName: specNames[specId] ?? specId,
        qty: i.resourceQuantity?.hasNumericalValue ?? 0,
        unit: i.resourceQuantity?.hasUnit ?? '',
        action: i.action, isIntent: true, y,
      });
      y += CARD_ROW_H;
    }

    return items;
  });

  // ── SVG height ────────────────────────────────────────────────────────────
  const svgH = $derived.by(() => {
    if (standaloneItems.length > 0) {
      const last = standaloneItems[standaloneItems.length - 1];
      return last.y + CARD_H + 16;
    }
    if (processSlots.length > 0) {
      return processSlots[processSlots.length - 1].slotBot + 16;
    }
    return 80;
  });

  const isEmpty = $derived(processSlots.length === 0 && standaloneItems.length === 0);

  // ── Edge path helpers ─────────────────────────────────────────────────────
  function inputEdge(card: CmtCard, procCY: number): string {
    const x1 = card.cx + CARD_W / 2;
    const y1 = card.cy;
    const x2 = PROC_CX - PROC_W / 2;
    const y2 = procCY;
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  function outputEdge(card: CmtCard, procCY: number): string {
    const x1 = PROC_CX + PROC_W / 2;
    const y1 = procCY;
    const x2 = card.cx - CARD_W / 2;
    const y2 = card.cy;
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  // ── Action color ──────────────────────────────────────────────────────────
  function actionStroke(action: string): string {
    if (action === 'produce')         return 'rgba(104,211,145,0.5)';
    if (action === 'consume')         return 'rgba(229,62,62,0.4)';
    if (action === 'work')            return 'rgba(99,179,237,0.45)';
    if (action === 'distribute')      return 'rgba(214,158,46,0.45)';
    if (action === 'deliverService')  return 'rgba(159,122,234,0.45)';
    return 'rgba(255,255,255,0.2)';
  }
</script>

<div class="net-wrap">
  {#if isEmpty}
    <p class="empty">No commitments or intents.</p>
  {:else}
    <svg width={SVG_W} height={svgH} class="net-svg">
      <!-- Column headers -->
      <text x={IN_CX}   y="12" class="col-label">INPUTS</text>
      <text x={PROC_CX} y="12" class="col-label">PROCESSES</text>
      <text x={OUT_CX}  y="12" class="col-label">OUTPUTS</text>

      <!-- Process slots -->
      {#each processSlots as slot (slot.id)}
        <!-- Input bezier edges -->
        {#each slot.inputs as card (card.id + '-edge')}
          <path d={inputEdge(card, slot.procCY)} class="edge" />
        {/each}
        <!-- Output bezier edges -->
        {#each slot.outputs as card (card.id + '-edge')}
          <path d={outputEdge(card, slot.procCY)} class="edge edge-out" />
        {/each}

        <!-- Process box -->
        <g transform="translate({PROC_CX},{slot.procCY})">
          <rect
            x={-PROC_W / 2} y={-PROC_H / 2}
            width={PROC_W} height={PROC_H} rx="4"
            class="proc-rect"
          />
          <text y="-6" class="proc-label" text-anchor="middle">PROCESS</text>
          <text y="10" class="proc-name" text-anchor="middle">{slot.name}</text>
        </g>

        <!-- Input cards -->
        {#each slot.inputs as card (card.id)}
          <g transform="translate({card.cx - CARD_W / 2},{card.cy - CARD_H / 2})">
            <rect width={CARD_W} height={CARD_H} rx="3"
              class="card-rect" style="stroke:{actionStroke(card.action)}" />
            <text x="8" y="13" class="card-action">{card.action}</text>
            <text x="8" y="28" class="card-spec">{card.specName}</text>
            <text x="8" y="40" class="card-qty">{card.qty} {card.unit}</text>
          </g>
        {/each}

        <!-- Output cards -->
        {#each slot.outputs as card (card.id)}
          <g transform="translate({card.cx - CARD_W / 2},{card.cy - CARD_H / 2})">
            <rect width={CARD_W} height={CARD_H} rx="3"
              class="card-rect" style="stroke:{actionStroke(card.action)}" />
            <text x="8" y="13" class="card-action">{card.action}</text>
            <text x="8" y="28" class="card-spec">{card.specName}</text>
            <text x="8" y="40" class="card-qty">{card.qty} {card.unit}</text>
            {#if mode === 'observe' && onhandBySpec[card.specId] !== undefined}
              <g transform="translate({CARD_W - 6},{4})">
                <circle r="5" class="oh-dot"
                  class:oh-ok={onhandBySpec[card.specId] >= card.qty} />
                <text x="-8" y="-8" class="oh-label">OH:{onhandBySpec[card.specId]}</text>
              </g>
            {/if}
          </g>
        {/each}
      {/each}

      <!-- Standalone section header -->
      {#if standaloneItems.length > 0 && processSlots.length > 0}
        {@const headerY = processSlots[processSlots.length - 1].slotBot + 8}
        <line x1="12" y1={headerY} x2={SVG_W - 12} y2={headerY}
          stroke="rgba(255,255,255,0.06)" stroke-width="1" />
        <text x="12" y={headerY + 12} class="col-label">FLOWS</text>
      {/if}

      <!-- Standalone items -->
      {#each standaloneItems as item (item.id)}
        <g transform="translate(20,{item.y})">
          <rect width={CARD_W} height={CARD_H} rx="3"
            class="card-rect" class:card-intent={item.isIntent}
            style="stroke:{actionStroke(item.action)}" />
          <text x="8" y="13" class="card-action">{item.action}</text>
          <text x="8" y="28" class="card-spec">{item.specName}</text>
          <text x="8" y="40" class="card-qty">{item.qty} {item.unit}</text>
        </g>
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

  .col-label {
    font-size: 6.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    fill: rgba(255, 255, 255, 0.22);
    text-anchor: middle;
  }

  .edge {
    fill: none;
    stroke: rgba(104, 211, 145, 0.18);
    stroke-width: 1.5;
  }

  .edge-out {
    stroke: rgba(104, 211, 145, 0.28);
  }

  .proc-rect {
    fill: rgba(99, 179, 237, 0.06);
    stroke: rgba(99, 179, 237, 0.4);
    stroke-width: 1;
  }

  .proc-label {
    font-size: 6px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    fill: rgba(99, 179, 237, 0.5);
  }

  .proc-name {
    font-size: 10px;
    fill: rgba(255, 255, 255, 0.85);
    font-weight: 500;
  }

  .card-rect {
    fill: rgba(255, 255, 255, 0.03);
    stroke-width: 1;
  }

  .card-intent {
    stroke-dasharray: 4 3;
  }

  .card-action {
    font-size: 6.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    fill: rgba(255, 255, 255, 0.3);
  }

  .card-spec {
    font-size: 11px;
    fill: rgba(255, 255, 255, 0.85);
  }

  .card-qty {
    font-size: 9px;
    fill: rgba(255, 255, 255, 0.5);
  }

  .oh-dot {
    fill: #d69e2e;
  }

  .oh-dot.oh-ok {
    fill: #68d391;
  }

  .oh-label {
    font-size: 7px;
    fill: rgba(255, 255, 255, 0.7);
    text-anchor: end;
  }

  .empty {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    opacity: 0.3;
    margin: 0;
  }
</style>
