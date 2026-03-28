/**
 * ValueFlows Schemas — Zod schemas for the VF ontology
 *
 * Three-level model:
 *   Specification (catalog type)  →  ResourceSpecification, ProcessSpecification
 *   Classification (loose tags)   →  classifiedAs: string[]  (URIs, taxonomy refs)
 *   Instance (observed/tracked)   →  EconomicResource, Process, EconomicEvent
 *
 * Temporal layers (future → past):
 *   Intent  →  Commitment  →  EconomicEvent
 *     ↑ satisfies    ↑ fulfills
 *
 * Knowledge layer (templates):
 *   Recipe  →  RecipeProcess  →  RecipeFlow
 */

import { z } from 'zod';
import { TemporalExpressionSchema } from './utils/time';

// =============================================================================
// PRIMITIVES
// =============================================================================

/**
 * Measure — a quantity with a unit.
 * VF uses OM2 units; we store the unit label or URI.
 */
export const MeasureSchema = z.object({
    hasNumericalValue: z.number(),
    hasUnit: z.string(),       // e.g. "kg", "hours", "each", or an OM2 URI
});
export type Measure = z.infer<typeof MeasureSchema>;

/**
 * Duration — time span for processes and recipes.
 */
export const DurationSchema = z.object({
    hasNumericalValue: z.number(),
    hasUnit: z.string(),       // e.g. "hours", "minutes", "days"
});
export type Duration = z.infer<typeof DurationSchema>;

/**
 * Unit — measurement unit definition.
 */
export const UnitSchema = z.object({
    id: z.string(),
    label: z.string(),
    symbol: z.string(),
    classifiedAs: z.array(z.string()).optional(), // taxonomy URIs
});
export type Unit = z.infer<typeof UnitSchema>;

/**
 * SpatialThing — a location in space.
 */
export const SpatialThingSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    note: z.string().optional(),
    lat: z.number().optional(),
    long: z.number().optional(),
    alt: z.number().optional(),
    mappableAddress: z.string().optional(),
    containedIn: z.string().optional(),
});
export type SpatialThing = z.infer<typeof SpatialThingSchema>;

/**
 * BatchLotRecord — tracking for serialized/lot-controlled resources.
 */
export const BatchLotRecordSchema = z.object({
    id: z.string(),
    batchLotCode: z.string().optional(),
    expirationDate: z.string().datetime().optional(),
});
export type BatchLotRecord = z.infer<typeof BatchLotRecordSchema>;

// =============================================================================
// ACTIONS — The 19 standard VF actions
// =============================================================================

/**
 * VF Action enum — the fixed set of actions that flows can perform.
 * Each action has defined effects on resources (accounting, onhand, location, etc.)
 */
export const VfAction = z.enum([
    'produce',
    'consume',
    'use',
    'work',
    'cite',
    'deliverService',
    'pickup',
    'dropoff',
    'accept',
    'modify',
    'combine',
    'separate',
    'transferAllRights',
    'transferCustody',
    'transfer',
    'move',
    'copy',
    'raise',
    'lower',
]);
export type VfAction = z.infer<typeof VfAction>;

/** Effect types that an action can have on a resource quantity. */
export type QuantityEffect = 'increment' | 'decrement' | 'decrementIncrement' | 'incrementTo' | 'noEffect';

/** Effect on location, stage, state, containment, or accountable agent. */
export type PropertyEffect = 'update' | 'updateTo' | 'remove' | 'new' | 'noEffect';

/**
 * ActionDefinition — encodes the behavioral rules for each VF action.
 * This is data-driven: the Observer reads this to know how to apply events.
 */
export interface ActionDefinition {
    /** Which quantity properties are meaningful for events with this action. */
    eventQuantity: 'resourceQuantity' | 'effortQuantity' | 'both';
    /** Whether this action is input, output, or not related to a process. */
    inputOutput: 'input' | 'output' | 'outputInput' | 'notApplicable';
    /** Action that pairs with this one in the same process (e.g. accept↔modify). */
    pairsWith?: VfAction;
    /** Whether this action can create a new resource. */
    createResource: 'optional' | 'optionalTo' | 'noEffect';
    /** Effect on accountingQuantity. */
    accountingEffect: QuantityEffect;
    /** Effect on onhandQuantity. */
    onhandEffect: QuantityEffect;
    /** Effect on currentLocation. */
    locationEffect: PropertyEffect;
    /** Effect on containedIn. */
    containedEffect: PropertyEffect;
    /** Effect on primaryAccountable. */
    accountableEffect: PropertyEffect;
    /** Effect on stage (process specification of output process). */
    stageEffect: PropertyEffect;
    /** Effect on state. */
    stateEffect: PropertyEffect;
    /**
     * Implied transfer behavior when provider ≠ receiver (GAP-F).
     * VF spec: transfers.md §Explicit and implied transfers, actions.md §Implied Transfers.
     * - 'allRights': applies transferAllRights behavior additionally (consume, produce)
     * - 'custody': applies transferCustody behavior additionally (pickup, dropoff, accept, modify)
     * - null: no implied transfer
     */
    impliesTransfer: 'allRights' | 'custody' | null;
    /**
     * Whether this action can meaningfully participate in an Exchange / Agreement.
     * False for custody-only actions (pickup, dropoff, accept, modify) which the
     * VF spec says "don't make sense to include in an exchange".
     */
    eligibleForExchange: boolean;
}

/**
 * ACTION_DEFINITIONS — the complete behavioral table for all 19 VF actions.
 * Derived from the VF spec actions table.
 */
