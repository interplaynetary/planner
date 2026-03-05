<script lang="ts">
  import CostRollupView from '$lib/components/finance/CostRollupView.svelte';
  import ValueDistributionView from '$lib/components/finance/ValueDistributionView.svelte';
</script>

<CostRollupView />
<ValueDistributionView shares={[]} totalIncome={0} />
