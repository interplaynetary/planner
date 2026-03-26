/**
 * Component Selector — maps a CardArrangement + VF instances to a component tree spec.
 *
 * Takes the detected card layout and determines which Svelte components to compose,
 * how to nest them, and what props to pass. The output is a declarative ComponentSpec
 * tree that can be rendered or used to generate Svelte code.
 */

import type {
    CardArrangement, DetectedCard,
    DetectedEntityCard, DetectedFlowCard,
    DetectedLensCard, DetectedSignalFlag,
} from './card-schemas';
import {
    isEntityCard, isFlowCard, isLensCard, isSignalFlag,
    getCardsByCategory, findCard, getCoveredCards,
} from './card-schemas';
import type { VFInstances } from './card-to-vf';

// =============================================================================
// COMPONENT SPEC — declarative component tree
// =============================================================================

export interface ComponentSpec {
    /** Component name (e.g. 'IntentRow', 'ScopePanel', 'section') */
    component: string;
    /** Props to pass to the component */
    props: Record<string, unknown>;
    /** Child components */
    children: ComponentSpec[];
    /** CSS class to apply */
    className?: string;
    /** Layout direction when this is a container */
    layout?: 'row' | 'column';
    /** Source card ID (for tracing back to the physical arrangement) */
    sourceCardId?: string;
}

// =============================================================================
// ENTITY → COMPONENT MAPPING
// =============================================================================

const ENTITY_COMPONENT_MAP: Record<string, string> = {
    agent: 'AgentCard',
    resourceType: 'ResourceSpecCard',
    resource: 'ResourceRow',
    process: 'ProcessRow',
    recipe: 'RecipeCard',
};

function entityToComponent(card: DetectedEntityCard, vf: VFInstances): ComponentSpec {
    const component = ENTITY_COMPONENT_MAP[card.type] ?? 'VfCard';

    switch (card.type) {
        case 'agent': {
            const agent = vf.agents.find(a => a.name?.toLowerCase() === card.fields.name?.toLowerCase());
            return {
                component: 'AgentCard',
                props: { agent: agent ?? { id: card.id, name: card.fields.name, type: card.fields.agentType ?? 'Person' } },
                children: [],
                sourceCardId: card.id,
            };
        }
        case 'resourceType': {
            const spec = vf.resourceSpecifications.find(s => s.name.toLowerCase() === card.fields.name?.toLowerCase());
            return {
                component: 'ResourceSpecCard',
                props: { spec: spec ?? { id: card.id, name: card.fields.name ?? 'Unknown' } },
                children: [],
                sourceCardId: card.id,
            };
        }
        case 'resource': {
            const resource = vf.resources.find(r => r.name?.toLowerCase() === card.fields.name?.toLowerCase());
            const specName = card.fields.typeRef;
            return {
                component: 'ResourceRow',
                props: { resource: resource ?? { id: card.id, conformsTo: 'unknown' }, specName },
                children: [],
                sourceCardId: card.id,
            };
        }
        case 'process': {
            const process = vf.processes.find(p => p.name.toLowerCase() === card.fields.name?.toLowerCase());
            return {
                component: 'ProcessRow',
                props: { process: process ?? { id: card.id, name: card.fields.name ?? 'Unknown' } },
                children: [],
                sourceCardId: card.id,
            };
        }
        case 'recipe': {
            const recipe = vf.recipes.find(r => r.name.toLowerCase() === card.fields.name?.toLowerCase());
            return {
                component: 'RecipeCard',
                props: { recipe: recipe ?? { id: card.id, name: card.fields.name ?? 'Unknown' } },
                children: [],
                className: 'recipe-template',
                sourceCardId: card.id,
            };
        }
        default:
            return {
                component: 'VfCard',
                props: { title: card.fields.name, fields: card.fields },
                children: [],
                sourceCardId: card.id,
            };
    }
}

// =============================================================================
// FLOW → COMPONENT MAPPING
// =============================================================================

