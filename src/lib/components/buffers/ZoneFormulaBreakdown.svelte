<script lang="ts">
  import type { BufferZone, BufferProfile } from "$lib/schemas";
  import type { BufferZoneComputation } from "$lib/algorithms/ddmrp";

  interface Props {
    bufferZone: BufferZone;
    profile?: BufferProfile;
    comp?: BufferZoneComputation;
    class?: string;
  }

  let { bufferZone, profile, comp, class: cls = "" }: Props = $props();

  // Build rows from zone data
  const rows = $derived([
    { label: "ADU", val: bufferZone.adu.toFixed(3), unit: bufferZone.aduUnit },
    { label: "DLT", val: bufferZone.dltDays.toFixed(1), unit: "days" },
    ...(profile
      ? [
          { label: "LTF", val: profile.leadTimeFactor.toFixed(2), unit: "" },
          { label: "VF", val: profile.variabilityFactor.toFixed(2), unit: "" },
        ]
      : []),
    ...(comp
      ? [
          {
            label: "Red Base",
            val: comp.redBase.toFixed(2),
            unit: bufferZone.aduUnit,
          },
          {
            label: "Red Safety",
            val: comp.redSafety.toFixed(2),
            unit: bufferZone.aduUnit,
          },
        ]
      : []),
    { label: "TOR", val: bufferZone.tor.toFixed(2), unit: bufferZone.aduUnit },
    { label: "TOY", val: bufferZone.toy.toFixed(2), unit: bufferZone.aduUnit },
    { label: "TOG", val: bufferZone.tog.toFixed(2), unit: bufferZone.aduUnit },
  ]);
</script>

<dl class="zfb {cls}">
  {#each rows as r}
    <dt>{r.label}</dt>
    <dd>{r.val}<span class="unit">{r.unit}</span></dd>
  {/each}
</dl>

<style>
  .zfb {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px var(--gap-lg);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    margin: 0;
  }
  dt {
    opacity: var(--muted);
    white-space: nowrap;
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
  .unit {
    margin-left: 3px;
    opacity: var(--muted);
    font-weight: 400;
  }
</style>
