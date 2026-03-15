import type { EconomicEvent, Commitment } from '$lib/schemas';

export interface FlowSelectCtx {
  processId:        string;
  procName:         string;
  specId:           string;
  specName:         string;
  action:           string;
  isInput:          boolean;
  commitmentId?:    string;
  commitment?:      Commitment;
  existingEvents:   EconomicEvent[];
  fulfilledQty:     number;
  plannedQty:       number;
  unit:             string;
  providerAgentId?: string;   // set for work flows; used by EventRecorderPanel
}
