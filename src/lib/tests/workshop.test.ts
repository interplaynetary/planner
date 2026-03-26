import { describe, expect, test } from 'bun:test';
import { CardArrangementSchema, type CardArrangement } from '../workshop/card-schemas';
import { arrangementToVF, resetIdCounter } from '../workshop/card-to-vf';
import { selectComponents, generateSvelteCode } from '../workshop/component-selector';
import { interpretArrangement } from '../workshop/interpret';

// =============================================================================
// FIXTURES
// =============================================================================

/** Minimal bakery arrangement: Baker → Baking → Bread, with Intent → Commitment */
function bakeryArrangement(): CardArrangement {
    return {
        cards: [
            {
                category: 'entity', type: 'agent', id: 'baker',
                position: { x: 0.1, y: 0.2 },
                fields: { name: 'Baker', agentType: 'Person', location: 'Kitchen' },
            },
            {
                category: 'entity', type: 'agent', id: 'customer',
                position: { x: 0.9, y: 0.2 },
                fields: { name: 'Customer', agentType: 'Person' },
            },
            {
                category: 'entity', type: 'resourceType', id: 'flour-spec',
                position: { x: 0.2, y: 0.1 },
                fields: { name: 'Flour', unit: 'kg' },
            },
            {
                category: 'entity', type: 'resourceType', id: 'bread-spec',
                position: { x: 0.8, y: 0.1 },
                fields: { name: 'Bread', unit: 'loaves' },
            },
            {
                category: 'entity', type: 'process', id: 'baking',
                position: { x: 0.5, y: 0.1 },
                fields: { name: 'Baking', duration: '2 hours' },
            },
            {
                category: 'flow', type: 'intent', id: 'intent-1',
                position: { x: 0.3, y: 0.5 },
                action: 'produce',
                fields: { description: 'Bake bread', what: 'Bread', howMuch: '50 loaves', provider: 'Baker' },
            },
            {
                category: 'flow', type: 'commitment', id: 'commit-1',
                position: { x: 0.6, y: 0.5 },
                action: 'transfer',
                fields: { description: 'Deliver bread', what: 'Bread', howMuch: '20 loaves', provider: 'Baker', receiver: 'Customer' },
            },
        ],
        connections: [
            { fromId: 'flour-spec', toId: 'baking', type: 'adjacent' },
            { fromId: 'baking', toId: 'bread-spec', type: 'adjacent' },
            { fromId: 'baker', toId: 'intent-1', type: 'adjacent' },
            { fromId: 'intent-1', toId: 'commit-1', type: 'adjacent' },
            { fromId: 'commit-1', toId: 'customer', type: 'adjacent' },
        ],
        annotations: [
            { text: 'Weekly run', nearCardId: 'baking' },
        ],
    };
}

/** Arrangement with lens overlays and signal flags */
function lensArrangement(): CardArrangement {
    return {
        cards: [
            {
                category: 'entity', type: 'resourceType', id: 'steel',
                position: { x: 0.5, y: 0.3 },
                fields: { name: 'Steel', unit: 'tonnes' },
            },
            {
                category: 'flow', type: 'intent', id: 'demand-1',
                position: { x: 0.5, y: 0.6 },
                action: 'consume',
                fields: { what: 'Steel', howMuch: '10 tonnes' },
            },
            {
                category: 'lens', type: 'buffer', id: 'buffer-lens',
                position: { x: 0.5, y: 0.3 },
                coversCardIds: ['steel'],
                fields: { note: 'Protect steel supply' },
            },
            {
                category: 'lens', type: 'scope', id: 'scope-lens',
                position: { x: 0.5, y: 0.5 },
                coversCardIds: ['steel', 'demand-1'],
                fields: { name: 'Foundry' },
            },
            {
                category: 'signal', type: 'deficit', id: 'deficit-flag',
                position: { x: 0.7, y: 0.6 },
                nearCardId: 'demand-1',
                fields: { note: 'Running low' },
            },
        ],
        connections: [],
        annotations: [],
    };
}

// =============================================================================
// SCHEMA VALIDATION
// =============================================================================

