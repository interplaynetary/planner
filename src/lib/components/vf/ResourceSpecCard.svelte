<script lang="ts">
  import type { ResourceSpecification } from '$lib/schemas';

  interface Props {
    spec: ResourceSpecification;
  }

  let { spec }: Props = $props();

  const accentColor = $derived(
    spec.replenishmentRequired
      ? 'var(--zone-green)'
      : spec.mediumOfExchange
        ? 'var(--zone-yellow)'
        : spec.substitutable
          ? 'var(--zone-excess)'
          : 'rgba(255,255,255,0.12)',
  );

  const accentRgb = $derived(
    spec.replenishmentRequired
      ? '56,161,105'
      : spec.mediumOfExchange
        ? '214,158,46'
        : spec.substitutable
          ? '49,130,206'
          : '255,255,255',
  );

  function dotCount(level: 'low' | 'medium' | 'high' | undefined): number {
    if (level === 'low') return 1;
    if (level === 'medium') return 2;
    if (level === 'high') return 3;
    return 0;
  }

  const pa = $derived(spec.positioningAnalysis);
  const classifications = $derived(
    (spec.resourceClassifiedAs ?? [])
      .map((c) => c.split(':').at(-1) ?? c)
      .filter((c) => c !== 'replenishment-required'),
  );
</script>

<div class="card" style="--accent: {accentColor}; --accent-rgb: {accentRgb};">
  <!-- Header bar -->
  <div class="card-header">
    <span class="classification">
      {#if classifications.length > 0}
        {classifications[0]}
      {:else}
        spec
      {/if}
    </span>
    {#if spec.defaultUnitOfResource}
      <span class="unit">{spec.defaultUnitOfResource}</span>
    {/if}
  </div>

  <!-- Decorative gradient area -->
  <div class="card-art" aria-hidden="true"></div>

  <!-- Body -->
  <div class="card-body">
    <div class="spec-name">{spec.name}</div>

    {#if spec.note}
      <p class="spec-note">{spec.note}</p>
    {/if}

    <!-- Tag pills -->
    {#if spec.replenishmentRequired || spec.mediumOfExchange || spec.substitutable}
      <div class="pills">
        {#if spec.replenishmentRequired}<span class="pill green">replen</span>{/if}
        {#if spec.mediumOfExchange}<span class="pill yellow">exchange</span>{/if}
        {#if spec.substitutable}<span class="pill blue">sub</span>{/if}
      </div>
    {/if}

    <!-- Positioning indicators -->
    {#if pa}
      <div class="positioning">
        {#if pa.vrd}
          <span class="pos-row">
            <span class="pos-label">VRD</span>
            <span class="dots">
              {#each [1, 2, 3] as i (i)}
                <span class="dot" class:filled={i <= dotCount(pa.vrd)}></span>
              {/each}
            </span>
          </span>
        {/if}
        {#if pa.vrs}
          <span class="pos-row">
            <span class="pos-label">VRS</span>
            <span class="dots">
              {#each [1, 2, 3] as i (i)}
                <span class="dot" class:filled={i <= dotCount(pa.vrs)}></span>
              {/each}
            </span>
          </span>
        {/if}
        {#if pa.inventoryLeverageFlexibility}
          <span class="pos-row">
            <span class="pos-label">ILF</span>
            <span class="pos-val">{pa.inventoryLeverageFlexibility}</span>
          </span>
        {/if}
        {#if pa.customerToleranceTimeDays != null}
          <span class="pos-row">
            <span class="pos-label">CTT</span>
            <span class="pos-val">{pa.customerToleranceTimeDays}d</span>
          </span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .card {
    width: 160px;
    min-height: 240px;
    flex-shrink: 0;
    background: #16161e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    transition: border-color 0.15s;
  }

  .card:hover {
    border-color: rgba(255, 255, 255, 0.2);
    border-left-color: var(--accent);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
    background: var(--border-faint);
    border-bottom: 1px solid var(--border-faint);
    gap: 4px;
  }

  .classification {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .unit {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .card-art {
    height: 52px;
    background:
      repeating-linear-gradient(
        -45deg,
        rgba(var(--accent-rgb), 0.04) 0px,
        rgba(var(--accent-rgb), 0.04) 1px,
        transparent 1px,
        transparent 6px
      ),
      linear-gradient(
        135deg,
        rgba(var(--accent-rgb), 0.12) 0%,
        rgba(0, 0, 0, 0) 100%
      );
    flex-shrink: 0;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 7px 7px 8px;
    flex: 1;
  }

  .spec-name {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    color: #e2e8f0;
  }

  .spec-note {
    font-size: 0.65rem;
    font-style: italic;
    opacity: 0.55;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.3;
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .pill {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    padding: 1px 4px;
    border-radius: 2px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .pill.green {
    background: rgba(56, 161, 105, 0.15);
    color: var(--zone-green);
  }

  .pill.yellow {
    background: rgba(214, 158, 46, 0.15);
    color: var(--zone-yellow);
  }

  .pill.blue {
    background: rgba(49, 130, 206, 0.15);
    color: var(--zone-excess);
  }

  .positioning {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: auto;
    padding-top: 4px;
    border-top: 1px solid var(--border-faint);
  }

  .pos-row {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .pos-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    opacity: 0.45;
    width: 24px;
    flex-shrink: 0;
  }

  .dots {
    display: flex;
    gap: 2px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--bg-elevated);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .dot.filled {
    background: var(--accent);
    border-color: var(--accent);
  }

  .pos-val {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--accent);
  }
</style>