function flowToComponent(card: DetectedFlowCard, vf: VFInstances): ComponentSpec {
    switch (card.type) {
        case 'intent': {
            const intent = vf.intents.find(i => i.name === card.fields.description);
            return {
                component: 'IntentRow',
                props: {
                    intent: intent ?? { id: card.id, action: card.action ?? 'produce' },
                    specName: card.fields.what,
                },
                children: [],
                sourceCardId: card.id,
            };
        }
        case 'commitment': {
            const commitment = vf.commitments.find(c => c.note === card.fields.description);
            return {
                component: 'CommitmentRow',
                props: {
                    commitment: commitment ?? { id: card.id, action: card.action ?? 'produce' },
                    specName: card.fields.what,
                },
                children: [],
                sourceCardId: card.id,
            };
        }
        case 'event': {
            const event = vf.events.find(e => e.note === card.fields.description);
            return {
                component: 'EventRow',
                props: {
                    event: event ?? { id: card.id, action: card.action ?? 'produce' },
                },
                children: [],
                sourceCardId: card.id,
            };
        }
        default:
            return {
                component: 'div',
                props: {},
                children: [],
                sourceCardId: card.id,
            };
    }
}

// =============================================================================
// SIGNAL → COMPONENT MAPPING
// =============================================================================

function signalToComponent(flag: DetectedSignalFlag): ComponentSpec {
    const badgeColors: Record<string, string> = {
        deficit: 'var(--zone-red)',
        surplus: 'var(--zone-green)',
        conservation: 'var(--zone-yellow)',
        replenishment: 'var(--zone-excess)',
    };

    const labels: Record<string, string> = {
        deficit: 'DEFICIT',
        surplus: 'SURPLUS',
        conservation: 'CONSERVATION',
        replenishment: 'REPLENISHMENT',
    };

    return {
        component: 'SignalBadge',
        props: {
            type: flag.type,
            label: labels[flag.type] ?? flag.type.toUpperCase(),
            color: badgeColors[flag.type],
            note: flag.fields.note,
        },
        children: [],
        sourceCardId: flag.id,
    };
}

// =============================================================================
// LENS → WRAPPER MAPPING
// =============================================================================

interface LensWrapper {
    component: string;
    className: string;
    props: Record<string, unknown>;
    /** Additional child components the lens adds */
    extraChildren: ComponentSpec[];
}

function lensToWrapper(lens: DetectedLensCard): LensWrapper {
    switch (lens.type) {
        case 'observer':
            return {
                component: 'section',
                className: 'observer-panel',
                props: { 'data-lens': 'observer' },
                extraChildren: [{
                    component: 'LensHeader',
                    props: { icon: 'eye', title: 'Observer', subtitle: 'Event recording & state derivation' },
                    children: [],
                }],
            };
        case 'netter':
            return {
                component: 'section',
                className: 'netter-panel',
                props: { 'data-lens': 'netter' },
                extraChildren: [{
                    component: 'LensHeader',
                    props: { icon: 'scale', title: 'Netter', subtitle: 'Supply ↔ demand matching' },
                    children: [],
                }],
            };
        case 'buffer':
            return {
                component: 'section',
                className: 'buffer-panel',
                props: { 'data-lens': 'buffer' },
                extraChildren: [
                    {
                        component: 'LensHeader',
                        props: { icon: 'shield', title: 'Buffer', subtitle: 'Resource protection zones' },
                        children: [],
                    },
                    {
                        component: 'BufferZoneBar',
                        props: {},
                        children: [],
                    },
                ],
            };
        case 'scope':
            return {
                component: 'section',
                className: 'scope-panel',
                props: { 'data-lens': 'scope', name: lens.fields.name },
                extraChildren: [{
                    component: 'LensHeader',
                    props: { icon: 'boundary', title: lens.fields.name ?? 'Scope', subtitle: 'Planning boundary' },
                    children: [],
                }],
            };
        case 'federation':
            return {
                component: 'section',
                className: 'federation-panel',
                props: { 'data-lens': 'federation' },
                extraChildren: [{
                    component: 'LensHeader',
                    props: { icon: 'bridge', title: 'Federation', subtitle: 'Multi-scope orchestration' },
                    children: [],
                }],
            };
        default:
            return {
                component: 'section',
                className: 'lens-panel',
                props: {},
                extraChildren: [],
            };
    }
}

