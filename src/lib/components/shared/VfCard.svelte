<script lang="ts">
  interface Field {
    label: string;
    value: string;
  }

  interface Props {
    title: string;
    subtitle?: string;
    badge?: string;
    badgeColor?: string;
    fields?: Field[];
    class?: string;
  }

  const { title, subtitle, badge, badgeColor = '#718096', fields = [], class: cls = '' }: Props = $props();
</script>

<div class="vf-card {cls}">
  <div class="vf-card-header">
    <span class="vf-card-title">{title}</span>
    {#if badge}
      <span class="vf-card-badge" style="color:{badgeColor};border-color:{badgeColor}40">
        {badge}
      </span>
    {/if}
  </div>
  {#if subtitle}
    <div class="vf-card-subtitle">{subtitle}</div>
  {/if}
  {#if fields.length > 0}
    <dl class="vf-card-fields">
      {#each fields as f (f.label)}
        <dt>{f.label}</dt>
        <dd>{f.value}</dd>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .vf-card {
    background: rgba(26, 32, 44, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: var(--text-xs, 11px);
    color: #e2e8f0;
    min-width: 140px;
  }

  .vf-card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .vf-card-title {
    font-size: var(--text-sm, 12px);
    font-weight: 600;
    color: #e2e8f0;
    flex: 1;
  }

  .vf-card-badge {
    font-size: 10px;
    border: 1px solid;
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
  }

  .vf-card-subtitle {
    margin-top: 2px;
    font-size: 10px;
    color: rgba(226, 232, 240, 0.45);
  }

  .vf-card-fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    margin: 6px 0 0;
  }

  .vf-card-fields dt {
    color: rgba(226, 232, 240, 0.4);
    white-space: nowrap;
  }

  .vf-card-fields dd {
    margin: 0;
    color: rgba(226, 232, 240, 0.8);
    word-break: break-word;
  }
</style>