export const ACTION_DEFINITIONS: Record<VfAction, ActionDefinition> = {
    produce: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'output',
        createResource: 'optional',
        accountingEffect: 'increment',
        onhandEffect: 'increment',
        locationEffect: 'new',
        containedEffect: 'noEffect',
        accountableEffect: 'new',
        stageEffect: 'update',
        stateEffect: 'update',
        impliesTransfer: 'allRights',
        eligibleForExchange: true,
    },
    consume: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'input',
        createResource: 'noEffect',
        accountingEffect: 'decrement',
        onhandEffect: 'decrement',
        locationEffect: 'noEffect',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'update',
        impliesTransfer: 'allRights',
        eligibleForExchange: true,
    },
    use: {
        eventQuantity: 'both',
        inputOutput: 'input',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'noEffect',
        locationEffect: 'noEffect',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'update',      // applying a tool can transition its state
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    work: {
        eventQuantity: 'effortQuantity', // labour is always measured in effort, not resource qty
        inputOutput: 'input',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'noEffect',
        locationEffect: 'noEffect',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'noEffect',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    cite: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'input',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'noEffect',
        locationEffect: 'noEffect',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'update',      // citing can record state transition on the cited resource
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    deliverService: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'outputInput',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'noEffect',
        locationEffect: 'noEffect',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'noEffect',
        // VF spec transfers.md: only consume/produce imply transfer.
        // deliverService is not in that list; services are intangible and
        // cannot be "transferred" in the accounting sense.
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    pickup: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'input',
        pairsWith: 'dropoff',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'decrement',
        locationEffect: 'update',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'update',
        impliesTransfer: 'custody',
        eligibleForExchange: false,
    },
    dropoff: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'output',
        pairsWith: 'pickup',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'increment',
        locationEffect: 'update',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'update',
        stateEffect: 'update',
        impliesTransfer: 'custody',
        eligibleForExchange: false,
    },
    accept: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'input',
        pairsWith: 'modify',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'decrement',
        locationEffect: 'update',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'update',
        impliesTransfer: 'custody',
        eligibleForExchange: false,
    },
    modify: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'output',
        pairsWith: 'accept',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'increment',
        locationEffect: 'update',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'update',
        stateEffect: 'update',
        impliesTransfer: 'custody',
        eligibleForExchange: false,
    },
    combine: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'input',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'decrement',
        locationEffect: 'noEffect',
        containedEffect: 'update',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'update',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    separate: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'output',
        createResource: 'noEffect',
        accountingEffect: 'noEffect',
        onhandEffect: 'increment',
        locationEffect: 'noEffect',
        containedEffect: 'remove',
        accountableEffect: 'noEffect',
        stageEffect: 'update',
        stateEffect: 'update',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    transferAllRights: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'notApplicable',
        createResource: 'optionalTo',
        accountingEffect: 'decrementIncrement',
        onhandEffect: 'noEffect',
        locationEffect: 'noEffect',
        containedEffect: 'noEffect',
        accountableEffect: 'updateTo',
        stageEffect: 'noEffect',
        stateEffect: 'updateTo',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    transferCustody: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'notApplicable',
        createResource: 'optionalTo',
        accountingEffect: 'noEffect',
        onhandEffect: 'decrementIncrement',
        locationEffect: 'updateTo',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'updateTo',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    transfer: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'notApplicable',
        createResource: 'optionalTo',
        accountingEffect: 'decrementIncrement',
        onhandEffect: 'decrementIncrement',
        locationEffect: 'updateTo',
        containedEffect: 'noEffect',
        accountableEffect: 'updateTo',
        stageEffect: 'noEffect',
        stateEffect: 'updateTo',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    move: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'notApplicable',
        createResource: 'optionalTo',
        accountingEffect: 'decrementIncrement',
        onhandEffect: 'decrementIncrement',
        locationEffect: 'updateTo',
        containedEffect: 'noEffect',
        accountableEffect: 'noEffect',
        stageEffect: 'noEffect',
        stateEffect: 'updateTo',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    copy: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'notApplicable',
        createResource: 'optionalTo',
        accountingEffect: 'incrementTo',
        onhandEffect: 'incrementTo',
        locationEffect: 'new',       // copy's new resource gets its location from toLocation
        containedEffect: 'noEffect',
        accountableEffect: 'new',    // copy's new resource gets its accountable from receiver
        stageEffect: 'noEffect',
        stateEffect: 'updateTo',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    raise: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'notApplicable',
        createResource: 'optional',
        accountingEffect: 'increment',
        onhandEffect: 'increment',
        locationEffect: 'noEffect',
        containedEffect: 'noEffect',
        accountableEffect: 'new',
        stageEffect: 'noEffect',
        stateEffect: 'update',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
    lower: {
        eventQuantity: 'resourceQuantity',
        inputOutput: 'notApplicable',
        createResource: 'optional',
        accountingEffect: 'decrement',
        onhandEffect: 'decrement',
        locationEffect: 'noEffect',
        containedEffect: 'noEffect',
        accountableEffect: 'new',
        stageEffect: 'noEffect',
        stateEffect: 'update',
        impliesTransfer: null,
        eligibleForExchange: true,
    },
};

// =============================================================================
// AGENTS
// =============================================================================

/** Agent type discriminator — VF defines Person, Organization, EcologicalAgent subtypes. */
export const AgentTypeEnum = z.enum(['Person', 'Organization', 'EcologicalAgent']);
export type AgentType = z.infer<typeof AgentTypeEnum>;

export const AgentSchema = z.object({
    id: z.string(),
    /** Subtype: Person | Organization | EcologicalAgent (GAP-A/C) */
    type: AgentTypeEnum.default('Person'),
    name: z.string().optional(),
    note: z.string().optional(),
    image: z.string().optional(),
    primaryLocation: z.string().optional(), // SpatialThing ID or inline
    classifiedAs: z.array(z.string()).optional(),
    availability_window: TemporalExpressionSchema.optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

/**
 * AgentRelationshipRole — defines a named role that an agent plays in relation
 * to another agent (e.g. "member", "steward", "grower").
 * VF spec: model-text.md §AgentRelationshipRole, agents.md §Agent Relationships.
 */
export const AgentRelationshipRoleSchema = z.object({
    id: z.string(),
    label: z.string(),
    inverseLabel: z.string().optional(),   // e.g. "has member" is inverse of "member of"
    note: z.string().optional(),
    classifiedAs: z.array(z.string()).optional(),
});
export type AgentRelationshipRole = z.infer<typeof AgentRelationshipRoleSchema>;

/**
 * AgentRelationship — a directed relationship between two agents.
 * subject plays `relationship` (role) toward object.
 * Can be scoped to a context agent.
 * VF spec: model-text.md §AgentRelationship, agents.md §Agent Relationships.
 */
export const AgentRelationshipSchema = z.object({
    id: z.string(),
    subject: z.string(),                   // Agent ID ("Michael is a member...")  
    object: z.string(),                    // Agent ID ("...of Enspiral")
    relationship: z.string(),              // AgentRelationshipRole ID
    inScopeOf: z.string().optional(),      // Agent ID — scope context
    note: z.string().optional(),
});
export type AgentRelationship = z.infer<typeof AgentRelationshipSchema>;

// =============================================================================
// KNOWLEDGE LAYER — Specifications
// =============================================================================

/**
 * PositioningAnalysis — DDMRP Chapter 6 strategic positioning factors.
 *
 * Captures the six positioning inputs per item that justify a decoupling-point
 * decision. Stored inline on ResourceSpecification so the rationale travels
 * with the item spec rather than living in a separate record.
 *
 * DDMRP ref: Ptak & Smith Ch 6 — Strategic Inventory Positioning.
 */
export const PositioningAnalysisSchema = z.object({
    /**
     * Customer Tolerance Time (CTT) — maximum wait time a customer will accept
     * before going elsewhere, in calendar days.
     */
    customerToleranceTimeDays: z.number().nonnegative().optional(),
    /**
     * Market Potential Lead Time (MPLT) — shortest lead time any competitor
     * currently offers, in calendar days.
     */
    marketPotentialLeadTimeDays: z.number().nonnegative().optional(),
    /**
     * Sales Order Visibility Horizon (SOVH) — how far ahead firm demand is
     * visible (confirmed orders on the books), in calendar days.
     */
    salesOrderVisibilityHorizonDays: z.number().nonnegative().optional(),
    /**
     * Inventory Leverage & Flexibility (ILF) — whether stocking this item
     * maximises flexibility for downstream use cases.
     */
    inventoryLeverageFlexibility: z.enum(['low', 'medium', 'high']).optional(),
    /**
     * Variable Rate of Demand (VRD) — how frequently and severely demand
     * spikes within the customer tolerance time.
     */
    vrd: z.enum(['low', 'medium', 'high']).optional(),
    /**
     * Variable Rate of Supply (VRS) — how frequently and severely supply
     * fails (late deliveries, short shipments, quality problems).
     */
    vrs: z.enum(['low', 'medium', 'high']).optional(),
    /**
     * Critical Operation Protection (COP) — whether this item feeds a capacity-constrained,
     * costly, or quality-sensitive operation. Upstream buffering protects throughput.
     * DDMRP ref: Ptak & Smith Ch 7 §"Factor 6: Critical Operation Protection".
     */
    criticalOperationProtection: z.boolean().optional(),
    /** Derived recommendation: should a decoupling point be placed here? */
    decouplingRecommended: z.boolean().optional(),
    note: z.string().optional(),
});
export type PositioningAnalysis = z.infer<typeof PositioningAnalysisSchema>;

/**
 * DecouplingTestResult — records the outcome of a formal decoupling-point approval.
 *
 * Each test maps to one of the six Ch 7 positioning criteria that must pass before
 * a strategic buffer is accepted into the master plan.
 *
 * DDMRP ref: Ptak & Smith Ch 7 §"Strategic Inventory Positioning Approval".
 */
export const DecouplingTestResultSchema = z.object({
    specId: z.string(),
    results: z.array(z.object({
        test: z.enum([
            'decoupling', 'bi-directional', 'order-independence',
            'primary-planning', 'relative-priority', 'dynamic-adjustment',
        ]),
        passed: z.boolean(),
        note: z.string().optional(),
    })),
    approvedAt: z.string().datetime().optional(),
    approvedBy: z.string().optional(),
});
export type DecouplingTestResult = z.infer<typeof DecouplingTestResultSchema>;

/**
 * ResourceSpecification — the catalog "type" of a resource.
 * One per kind of thing (e.g. "Bread", "Steel beam", "Translation service").
 * EconomicResources conformTo exactly one ResourceSpecification.
 */
export const ResourceSpecificationSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    image: z.string().optional(),
    /**
     * Taxonomy URIs / classification tags for this spec.
     *
     * Commune convention: every spec is either `'individual-claimable'` (members
     * can claim instances from the commune pool) OR `'communal'` (shared production
     * infrastructure owned collectively). These two are mutually exclusive — a spec
     * must never carry both tags.
     */
    resourceClassifiedAs: z.array(z.string()).optional(),
    defaultUnitOfResource: z.string().optional(),         // unit label or URI
    defaultUnitOfEffort: z.string().optional(),
    substitutable: z.boolean().optional(),
    mediumOfExchange: z.boolean().optional(),
    // DDMRP extensions
    bufferProfileId: z.string().optional(),               // BufferProfile ID
    /** DDMRP Ch 6 positioning factors — rationale for decoupling-point placement. */
    positioningAnalysis: PositioningAnalysisSchema.optional(),
});
export type ResourceSpecification = z.infer<typeof ResourceSpecificationSchema>;


