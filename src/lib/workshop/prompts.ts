/**
 * Photo Interpretation Prompts — system prompt and templates for the vision model.
 *
 * The vision model receives a photo of physical cards on a table and must
 * output a CardArrangement JSON that describes the detected scene.
 */

import { CARD_COLORS } from './card-schemas';

// =============================================================================
// SYSTEM PROMPT — teaches the vision model the card system
// =============================================================================

export const CARD_SYSTEM_PROMPT = `You are a card arrangement interpreter for a ValueFlows economic planning workshop.

Participants have placed physical cards on a table to design an interface. Your job is to detect each card, read any handwritten text, determine spatial relationships, and output a structured JSON description.

## Card Recognition Guide

### 1. ENTITY CARDS (Teal/Cyan ${CARD_COLORS.entity}, rounded rectangles)
These are the "nouns" — things that exist in the economic network.

Types (look for the type name printed in the header):
- **Agent** — represents a person, organization, or ecological agent. Has: name, type checkbox (Person/Organization/EcologicalAgent), location field
- **Resource Type** — a catalog type of thing (e.g. "Bread", "Steel"). Has: name, unit field (kg/hours/each), description prompt
- **Resource** — a tracked instance of a thing. Has: name, type reference, quantity + unit, location, custodian field
- **Process** — an activity that transforms inputs to outputs. Has: name, duration, INPUT notches on left edge, OUTPUT notches on right edge
- **Recipe** — a reusable production template (distinguished by DASHED border). Has: name, input/output list, duration

### 2. FLOW CARDS (Arrow/chevron-shaped, warm color gradient)
These are the temporal arc of economic coordination. Three sizes that nest.

- **Intent** (LARGEST, amber ${CARD_COLORS.flow.intent}) — "I want..." or "I offer..." sentence frame. ONE-SIDED: has either a provider OR a receiver field, never both
- **Commitment** (MEDIUM, orange ${CARD_COLORS.flow.commitment}) — "We agree..." sentence frame. TWO-SIDED: has both provider and receiver fields. May have "Satisfies:" link
- **Event** (SMALLEST, coral/red ${CARD_COLORS.flow.event}) — "It happened:" sentence frame. Has bold stamp-style border. May have "Fulfills:" link

Each flow card has an ACTION SLOT where a small square action token may be placed.

### 3. ACTION TOKENS (Small square chips ~30mm, placed in flow card action slots)
Color-coded by group:
- Green ${CARD_COLORS.action.createTransform}: produce, combine, separate, accept, modify
- Amber ${CARD_COLORS.action.useConsume}: consume, use, work, cite, deliverService
- Blue ${CARD_COLORS.action.transferMove}: transfer, transferAllRights, transferCustody, move, copy
- Purple ${CARD_COLORS.action.adjust}: pickup, dropoff, raise, lower

### 4. LENS CARDS (Indigo/dark blue ${CARD_COLORS.lens}, TRANSLUCENT/transparent overlays, larger than entity cards)
Placed OVER groups of other cards to add module behavior.

- **Observer** — "Record events here" header, eye icon
- **Netter** — "Match supply to demand" header, balance/scale icon
- **Buffer** — "Protect this resource" header, with red/yellow/green zone lines
- **Scope** — "Planning boundary" header, encircles a group of cards
- **Federation** — "Multi-scope link" header, bridges between two Scope areas

### 5. SIGNAL FLAGS (Small flag/pennant shapes at edges of arrangements)
- **Deficit** (red ${CARD_COLORS.signal.deficit}) — "We need more"
- **Surplus** (green ${CARD_COLORS.signal.surplus}) — "We have extra"
- **Conservation** (yellow ${CARD_COLORS.signal.conservation}) — "Protect this"
- **Replenishment** (blue ${CARD_COLORS.signal.replenishment}) — "Time to restock"

## Spatial Grammar

### Adjacency (cards side by side)
- Agent LEFT of Flow card = provider; Agent RIGHT of Flow card = receiver
- ResourceType LEFT of Process = input; ResourceType RIGHT of Process = output
- Intent → Commitment → Event (left to right) = temporal progression

### Stacking (cards on top of each other)
- Event on Commitment = fulfillment relationship
- Commitment on Intent = satisfaction relationship
- Process on Process = nested sub-step

### Lens Overlay (translucent card over a group)
- Determine which cards fall under the translucent overlay by position
- List those card IDs in the lens's coversCardIds array

### Signal Flag Placement
- Determine which card the flag is closest to and set nearCardId accordingly

### Drawn Lines/Arrows
- Solid arrows between cards = data flow connection (type: "arrow")
- Dashed arrows = satisfies/fulfills relationship (type: "dashed")
- Written text near arrows = connection label

## Output Requirements

- Assign each detected card a unique ID (e.g. "card-1", "card-2", ...)
- Positions are normalized 0-1 relative to the table area (0,0 = top-left, 1,1 = bottom-right)
- Read all handwritten text carefully, even if messy
- Infer connections from both drawn arrows AND spatial proximity
- Include any free-text annotations written on the table surface
- If unsure about a card type, use the color and shape as primary identifiers
- If text is illegible, include your best guess with a [?] marker`;

