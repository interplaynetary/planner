<script lang="ts">
  import AdjustmentFactorDashboard from '$lib/components/adjustments/AdjustmentFactorDashboard.svelte';
  import RecalibrationQueue from '$lib/components/adjustments/RecalibrationQueue.svelte';
</script>

<AdjustmentFactorDashboard factors={[]} />
<RecalibrationQueue zones={[]} profileMap={new Map()} />
