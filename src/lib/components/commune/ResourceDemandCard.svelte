<script lang="ts">
  import type { Intent, ResourceSpecification } from "$lib/schemas";
  import { formatWhen, type AvailabilityWindow } from "$lib/utils/time";
  import { TimePatternEditor, LocationEditor } from "$lib/components/free/slots";
  import type { LocationData } from "$lib/components/free/slots";
  import type { CommuneDemandPolicy, DerivedDependentPolicy } from "$lib/observation/demand-policy";
  import DemandPolicyEditor from "./DemandPolicyEditor.svelte";

  interface Props {
    spec: ResourceSpecification;
    intents: Intent[];
    // Editing (omit for readonly)
    onAddDemand?: () => void;
    onUpdate?: (intent: Intent) => void;
    onDelete?: (id: string) => void;
    // Policy panel (for derived bands)
    policyKind?: 'independent' | 'dependent';
    memberCount?: number;
    dependentTotal?: number;
    independentTotal?: number;
    policy?: CommuneDemandPolicy | DerivedDependentPolicy;
    onSavePolicy?: (p: CommuneDemandPolicy | DerivedDependentPolicy) => void;
    onDeletePolicy?: () => void;
  }

  let {
    spec,
    intents,
    onAddDemand,
    onUpdate,
    onDelete,
    policyKind,
    memberCount,
    dependentTotal,
    independentTotal,
    policy,
    onSavePolicy,
    onDeletePolicy,
  }: Props = $props();

  const readonly = $derived(!onUpdate);

  let expandedTimeId = $state<string | null>(null);
  let expandedLocId  = $state<string | null>(null);
  let policyOpen     = $state(false);

  let localUnit = $state<string | null>(null);
  let localQtys = $state<Record<string, number>>({});

  function getUnit(): string {
    return localUnit ?? intents[0]?.resourceQuantity?.hasUnit ?? spec.defaultUnitOfResource ?? "units";
  }

  function getQty(intent: Intent): number {
    return localQtys[intent.id] ?? intent.resourceQuantity?.hasNumericalValue ?? 1;
  }

  function parseLocation(atLocation?: string): LocationData {
    if (!atLocation) return { locationType: "Undefined" };
    if (atLocation === "live") return { locationType: "Live" };
    if (atLocation.startsWith("http://") || atLocation.startsWith("https://"))
      return { locationType: "Online", note: atLocation };
    const coord = atLocation.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coord) return { locationType: "Coordinates", lat: parseFloat(coord[1]), long: parseFloat(coord[2]) };
    return { locationType: "Specific", mappableAddress: atLocation };
  }

  function serializeLocation(loc: LocationData): string | undefined {
    if (loc.locationType === "Undefined") return undefined;
    if (loc.locationType === "Live") return "live";
    if (loc.locationType === "Online") return loc.note || undefined;
    if (loc.locationType === "Coordinates")
      return loc.lat != null && loc.long != null ? `${loc.lat},${loc.long}` : undefined;
    return loc.mappableAddress || undefined;
  }

  function locLabel(atLocation?: string): string {
    if (!atLocation) return "—";
    if (atLocation === "live") return "live";
    if (atLocation.startsWith("http")) return "online";
    const coord = atLocation.match(/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/);
    if (coord) return "coords";
    return atLocation.slice(0, 8);
  }

  function toggleTime(id: string) {
    expandedTimeId = expandedTimeId === id ? null : id;
    if (expandedTimeId) expandedLocId = null;
  }

  function toggleLoc(id: string) {
    expandedLocId = expandedLocId === id ? null : id;
    if (expandedLocId) expandedTimeId = null;
  }

  function commitUnit() {
    const unit = getUnit();
    for (const intent of intents) {
      onUpdate?.({ ...intent, resourceQuantity: { hasNumericalValue: getQty(intent), hasUnit: unit } });
    }
  }

  function commitQty(intent: Intent) {
    onUpdate?.({ ...intent, resourceQuantity: { hasNumericalValue: getQty(intent), hasUnit: getUnit() } });
  }

  function handleTimeUpdate(intent: Intent, _rec: string | null, aw?: AvailabilityWindow) {
    onUpdate?.({ ...intent, availability_window: aw });
  }

  function handleLocUpdate(intent: Intent, loc: LocationData) {
    onUpdate?.({ ...intent, atLocation: serializeLocation(loc) });
  }
