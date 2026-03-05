<script lang="ts">
  import type { Recipe } from '$lib/schemas';

  interface Props {
    recipes: Recipe[];
    value?: string;
    onselect?: (id: string) => void;
    class?: string;
  }

  let { recipes, value, onselect, class: cls = '' }: Props = $props();
</script>

<select class="rs {cls}" onchange={e => onselect?.(e.currentTarget.value)}>
  <option value="">— select recipe —</option>
  {#each recipes as r}
    <option value={r.id} selected={r.id === value}>{r.name}</option>
  {/each}
</select>

<style>
  .rs {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
</style>
