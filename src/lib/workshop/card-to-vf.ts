/**
 * Card-to-VF Mapping — converts detected CardArrangement into VF schema instances.
 *
 * Pure functions: no side effects, no stores. Takes a CardArrangement and returns
 * validated VF entities that can be loaded into the planning system.
 */

import type {
    Agent, ResourceSpecification, EconomicResource, Process,
    Recipe, RecipeProcess, RecipeFlow,
    Intent, Commitment, EconomicEvent, VfAction,
} from '../schemas';

import type {
    CardArrangement, DetectedEntityCard, DetectedFlowCard,
    DetectedConnection, DetectedCard,
} from './card-schemas';
import {
    isEntityCard, isFlowCard, isLensCard, isSignalFlag,
    getCardsByCategory, findCard, getConnections,
} from './card-schemas';

// =============================================================================
// OUTPUT TYPE
// =============================================================================

export interface VFInstances {
    agents: Agent[];
    resourceSpecifications: ResourceSpecification[];
    resources: EconomicResource[];
    processes: Process[];
    recipes: Recipe[];
    recipeProcesses: RecipeProcess[];
    recipeFlows: RecipeFlow[];
    intents: Intent[];
    commitments: Commitment[];
    events: EconomicEvent[];
}

// =============================================================================
// ID GENERATION
// =============================================================================

let idCounter = 0;

function generateId(prefix: string): string {
    return `${prefix}-${++idCounter}-${Date.now().toString(36)}`;
}

/** Reset ID counter (for testing) */
export function resetIdCounter(): void {
    idCounter = 0;
}

// =============================================================================
// FIELD PARSERS — extract typed values from OCR'd strings
// =============================================================================

function parseQuantity(raw?: string): { value: number; unit: string } | undefined {
    if (!raw) return undefined;
    // Match patterns like "10 kg", "5.5 hours", "100 each", "42"
    const match = raw.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (!match) return undefined;
    return { value: parseFloat(match[1]), unit: match[2].trim() || 'each' };
}

function parseDuration(raw?: string): { hasNumericalValue: number; hasUnit: string } | undefined {
    if (!raw) return undefined;
    const parsed = parseQuantity(raw);
    if (!parsed) return undefined;
    return { hasNumericalValue: parsed.value, hasUnit: parsed.unit || 'hours' };
}

function parseDate(raw?: string): string | undefined {
    if (!raw) return undefined;
    // Try to parse various date formats
    const date = new Date(raw);
    if (!isNaN(date.getTime())) return date.toISOString();
    // Try relative dates: "tomorrow", "in 3 days", etc.
    const today = new Date();
    if (raw.toLowerCase().includes('tomorrow')) {
        today.setDate(today.getDate() + 1);
        return today.toISOString();
    }
    const daysMatch = raw.match(/in\s+(\d+)\s+days?/i);
    if (daysMatch) {
        today.setDate(today.getDate() + parseInt(daysMatch[1]));
        return today.toISOString();
    }
    return undefined;
}

const VALID_ACTIONS = new Set<string>([
    'produce', 'consume', 'use', 'work', 'cite', 'deliverService',
    'pickup', 'dropoff', 'accept', 'modify', 'combine', 'separate',
    'transferAllRights', 'transferCustody', 'transfer', 'move', 'copy',
    'raise', 'lower',
]);

function parseAction(raw?: string): VfAction | undefined {
    if (!raw) return undefined;
    const normalized = raw.trim().toLowerCase();
    // Handle common variations
    const aliases: Record<string, string> = {
        'deliver service': 'deliverService',
        'deliver': 'deliverService',
        'transfer all rights': 'transferAllRights',
        'transfer custody': 'transferCustody',
        'pick up': 'pickup',
        'drop off': 'dropoff',
    };
    const resolved = aliases[normalized] ?? normalized;
    if (VALID_ACTIONS.has(resolved)) return resolved as VfAction;
    // Fuzzy match: find action that starts with the input
    for (const action of VALID_ACTIONS) {
        if (action.toLowerCase().startsWith(normalized)) return action as VfAction;
    }
    return undefined;
}

// =============================================================================
// AGENT RESOLUTION — map card names to agent IDs
// =============================================================================

interface AgentMap {
    /** card ID → agent VF ID */
    cardToAgent: Map<string, string>;
    /** lowercase name → agent VF ID */
    nameToAgent: Map<string, string>;
}

