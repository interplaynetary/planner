/**
 * tooltip.svelte.ts — shared tooltip state for cross-component hover tooltips.
 *
 * Usage:
 *   import { showTip, hideTip, moveTip, tipState } from '$lib/tooltip.svelte';
 *
 *   <rect onmouseenter={(e) => showTip(e, ['Process: Fab Frame', 'Spec: Frame Fab'])}
 *         onmouseleave={hideTip}
 *         onmousemove={moveTip} />
 *
 * Render <TooltipOverlay /> once in your layout or page.
 */

export const tipState = $state({
  visible: false,
  x: 0,
  y: 0,
  lines: [] as string[],
});

export function showTip(e: MouseEvent, lines: string[]) {
  tipState.visible = true;
  tipState.x = e.clientX + 14;
  tipState.y = e.clientY - 8;
  tipState.lines = lines;
}

export function hideTip() {
  tipState.visible = false;
}

export function moveTip(e: MouseEvent) {
  if (tipState.visible) {
    tipState.x = e.clientX + 14;
    tipState.y = e.clientY - 8;
  }
}
