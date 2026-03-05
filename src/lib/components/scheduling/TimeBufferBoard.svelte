<script lang="ts">
  import type { Commitment, BufferZone } from "$lib/schemas";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";

  interface Props {
    commitments: Commitment[];
    bufferZone: BufferZone;
    today?: Date;
    class?: string;
  }

  let {
    commitments,
    bufferZone,
    today = new Date(),
    class: cls = "",
  }: Props = $props();

  const dltMs = $derived(bufferZone.dltDays * 86_400_000);

  function timeZone(
    c: Commitment,
  ): "early" | "green" | "yellow" | "red" | "late" {
    if (!c.due) return "early";
    const msLeft = new Date(c.due).getTime() - today.getTime();
    const third = dltMs / 3;
    if (msLeft < 0) return "late";
    if (msLeft < third) return "red";
    if (msLeft < third * 2) return "yellow";
    if (msLeft < dltMs) return "green";
    return "early";
  }

  interface Row {
    commitment: Commitment;
    zone: ReturnType<typeof timeZone>;
    daysLeft: number | null;
    pct: number; // progress along timeline 0-100
  }

  const rows = $derived(
    commitments.map((c) => {
      const zone = timeZone(c);
      const daysLeft = c.due
        ? (new Date(c.due).getTime() - today.getTime()) / 86_400_000
        : null;
      // position on the bar: clamp 0-100, 0=now, 100=0 days left (due)
      const pct =
        daysLeft !== null
          ? Math.max(
              0,
              Math.min(100, 100 - (daysLeft / bufferZone.dltDays) * 100),
            )
          : 0;
      return { commitment: c, zone, daysLeft, pct } satisfies Row;
    }),
  );
</script>

<div class="tbb {cls}">
  <!-- Zone axis header -->
  <div class="axis">
    <span class="early-lbl">Earlier</span>
    <div class="zones">
      <div class="z green" style="flex:1"><span>G</span></div>
      <div class="z yellow" style="flex:0.5"><span>Y</span></div>
      <div class="z red" style="flex:0.5"><span>R</span></div>
    </div>
    <span class="late-lbl">Late</span>
  </div>

  <!-- Rows -->
  {#each rows as r}
    <div class="row">
      <span class="id">{r.commitment.id.slice(0, 8)}</span>
      <div class="track">
        <div class="dot {r.zone}" style="left:{r.pct}%"></div>
      </div>
      <ZoneBadge zone={r.zone} />
      {#if r.daysLeft !== null}
        <span class="days"
          >{r.daysLeft >= 0 ? r.daysLeft.toFixed(1) : "!"} d</span
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .tbb {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .axis {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
    opacity: var(--muted);
  }
  .zones {
    display: flex;
    flex: 1;
    height: 4px;
    border-radius: 2px;
    overflow: hidden;
  }
  .z {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .z span {
    display: none;
  } /* labels hidden at small size */
  .z.green {
    background: var(--zone-green);
  }
  .z.yellow {
    background: var(--zone-yellow);
  }
  .z.red {
    background: var(--zone-red);
  }
  .early-lbl,
  .late-lbl {
    white-space: nowrap;
    font-size: var(--text-xs);
  }
  .late-lbl {
    color: var(--zone-late);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }

  .id {
    width: 6ch;
    opacity: var(--muted);
    overflow: hidden;
  }

  .track {
    position: relative;
    flex: 1;
    height: 2px;
    background: rgba(255, 255, 255, 0.1);
  }
  .dot {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .dot.early {
    background: var(--zone-early);
  }
  .dot.green {
    background: var(--zone-green);
  }
  .dot.yellow {
    background: var(--zone-yellow);
  }
  .dot.red {
    background: var(--zone-red);
  }
  .dot.late {
    background: var(--zone-late);
  }

  .days {
    width: 5ch;
    text-align: right;
    opacity: 0.7;
  }
</style>