function buildAgentMap(entities: DetectedEntityCard[]): AgentMap {
    const cardToAgent = new Map<string, string>();
    const nameToAgent = new Map<string, string>();

    for (const card of entities) {
        if (card.type !== 'agent') continue;
        const agentId = generateId('agent');
        cardToAgent.set(card.id, agentId);
        if (card.fields.name) {
            nameToAgent.set(card.fields.name.toLowerCase(), agentId);
        }
    }

    return { cardToAgent, nameToAgent };
}

function resolveAgentId(name: string | undefined, agentMap: AgentMap): string | undefined {
    if (!name) return undefined;
    return agentMap.nameToAgent.get(name.toLowerCase());
}

// =============================================================================
// SPEC RESOLUTION — map resource type card names to spec IDs
// =============================================================================

interface SpecMap {
    cardToSpec: Map<string, string>;
    nameToSpec: Map<string, string>;
}

function buildSpecMap(entities: DetectedEntityCard[]): SpecMap {
    const cardToSpec = new Map<string, string>();
    const nameToSpec = new Map<string, string>();

    for (const card of entities) {
        if (card.type !== 'resourceType') continue;
        const specId = generateId('spec');
        cardToSpec.set(card.id, specId);
        if (card.fields.name) {
            nameToSpec.set(card.fields.name.toLowerCase(), specId);
        }
    }

    return { cardToSpec, nameToSpec };
}

function resolveSpecId(name: string | undefined, specMap: SpecMap): string | undefined {
    if (!name) return undefined;
    return specMap.nameToSpec.get(name.toLowerCase());
}

// =============================================================================
// CONNECTION ANALYSIS — infer relationships from spatial arrangement
// =============================================================================

interface ConnectionAnalysis {
    /** For flow cards: which agent card is to the left (provider) */
    leftAgent: Map<string, string>;
    /** For flow cards: which agent card is to the right (receiver) */
    rightAgent: Map<string, string>;
    /** Process inputs: entity cards connected to left of process */
    processInputs: Map<string, string[]>;
    /** Process outputs: entity cards connected to right of process */
    processOutputs: Map<string, string[]>;
    /** Satisfaction links: commitment card ID → intent card ID */
    satisfies: Map<string, string>;
    /** Fulfillment links: event card ID → commitment card ID */
    fulfills: Map<string, string>;
}

function analyzeConnections(arrangement: CardArrangement): ConnectionAnalysis {
    const result: ConnectionAnalysis = {
        leftAgent: new Map(),
        rightAgent: new Map(),
        processInputs: new Map(),
        processOutputs: new Map(),
        satisfies: new Map(),
        fulfills: new Map(),
    };

    for (const conn of arrangement.connections) {
        const fromCard = findCard(arrangement, conn.fromId);
        const toCard = findCard(arrangement, conn.toId);
        if (!fromCard || !toCard) continue;

        // Agent → Flow card adjacency: determine provider/receiver from position
        if (isEntityCard(fromCard) && fromCard.type === 'agent' && isFlowCard(toCard)) {
            if (fromCard.position.x < toCard.position.x) {
                result.leftAgent.set(toCard.id, fromCard.id);
            } else {
                result.rightAgent.set(toCard.id, fromCard.id);
            }
        }
        if (isFlowCard(fromCard) && isEntityCard(toCard) && toCard.type === 'agent') {
            if (fromCard.position.x < toCard.position.x) {
                result.rightAgent.set(fromCard.id, toCard.id);
            } else {
                result.leftAgent.set(fromCard.id, toCard.id);
            }
        }

        // Entity → Process adjacency: determine inputs (left) vs outputs (right)
        if (isEntityCard(fromCard) && isEntityCard(toCard) && toCard.type === 'process') {
            const inputs = result.processInputs.get(toCard.id) ?? [];
            inputs.push(fromCard.id);
            result.processInputs.set(toCard.id, inputs);
        }
        if (isEntityCard(fromCard) && fromCard.type === 'process' && isEntityCard(toCard)) {
            const outputs = result.processOutputs.get(fromCard.id) ?? [];
            outputs.push(toCard.id);
            result.processOutputs.set(fromCard.id, outputs);
        }

        // Stacking / dashed arrows: Intent → Commitment → Event lifecycle
        if (conn.type === 'stacked' || conn.type === 'dashed') {
            if (isFlowCard(fromCard) && isFlowCard(toCard)) {
                if (fromCard.type === 'intent' && toCard.type === 'commitment') {
                    result.satisfies.set(toCard.id, fromCard.id);
                }
                if (fromCard.type === 'commitment' && toCard.type === 'event') {
                    result.fulfills.set(toCard.id, fromCard.id);
                }
                // Also handle reverse ordering
                if (toCard.type === 'intent' && fromCard.type === 'commitment') {
                    result.satisfies.set(fromCard.id, toCard.id);
                }
                if (toCard.type === 'commitment' && fromCard.type === 'event') {
                    result.fulfills.set(fromCard.id, toCard.id);
                }
            }
        }

        // Adjacent flow cards in L→R order: Intent → Commitment → Event
        if (conn.type === 'adjacent' && isFlowCard(fromCard) && isFlowCard(toCard)) {
            const [left, right] = fromCard.position.x < toCard.position.x
                ? [fromCard, toCard]
                : [toCard, fromCard];
            if (left.type === 'intent' && right.type === 'commitment') {
                result.satisfies.set(right.id, left.id);
            }
            if (left.type === 'commitment' && right.type === 'event') {
                result.fulfills.set(right.id, left.id);
            }
        }
    }

    return result;
}