/**
 * ProcessSpecification — the "type" of a process.
 * Processes have basedOn pointing to exactly one ProcessSpecification.
 * Also used for stage tracking on resources.
 */
export const ProcessSpecificationSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    image: z.string().optional(),
    // DDMRP extensions
    isDecouplingPoint: z.boolean().optional(),            // design-time strategic buffer placement marker
    isControlPoint: z.boolean().optional(),               // design-time scheduling pacemaker marker
    /**
     * Buffer type at this design point (set after positioning analysis):
     *   'stock'    — stock buffer (decoupling point; manufactured/purchased item)
     *   'time'     — time buffer (control point; timing-critical pre-CP coverage)
     *   'capacity' — capacity buffer (drum resource; sprint headroom)
     */
    bufferType: z.enum(['stock', 'time', 'capacity']).optional(),
    /**
     * Divergent point — this process produces output consumed by ≥2 downstream
     * processes or end products. Ideal decoupling candidate (maximum flexibility).
     * DDMRP ref: Ptak & Smith Ch 6 §"Advanced Inventory Positioning Considerations".
     */
    isDivergentPoint: z.boolean().optional(),
    /**
     * Convergent point — ≥2 distinct supply chains merge as inputs to this process.
     * Inherently higher risk; often warrants a time or capacity buffer.
     * DDMRP ref: Ptak & Smith Ch 6 §"Advanced Inventory Positioning Considerations".
     */
    isConvergentPoint: z.boolean().optional(),
});
export type ProcessSpecification = z.infer<typeof ProcessSpecificationSchema>;

export const CapacityBufferSchema = z.object({
    id: z.string(),
    processSpecId: z.string(),                                 // ProcessSpecification ID (the work center)
    totalCapacityHours: z.number().positive(),                 // available capacity hours per period
    periodDays: z.number().positive(),                         // period length (1 = daily)
    currentLoadHours: z.number().nonnegative(),                // scheduled load hours (computed at seed/refresh)
    greenThreshold: z.number().min(0).max(1).optional(),       // default 0.80
    yellowThreshold: z.number().min(0).max(1).optional(),      // default 0.95
    note: z.string().optional(),
});
export type CapacityBuffer = z.infer<typeof CapacityBufferSchema>;

// =============================================================================
// KNOWLEDGE LAYER — Recipes
// =============================================================================

/**
 * RecipeFlow — a template flow in a recipe (what goes in/out of a RecipeProcess).
 */
export const RecipeFlowSchema = z.object({
    id: z.string(),
    action: VfAction,
    resourceConformsTo: z.string().optional(),             // ResourceSpecification ID
    resourceClassifiedAs: z.array(z.string()).optional(),
    resourceQuantity: MeasureSchema.optional(),
    effortQuantity: MeasureSchema.optional(),
    recipeInputOf: z.string().optional(),                  // RecipeProcess ID
    recipeOutputOf: z.string().optional(),                 // RecipeProcess ID
    recipeClauseOf: z.string().optional(),                 // RecipeExchange ID
    stage: z.string().optional(),                          // ProcessSpecification ID
    state: z.string().optional(),
    note: z.string().optional(),
    // Marks this flow as the primary side of a RecipeExchange.
    // When true:  commitment goes into Agreement.stipulates.
    // When false: commitment goes into Agreement.stipulatesReciprocal.
    // When absent: falls back to first-flow-is-primary heuristic.
    isPrimary: z.boolean().optional(),
    /**
     * RecipeFlow ID of a sibling flow (same process) whose resolved container
     * instance scopes this flow's resource resolution. The anchor must be a
     * `use` action (durable, books a specific resource instance).
     *
     * Example: a harvesting process `use`s soil and `consume`s nitrogen
     * contained within it. The consume flow sets resolveFromFlow to the
     * use-soil flow's ID so the planner resolves nitrogen from inside the
     * specific soil instance that the use flow booked.
     */
    resolveFromFlow: z.string().optional(),
});
export type RecipeFlow = z.infer<typeof RecipeFlowSchema>;