// =============================================================================
// FULFILLMENT CHAIN DETECTION
// =============================================================================

/**
 * Detect Intent → Commitment → Event chains and wrap them with FulfillmentBar.
 */
function detectFulfillmentChains(
    arrangement: CardArrangement,
    flowComponents: Map<string, ComponentSpec>,
): ComponentSpec[] {
    const chains: ComponentSpec[] = [];
    const usedCardIds = new Set<string>();

    const flows = getCardsByCategory(arrangement, 'flow');
    const intents = flows.filter(f => f.type === 'intent');

    for (const intent of intents) {
        // Find commitment that satisfies this intent (adjacent or stacked)
        const commitment = flows.find(f =>
            f.type === 'commitment' &&
            arrangement.connections.some(c =>
                (c.fromId === intent.id && c.toId === f.id) ||
                (c.fromId === f.id && c.toId === intent.id)
            )
        );

        // Find event that fulfills the commitment
        const event = commitment ? flows.find(f =>
            f.type === 'event' &&
            arrangement.connections.some(c =>
                (c.fromId === commitment.id && c.toId === f.id) ||
                (c.fromId === f.id && c.toId === commitment.id)
            )
        ) : undefined;

        if (commitment) {
            // Build chain component
            const chainChildren: ComponentSpec[] = [];
            const intentComp = flowComponents.get(intent.id);
            const commitmentComp = flowComponents.get(commitment.id);

            if (intentComp) chainChildren.push(intentComp);
            if (commitmentComp) chainChildren.push(commitmentComp);

            if (event) {
                const eventComp = flowComponents.get(event.id);
                if (eventComp) chainChildren.push(eventComp);
                usedCardIds.add(event.id);
            }

            // Add fulfillment bar
            chainChildren.push({
                component: 'FulfillmentBar',
                props: {
                    state: event ? 'fulfilled' : commitment ? 'committed' : 'intended',
                },
                children: [],
            });

            chains.push({
                component: 'div',
                className: 'fulfillment-chain',
                props: {},
                children: chainChildren,
                layout: 'row',
            });

            usedCardIds.add(intent.id);
            usedCardIds.add(commitment.id);
        }
    }

    return chains;
}

// =============================================================================
// SPATIAL LAYOUT — group cards by position into rows/columns
// =============================================================================

interface SpatialGroup {
    cards: DetectedCard[];
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * Group cards into horizontal rows based on Y-position proximity.
 */
function groupIntoRows(cards: DetectedCard[], threshold = 0.15): SpatialGroup[] {
    if (cards.length === 0) return [];

    // Sort by Y position
    const sorted = [...cards].sort((a, b) => a.position.y - b.position.y);
    const groups: SpatialGroup[] = [];
    let currentGroup: DetectedCard[] = [sorted[0]];
    let currentY = sorted[0].position.y;

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].position.y - currentY > threshold) {
            groups.push({
                cards: currentGroup.sort((a, b) => a.position.x - b.position.x),
                bounds: {
                    minX: Math.min(...currentGroup.map(c => c.position.x)),
                    maxX: Math.max(...currentGroup.map(c => c.position.x)),
                    minY: Math.min(...currentGroup.map(c => c.position.y)),
                    maxY: Math.max(...currentGroup.map(c => c.position.y)),
                },
            });
            currentGroup = [sorted[i]];
            currentY = sorted[i].position.y;
        } else {
            currentGroup.push(sorted[i]);
        }
    }

    groups.push({
        cards: currentGroup.sort((a, b) => a.position.x - b.position.x),
        bounds: {
            minX: Math.min(...currentGroup.map(c => c.position.x)),
            maxX: Math.max(...currentGroup.map(c => c.position.x)),
            minY: Math.min(...currentGroup.map(c => c.position.y)),
            maxY: Math.max(...currentGroup.map(c => c.position.y)),
        },
    });

    return groups;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Recursively check if a component tree contains any of the given source card IDs */