// =============================================================================
// ENTITY CONVERSION
// =============================================================================

function convertAgent(card: DetectedEntityCard, agentMap: AgentMap): Agent {
    const id = agentMap.cardToAgent.get(card.id)!;
    return {
        id,
        type: card.fields.agentType ?? 'Person',
        name: card.fields.name,
        note: card.fields.description,
        primaryLocation: card.fields.location,
    };
}

function convertResourceSpec(card: DetectedEntityCard, specMap: SpecMap): ResourceSpecification {
    const id = specMap.cardToSpec.get(card.id)!;
    return {
        id,
        name: card.fields.name ?? 'Unnamed Resource Type',
        note: card.fields.description,
        defaultUnitOfResource: card.fields.unit,
    };
}

function convertResource(
    card: DetectedEntityCard,
    specMap: SpecMap,
    agentMap: AgentMap,
): EconomicResource {
    const qty = parseQuantity(card.fields.quantity);
    return {
        id: generateId('resource'),
        name: card.fields.name,
        note: card.fields.description,
        conformsTo: resolveSpecId(card.fields.typeRef, specMap) ?? card.fields.typeRef ?? 'unknown-spec',
        onhandQuantity: qty ? { hasNumericalValue: qty.value, hasUnit: qty.unit } : undefined,
        accountingQuantity: qty ? { hasNumericalValue: qty.value, hasUnit: qty.unit } : undefined,
        currentLocation: card.fields.location,
        primaryAccountable: resolveAgentId(card.fields.custodian, agentMap),
    };
}

function convertProcess(card: DetectedEntityCard): Process {
    return {
        id: generateId('process'),
        name: card.fields.name ?? 'Unnamed Process',
        note: card.fields.description,
        hasDuration: parseDuration(card.fields.duration),
    } as Process & { hasDuration?: { hasNumericalValue: number; hasUnit: string } };
}

function convertRecipe(card: DetectedEntityCard, specMap: SpecMap): {
    recipe: Recipe;
    recipeProcesses: RecipeProcess[];
    recipeFlows: RecipeFlow[];
} {
    const recipeId = generateId('recipe');
    const processId = generateId('rp');
    const recipeFlows: RecipeFlow[] = [];

    // Create input flows from card fields
    if (card.fields.inputs) {
        for (const input of card.fields.inputs) {
            recipeFlows.push({
                id: generateId('rf'),
                action: 'consume' as VfAction,
                resourceConformsTo: resolveSpecId(input, specMap),
                recipeInputOf: processId,
            });
        }
    }

    // Create output flows from card fields
    if (card.fields.outputs) {
        for (const output of card.fields.outputs) {
            recipeFlows.push({
                id: generateId('rf'),
                action: 'produce' as VfAction,
                resourceConformsTo: resolveSpecId(output, specMap),
                recipeOutputOf: processId,
            });
        }
    }

    const recipeProcess: RecipeProcess = {
        id: processId,
        name: card.fields.name ?? 'Unnamed Recipe Step',
        hasDuration: parseDuration(card.fields.duration),
    };

    return {
        recipe: {
            id: recipeId,
            name: card.fields.name ?? 'Unnamed Recipe',
            note: card.fields.description,
            recipeProcesses: [processId],
            primaryOutput: card.fields.outputs?.[0]
                ? resolveSpecId(card.fields.outputs[0], specMap)
                : undefined,
        },
        recipeProcesses: [recipeProcess],
        recipeFlows,
    };
}