/**
 * RecipeProcess — a template process step in a recipe.
 */
export const RecipeProcessSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    image: z.string().optional(),
    processConformsTo: z.string().optional(),              // ProcessSpecification ID
    processClassifiedAs: z.array(z.string()).optional(),
    hasDuration: DurationSchema.optional(),
    /**
     * Allergen / regulatory sequence group for priority-sorted scheduling.
     * Processes with lower sequenceGroup are scheduled before higher groups.
     * Within a group, DDMRP planning priority % (NFP/TOG) determines order.
     * Resolves M5 partial: replaces unstructured processClassifiedAs tags for ordering.
     */
    sequenceGroup: z.number().int().optional(),
    /**
     * Minimum lot size per run, in output units.
     * When specified, a single run must produce at least this quantity.
     * Demand below the minimum still triggers a full minimum-size run;
     * excess output beyond demand becomes surplus inventory.
     */
    minimumBatchQuantity: MeasureSchema.optional(),
});
export type RecipeProcess = z.infer<typeof RecipeProcessSchema>;

/**
 * RecipeExchange — a template exchange agreement in a recipe.
 */
export const RecipeExchangeSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    note: z.string().optional(),
});
export type RecipeExchange = z.infer<typeof RecipeExchangeSchema>;

/**
 * Recipe — groups RecipeProcesses (and optionally RecipeExchanges)
 * into a reusable template for plan generation.
 */
export const RecipeSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    basedOn: z.string().optional(),                        // ResourceSpecification ID (the output spec)
    primaryOutput: z.string().optional(),                  // ResourceSpecification ID
    recipeProcesses: z.array(z.string()).optional(),       // RecipeProcess IDs
    recipeExchanges: z.array(z.string()).optional(),       // RecipeExchange IDs
});
export type Recipe = z.infer<typeof RecipeSchema>;

/**
 * RecipeGroup — groups multiple Recipes that together produce more than one output.
 * Used when a plan regularly produces several different outputs from different recipes.
 * VF spec: model-text.md §vf:RecipeGroup, recipes.md §Recipe and Recipe Group.
 */
export const RecipeGroupSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    recipes: z.array(z.string()),                          // Recipe IDs
});
export type RecipeGroup = z.infer<typeof RecipeGroupSchema>;

// =============================================================================
// OBSERVATION LAYER — Resources
// =============================================================================

/**
 * EconomicResource — a tracked instance of a resource.
 * 
 * Its state is derived from EconomicEvents:
 *   accountingQuantity: rights-based balance (who "owns" it)
 *   onhandQuantity: custody-based balance (who physically has it)
 *
 * conformsTo exactly ONE ResourceSpecification.
 * classifiedAs any number of classification URIs.
 */
export const EconomicResourceSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    note: z.string().optional(),
    image: z.string().optional(),
    trackingIdentifier: z.string().optional(),

    // Type system
    conformsTo: z.string(),                                // ResourceSpecification ID (required!)
    /** Taxonomy tags. Either `'individual-claimable'` (claimable from commune pool)
     *  or `'communal'` (shared infrastructure). Mutually exclusive — never both. */
    classifiedAs: z.array(z.string()).optional(),

    // Quantities (derived from events)
    accountingQuantity: MeasureSchema.optional(),
    onhandQuantity: MeasureSchema.optional(),

    // Location & custody
    currentLocation: z.string().optional(),                // SpatialThing ID
    currentVirtualLocation: z.string().url().optional(),   // URI for digital/non-physical resources
    primaryAccountable: z.string().optional(),             // Agent ID (rights holder)
    custodianScope: z.string().optional(),                 // Scope ID currently stewarding this resource (custody partition C); updated by transferCustody events

    // Stage/state (set by processes)
    stage: z.string().optional(),                          // ProcessSpecification ID
    state: z.string().optional(),

    // Containment
    containedIn: z.string().optional(),                    // EconomicResource ID

    // Effort tracking
    unitOfEffort: z.string().optional(),                   // unit label

    // Batch/lot
    lot: BatchLotRecordSchema.optional(),

    // Track/trace breadcrumb (set by Observer on event recording)
    previousEvent: z.string().optional(),                  // EconomicEvent ID

    // Persistent availability (machine operating hours, person's schedule, etc.)
    availability_window: TemporalExpressionSchema.optional(),
});
export type EconomicResource = z.infer<typeof EconomicResourceSchema>;

// =============================================================================
// OBSERVATION LAYER — Events
// =============================================================================

/**
 * EconomicEvent — an observed, immutable economic fact.
 *
 * Events are the atoms of accounting. Resource state is derived from them.
 * An event can:
 *   - be inputOf or outputOf a Process
 *   - fulfill a Commitment
 *   - satisfy an Intent (directly, when no Commitment exists)
 *   - correct a previous event
 */
export const EconomicEventSchema = z.object({
    id: z.string(),
    action: VfAction,

    // Process links
    inputOf: z.string().optional(),                        // Process ID
    outputOf: z.string().optional(),                       // Process ID

    // Resource links
    resourceInventoriedAs: z.string().optional(),          // EconomicResource ID (from)
    toResourceInventoriedAs: z.string().optional(),        // EconomicResource ID (to, for transfers)
    resourceConformsTo: z.string().optional(),             // ResourceSpecification ID
    resourceClassifiedAs: z.array(z.string()).optional(),

    // Agents
    // VF spec: internal process flows (same-agent produce/consume) often have
    // provider === receiver. For cross-agent flows, both are required semantically,
    // but the schema allows omission so that internal-process events can be recorded
    // without requiring the caller to always specify 'self' agent IDs.
    provider: z.string().optional(),                       // Agent ID (who provides)
    receiver: z.string().optional(),                       // Agent ID (who receives)

    // Quantities
    resourceQuantity: MeasureSchema.optional(),
    effortQuantity: MeasureSchema.optional(),

    // Time
    hasBeginning: z.string().datetime().optional(),
    hasEnd: z.string().datetime().optional(),
    hasPointInTime: z.string().datetime().optional(),
    created: z.string().datetime().optional(),             // computer-generated timestamp

    // Location (GAP-G)
    atLocation: z.string().optional(),                     // SpatialThing ID (where event occurred)
    toLocation: z.string().optional(),                     // SpatialThing ID (for move/transfer destination)

    // State
    state: z.string().optional(),

    // Links (singular per VF spec — many-to-many resolved via inverse queries)
    fulfills: z.string().optional(),                       // Commitment ID
    satisfies: z.string().optional(),                      // Intent ID
    corrects: z.string().optional(),                       // EconomicEvent ID (correction)
    realizationOf: z.string().optional(),                  // Agreement ID
    settles: z.string().optional(),                        // Claim ID

    // Metadata — NOTE: image intentionally omitted (non-economic data belongs on EconomicResource)
    note: z.string().optional(),
    inScopeOf: z.array(z.string()).optional(),             // Agent IDs (scope)

    // Track/trace breadcrumb (set by Observer)
    previousEvent: z.string().optional(),                  // EconomicEvent ID

    /**
     * When true, this event is treated as anomalous and excluded from ADU calculation.
     * Use for one-off demand spikes (e.g., a single large promotional pull) that are
     * not representative of ongoing usage patterns and are expected to revert.
     * Events excluded here still count toward NFP and on-hand tracking.
     * DDMRP ref: Ptak & Smith Ch 7 §"ADU Exceptions".
     */
    excludeFromADU: z.boolean().optional(),

    /**
     * Dollar-denominated market value for transferCustody events.
     * Used exclusively for entrustment limit enforcement; theft risk is market-denominated.
     */
    market_value: z.number().optional(),
});
export type EconomicEvent = z.infer<typeof EconomicEventSchema>;