function containsSourceCardId(spec: ComponentSpec, ids: Set<string>): boolean {
    if (spec.sourceCardId && ids.has(spec.sourceCardId)) return true;
    return spec.children.some(child => containsSourceCardId(child, ids));
}

// =============================================================================
// MAIN SELECTOR
// =============================================================================

/**
 * Select and compose Svelte components from a card arrangement.
 *
 * Algorithm:
 * 1. Convert each card to its base component spec
 * 2. Detect fulfillment chains (Intent→Commitment→Event) and group them
 * 3. Apply lens overlays as wrapper components
 * 4. Attach signal flags as badges/indicators
 * 5. Arrange spatially into rows based on card positions
 */
export function selectComponents(
    arrangement: CardArrangement,
    vf: VFInstances,
): ComponentSpec {
    // Step 1: Convert all cards to base components
    const componentMap = new Map<string, ComponentSpec>();

    for (const card of arrangement.cards) {
        if (isEntityCard(card)) {
            componentMap.set(card.id, entityToComponent(card, vf));
        } else if (isFlowCard(card)) {
            componentMap.set(card.id, flowToComponent(card, vf));
        } else if (isSignalFlag(card)) {
            componentMap.set(card.id, signalToComponent(card));
        }
        // Lens cards are handled as wrappers, not individual components
    }

    // Step 2: Detect fulfillment chains
    const flowComponents = new Map<string, ComponentSpec>();
    for (const card of arrangement.cards) {
        if (isFlowCard(card) && componentMap.has(card.id)) {
            flowComponents.set(card.id, componentMap.get(card.id)!);
        }
    }
    const chains = detectFulfillmentChains(arrangement, flowComponents);
    const chainedCardIds = new Set<string>();
    for (const chain of chains) {
        for (const child of chain.children) {
            if (child.sourceCardId) chainedCardIds.add(child.sourceCardId);
        }
    }

    // Step 3: Build the non-chained card list (excluding lens cards and chained flow cards)
    const standaloneCards = arrangement.cards.filter(c =>
        !isLensCard(c) &&
        !chainedCardIds.has(c.id) &&
        componentMap.has(c.id)
    );

    // Step 4: Group into spatial rows
    const allDisplayCards = [...standaloneCards];
    const rows = groupIntoRows(allDisplayCards);

    // Build row components
    const rowComponents: ComponentSpec[] = [];

    for (const row of rows) {
        const rowChildren: ComponentSpec[] = [];

        for (const card of row.cards) {
            const comp = componentMap.get(card.id);
            if (comp) {
                // Attach signal flags to their nearest card
                const attachedSignals = arrangement.cards.filter(
                    c => isSignalFlag(c) && c.nearCardId === card.id
                );
                if (attachedSignals.length > 0) {
                    rowChildren.push({
                        component: 'div',
                        className: 'card-with-signals',
                        props: {},
                        children: [
                            comp,
                            ...attachedSignals.map(s => componentMap.get(s.id)!).filter(Boolean),
                        ],
                    });
                } else {
                    rowChildren.push(comp);
                }
            }
        }

        rowComponents.push({
            component: 'div',
            className: 'card-row',
            props: {},
            children: rowChildren,
            layout: 'row',
        });
    }

    // Insert fulfillment chains into the layout
    if (chains.length > 0) {
        rowComponents.push({
            component: 'div',
            className: 'fulfillment-chains',
            props: {},
            children: chains,
            layout: 'column',
        });
    }

    // Step 5: Apply lens wrappers
    const lenses = getCardsByCategory(arrangement, 'lens');
    let rootChildren = rowComponents;

    for (const lens of lenses) {
        const wrapper = lensToWrapper(lens);
        const coveredCardIds = new Set(lens.coversCardIds);

        // Find which root children contain covered cards (recursive check)
        const wrappedIndices: number[] = [];
        rootChildren.forEach((child, index) => {
            if (containsSourceCardId(child, coveredCardIds)) {
                wrappedIndices.push(index);
            }
        });

        if (wrappedIndices.length > 0) {
            // Extract covered rows, wrap them
            const coveredRows = wrappedIndices.map(i => rootChildren[i]);
            const wrapperSpec: ComponentSpec = {
                component: wrapper.component,
                className: wrapper.className,
                props: wrapper.props,
                children: [...wrapper.extraChildren, ...coveredRows],
            };

            // Replace in rootChildren
            const newChildren: ComponentSpec[] = [];
            for (let i = 0; i < rootChildren.length; i++) {
                if (i === wrappedIndices[0]) {
                    newChildren.push(wrapperSpec);
                } else if (!wrappedIndices.includes(i)) {
                    newChildren.push(rootChildren[i]);
                }
            }
            rootChildren = newChildren;
        }
    }

    // Step 6: Wrap everything in the root layout
    return {
        component: 'div',
        className: 'workshop-interface',
        props: {},
        children: rootChildren,
        layout: 'column',
    };
}

