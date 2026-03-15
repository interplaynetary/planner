<script lang="ts">
  import type { BufferZone } from "$lib/schemas";
  import ZoneBadge from "$lib/components/ui/ZoneBadge.svelte";
  import BufferZoneBar from "$lib/components/ui/BufferZoneBar.svelte";

  type ReasonCode = NonNullable<BufferZone["overrideReason"]>;

  interface Props {
    bufferZone: BufferZone;
    /** Current physical on-hand for live zone display */
    onhand: number;
    onSave?: (reason: ReasonCode, note: string) => void;
    class?: string;
  }

  let { bufferZone, onhand, onSave, class: cls = "" }: Props = $props();

  let reason = $state<ReasonCode | "">("");
  let note = $state("");

  const pct = $derived(
    bufferZone.tog > 0 ? (onhand / bufferZone.tog) * 100 : 0,
  );

  const zone = $derived(
    onhand <= 0
      ? "stockout"
      : onhand <= bufferZone.tor
        ? "red"
        : onhand <= bufferZone.toy
          ? "yellow"
          : onhand <= bufferZone.tog
            ? "green"
            : "excess",
  );

  const canSave = $derived(
    reason !== "" && (reason !== "other" || note.trim().length > 0),
  );

  function handleSave() {
    if (!canSave || reason === "") return;
    onSave?.(reason, note.trim());
    reason = "";
    note = "";
  }
</script>

<div class="bop {cls}">
  <!-- Status header — warning border signals execution-time action -->
  <div class="header">
    <div class="header-top">
      <ZoneBadge {zone} pct={pct} />
      <span class="oh-label">{onhand.toFixed(1)} on-hand</span>
    </div>
    <BufferZoneBar
      value={onhand}
      tor={bufferZone.tor}
      toy={bufferZone.toy}
      tog={bufferZone.tog}
    />
  </div>

  <!-- Reason code form -->
  <div class="form">
    <label class="form-label" for="bop-reason">Flag outlier reason</label>
    <select id="bop-reason" class="select" bind:value={reason}>
      <option value="">— select reason —</option>
      <option value="space">Space constraint</option>
      <option value="cash">Cash / capital constraint</option>
      <option value="contractual">Contractual limit</option>
      <option value="other">Other (specify below)</option>
    </select>

    <textarea
      class="note-area"
      placeholder={reason === "other"
        ? "Note required for 'other'…"
        : "Optional note…"}
      rows={3}
      bind:value={note}
    ></textarea>

    <button class="save-btn" onclick={handleSave} disabled={!canSave}>
      Save Reason Code
    </button>
  </div>
</div>

<style>
  .bop {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    border: 1px solid var(--zone-yellow);
    border-radius: 4px;
    padding: var(--gap-md);
  }

  /* Status header */
  .header {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .oh-label {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    opacity: var(--muted);
  }

  /* Form */
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .form-label {
    font-size: var(--text-xs);
    font-weight: 500;
    opacity: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .select,
  .note-area {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    background: transparent;
    border: 1px solid var(--border-dim);
    border-radius: 3px;
    padding: 4px 6px;
    color: inherit;
    width: 100%;
    box-sizing: border-box;
  }

  .select:focus,
  .note-area:focus {
    outline: none;
    border-color: var(--zone-yellow);
  }

  .note-area {
    resize: vertical;
    min-height: 48px;
  }

  .save-btn {
    align-self: flex-start;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 3px;
    border: 1px solid var(--zone-yellow);
    background: var(--zone-yellow-fill);
    color: var(--zone-yellow);
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .save-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .save-btn:not(:disabled):hover {
    opacity: 0.8;
  }
</style>