</script>

<div class="card">
  <!-- Header -->
  <div class="card-header">
    <span class="emoji">{spec.image ?? "📦"}</span>
    <span class="spec-name">{spec.name}</span>
    {#if readonly}
      <span class="unit-display">{getUnit()}</span>
    {:else}
      <input
        type="text"
        class="unit-input"
        value={getUnit()}
        oninput={(e) => { localUnit = e.currentTarget.value; }}
        onblur={commitUnit}
        title="Unit (applies to all rows)"
      />
    {/if}
    {#if policyKind}
      <button
        class="policy-btn"
        class:policy-btn--active={policyOpen}
        onclick={() => (policyOpen = !policyOpen)}
        title="Edit policy"
      >⚙</button>
    {/if}
  </div>

  <!-- Art band -->
  <div class="card-art" aria-hidden="true"></div>

  <!-- Classification tags -->
  {#if spec.resourceClassifiedAs?.filter(t => t !== 'communal-demand').length}
    <div class="tag-row">
      {#each spec.resourceClassifiedAs.filter(t => t !== 'communal-demand') as tag (tag)}
        <span class="class-tag class-tag--{tag}">{tag}</span>
      {/each}
    </div>
  {/if}

  <!-- Optional description -->
  {#if spec.note}
    <p class="card-desc">{spec.note}</p>
  {/if}

  <!-- Demand rows -->
  <div class="demand-rows">
    {#each intents as intent (intent.id)}
      <div class="row">
        {#if readonly}
          <span class="qty-text">{getQty(intent)}</span>
          <span class="unit-label">{getUnit()}</span>
          <span class="pill"
            title="Time pattern">⏰ {formatWhen(intent.availability_window) || "—"}</span>
          <span class="pill loc-pill"
            title="Location">📍 {locLabel(intent.atLocation)}</span>
        {:else}
          <input
            type="number"
            class="qty"
            value={getQty(intent)}
            oninput={(e) => { localQtys[intent.id] = parseFloat(e.currentTarget.value); }}
            onblur={() => commitQty(intent)}
            min="0"
            step="1"
          />
          <span class="unit-label">{getUnit()}</span>
          <button
            class="pill"
            class:active={expandedTimeId === intent.id}
            onclick={() => toggleTime(intent.id)}
            title="Time pattern"
          >⏰ {formatWhen(intent.availability_window) || "—"}</button>
          <button
            class="pill loc-pill"
            class:active={expandedLocId === intent.id}
            onclick={() => toggleLoc(intent.id)}
            title="Location"
          >📍 {locLabel(intent.atLocation)}</button>
          <button class="del" onclick={() => onDelete?.(intent.id)}>✕</button>
        {/if}
      </div>

      {#if !readonly && expandedTimeId === intent.id}
        <div class="expand-panel">
          <TimePatternEditor
            availabilityWindow={intent.availability_window}
            onUpdate={(r, aw) => handleTimeUpdate(intent, r, aw)}
          />
        </div>
      {/if}

      {#if !readonly && expandedLocId === intent.id}
        <div class="expand-panel">
          <LocationEditor
            {...parseLocation(intent.atLocation)}
            onUpdate={(loc) => handleLocUpdate(intent, loc)}
          />
        </div>
      {/if}
    {/each}

    {#if !readonly}
      <button class="add-row" onclick={onAddDemand}>+ Add demand</button>
    {/if}
  </div>

  <!-- Policy panel -->
  {#if policyKind && policyOpen}
    <DemandPolicyEditor
      kind={policyKind}
      specId={spec.id}
      unit={getUnit()}
      {memberCount}
      {dependentTotal}
      {independentTotal}
      {policy}
      onSave={(p) => { onSavePolicy?.(p); policyOpen = false; }}
      onDelete={onDeletePolicy ? () => { onDeletePolicy?.(); policyOpen = false; } : undefined}
    />
  {/if}
</div>

<style>
  .card {
    width: 200px;
    min-height: 200px;
    flex-shrink: 0;
    background: #16161e;
    border: 1px solid var(--border-dim);
    border-left: 3px solid rgba(124, 58, 237, 0.8);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-overlay);
    padding: 5px 6px;
    border-bottom: 1px solid var(--border-faint);
  }

  .emoji { font-size: 0.9rem; flex-shrink: 0; }

  .spec-name {
    flex: 1;
    font-weight: 600;
    font-size: 0.8rem;
    color: #e2e8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .unit-input {
    width: 44px;
    font-family: monospace;
    font-size: 0.6rem;
    color: rgba(167, 139, 250, 0.9);
    background: var(--border-faint);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    padding: 1px 3px;
    text-align: center;
    flex-shrink: 0;
  }

  .unit-input:focus {
    outline: none;
    border-color: rgba(124, 58, 237, 0.5);
    background: rgba(124, 58, 237, 0.08);
  }

  .unit-display {
    font-family: monospace;
    font-size: 0.6rem;
    color: rgba(167, 139, 250, 0.7);
    flex-shrink: 0;
    padding: 1px 3px;
  }

  .policy-btn {
    font-size: 0.7rem;
    padding: 1px 4px;
    background: var(--border-faint);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.4);
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .policy-btn:hover { background: rgba(255, 255, 255, 0.1); color: rgba(255,255,255,0.7); }

  .policy-btn--active {
    background: rgba(124, 58, 237, 0.2);
    border-color: rgba(124, 58, 237, 0.5);
    color: #c4b5fd;
  }

  .card-art {
    height: 36px;
    flex-shrink: 0;
    overflow: hidden;
    background:
      repeating-linear-gradient(
        -45deg,
        rgba(124, 58, 237, 0.06) 0px,
        rgba(124, 58, 237, 0.06) 1px,
        transparent 1px,
        transparent 6px
      ),
      linear-gradient(135deg, rgba(124, 58, 237, 0.18) 0%, rgba(0,0,0,0) 100%);
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    padding: 4px 7px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .class-tag {
    font-size: 0.54rem;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.03em;
    text-transform: lowercase;
    color: rgba(255, 255, 255, 0.5);
    background: var(--bg-overlay);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .class-tag--individual-claimable {
    color: #fde68a;
    background: rgba(234, 179, 8, 0.1);
    border-color: rgba(234, 179, 8, 0.35);
  }

  .class-tag--communal {
    color: #86efac;
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.3);
  }

  .card-desc {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.35);
    padding: 4px 7px;
    margin: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    line-height: 1.3;
  }

  .demand-rows { display: flex; flex-direction: column; flex: 1; }

  .row {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .qty {
    width: 48px;
    text-align: right;
    background: var(--border-faint);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    border-radius: 3px;
    padding: 2px 5px;
    font-size: 0.72rem;
    flex-shrink: 0;
    appearance: textfield;
  }
  .qty::-webkit-inner-spin-button,
  .qty::-webkit-outer-spin-button { display: none; }

  .qty-text {
    width: 48px;
    text-align: right;
    font-size: 0.72rem;
    font-weight: 600;
    color: #e2e8f0;
    flex-shrink: 0;
    font-family: monospace;
  }

  .unit-label {
    font-family: monospace;
    font-size: 0.6rem;
    color: rgba(167, 139, 250, 0.65);
    flex-shrink: 0;
    max-width: 36px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill {
    flex: 1;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: var(--bg-overlay);
    color: rgba(255, 255, 255, 0.45);
    font-size: 0.6rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    padding: 2px 4px;
    border-radius: 3px;
    min-width: 0;
  }

  button.pill {
    cursor: pointer;
  }

  .loc-pill { flex: 0 0 auto; max-width: 52px; }

  button.pill.active {
    background: rgba(124, 58, 237, 0.2);
    border-color: rgba(124, 58, 237, 0.5);
    color: #c4b5fd;
  }

  .del {
    border: 1px solid rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.08);
    color: rgba(239, 68, 68, 0.6);
    padding: 1px 4px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.6rem;
    flex-shrink: 0;
  }

  .del:hover { background: rgba(239, 68, 68, 0.18); }

  .expand-panel {
    background: rgba(0, 0, 0, 0.25);
    border-bottom: 1px solid var(--border-faint);
  }

  .add-row {
    margin: 5px 7px;
    border: 1px dashed rgba(124, 58, 237, 0.35);
    color: rgba(167, 139, 250, 0.6);
    background: transparent;
    border-radius: 3px;
    font-size: 0.65rem;
    padding: 2px 7px;
    cursor: pointer;
    align-self: flex-start;
  }

  .add-row:hover { background: rgba(124, 58, 237, 0.1); }
</style>
