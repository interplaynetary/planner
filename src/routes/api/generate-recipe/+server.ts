import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { AIPipe, type LLMProvider } from '$lib/ai-pipe';
import OpenAI from 'openai';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// OpenRouter provider — OpenAI-compatible API, proxies many models
// ---------------------------------------------------------------------------

class OpenRouterProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'openai/gpt-4o-mini') {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    this.model = model;
  }

  async call(
    prompt: string,
    systemPrompt?: string,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<unknown> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      { role: 'user' as const, content: prompt },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.6,
      max_tokens: options?.maxTokens ?? 1200,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No content in OpenRouter response');
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```([\s\S]*?)```/);
    return JSON.parse(jsonMatch ? jsonMatch[1] : content);
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const AIRecipeSchema = z.object({
  recipe: z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    primaryOutput: z.string().optional(),
  }),
  processes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      note: z.string().optional(),
      hasDuration: z
        .object({ hasNumericalValue: z.number(), hasUnit: z.string() })
        .optional(),
      sequenceGroup: z.number().int().optional(),
    }),
  ),
  flows: z.array(
    z.object({
      id: z.string(),
      action: z.enum([
        'produce', 'consume', 'use', 'work', 'transfer', 'move',
        'pickup', 'dropoff', 'accept', 'modify', 'cite', 'deliverService',
        'raise', 'lower', 'transferAllRights', 'transferCustody', 'transferComplete',
      ]),
      resourceConformsTo: z.string().optional(),
      resourceQuantity: z
        .object({ hasNumericalValue: z.number(), hasUnit: z.string() })
        .optional(),
      effortQuantity: z
        .object({ hasNumericalValue: z.number(), hasUnit: z.string() })
        .optional(),
      recipeInputOf: z.string().optional(),
      recipeOutputOf: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
});

const SYSTEM_PROMPT = `You generate ValueFlows production recipes as structured JSON.

Rules:
- Each process has a unique id (e.g. "proc-1"), a name, and an optional sequenceGroup integer (1 = first step).
- Each flow has a unique id (e.g. "flow-1") and must reference either recipeInputOf OR recipeOutputOf with a process id.
- Use action "consume" for material inputs, "produce" for outputs, "work" for labour, "transfer" for supply/delivery flows.
- resourceConformsTo is a short kebab-case slug (e.g. "wheat", "flour", "labour-baking", "iron-ore").
- resourceQuantity.hasUnit is a short informal unit: "kg", "loaf", "hr", "unit", "liter", "tonne", "m2", etc.
- primaryOutput in the recipe object must exactly match the resourceConformsTo of the main produce flow.
- Keep it concise: 1–3 processes, 3–8 flows total.
- Respond with valid JSON only — no markdown, no commentary.`;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const POST = async ({ request }) => {
  const { prompt } = await request.json();

  const pipe = new AIPipe(new OpenRouterProvider(env.OPENROUTER_API_KEY ?? ''));
  const result = await pipe.generate({
    schema: AIRecipeSchema,
    prompt,
    systemPrompt: SYSTEM_PROMPT,
    retries: 2,
    temperature: 0.6,
    maxTokens: 1200,
  });

  return json(result);
};