// =============================================================================
// FLOW CONVERSION
// =============================================================================

/** Map from flow card ID → VF instance ID (for wiring satisfies/fulfills) */
type FlowIdMap = Map<string, string>;

function convertIntent(
    card: DetectedFlowCard,
    agentMap: AgentMap,
    specMap: SpecMap,
    connAnalysis: ConnectionAnalysis,
    flowIds: FlowIdMap,
): Intent {
    const id = generateId('intent');
    flowIds.set(card.id, id);

    const action = parseAction(card.action);
    const qty = parseQuantity(card.fields.howMuch);

    // Determine provider/receiver from card fields or spatial adjacency
    const leftAgentCardId = connAnalysis.leftAgent.get(card.id);
    const rightAgentCardId = connAnalysis.rightAgent.get(card.id);

    let provider = resolveAgentId(card.fields.provider, agentMap);
    let receiver = resolveAgentId(card.fields.receiver, agentMap);

    // Fall back to spatial adjacency
    if (!provider && leftAgentCardId) {
        provider = agentMap.cardToAgent.get(leftAgentCardId);
    }
    if (!receiver && rightAgentCardId) {
        receiver = agentMap.cardToAgent.get(rightAgentCardId);
    }

    return {
        id,
        action: action ?? 'produce',
        name: card.fields.description,
        resourceConformsTo: resolveSpecId(card.fields.what, specMap),
        resourceQuantity: qty ? { hasNumericalValue: qty.value, hasUnit: qty.unit || card.fields.unit || 'each' } : undefined,
        due: parseDate(card.fields.when),
        provider,
        receiver,
    };
}

function convertCommitment(
    card: DetectedFlowCard,
    agentMap: AgentMap,
    specMap: SpecMap,
    connAnalysis: ConnectionAnalysis,
    flowIds: FlowIdMap,
): Commitment {
    const id = generateId('commitment');
    flowIds.set(card.id, id);

    const action = parseAction(card.action);
    const qty = parseQuantity(card.fields.howMuch);

    let provider = resolveAgentId(card.fields.provider, agentMap);
    let receiver = resolveAgentId(card.fields.receiver, agentMap);

    const leftAgentCardId = connAnalysis.leftAgent.get(card.id);
    const rightAgentCardId = connAnalysis.rightAgent.get(card.id);

    if (!provider && leftAgentCardId) {
        provider = agentMap.cardToAgent.get(leftAgentCardId);
    }
    if (!receiver && rightAgentCardId) {
        receiver = agentMap.cardToAgent.get(rightAgentCardId);
    }

    // Wire satisfies link
    const satisfiesCardId = connAnalysis.satisfies.get(card.id);
    const satisfies = satisfiesCardId ? flowIds.get(satisfiesCardId) : undefined;

    return {
        id,
        action: action ?? 'produce',
        note: card.fields.description,
        resourceConformsTo: resolveSpecId(card.fields.what, specMap),
        resourceQuantity: qty ? { hasNumericalValue: qty.value, hasUnit: qty.unit || card.fields.unit || 'each' } : undefined,
        due: parseDate(card.fields.when),
        provider,
        receiver,
        satisfies,
    };
}

