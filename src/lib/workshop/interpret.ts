/**
 * Workshop Interpreter — orchestrates the full photo → interface pipeline.
 *
 * Flow: Photo → AI Vision → CardArrangement → VF Instances → ComponentSpec → Svelte Code
 */

import { z } from 'zod';
import type { AIPipe } from '../ai-pipe';
import { CardArrangementSchema, type CardArrangement } from './card-schemas';
import { arrangementToVF, type VFInstances } from './card-to-vf';
import { selectComponents, generateSvelteCode, type ComponentSpec } from './component-selector';
import { CARD_SYSTEM_PROMPT, buildInterpretationPrompt, SVELTE_CODEGEN_SYSTEM_PROMPT, buildCodegenPrompt } from './prompts';

// =============================================================================
// RESULT TYPE
// =============================================================================

export interface InterpretationResult {
    /** Raw detected card arrangement */
    arrangement: CardArrangement;
    /** Converted VF schema instances */
    vfInstances: VFInstances;
    /** Selected component tree */
    componentTree: ComponentSpec;
    /** Generated Svelte source code */
    svelteCode: string;
}

// =============================================================================
// MAIN INTERPRETER
// =============================================================================

/**
 * Interpret a photo of workshop cards and generate a Svelte interface.
 *
 * @param imageBase64 - Base64-encoded image data (JPEG or PNG)
 * @param mediaType - Image MIME type (e.g. 'image/jpeg', 'image/png')
 * @param pipe - Configured AIPipe instance with a vision-capable provider
 * @returns Full interpretation result with arrangement, VF data, component tree, and Svelte code
 */
export async function interpretCardPhoto(
    imageBase64: string,
    mediaType: string,
    pipe: AIPipe,
): Promise<InterpretationResult> {
    // Step 1: Send image to vision model → CardArrangement
    const arrangement = await pipe.generateOrThrow({
        schema: CardArrangementSchema,
        prompt: buildInterpretationPrompt(),
        systemPrompt: CARD_SYSTEM_PROMPT,
        images: [{ base64: imageBase64, mediaType }],
        retries: 2,
        temperature: 0.3, // Low temperature for structured extraction
        maxTokens: 8192,
    });

    // Step 2: Convert to VF instances
    const vfInstances = arrangementToVF(arrangement);

    // Step 3: Select components
    const componentTree = selectComponents(arrangement, vfInstances);

    // Step 4: Generate Svelte code
    const svelteCode = generateSvelteCode(componentTree, vfInstances);

    return { arrangement, vfInstances, componentTree, svelteCode };
}

/**
 * Interpret a card arrangement that was already detected (skip vision step).
 * Useful for testing or when the arrangement is composed manually.
 */
export function interpretArrangement(arrangement: CardArrangement): Omit<InterpretationResult, 'arrangement'> & { arrangement: CardArrangement } {
    const vfInstances = arrangementToVF(arrangement);
    const componentTree = selectComponents(arrangement, vfInstances);
    const svelteCode = generateSvelteCode(componentTree, vfInstances);
    return { arrangement, vfInstances, componentTree, svelteCode };
}

/**
 * Generate enhanced Svelte code using a second AI pass.
 * Takes the component spec + VF data and asks the LLM to produce
 * a more polished component with proper data wiring.
 *
 * Optional: use this for higher-quality output at the cost of an extra API call.
 */
export async function generateEnhancedSvelteCode(
    componentTree: ComponentSpec,
    vfInstances: VFInstances,
    pipe: AIPipe,
): Promise<string> {
    const result = await pipe.generate({
        schema: svelteCodeSchema(),
        prompt: buildCodegenPrompt(
            JSON.stringify(componentTree, null, 2),
            JSON.stringify(vfInstances, null, 2),
        ),
        systemPrompt: SVELTE_CODEGEN_SYSTEM_PROMPT,
        temperature: 0.5,
        maxTokens: 8192,
        retries: 1,
    });

    if (result.success) {
        return (result.data as { code: string }).code;
    }

    // Fallback to static generation
    return generateSvelteCode(componentTree, vfInstances);
}

// Helper schema for AI-generated Svelte code
function svelteCodeSchema() {
    return z.object({
        code: z.string().describe('Complete Svelte 5 component source code'),
    });
}

// =============================================================================
// EXPORTS
// =============================================================================

export { CardArrangementSchema } from './card-schemas';
export type { CardArrangement } from './card-schemas';
export type { VFInstances } from './card-to-vf';
export type { ComponentSpec } from './component-selector';
