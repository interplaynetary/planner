<script lang="ts">
  import type { BufferType } from '$lib/utils/buffer-type';

  interface Props {
    type: BufferType;
  }

  let { type }: Props = $props();

  const labels: Record<BufferType, string> = {
    ecological:  'ECO',
    strategic:   'STR',
    reserve:     'RES',
    social:      'SOC',
    consumption: 'CON',
    metabolic:   'MET',
  };
</script>

<span class="type-badge {type}">{labels[type]}</span>

<style>
  .type-badge {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 1px 5px;
    border-radius: 2px;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .ecological  { background: rgba(56, 178, 172, 0.15); color: #38b2ac; }
  .strategic   { background: rgba(66, 153, 225, 0.15); color: #4299e1; }
  .metabolic   { background: rgba(72, 187, 120, 0.12); color: var(--zone-green); }
  .reserve     { background: rgba(214, 158, 46, 0.15); color: var(--zone-yellow); }
  .social      { background: rgba(159, 122, 234, 0.15); color: #9f7aea; }
  .consumption { background: rgba(160, 174, 192, 0.12); color: #a0aec0; }
</style>