describe('CardArrangement schema', () => {
    test('validates a well-formed bakery arrangement', () => {
        const result = CardArrangementSchema.safeParse(bakeryArrangement());
        expect(result.success).toBe(true);
    });

    test('validates arrangement with lenses and signals', () => {
        const result = CardArrangementSchema.safeParse(lensArrangement());
        expect(result.success).toBe(true);
    });

    test('rejects invalid card category', () => {
        const invalid = {
            cards: [{ category: 'unknown', type: 'foo', id: 'x', position: { x: 0, y: 0 }, fields: {} }],
            connections: [],
            annotations: [],
        };
        const result = CardArrangementSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    test('rejects out-of-range positions', () => {
        const invalid = bakeryArrangement();
        (invalid.cards[0] as any).position = { x: 2, y: 0.5 };
        const result = CardArrangementSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });
});

// =============================================================================
// CARD-TO-VF MAPPING
// =============================================================================

describe('arrangementToVF', () => {
    test('produces agents from agent cards', () => {
        const vf = arrangementToVF(bakeryArrangement());
        expect(vf.agents).toHaveLength(2);
        expect(vf.agents.find(a => a.name === 'Baker')).toBeDefined();
        expect(vf.agents.find(a => a.name === 'Customer')).toBeDefined();
    });

    test('produces resource specifications from resourceType cards', () => {
        const vf = arrangementToVF(bakeryArrangement());
        expect(vf.resourceSpecifications).toHaveLength(2);
        const flour = vf.resourceSpecifications.find(s => s.name === 'Flour');
        expect(flour).toBeDefined();
        expect(flour!.defaultUnitOfResource).toBe('kg');
    });

    test('produces processes from process cards', () => {
        const vf = arrangementToVF(bakeryArrangement());
        expect(vf.processes).toHaveLength(1);
        expect(vf.processes[0].name).toBe('Baking');
    });

    test('produces intents from intent flow cards', () => {
        const vf = arrangementToVF(bakeryArrangement());
        expect(vf.intents).toHaveLength(1);
        const intent = vf.intents[0];
        expect(intent.action).toBe('produce');
        expect(intent.resourceQuantity?.hasNumericalValue).toBe(50);
        expect(intent.resourceQuantity?.hasUnit).toBe('loaves');
    });

    test('produces commitments from commitment flow cards', () => {
        const vf = arrangementToVF(bakeryArrangement());
        expect(vf.commitments).toHaveLength(1);
        const commitment = vf.commitments[0];
        expect(commitment.action).toBe('transfer');
        expect(commitment.resourceQuantity?.hasNumericalValue).toBe(20);
    });

    test('wires provider from adjacent agent card', () => {
        const vf = arrangementToVF(bakeryArrangement());
        const intent = vf.intents[0];
        // Baker is to the left of intent-1 → should be wired as provider
        expect(intent.provider).toBeDefined();
    });

    test('wires commitment satisfies link from adjacent intent', () => {
        const vf = arrangementToVF(bakeryArrangement());
        const commitment = vf.commitments[0];
        const intent = vf.intents[0];
        // intent-1 is adjacent to commit-1 → satisfies should be wired
        expect(commitment.satisfies).toBe(intent.id);
    });

    test('handles empty arrangement', () => {
        const vf = arrangementToVF({ cards: [], connections: [], annotations: [] });
        expect(vf.agents).toHaveLength(0);
        expect(vf.intents).toHaveLength(0);
    });
});

// =============================================================================
// COMPONENT SELECTOR
// =============================================================================

describe('selectComponents', () => {
    test('produces a root component with children', () => {
        const vf = arrangementToVF(bakeryArrangement());
        const tree = selectComponents(bakeryArrangement(), vf);
        expect(tree.component).toBe('div');
        expect(tree.className).toBe('workshop-interface');
        expect(tree.children.length).toBeGreaterThan(0);
    });

    test('includes IntentRow for intent cards', () => {
        const vf = arrangementToVF(bakeryArrangement());
        const tree = selectComponents(bakeryArrangement(), vf);
        const hasIntentRow = JSON.stringify(tree).includes('IntentRow');
        expect(hasIntentRow).toBe(true);
    });

    test('includes CommitmentRow for commitment cards', () => {
        const vf = arrangementToVF(bakeryArrangement());
        const tree = selectComponents(bakeryArrangement(), vf);
        const hasCommitmentRow = JSON.stringify(tree).includes('CommitmentRow');
        expect(hasCommitmentRow).toBe(true);
    });

    test('wraps buffer-covered cards in buffer panel', () => {
        const arr = lensArrangement();
        const vf = arrangementToVF(arr);
        const tree = selectComponents(arr, vf);
        const json = JSON.stringify(tree);
        expect(json).toContain('buffer-panel');
    });

    test('wraps scope-covered cards in scope panel', () => {
        const arr = lensArrangement();
        const vf = arrangementToVF(arr);
        const tree = selectComponents(arr, vf);
        const json = JSON.stringify(tree);
        expect(json).toContain('scope-panel');
    });

    test('includes signal badges for signal flags', () => {
        const arr = lensArrangement();
        const vf = arrangementToVF(arr);
        const tree = selectComponents(arr, vf);
        const json = JSON.stringify(tree);
        expect(json).toContain('SignalBadge');
        expect(json).toContain('DEFICIT');
    });
});

// =============================================================================
// SVELTE CODE GENERATION
// =============================================================================

describe('generateSvelteCode', () => {
    test('produces valid-looking Svelte code', () => {
        const vf = arrangementToVF(bakeryArrangement());
        const tree = selectComponents(bakeryArrangement(), vf);
        const code = generateSvelteCode(tree, vf);

        expect(code).toContain('<script>');
        expect(code).toContain('</style>');
        expect(code).toContain('.workshop-interface');
    });

    test('includes VF component imports', () => {
        const vf = arrangementToVF(bakeryArrangement());
        const tree = selectComponents(bakeryArrangement(), vf);
        const code = generateSvelteCode(tree, vf);

        expect(code).toContain('IntentRow');
        expect(code).toContain('CommitmentRow');
    });

    test('embeds VF data as state', () => {
        const vf = arrangementToVF(bakeryArrangement());
        const tree = selectComponents(bakeryArrangement(), vf);
        const code = generateSvelteCode(tree, vf);

        expect(code).toContain('$state(');
        expect(code).toContain('Baker');
        expect(code).toContain('Flour');
    });
});

// =============================================================================
// FULL PIPELINE (interpretArrangement)
// =============================================================================

describe('interpretArrangement (full pipeline)', () => {
    test('produces complete result from bakery arrangement', () => {
        const result = interpretArrangement(bakeryArrangement());

        expect(result.arrangement.cards).toHaveLength(7);
        expect(result.vfInstances.agents).toHaveLength(2);
        expect(result.vfInstances.intents).toHaveLength(1);
        expect(result.vfInstances.commitments).toHaveLength(1);
        expect(result.componentTree.component).toBe('div');
        expect(result.svelteCode.length).toBeGreaterThan(100);
    });

    test('produces complete result from lens arrangement', () => {
        const result = interpretArrangement(lensArrangement());

        expect(result.vfInstances.resourceSpecifications).toHaveLength(1);
        expect(result.vfInstances.intents).toHaveLength(1);
        expect(result.svelteCode).toContain('buffer');
    });
});