function convertEvent(
    card: DetectedFlowCard,
    agentMap: AgentMap,
    specMap: SpecMap,
    connAnalysis: ConnectionAnalysis,
    flowIds: FlowIdMap,
): EconomicEvent {
    const id = generateId('event');
    flowIds.set(card.id, id);

    const action = parseAction(card.action);
    const qty = parseQuantity(card.fields.howMuch);

    let provider = resolveAgentId(card.fields.provider, agentMap);
    let receiver = resolveAgentId(card.fields.receiver, agentMap);

    const leftAgentCardId = connAnalysis.leftAgent.get(card.id);
    const rightAgentCardId = connAnalysis.rightAgent.get(card.id);

    if (!provider && leftAgentCardId) {
        provider = agentMap.cardToAgent.get(leftAgentCardId);
    }
    if (!receiver && rightAgentCardId) {
        receiver = agentMap.cardToAgent.get(rightAgentCardId);
    }

    // Wire fulfills link
    const fulfillsCardId = connAnalysis.fulfills.get(card.id);
    const fulfills = fulfillsCardId ? flowIds.get(fulfillsCardId) : undefined;

    return {
        id,
        action: action ?? 'produce',
        note: card.fields.description,
        resourceConformsTo: resolveSpecId(card.fields.what, specMap),
        resourceQuantity: qty ? { hasNumericalValue: qty.value, hasUnit: qty.unit || card.fields.unit || 'each' } : undefined,
        hasPointInTime: parseDate(card.fields.when),
        provider,
        receiver,
        fulfills,
    };
}

// =============================================================================
// MAIN CONVERSION
// =============================================================================

/**
 * Convert a detected CardArrangement into VF schema instances.
 *
 * Processing order:
 * 1. Build agent & spec lookup maps from entity cards
 * 2. Analyze spatial connections
 * 3. Convert entity cards → VF entities
 * 4. Convert flow cards → VF intents/commitments/events (in temporal order
 *    so satisfies/fulfills links resolve correctly)
 * 5. Apply annotations as notes
 */
export function arrangementToVF(arrangement: CardArrangement): VFInstances {
    resetIdCounter();

    const entities = getCardsByCategory(arrangement, 'entity');
    const flows = getCardsByCategory(arrangement, 'flow');

    // Step 1: Build lookup maps
    const agentMap = buildAgentMap(entities);
    const specMap = buildSpecMap(entities);

    // Step 2: Analyze connections
    const connAnalysis = analyzeConnections(arrangement);

    // Step 3: Convert entities
    const agents: Agent[] = [];
    const resourceSpecifications: ResourceSpecification[] = [];
    const resources: EconomicResource[] = [];
    const processes: Process[] = [];
    const recipes: Recipe[] = [];
    const recipeProcesses: RecipeProcess[] = [];
    const recipeFlows: RecipeFlow[] = [];

    for (const card of entities) {
        switch (card.type) {
            case 'agent':
                agents.push(convertAgent(card, agentMap));
                break;
            case 'resourceType':
                resourceSpecifications.push(convertResourceSpec(card, specMap));
                break;
            case 'resource':
                resources.push(convertResource(card, specMap, agentMap));
                break;
            case 'process':
                processes.push(convertProcess(card));
                break;
            case 'recipe': {
                const result = convertRecipe(card, specMap);
                recipes.push(result.recipe);
                recipeProcesses.push(...result.recipeProcesses);
                recipeFlows.push(...result.recipeFlows);
                break;
            }
        }
    }

    // Step 4: Convert flows — process in temporal order (intents first, then commitments, then events)
    // This ensures satisfies/fulfills links resolve to already-created IDs
    const flowIds: FlowIdMap = new Map();
    const intents: Intent[] = [];
    const commitments: Commitment[] = [];
    const events: EconomicEvent[] = [];

    // Sort flows by temporal type: intent → commitment → event
    const flowOrder = { intent: 0, commitment: 1, event: 2 };
    const sortedFlows = [...flows].sort((a, b) => flowOrder[a.type] - flowOrder[b.type]);

    for (const card of sortedFlows) {
        switch (card.type) {
            case 'intent':
                intents.push(convertIntent(card, agentMap, specMap, connAnalysis, flowIds));
                break;
            case 'commitment':
                commitments.push(convertCommitment(card, agentMap, specMap, connAnalysis, flowIds));
                break;
            case 'event':
                events.push(convertEvent(card, agentMap, specMap, connAnalysis, flowIds));
                break;
        }
    }

    // Step 5: Apply annotations as notes on nearest cards
    for (const annotation of arrangement.annotations) {
        if (!annotation.nearCardId) continue;
        // Find the VF instance for this card and append the annotation
        // (best-effort: search all collections)
        const appendNote = (items: { id?: string; note?: string }[], cardId: string) => {
            // We'd need a card-ID → VF-ID map for this; for now annotations
            // are captured in the component spec layer
        };
    }

    return {
        agents,
        resourceSpecifications,
        resources,
        processes,
        recipes,
        recipeProcesses,
        recipeFlows,
        intents,
        commitments,
        events,
    };
}