// =============================================================================
// OBSERVATION LAYER — Processes
// =============================================================================

/**
 * Process — an activity that transforms inputs into outputs.
 * Spans both planning and observation: intents, commitments, AND events
 * can all be connected to the same process.
 */
export const ProcessSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    basedOn: z.string().optional(),                        // ProcessSpecification ID
    classifiedAs: z.array(z.string()).optional(),
    plannedWithin: z.string().optional(),                  // Plan ID
    nestedIn: z.string().optional(),                       // Scenario ID
    inScopeOf: z.array(z.string()).optional(),             // Agent IDs
    hasBeginning: z.string().datetime().optional(),
    hasEnd: z.string().datetime().optional(),
    finished: z.boolean().optional(),
});
export type Process = z.infer<typeof ProcessSchema>;

// =============================================================================
// PLANNING LAYER — Intents & Commitments
// =============================================================================

/**
 * Intent — a unilateral desire/offer/request, not yet agreed to.
 * The "furthest future" planning construct.
 */
export const IntentSchema = z.object({
    id: z.string(),
    action: VfAction,
    name: z.string().optional(),
    note: z.string().optional(),
    image: z.string().optional(),

    // Process links
    inputOf: z.string().optional(),
    outputOf: z.string().optional(),

    // Resource
    resourceInventoriedAs: z.string().optional(),
    resourceConformsTo: z.string().optional(),
    resourceClassifiedAs: z.array(z.string()).optional(),
    resourceQuantity: MeasureSchema.optional(),
    effortQuantity: MeasureSchema.optional(),
    availableQuantity: MeasureSchema.optional(),
    minimumQuantity: MeasureSchema.optional(),

    // Agents
    provider: z.string().optional(),
    receiver: z.string().optional(),

    // Time
    hasBeginning: z.string().datetime().optional(),
    hasEnd: z.string().datetime().optional(),
    hasPointInTime: z.string().datetime().optional(),
    due: z.string().datetime().optional(),

    // Location (GAP-G)
    atLocation: z.string().optional(),                     // SpatialThing ID

    // Stage/state filtering
    stage: z.string().optional(),
    state: z.string().optional(),

    // Plan
    plannedWithin: z.string().optional(),

    // Links
    satisfies: z.string().optional(),                      // Intent ID (VF: soft-allocation provenance)

    // Scope
    inScopeOf: z.array(z.string()).optional(),             // Agent IDs

    finished: z.boolean().optional(),

    // Matching-layer extension — temporal expression.
    // Not in the VF core spec; covers both recurring patterns (AvailabilityWindow)
    // and specific calendar dates (SpecificDateWindow) in a unified type.
    // When present, takes precedence over hasBeginning/hasEnd for temporal indexing.
    availability_window: TemporalExpressionSchema.optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

/**
 * Commitment — a promised future event, agreed to by agents.
 * Commitments satisfy Intents. Events fulfill Commitments.
 */
export const CommitmentSchema = z.object({
    id: z.string(),
    action: VfAction,
    note: z.string().optional(),

    // Process links
    inputOf: z.string().optional(),
    outputOf: z.string().optional(),

    // Resource
    resourceInventoriedAs: z.string().optional(),
    resourceConformsTo: z.string().optional(),
    resourceClassifiedAs: z.array(z.string()).optional(),
    resourceQuantity: MeasureSchema.optional(),
    effortQuantity: MeasureSchema.optional(),

    // Agents (GAP-I: optional — can be temporarily unassigned during planning)
    // VF spec: "can be planned temporarily without both provider and receiver"
    provider: z.string().optional(),
    receiver: z.string().optional(),

    // Time
    hasBeginning: z.string().datetime().optional(),
    hasEnd: z.string().datetime().optional(),
    hasPointInTime: z.string().datetime().optional(),
    due: z.string().datetime().optional(),
    created: z.string().datetime().optional(),

    // Location (GAP-G)
    atLocation: z.string().optional(),                     // SpatialThing ID

    // Scope
    inScopeOf: z.array(z.string()).optional(),             // Agent IDs

    // Stage/state filtering
    stage: z.string().optional(),
    state: z.string().optional(),

    // Links (singular per VF spec)
    satisfies: z.string().optional(),                      // Intent ID
    clauseOf: z.string().optional(),                       // Agreement ID
    independentDemandOf: z.string().optional(),            // Plan ID (marks this as a deliverable)
    plannedWithin: z.string().optional(),                  // Plan ID

    finished: z.boolean().optional(),

    // Matching-layer extension — temporal expression.
    // Inherited from a recurring Intent when the Commitment satisfies one;
    // expresses "this commitment recurs on the same schedule as its intent".
    // When present, takes precedence over hasBeginning/hasEnd for temporal indexing.
    availability_window: TemporalExpressionSchema.optional(),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

/**
 * Claim — triggered by an event, resembles a Commitment but initiated by receiver.
 */
export const ClaimSchema = z.object({
    id: z.string(),
    action: VfAction,
    provider: z.string().optional(),
    receiver: z.string().optional(),
    triggeredBy: z.string().optional(),                    // EconomicEvent ID
    resourceQuantity: MeasureSchema.optional(),
    effortQuantity: MeasureSchema.optional(),
    resourceConformsTo: z.string().optional(),
    resourceClassifiedAs: z.array(z.string()).optional(),
    due: z.string().datetime().optional(),
    created: z.string().datetime().optional(),
    note: z.string().optional(),
    finished: z.boolean().optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

// =============================================================================
// PLANNING LAYER — Plans
// =============================================================================

/**
 * Plan — a schedule of related processes constituting a body of work.
 */
export const PlanSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    due: z.string().datetime().optional(),
    created: z.string().datetime().optional(),
    hasIndependentDemand: z.array(z.string()).optional(),  // Commitment/Intent IDs (deliverables)
    refinementOf: z.string().optional(),                   // Scenario ID (this plan refines a scenario)
    classifiedAs: z.array(z.string()).optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

// =============================================================================
// ESTIMATION / ANALYSIS LAYER — Scenarios
// =============================================================================

/**
 * ScenarioDefinition — a named category or template for a kind of scenario.
 * E.g. "Yearly Budget", "Risk Analysis", "Network Flow Analysis".
 * VF spec: model-text.md §vf:ScenarioDefinition, estimates.md.
 */
export const ScenarioDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    hasDuration: DurationSchema.optional(),                // typical duration of scenarios of this type
    inScopeOf: z.string().optional(),                     // Agent ID — who defines this type
});
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;

/**
 * Scenario — a higher-level grouping of processes, intents, plans, and/or
 * aggregated events for analysis, budgeting, or pre-planning.
 * Scenarios can be nested (refinementOf) to support zooming in/out.
 * VF spec: model-text.md §vf:Scenario, estimates.md.
 */
export const ScenarioSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    definedAs: z.string().optional(),                      // ScenarioDefinition ID
    refinementOf: z.string().optional(),                   // Scenario ID (nesting — more detailed)
    hasBeginning: z.string().datetime().optional(),
    hasEnd: z.string().datetime().optional(),
    inScopeOf: z.string().optional(),                      // Agent ID — scope (community, org…)
    // Plans, processes, intents, events are associated via back-references (query, not embedding)
});
export type Scenario = z.infer<typeof ScenarioSchema>;

// =============================================================================
// AGREEMENTS & EXCHANGES
// =============================================================================

export const AgreementSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    note: z.string().optional(),
    created: z.string().datetime().optional(),
    stipulates: z.array(z.string()).optional(),            // primary Commitment IDs
    stipulatesReciprocal: z.array(z.string()).optional(),  // reciprocal Commitment IDs
});
export type Agreement = z.infer<typeof AgreementSchema>;