// =============================================================================
// SVELTE CODE GENERATION — convert ComponentSpec → Svelte source
// =============================================================================

/**
 * Generate Svelte 5 component source code from a ComponentSpec tree.
 * Produces a self-contained component with embedded sample data.
 */
export function generateSvelteCode(tree: ComponentSpec, vf: VFInstances): string {
    // Collect which VF components are used
    const usedComponents = new Set<string>();
    collectComponents(tree, usedComponents);

    // Build imports
    const componentImports: Record<string, string> = {
        IntentRow: '$lib/components/vf/IntentRow.svelte',
        CommitmentRow: '$lib/components/vf/CommitmentRow.svelte',
        EventRow: '$lib/components/vf/EventRow.svelte',
        ProcessRow: '$lib/components/vf/ProcessRow.svelte',
        ResourceRow: '$lib/components/vf/ResourceRow.svelte',
        ActionBadge: '$lib/components/vf/ActionBadge.svelte',
        MeasureDisplay: '$lib/components/vf/MeasureDisplay.svelte',
        FulfillmentBar: '$lib/components/vf/FulfillmentBar.svelte',
        ResourceSpecCard: '$lib/components/vf/ResourceSpecCard.svelte',
        EconomicResourceCard: '$lib/components/vf/EconomicResourceCard.svelte',
    };

    const imports = [...usedComponents]
        .filter(c => componentImports[c])
        .map(c => `  import ${c} from '${componentImports[c]}';`)
        .join('\n');

    // Build data section
    const data = JSON.stringify(vf, null, 2);

    // Build template
    const template = renderComponentSpec(tree, 1);

    return `<script>
${imports}

  // Sample data from card arrangement
  const data = $state(${data});
</script>

${template}

<style>
  .workshop-interface {
    display: flex;
    flex-direction: column;
    gap: var(--gap-lg, 16px);
    padding: var(--gap-lg, 16px);
    font-family: var(--font-sans, Inter, system-ui);
  }

  .card-row {
    display: flex;
    flex-direction: row;
    gap: var(--gap-md, 8px);
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .fulfillment-chain {
    display: flex;
    flex-direction: row;
    gap: var(--gap-sm, 4px);
    align-items: center;
    padding: var(--gap-sm, 4px);
    border: 1px dashed var(--border-faint, rgba(130, 175, 255, 0.18));
    border-radius: 6px;
  }

  .card-with-signals {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs, 2px);
  }

  .scope-panel {
    border: 2px solid var(--border-dim, rgba(130, 175, 255, 0.35));
    border-radius: 8px;
    padding: var(--gap-md, 8px);
  }

  .observer-panel {
    border-left: 3px solid #4fd1c5;
    padding-left: var(--gap-md, 8px);
  }

  .netter-panel {
    border-left: 3px solid #4ca6f0;
    padding-left: var(--gap-md, 8px);
  }

  .buffer-panel {
    border-left: 3px solid var(--zone-yellow, #e8b04e);
    padding-left: var(--gap-md, 8px);
  }

  .federation-panel {
    border: 2px dashed #3182ce;
    border-radius: 8px;
    padding: var(--gap-md, 8px);
  }

  .lens-header {
    display: flex;
    align-items: center;
    gap: var(--gap-sm, 4px);
    font-size: var(--text-sm, 0.8rem);
    color: var(--text-secondary, rgba(188, 212, 252, 0.80));
    margin-bottom: var(--gap-sm, 4px);
  }

  .signal-badge {
    display: inline-flex;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: var(--text-xs, 0.7rem);
    font-weight: 600;
    text-transform: uppercase;
    font-family: var(--font-mono, monospace);
  }
</style>`;
}

