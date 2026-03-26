/**
 * Card Detection Schemas — Zod schemas for card arrangements detected from photos.
 *
 * The AI vision model extracts a CardArrangement from a photo of physical cards
 * on a table. These schemas validate that structured output.
 *
 * Card categories:
 *   Entity (teal)  — Agent, ResourceType, Resource, Process, Recipe
 *   Flow (amber→coral) — Intent, Commitment, Event
 *   Lens (indigo, translucent) — Observer, Netter, Buffer, Scope, Federation
 *   Signal (zone-colored flags) — Deficit, Surplus, Conservation, Replenishment
 */

import { z } from 'zod';

// =============================================================================
// CARD CATEGORY ENUMS
// =============================================================================

export const EntityCardType = z.enum([
    'agent',
    'resourceType',
    'resource',
    'process',
    'recipe',
]);
export type EntityCardType = z.infer<typeof EntityCardType>;

export const FlowCardType = z.enum([
    'intent',
    'commitment',
    'event',
]);
export type FlowCardType = z.infer<typeof FlowCardType>;

export const LensCardType = z.enum([
    'observer',
    'netter',
    'buffer',
    'scope',
    'federation',
]);
export type LensCardType = z.infer<typeof LensCardType>;

export const SignalFlagType = z.enum([
    'deficit',
    'surplus',
    'conservation',
    'replenishment',
]);
export type SignalFlagType = z.infer<typeof SignalFlagType>;

// =============================================================================
// CARD COLORS — physical card colors for the vision model
// =============================================================================

export const CARD_COLORS = {
    entity: '#4fd1c5',
    flow: {
        intent: '#e8b04e',
        commitment: '#ed8936',
        event: '#fc5858',
    },
    lens: '#3182ce',
    signal: {
        deficit: '#fc5858',
        surplus: '#48bb78',
        conservation: '#e8b04e',
        replenishment: '#4ca6f0',
    },
    action: {
        createTransform: '#48bb78',
        useConsume: '#e8b04e',
        transferMove: '#4ca6f0',
        adjust: '#9f7aea',
    },
} as const;

// =============================================================================
// POSITION — relative position on the table (0-1 normalized)
// =============================================================================

export const PositionSchema = z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
});
export type Position = z.infer<typeof PositionSchema>;

// =============================================================================
// DETECTED CARDS — what the vision model extracts
// =============================================================================

/**
 * Entity card — the nouns: Agent, Resource Type, Resource, Process, Recipe.
 * Fields are OCR'd handwritten text from the card's writable zones.
 */
export const DetectedEntityCardSchema = z.object({
    category: z.literal('entity'),
    type: EntityCardType,
    id: z.string(),
    position: PositionSchema,
    fields: z.object({
        name: z.string().optional(),
        /** Agent type: Person, Organization, or EcologicalAgent */
        agentType: z.enum(['Person', 'Organization', 'EcologicalAgent']).optional(),
        /** Unit of measurement (on Resource Type cards) */
        unit: z.string().optional(),
        /** Quantity written on card (on Resource cards) */
        quantity: z.string().optional(),
        /** Location written on card */
        location: z.string().optional(),
        /** Custodian / "who has it" (on Resource cards) */
        custodian: z.string().optional(),
        /** Duration written on card (on Process cards) */
        duration: z.string().optional(),
        /** Type reference — connects Resource to its Resource Type (written name or drawn arrow) */
        typeRef: z.string().optional(),
        /** Free-text description or note */
        description: z.string().optional(),
        /** Input list (on Recipe cards) */
        inputs: z.array(z.string()).optional(),
        /** Output list (on Recipe cards) */
        outputs: z.array(z.string()).optional(),
    }),
});
export type DetectedEntityCard = z.infer<typeof DetectedEntityCardSchema>;

/**
 * Flow card — the temporal arc: Intent, Commitment, Event.
 * Arrow-shaped, physically nesting (Intent largest → Event smallest).
 */
export const DetectedFlowCardSchema = z.object({
    category: z.literal('flow'),
    type: FlowCardType,
    id: z.string(),
    position: PositionSchema,
    /** Action token placed in the card's action slot (e.g. "produce", "consume") */
    action: z.string().optional(),
    fields: z.object({
        /** Sentence frame content: what was written after "I want..." / "We agree..." / "It happened:" */
        description: z.string().optional(),
        /** What resource/spec is referenced */
        what: z.string().optional(),
        /** Quantity */
        howMuch: z.string().optional(),
        /** Unit */
        unit: z.string().optional(),
        /** Due date / when */
        when: z.string().optional(),
        /** Provider name (left side of card or explicitly written) */
        provider: z.string().optional(),
        /** Receiver name (right side of card or explicitly written) */
        receiver: z.string().optional(),
    }),
});
export type DetectedFlowCard = z.infer<typeof DetectedFlowCardSchema>;