export const AgreementBundleSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    note: z.string().optional(),
    created: z.string().datetime().optional(),
    bundles: z.array(z.string()).optional(),                // Agreement IDs
});
export type AgreementBundle = z.infer<typeof AgreementBundleSchema>;

// =============================================================================
// PROPOSALS — Offers & Requests
// =============================================================================

export const ProposalSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    note: z.string().optional(),
    hasBeginning: z.string().datetime().optional(),
    hasEnd: z.string().datetime().optional(),
    unitBased: z.boolean().optional(),
    created: z.string().datetime().optional(),
    purpose: z.enum(['offer', 'request']).optional(),     // spec: Proposal.purpose
    eligibleLocation: z.string().optional(),               // SpatialThing ID
    inScopeOf: z.array(z.string()).optional(),             // Agent IDs
    publishes: z.array(z.string()).optional(),             // Intent IDs
    reciprocal: z.array(z.string()).optional(),            // Intent IDs
    proposedTo: z.array(z.string()).optional(),            // Agent IDs
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const ProposalListSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    note: z.string().optional(),
    created: z.string().datetime().optional(),
    lists: z.array(z.string()).optional(),                 // Proposal IDs
});
export type ProposalList = z.infer<typeof ProposalListSchema>;

// =============================================================================
// DDMRP BUFFER MANAGEMENT
// =============================================================================

/**
 * BufferProfile — DDS&OP master settings for a category of buffered items.
 *
 * One profile per (itemType × leadTimeBand × variabilityBand) combination.
 * Multiple ResourceSpecifications share the same profile when they have the
 * same operational characteristics.
 *
 * DDMRP ref: Ptak & Smith Ch 8 — Buffer Profiles and Levels.
 */
export const BufferProfileSchema = z.object({
    id: z.string(),
    name: z.string(),
    /** P = Purchased externally; M = Manufactured in-house; I = Intermediate (both); D = Distributed */
    itemType: z.enum(['Purchased', 'Manufactured', 'Intermediate', 'Distributed']),
    /**
     * Lead Time Factor — multiplier applied to ADU × DLT to size the red zone base.
     * Typical values: 0.5 (short LT), 1.0 (medium LT), 1.5 (long LT).
     */
    leadTimeFactor: z.number().positive(),
    /**
     * Variable Rate of Demand (VRD) — semantic classification of demand variability.
     * Low: demand is predictable; High: frequent large spikes within CTT.
     * Used to derive variabilityFactor when set; see deriveVariabilityFactor().
     * DDMRP ref: Ptak & Smith Ch 6 §"External Variability", Ch 7 §"Factor 3: Variability".
     */
    vrd: z.enum(['low', 'medium', 'high']).optional(),
    /**
     * Variable Rate of Supply (VRS) — semantic classification of supply variability.
     * Low: supplier is reliable; High: frequent late/short/quality failures.
     * Used to derive variabilityFactor when set; see deriveVariabilityFactor().
     * DDMRP ref: Ptak & Smith Ch 6 §"External Variability", Ch 7 §"Factor 3: Variability".
     */
    vrs: z.enum(['low', 'medium', 'high']).optional(),
    /**
     * Variability Factor — fraction of the red base added as a safety buffer.
     * TOR = ADU × DLT × LTF × (1 + VF). Typical values: 0.1 (low), 0.5 (medium), 1.0 (high).
     * Can be set manually or auto-derived from vrd + vrs via deriveVariabilityFactor().
     */
    variabilityFactor: z.number().nonnegative(),
    /**
     * Order cycle days — drives the green zone upper bound.
     * Green zone ≥ max(ADU × orderCycleDays, MOQ).
     * Omit when MOQ always dominates or for one-off items.
     */
    orderCycleDays: z.number().positive().optional(),
    /**
     * Order Spike Threshold multiplier (k). A demand order is considered a spike —
     * and excluded from qualified demand — when its quantity > ADU × ostMultiplier.
     * Typical range: 1–3. When absent, no spike filtering is applied.
     */
    ostMultiplier: z.number().positive().optional(),
    /**
     * Scheduled zone-recalculation cadence for items in this profile.
     * Used by the zone-recalculation scheduler to determine when to recompute
     * ADU, DLT, and zone boundaries.
     */
    recalculationCadence: z.enum(['daily', 'weekly', 'monthly']).optional(),
    /**
     * Lead time band classification per Ch 7 profile convention.
     * Short: LTF 61–100%, Medium: LTF 41–60%, Long: LTF 20–40%.
     */
    leadTimeCategory: z.enum(['short', 'medium', 'long']).optional(),
    /**
     * Variability band classification per Ch 7 profile convention.
     * Low: VF 0–40%, Medium: VF 41–60%, High: VF 61–100%+.
     */
    variabilityCategory: z.enum(['low', 'medium', 'high']).optional(),
    /**
     * 3-letter profile code per Ch 7 convention: ItemType + LTCategory + VariabilityCategory.
     * Item types: M (Manufactured), P (Purchased), D (Distributed), I (Intermediate).
     * e.g. "MML" = Manufactured / Medium LT / Low variability, "PSH" = Purchased / Short / High.
     */
    code: z.string().optional(),
    note: z.string().optional(),
});
export type BufferProfile = z.infer<typeof BufferProfileSchema>;

/**
 * BufferZone — per-ResourceSpecification computed DDMRP buffer parameters.
 *
 * Stores the computed TOR/TOY/TOG zone boundaries for a specific item at a
 * specific location (or globally when atLocation is absent).
 *
 * Zone boundaries (all in `aduUnit` units):
 *   red base   = ADU × DLT × LTF
 *   red safety = red base × VF
 *   TOR        = red base + red safety = ADU × DLT × LTF × (1 + VF)
 *   TOY        = TOR + ADU × DLT
 *   TOG        = TOY + max(ADU × orderCycleDays, MOQ)
 *
 * Note: the formula ADU × DLT × (LTF + VF) found in some documents is only
 * equivalent when LTF = 1.0. The correct Ptak & Smith formula is LTF × (1 + VF).
 *
 * DDMRP ref: Ptak & Smith Ch 8 — Buffer Profiles and Levels, Ch 9 — DDMRP.
 */