function collectComponents(spec: ComponentSpec, set: Set<string>): void {
    if (spec.component && !['div', 'section', 'span'].includes(spec.component)) {
        set.add(spec.component);
    }
    for (const child of spec.children) {
        collectComponents(child, set);
    }
}

function renderComponentSpec(spec: ComponentSpec, depth: number): string {
    const indent = '  '.repeat(depth);
    const tag = spec.component;

    // HTML elements
    if (['div', 'section', 'span'].includes(tag)) {
        const classAttr = spec.className ? ` class="${spec.className}"` : '';
        const children = spec.children.map(c => renderComponentSpec(c, depth + 1)).join('\n');
        return `${indent}<${tag}${classAttr}>\n${children}\n${indent}</${tag}>`;
    }

    // Custom components: LensHeader, SignalBadge, BufferZoneBar
    if (tag === 'LensHeader') {
        const { title, subtitle } = spec.props as { title: string; subtitle: string };
        return `${indent}<div class="lens-header">
${indent}  <strong>${title}</strong>
${indent}  <span class="muted">${subtitle}</span>
${indent}</div>`;
    }

    if (tag === 'SignalBadge') {
        const { label, color } = spec.props as { label: string; color: string };
        return `${indent}<span class="signal-badge" style="background: ${color}; color: #111;">${label}</span>`;
    }

    if (tag === 'BufferZoneBar') {
        return `${indent}<div class="buffer-zone-bar" style="display:flex; height:8px; border-radius:4px; overflow:hidden;">
${indent}  <div style="flex:1; background:var(--zone-red, #fc5858);"></div>
${indent}  <div style="flex:1; background:var(--zone-yellow, #e8b04e);"></div>
${indent}  <div style="flex:1; background:var(--zone-green, #48bb78);"></div>
${indent}</div>`;
    }

    // VF Components — render with data props
    if (tag === 'AgentCard') {
        const name = (spec.props.agent as { name?: string })?.name ?? 'Agent';
        return `${indent}<div class="agent-card" style="border-left:3px solid #4fd1c5; padding-left:8px;">
${indent}  <strong>${name}</strong>
${indent}</div>`;
    }

    if (tag === 'RecipeCard') {
        const name = (spec.props.recipe as { name?: string })?.name ?? 'Recipe';
        return `${indent}<div class="recipe-card" style="border:2px dashed var(--border-dim); padding:8px; border-radius:6px;">
${indent}  <strong>${name}</strong> <span class="muted">(recipe template)</span>
${indent}</div>`;
    }

    // Known VF components: render as Svelte component tags with comment placeholders
    const propsStr = Object.entries(spec.props)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => {
            if (typeof v === 'string') return `${k}="${v}"`;
            return `${k}={${JSON.stringify(v)}}`;
        })
        .join(' ');

    const children = spec.children.map(c => renderComponentSpec(c, depth + 1)).join('\n');
    if (spec.children.length > 0) {
        return `${indent}<${tag} ${propsStr}>\n${children}\n${indent}</${tag}>`;
    }
    return `${indent}<${tag} ${propsStr} />`;
}