/**
 * Lens card — translucent overlays that activate modules.
 * Placed over groups of other cards to add algorithmic behavior.
 */
export const DetectedLensCardSchema = z.object({
    category: z.literal('lens'),
    type: LensCardType,
    id: z.string(),
    position: PositionSchema,
    /** IDs of cards this lens overlays (determined by spatial overlap) */
    coversCardIds: z.array(z.string()),
    fields: z.object({
        /** Scope name (on Scope lens cards) */
        name: z.string().optional(),
        /** Any handwritten notes on the lens */
        note: z.string().optional(),
    }),
});
export type DetectedLensCard = z.infer<typeof DetectedLensCardSchema>;

/**
 * Signal flag — small pennants placed at edges of arrangements.
 * Indicate what feedback the interface should surface.
 */
export const DetectedSignalFlagSchema = z.object({
    category: z.literal('signal'),
    type: SignalFlagType,
    id: z.string(),
    position: PositionSchema,
    /** ID of the nearest card this flag is associated with */
    nearCardId: z.string(),
    fields: z.object({
        /** Any text written on the flag */
        note: z.string().optional(),
    }),
});
export type DetectedSignalFlag = z.infer<typeof DetectedSignalFlagSchema>;

// =============================================================================
// CONNECTIONS — relationships between cards
// =============================================================================

export const ConnectionType = z.enum([
    'adjacent',      // cards placed side by side
    'stacked',       // cards physically on top of each other
    'arrow',         // drawn solid arrow between cards
    'dashed',        // drawn dashed arrow (satisfies/fulfills)
]);
export type ConnectionType = z.infer<typeof ConnectionType>;

export const DetectedConnectionSchema = z.object({
    fromId: z.string(),
    toId: z.string(),
    type: ConnectionType,
    /** Text annotation on the drawn line/arrow */
    label: z.string().optional(),
});
export type DetectedConnection = z.infer<typeof DetectedConnectionSchema>;

// =============================================================================
// ANNOTATIONS — free-text written on the table surface
// =============================================================================

export const AnnotationSchema = z.object({
    text: z.string(),
    /** ID of the nearest card, if any */
    nearCardId: z.string().optional(),
    position: PositionSchema.optional(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

// =============================================================================
// TOP-LEVEL ARRANGEMENT — the complete detected scene
// =============================================================================

/**
 * CardArrangement — the complete output of AI photo interpretation.
 * Describes all detected cards, their positions, connections between them,
 * and free-text annotations on the table.
 */
export const CardArrangementSchema = z.object({
    cards: z.array(z.discriminatedUnion('category', [
        DetectedEntityCardSchema,
        DetectedFlowCardSchema,
        DetectedLensCardSchema,
        DetectedSignalFlagSchema,
    ])),
    connections: z.array(DetectedConnectionSchema),
    annotations: z.array(AnnotationSchema),
});
export type CardArrangement = z.infer<typeof CardArrangementSchema>;

// =============================================================================
// HELPERS — type guards and accessors
// =============================================================================

export type DetectedCard = DetectedEntityCard | DetectedFlowCard | DetectedLensCard | DetectedSignalFlag;

export function isEntityCard(card: DetectedCard): card is DetectedEntityCard {
    return card.category === 'entity';
}

export function isFlowCard(card: DetectedCard): card is DetectedFlowCard {
    return card.category === 'flow';
}

export function isLensCard(card: DetectedCard): card is DetectedLensCard {
    return card.category === 'lens';
}

export function isSignalFlag(card: DetectedCard): card is DetectedSignalFlag {
    return card.category === 'signal';
}

/** Get all cards of a specific category from an arrangement */
export function getCardsByCategory<T extends DetectedCard['category']>(
    arrangement: CardArrangement,
    category: T,
): Extract<DetectedCard, { category: T }>[] {
    return arrangement.cards.filter(c => c.category === category) as Extract<DetectedCard, { category: T }>[];
}

/** Find a card by ID */
export function findCard(arrangement: CardArrangement, id: string): DetectedCard | undefined {
    return arrangement.cards.find(c => c.id === id);
}

/** Get all connections involving a specific card */
export function getConnections(arrangement: CardArrangement, cardId: string): DetectedConnection[] {
    return arrangement.connections.filter(c => c.fromId === cardId || c.toId === cardId);
}

/** Get cards that a lens covers */
export function getCoveredCards(arrangement: CardArrangement, lens: DetectedLensCard): DetectedCard[] {
    return lens.coversCardIds
        .map(id => findCard(arrangement, id))
        .filter((c): c is DetectedCard => c !== undefined);
}