export const BufferZoneSchema = z.object({
    id: z.string(),
    /** ResourceSpecification ID this zone applies to */
    specId: z.string(),
    /** BufferProfile ID used to compute this zone */
    profileId: z.string(),
    /**
     * Buffer classification per Ch 7.
     * replenished: standard 3-zone (TOR/TOY/TOG), auto-recalculated on ADU/DLT/MOQ change.
     * replenished_override: user-set zones (contractual/constrained), must NOT be auto-recalculated.
     * min_max: 2-zone (TOR/TOG), yellow zone not applicable (TOY = TOR).
     */
    bufferClassification: z.enum(['replenished', 'replenished_override', 'min_max']).default('replenished'),
    /** SpatialThing ID — if absent, applies to all locations */
    atLocation: z.string().optional(),
    /** SpatialThing ID of the upstream location that replenishes this zone. */
    upstreamLocationId: z.string().optional(),
    /** Recipe ID (transport leg) to execute when issuing a replenishment order. */
    replenishmentRecipeId: z.string().optional(),
    /** Upstream stage marker for DLT segmentation via legLeadTime(). */
    upstreamStageId: z.string().optional(),
    /** Downstream stage marker for DLT segmentation via legLeadTime(). */
    downstreamStageId: z.string().optional(),

    // --- ADU inputs ---
    /** Average Daily Usage quantity (result of the rolling-window calculation) */
    adu: z.number().nonnegative(),
    /** Unit label or URI matching the ResourceSpecification's defaultUnitOfResource */
    aduUnit: z.string(),
    /**
     * Blending ratio for ADU computation: proportion of past ADU in blended result.
     * 0 = forward-only, 1 = past-only, 0.5 = equal blend.
     * When absent, either pure-past or pure-forward ADU is used.
     */
    aduBlendRatio: z.number().min(0).max(1).optional(),
    /**
     * Rolling window length used to compute the past component of ADU.
     * Standard DDMRP practice: 28–90 days. When absent, assumed from profile defaults.
     */
    aduWindowDays: z.number().positive().optional(),
    /**
     * ISO date of the earliest EconomicEvent included in the ADU calculation.
     * Together with lastComputedAt, pins the exact historical window used.
     */
    aduComputedFrom: z.string().optional(),

    // --- N-1: ADU Exception Alert thresholds ---
    /**
     * ADU exception alert — high threshold (0–1 fraction).
     * Fires when recomputed ADU exceeds previous ADU × (1 + aduAlertHighPct).
     * DDMRP ref: Ptak & Smith Ch 7 §"ADU Exceptions".
     */
    aduAlertHighPct: z.number().positive().optional(),
    /**
     * ADU exception alert — low threshold (0–1 fraction).
     * Fires when recomputed ADU falls below previous ADU × (1 − aduAlertLowPct).
     * DDMRP ref: Ptak & Smith Ch 7 §"ADU Exceptions".
     */
    aduAlertLowPct: z.number().positive().optional(),
    /**
     * Rolling window in days over which ADU change is measured for alert evaluation.
     * Defaults to aduWindowDays when absent.
     */
    aduAlertWindowDays: z.number().positive().optional(),

    // --- N-2: Bootstrap ADU for items with no demand history ---
    /**
     * Management-estimated ADU for items with no demand history.
     * Used as the "estimated" component when blending with actual demand during
     * the no-history bootstrap period. Once aduWindowDays of real history exists,
     * this field should be cleared (set to undefined).
     * DDMRP ref: Ptak & Smith Ch 7 §"Establishing ADU with No History".
     */
    estimatedADU: z.number().nonnegative().optional(),
    /**
     * Number of periods (days) of real demand history accumulated so far.
     * During bootstrap: bootstrapDaysAccumulated < aduWindowDays.
     * Used by bootstrapADU() to compute the correct blend ratio automatically.
     */
    bootstrapDaysAccumulated: z.number().nonnegative().optional(),

    /**
     * Order Spike Threshold horizon in days. Demand orders further out than
     * this horizon are exempt from spike filtering (they are future, not spikes).
     * Typical DDMRP practice: 50% of DLT. Overrides BufferProfile.ostMultiplier
     * horizon for this specific zone when present.
     */
    ostHorizonDays: z.number().positive().optional(),

    // --- Decoupled Lead Time ---
    /** DLT in calendar days (from recipe template or criticalPath() on instantiated Plan) */
    dltDays: z.number().nonnegative(),

    // --- MOQ (mirrored for quick access) ---
    /** Minimum order/batch quantity — mirrors RecipeProcess.minimumBatchQuantity */
    moq: z.number().nonnegative(),
    /** Unit label for MOQ */
    moqUnit: z.string(),

    // --- N-5: Per-part Desired/Imposed Order Cycle (DOC) ---
    /**
     * Desired or imposed order cycle in days — individual part override of the
     * profile-level orderCycleDays. When present, drives Green zone option 1
     * (ADU × orderCycleDays) in preference to the profile default.
     * Examples: supplier minimum order frequency, production scheduling wheel slot.
     * DDMRP ref: Ptak & Smith Ch 7 §"The Green Zone — Option 1".
     */
    orderCycleDays: z.number().positive().optional(),

    // --- N-3: Override reason capture ---
    /**
     * Reason the buffer was set to replenished_override.
     * 'space'       — physical space constraint (bin, shelf, warehouse capacity)
     * 'cash'        — capital/cash-flow constraint limiting how much inventory is acceptable
     * 'contractual' — customer-imposed or supplier-imposed min/max levels
     * 'other'       — any other business reason (see overrideNote)
     * Only meaningful when bufferClassification === 'replenished_override'.
     * DDMRP ref: Ptak & Smith Ch 7 §"Replenished Override Buffers".
     */
    overrideReason: z.enum(['space', 'cash', 'contractual', 'other']).optional(),
    /** Free-text explanation when overrideReason === 'other'. */
    overrideNote: z.string().optional(),

    // --- N-4: Distributed item lead time breakdown ---
    /**
     * For distributed items: transportation transit days (part of dltDays).
     * dltDays = transportDays + stagingDays (when both are provided).
     * Informational — does not change zone math; dltDays is always the authoritative total.
     * DDMRP ref: Ptak & Smith Ch 7 §"Part Lead Time — Distributed".
     */
    transportDays: z.number().nonnegative().optional(),
    /**
     * For distributed items: staging, receiving, and QA inspection days at destination.
     * DDMRP ref: Ptak & Smith Ch 7 §"Part Lead Time — Distributed".
     */
    stagingDays: z.number().nonnegative().optional(),

    // --- Computed zone boundaries (all in aduUnit) ---
    /** Top of Red = red zone upper boundary */
    tor: z.number().nonnegative(),
    /** Top of Yellow = red + yellow zone boundary */
    toy: z.number().nonnegative(),
    /** Top of Green = full buffer ceiling */
    tog: z.number().nonnegative(),
    /**
     * Tipping point — on-hand level below which ecological recovery is impossible.
     * When onhand < tippingPoint, the planner emits a ConservationSignal with
     * tippingPointBreached: true so the federation can escalate immediately.
     * Only meaningful for ecological buffers (tag:buffer:ecological on ResourceSpec).
     * Must be ≤ tor; leave undefined for metabolic/social buffers.
     */
    tippingPoint: z.number().nonnegative().optional(),

    // --- N-6: Red zone decomposition (informational) ---
    /**
     * Red base = ADU × DLT × LTF.
     * The lead-time-driven component of safety embedded in the red zone.
     * Informational — tor is always the authoritative zone boundary.
     * DDMRP ref: Ptak & Smith Ch 7 §"The Red Zone — Step 1".
     */
    redBase: z.number().nonnegative().optional(),
    /**
     * Red safety = red base × VF.
     * The variability-driven component of safety embedded in the red zone.
     * Informational — tor is always the authoritative zone boundary.
     * DDMRP ref: Ptak & Smith Ch 7 §"The Red Zone — Step 2".
     */
    redSafety: z.number().nonnegative().optional(),

    // --- Dynamic adjustment factors ---
    /** DAF: multiplier on ADU (Demand Adjustment Factor). Default 1.0. */
    demandAdjFactor: z.number().positive().optional(),
    /** ZAF: direct zone size multiplier. Default 1.0. */
    zoneAdjFactor: z.number().positive().optional(),
    /** LTAF: DLT multiplier. Default 1.0. */
    leadTimeAdjFactor: z.number().positive().optional(),
    /** Supply timing offset in days (shifts order due date). */
    supplyOffsetDays: z.number().optional(),

    /**
     * DemandAdjustmentFactor IDs whose validFrom ≤ lastComputedAt ≤ validTo
     * were combined to produce the current demandAdjFactor/zoneAdjFactor/leadTimeAdjFactor
     * values. Lets the recalculation engine expire stale adjustments without a full scan.
     */
    activeAdjustmentIds: z.array(z.string()).optional(),

    /** ISO datetime of last zone recalculation */
    lastComputedAt: z.string().datetime(),
});
export type BufferZone = z.infer<typeof BufferZoneSchema>;