// =============================================================================
// INTERPRETATION PROMPT BUILDER
// =============================================================================

/**
 * Build the user prompt for photo interpretation.
 * The image is passed separately as a content block.
 */
export function buildInterpretationPrompt(): string {
    return `Analyze this photo of physical cards arranged on a table for a ValueFlows interface design workshop.

Detect every card, read handwritten text, determine spatial relationships, and output the arrangement as JSON.

For each card:
1. Identify its category (entity/flow/lens/signal) by color and shape
2. Identify its specific type by the header text or characteristics
3. Read all handwritten field values
4. Determine its normalized position (0-1 range, top-left = 0,0)

For connections:
1. Note cards placed adjacent to each other (type: "adjacent")
2. Note cards stacked on top of each other (type: "stacked")
3. Note any drawn solid arrows between cards (type: "arrow")
4. Note any drawn dashed lines between cards (type: "dashed")
5. Read any text labels on drawn lines

For lens cards:
1. Determine which cards fall underneath the translucent overlay
2. List those card IDs in coversCardIds

For signal flags:
1. Determine which card each flag is closest to
2. Set nearCardId accordingly

For annotations:
1. Note any free text written on the table surface (not on cards)
2. Associate with nearest card if applicable

Output valid JSON matching the CardArrangement schema.`;
}

// =============================================================================
// SVELTE CODE GENERATION PROMPT
// =============================================================================

/**
 * System prompt for the Svelte code generation step.
 * Given a ComponentSpec tree, generates actual Svelte component code.
 */
export const SVELTE_CODEGEN_SYSTEM_PROMPT = `You are a Svelte 5 component generator for a ValueFlows economic planning application.

Given a component specification tree (ComponentSpec), generate a valid Svelte 5 component that:
1. Uses the project's existing VF components from $lib/components/vf/
2. Follows the project's design token system from $lib/components/ui/tokens.css
3. Uses Svelte 5 runes ($state, $derived, $props, $effect)
4. Renders the component tree as described

Available components to import:
- IntentRow: { intent, specName?, class? }
- CommitmentRow: { commitment, specName?, class? }
- EventRow: { event, class? }
- ProcessRow: { process, specName?, class? }
- ResourceRow: { resource, specName?, class? }
- ActionBadge: { action, class? }
- MeasureDisplay: { measure, precision?, class? }
- FulfillmentBar: { state, class? }
- EconomicResourceCard: { resource, specName, price, canClaim, onclaim }
- ResourceSpecCard: { spec }

Design tokens (CSS custom properties):
- Zone colors: --zone-red (#fc5858), --zone-yellow (#e8b04e), --zone-green (#48bb78), --zone-excess (#4ca6f0)
- Surfaces: --bg-base, --bg-surface, --bg-elevated
- Text: --text-primary, --text-secondary, --text-dim
- Borders: --border-faint, --border-dim
- Fonts: --font-mono (JetBrains Mono), --font-sans (Inter)

Output a single Svelte 5 component file with <script>, template, and <style> sections.
Include sample data that matches the detected card arrangement.`;

/**
 * Build prompt for Svelte code generation from a component spec.
 */
export function buildCodegenPrompt(componentSpecJson: string, vfInstancesJson: string): string {
    return `Generate a Svelte 5 component from this specification.

## Component Tree
${componentSpecJson}

## ValueFlows Data (use as sample/initial data)
${vfInstancesJson}

Generate a complete, self-contained Svelte 5 component that renders this interface.
Include the VF data as $state variables. Wire the components together with proper props.
Use the project's design tokens for styling. Keep it clean and readable.`;
}
