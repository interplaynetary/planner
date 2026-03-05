<script lang="ts">
  import type { PlanningRow } from '$lib/components/planning/PlanningScreen.svelte';
  import type { SignalIntegrityEntry } from '$lib/algorithms/ddmrp';
  import type { BufferZone } from '$lib/schemas';
  import PlanningScreen from '$lib/components/planning/PlanningScreen.svelte';
  import SignalIntegrityReport from '$lib/components/execution/SignalIntegrityReport.svelte';
  import BufferStatusDashboard from '$lib/components/execution/BufferStatusDashboard.svelte';
  import FlowExceptionReport from './FlowExceptionReport.svelte';
  import TimeBufferBoard from '$lib/components/scheduling/TimeBufferBoard.svelte';

  interface FlowException {
    orderId: string;
    date: string;
    domain: string;
    duration?: number;
    dueDate?: string;
  }

  interface BufferEntry {
    bufferZone: BufferZone;
    onhand: number;
    specName?: string;
  }

  interface Props {
    planningRows?: PlanningRow[];
    signalEntries?: SignalIntegrityEntry[];
    bufferEntries?: BufferEntry[];
    exceptionEntries?: FlowException[];
    class?: string;
  }

  let { planningRows = [], signalEntries = [], bufferEntries = [], exceptionEntries = [], class: cls = '' }: Props = $props();
</script>

<div class="ddom {cls}">
  <div class="col">
    <PlanningScreen rows={planningRows} />
    <SignalIntegrityReport entries={signalEntries} />
  </div>
  <div class="col">
    <BufferStatusDashboard entries={bufferEntries} />
  </div>
  <div class="col">
    <FlowExceptionReport entries={exceptionEntries} />
  </div>
</div>

<style>
  .ddom {
    display: flex;
    flex-direction: row;
    gap: var(--gap-md);
  }
  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    min-width: 0;
  }
</style>