/**
 * ReplenishmentSignal — an NFP-triggered supply order proposal.
 *
 * Created when NFP ≤ TOY (Net Flow Position at or below Top of Yellow).
 * Carries all inputs to the replenishment decision plus the recommended order
 * quantity and its approval status.
 *
 * On approval, `approvedCommitmentId` is set by `promoteToCommitment()`.
 *
 * DDMRP ref: Ptak & Smith Ch 9 — Supply Order Generation.
 */
export const ReplenishmentSignalSchema = z.object({
    id: z.string(),
    /** ResourceSpecification ID */
    specId: z.string(),
    /** SpatialThing ID — if absent, signal applies to all locations */
    atLocation: z.string().optional(),
    /** BufferZone ID that provided TOR/TOY/TOG and DLT */
    bufferZoneId: z.string(),

    // --- NFP components (all in BufferZone.aduUnit) ---
    /** Physical on-hand quantity at signal time (onhandQuantity, custody-based) */
    onhand: z.number(),
    /** Sum of open supply Commitments (approved orders only, not Intents) */
    onorder: z.number().nonnegative(),
    /** OST-filtered qualified demand due today */
    qualifiedDemand: z.number().nonnegative(),
    /**
     * Net Flow Position = onhand + onorder − qualifiedDemand.
     * CAN BE NEGATIVE (negative = stockout zone, below red).
     */
    nfp: z.number(),

    // --- Zone assessment ---
    /** Planning priority = NFP / TOG. Values < 0 indicate stockout. */
    priority: z.number(),
    /**
     * Buffer zone at signal time.
     * 'excess' = NFP > TOG (overstocked; signal is informational, not a replenishment request).
     */
    zone: z.enum(['red', 'yellow', 'green', 'excess']),

    // --- Order recommendation ---
    /** TOG − NFP, rounded up to nearest MOQ/multiple. */
    recommendedQty: z.number().positive(),
    /** ISO date: today + DLT (when the order should arrive) */
    dueDate: z.string(),

    // --- Lifecycle ---
    status: z.enum(['open', 'approved', 'rejected']),
    /** Set by promoteToCommitment() when signal is approved */
    approvedCommitmentId: z.string().optional(),
    /** ISO datetime when this signal was generated */
    createdAt: z.string().datetime(),
});
export type ReplenishmentSignal = z.infer<typeof ReplenishmentSignalSchema>;

/**
 * DemandAdjustmentFactor — DDS&OP planned multipliers for buffer zone recalculation.
 *
 * Applied during scheduled zone recalculations to account for known future
 * demand changes (seasonality, promotions, ramp-up/down) that ADU history
 * does not yet reflect.
 *
 * Three types:
 *   'demand'   — multiplies ADU (affects yellow + red zone sizing)
 *   'zone'     — multiplies the entire zone size directly
 *   'leadTime' — multiplies DLT (affects red + yellow zone sizing)
 *
 * DDMRP ref: Ptak & Smith Ch 8 — Dynamic Adjustments.
 */
export const DemandAdjustmentFactorSchema = z.object({
    id: z.string(),
    /** ResourceSpecification ID this adjustment applies to */
    specId: z.string(),
    /**
     * SpatialThing ID — scopes this adjustment to a specific location's BufferZone.
     * When absent, applies to all locations for the given specId.
     */
    atLocation: z.string().optional(),
    /** Which component of the buffer zone formula this factor adjusts */
    type: z.enum(['demand', 'zone', 'leadTime']),
    /**
     * For type='zone' only: which specific zone this factor targets.
     * - 'green'  → adjusts order size / order frequency (Ch 8 §8.2.2)
     * - 'yellow' → adjusts demand coverage window (short promo or supply disruption)
     * - 'red'    → adjusts embedded safety (temporary volatility)
     * When absent, defaults to 'red' for backward compatibility.
     */
    targetZone: z.enum(['green', 'yellow', 'red']).optional(),
    /**
     * Multiplier applied to the target component.
     * 1.0 = no change; 1.2 = 20% increase; 0.8 = 20% decrease.
     */
    factor: z.number().positive(),
    /** ISO date (inclusive) — start of the adjustment window */
    validFrom: z.string(),
    /** ISO date (inclusive) — end of the adjustment window */
    validTo: z.string(),
    /**
     * Supply timing offset in days — for 'demand' type only.
     * Shifts the ADU computation window forward by this many days
     * (used to pre-position supply for a known ramp-up).
     */
    supplyOffsetDays: z.number().optional(),
    note: z.string().optional(),
    /** When false, the factor is inactive and should be excluded from display/calculation. */
    isActive: z.boolean().optional(),
});
export type DemandAdjustmentFactor = z.infer<typeof DemandAdjustmentFactorSchema>;
