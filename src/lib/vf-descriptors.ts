export type EntityType =
  | 'processSpec' | 'resourceSpec'
  | 'process' | 'resource'
  | 'commitment' | 'plan' | 'agent';

export type FieldKind =
  | 'text'     // string — rendered as-is
  | 'boolean'  // boolean — rendered as 'yes' / 'no'
  | 'date'     // ISO datetime string — rendered as locale date
  | 'measure'  // { hasNumericalValue, hasUnit } — rendered as "n unit"
  | 'ref';     // string ID — rendered as a clickable named link

export interface FieldDesc {
  key: string;
  label: string;
  kind: FieldKind;
  refType?: EntityType;
}

export interface BackRefDesc {
  label: string;
  storeKey: StoreKey;
  matchField: string;
  entityType: EntityType;
}

export interface EntityDesc {
  label: string;
  color: string;
  nameField: string;
  fields: FieldDesc[];
  backRefs?: BackRefDesc[];
}

export const ENTITY_DESCS: Record<EntityType, EntityDesc> = {
  processSpec: {
    label: 'ProcessSpecification', color: '#d69e2e', nameField: 'name',
    fields: [
      { key: 'note',              label: 'note',       kind: 'text' },
      { key: 'bufferType',        label: 'bufferType', kind: 'text' },
      { key: 'isDecouplingPoint', label: 'decoupling', kind: 'boolean' },
      { key: 'isControlPoint',    label: 'control pt', kind: 'boolean' },
    ],
    backRefs: [
      { label: 'PROCESSES', storeKey: 'processList', matchField: 'basedOn', entityType: 'process' },
    ],
  },
  resourceSpec: {
    label: 'ResourceSpecification', color: '#4299e1', nameField: 'name',
    fields: [
      { key: 'note',                  label: 'note',           kind: 'text' },
      { key: 'defaultUnitOfResource', label: 'unit',           kind: 'text' },
      { key: 'substitutable',         label: 'substitutable',  kind: 'boolean' },
      { key: 'mediumOfExchange',      label: 'medium of exch', kind: 'boolean' },
    ],
    backRefs: [
      { label: 'RESOURCES',   storeKey: 'resourceList',   matchField: 'conformsTo',         entityType: 'resource' },
      { label: 'COMMITMENTS', storeKey: 'commitmentList', matchField: 'resourceConformsTo', entityType: 'commitment' },
    ],
  },
  process: {
    label: 'Process', color: '#9f7aea', nameField: 'name',
    fields: [
      { key: 'note',          label: 'note',     kind: 'text' },
      { key: 'basedOn',       label: 'spec',     kind: 'ref', refType: 'processSpec' },
      { key: 'plannedWithin', label: 'plan',     kind: 'ref', refType: 'plan' },
      { key: 'hasBeginning',  label: 'began',    kind: 'date' },
      { key: 'hasEnd',        label: 'ended',    kind: 'date' },
      { key: 'finished',      label: 'finished', kind: 'boolean' },
    ],
    backRefs: [
      { label: 'COMMITMENTS (inputs)',  storeKey: 'commitmentList', matchField: 'inputOf',  entityType: 'commitment' },
      { label: 'COMMITMENTS (outputs)', storeKey: 'commitmentList', matchField: 'outputOf', entityType: 'commitment' },
    ],
  },
  resource: {
    label: 'EconomicResource', color: '#38a169', nameField: 'name',
    fields: [
      { key: 'conformsTo',         label: 'spec',        kind: 'ref', refType: 'resourceSpec' },
      { key: 'note',               label: 'note',        kind: 'text' },
      { key: 'onhandQuantity',     label: 'on-hand',     kind: 'measure' },
      { key: 'accountingQuantity', label: 'accounting',  kind: 'measure' },
      { key: 'trackingIdentifier', label: 'tracking id', kind: 'text' },
      { key: 'stage',              label: 'stage',       kind: 'ref', refType: 'processSpec' },
    ],
  },
  commitment: {
    label: 'Commitment', color: '#718096', nameField: 'action',
    fields: [
      { key: 'action',             label: 'action',    kind: 'text' },
      { key: 'note',               label: 'note',      kind: 'text' },
      { key: 'resourceConformsTo', label: 'resource',  kind: 'ref', refType: 'resourceSpec' },
      { key: 'inputOf',            label: 'input of',  kind: 'ref', refType: 'process' },
      { key: 'outputOf',           label: 'output of', kind: 'ref', refType: 'process' },
      { key: 'resourceQuantity',   label: 'qty',       kind: 'measure' },
      { key: 'due',                label: 'due',       kind: 'date' },
      { key: 'finished',           label: 'finished',  kind: 'boolean' },
    ],
  },
  plan: {
    label: 'Plan', color: '#ed8936', nameField: 'name',
    fields: [
      { key: 'note',    label: 'note',    kind: 'text' },
      { key: 'due',     label: 'due',     kind: 'date' },
      { key: 'created', label: 'created', kind: 'date' },
    ],
    backRefs: [
      { label: 'PROCESSES', storeKey: 'processList', matchField: 'plannedWithin', entityType: 'process' },
    ],
  },
  agent: {
    label: 'Agent', color: '#4fd1c5', nameField: 'name',
    fields: [
      { key: 'type', label: 'type', kind: 'text' },
      { key: 'note', label: 'note', kind: 'text' },
    ],
  },
};

export type StoreKey =
  | 'processSpecs' | 'resourceSpecs' | 'processList' | 'resourceList'
  | 'commitmentList' | 'planList' | 'agentList' | 'capacityBufferList';

export const ENTITY_STORE: Record<EntityType, StoreKey> = {
  processSpec: 'processSpecs',
  resourceSpec: 'resourceSpecs',
  process: 'processList',
  resource: 'resourceList',
  commitment: 'commitmentList',
  plan: 'planList',
  agent: 'agentList',
};
