import { z } from 'zod'
import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'

/**
 * Generic AI pipe for structured output generation
 * Works with any LLM API - just provide a schema and get validated data back
 */

// =============================================================================
// CORE TYPES
// =============================================================================

export interface GenerateOptions<T extends z.ZodType> {
  schema: T
  prompt: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  /** Number of retry attempts if validation fails (default: 0) */
  retries?: number
  /** Custom healing prompt template. Use {error} for validation errors, {raw} for the failed output */
  healingPrompt?: string
  /** Base64-encoded images to include in the message (vision support) */
  images?: { base64: string; mediaType: string }[]
}

export type AIResult<T> =
  | {
      success: true
      data: T
      raw?: unknown
    }
  | {
      success: false
      error: string
      raw?: unknown
      validationErrors?: z.ZodError
    }

/**
 * Generic LLM provider interface
 * Implement this for any API (OpenAI, Anthropic, local models, etc.)
 */
export interface LLMProvider {
  /**
   * Call the LLM and return parsed JSON
   * The provider should handle API calls and return the raw parsed response
   */
  call(
    prompt: string,
    systemPrompt?: string,
    options?: {
      temperature?: number
      maxTokens?: number
      schema?: z.ZodType
      /** Base64-encoded images to include in the message (vision support) */
      images?: { base64: string; mediaType: string }[]
    }
  ): Promise<unknown>
}

// =============================================================================
// CORE PIPE
// =============================================================================

/**
 * Generic AI pipe that validates LLM output against Zod schemas
 */
export class AIPipe {
  constructor(private provider: LLMProvider) {}

  /**
   * Generate structured output matching a Zod schema
   *
   * @example
   * const CategoryResult = z.object({
   *   text: z.string(),
   *   categoryChain: z.array(z.string()),
   *   disjointWith: z.array(z.string()),
   * })
   *
   * const result = await pipe.generate({
   *   schema: z.array(CategoryResult),
   *   prompt: 'Generate categories for: piano, guitar, drums',
   *   retries: 2, // Will auto-heal validation failures
   * })
   *
   * if (result.success) {
   *   console.log(result.data) // Fully typed as CategoryResult[]
   * }
   */
  async generate<T extends z.ZodType>(
    options: GenerateOptions<T>
  ): Promise<AIResult<z.infer<T>>> {
    const maxAttempts = (options.retries ?? 0) + 1
    let currentPrompt = options.prompt
    let lastError: string | undefined
    let lastRaw: unknown | undefined
    let lastValidationErrors: z.ZodError | undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const raw = await this.provider.call(
          currentPrompt,
          options.systemPrompt,
          {
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            schema: options.schema,
            images: options.images,
          }
        )

        const validated = options.schema.safeParse(raw)

        if (!validated.success) {
          lastError = 'Schema validation failed'
          lastRaw = raw
          lastValidationErrors = validated.error

          // If we have retries left, create a healing prompt
          if (attempt < maxAttempts - 1) {
            currentPrompt = this.createHealingPrompt(
              options,
              raw,
              validated.error
            )
            continue
          }

          return {
            success: false,
            error: lastError,
            raw: lastRaw,
            validationErrors: lastValidationErrors,
          }
        }

        return {
          success: true,
          data: validated.data,
          raw,
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)

        // Don't retry on API errors
        return {
          success: false,
          error: lastError,
        }
      }
    }

    // Shouldn't reach here, but for type safety
    return {
      success: false,
      error: lastError ?? 'Unknown error',
      raw: lastRaw,
      validationErrors: lastValidationErrors,
    }
  }

  /**
   * Create a healing prompt that explains validation errors to the LLM
   */
  private createHealingPrompt<T extends z.ZodType>(
    options: GenerateOptions<T>,
    failedOutput: unknown,
    validationError: z.ZodError
  ): string {
    if (options.healingPrompt) {
      return options.healingPrompt
        .replace('{error}', this.formatValidationError(validationError))
        .replace('{raw}', JSON.stringify(failedOutput, null, 2))
    }

    // Default healing prompt
    return `Your previous response failed validation. Here's what went wrong:

Previous output:
${JSON.stringify(failedOutput, null, 2)}

Validation errors:
${this.formatValidationError(validationError)}

Please fix these issues and provide a corrected response that matches the required schema.

Original request: ${options.prompt}`
  }

  /**
   * Format validation errors in a human-readable way for the LLM
   */
  private formatValidationError(error: z.ZodError): string {
    return error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
        return `- At "${path}": ${issue.message} (expected: ${issue.code})`
      })
      .join('\n')
  }

  /**
   * Generate and unwrap, throwing on error (for simpler error handling)
   */
  async generateOrThrow<T extends z.ZodType>(
    options: GenerateOptions<T>
  ): Promise<z.infer<T>> {
    const result = await this.generate(options)
    if (!result.success) {
      const errorDetails = result.validationErrors
        ? `\nValidation errors: ${JSON.stringify(result.validationErrors.issues, null, 2)}`
        : ''
      throw new Error(`${result.error}${errorDetails}`)
    }
    return result.data
  }

  /**
   * Generate with automatic retry/healing (convenience method)
   * Defaults to 2 retries with smart healing prompts
   */
  async generateWithHealing<T extends z.ZodType>(
    schema: T,
    prompt: string,
    options?: {
      systemPrompt?: string
      retries?: number
      temperature?: number
      maxTokens?: number
    }
  ): Promise<AIResult<z.infer<T>>> {
    return this.generate({
      schema,
      prompt,
      systemPrompt: options?.systemPrompt,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      retries: options?.retries ?? 2,
    })
  }
}

// =============================================================================
// BUILT-IN PROVIDERS
// =============================================================================

/**
 * OpenAI provider with native structured output support
 * Uses OpenAI SDK's zodResponseFormat for Zod 4 compatibility
 */
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  private model: string

  constructor(config?: { apiKey?: string; model?: string }) {
    const apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required')
    }
    this.client = new OpenAI({ apiKey })
    this.model = config?.model ?? 'gpt-4o-2024-08-06'
  }

  async call(
    prompt: string,
    systemPrompt?: string,
    options?: {
      temperature?: number
      maxTokens?: number
      schema?: z.ZodType
    }
  ): Promise<unknown> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      { role: 'user' as const, content: prompt },
    ]

    // GPT-5 detection heuristic (as of 2026-01):
    // - GPT-5 models use max_completion_tokens instead of max_tokens
    // - GPT-5 models only support temperature=1 (default), other values cause errors
    // - This heuristic may need updating for future model naming conventions
    const isGpt5 = this.model.startsWith('gpt-5')
    const modelParams = isGpt5
      ? { max_completion_tokens: options?.maxTokens ?? 4096 }
      : { max_tokens: options?.maxTokens ?? 4096, temperature: options?.temperature ?? 0.7 }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      ...modelParams,
      // Use zodResponseFormat for structured output when schema provided
      ...(options?.schema
        ? { response_format: zodResponseFormat(options.schema as z.ZodObject<z.ZodRawShape>, 'response') }
        : { response_format: { type: 'json_object' as const } }),
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('No content in response')
    }

    return JSON.parse(content)
  }
}

/**
 * Anthropic provider using tool calling for structured output
 */
export class AnthropicProvider implements LLMProvider {
  private apiKey: string
  private model: string

  constructor(config?: { apiKey?: string; model?: string }) {
    this.apiKey = config?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
    this.model = config?.model ?? 'claude-sonnet-4-20250514'
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required')
    }
  }

  async call(
    prompt: string,
    systemPrompt?: string,
    options?: {
      temperature?: number
      maxTokens?: number
      schema?: z.ZodType
      images?: { base64: string; mediaType: string }[]
    }
  ): Promise<unknown> {
    // Build message content: text-only or multi-part with images
    const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> =
      options?.images?.length
        ? [
            // Images first, then prompt text
            ...options.images.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.mediaType,
                data: img.base64,
              },
            })),
            { type: 'text' as const, text: prompt },
          ]
        : [{ type: 'text' as const, text: prompt }]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt
          ? `${systemPrompt}\n\nRespond with valid JSON only.`
          : 'Respond with valid JSON only.',
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${error}`)
    }

    const data = (await response.json()) as {
      content: Array<{
        type: string
        text?: string
      }>
    }

    const textBlock = data.content.find((block) => block.type === 'text')
    if (!textBlock?.text) {
      throw new Error('No text content in response')
    }

    // Extract JSON from response (handles markdown code blocks)
    const jsonMatch = textBlock.text.match(/```json\n([\s\S]*?)\n```/)
      || textBlock.text.match(/\[[\s\S]*\]/)
      || textBlock.text.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      // Try parsing the whole response
      return JSON.parse(textBlock.text)
    }

    return JSON.parse(jsonMatch[1] || jsonMatch[0])
  }
}

/**
 * OpenRouter provider — routes to any model via openrouter.ai.
 * Uses the OpenAI-compatible chat completions API with vision support.
 */
export class OpenRouterProvider implements LLMProvider {
  private apiKey: string
  private model: string

  constructor(config?: { apiKey?: string; model?: string }) {
    this.apiKey = config?.apiKey ?? process.env.OPENROUTER_API_KEY ?? ''
    this.model = config?.model ?? 'anthropic/claude-sonnet-4'
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is required')
    }
  }

  async call(
    prompt: string,
    systemPrompt?: string,
    options?: {
      temperature?: number
      maxTokens?: number
      schema?: z.ZodType
      images?: { base64: string; mediaType: string }[]
    }
  ): Promise<unknown> {
    // Build message content: text-only or multi-part with images
    type ContentPart =
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }

    const content: ContentPart[] = options?.images?.length
      ? [
          ...options.images.map((img): ContentPart => ({
            type: 'image_url',
            image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
          })),
          { type: 'text', text: prompt },
        ]
      : [{ type: 'text', text: prompt }]

    const messages = [
      ...(systemPrompt
        ? [{ role: 'system' as const, content: `${systemPrompt}\n\nRespond with valid JSON only.` }]
        : [{ role: 'system' as const, content: 'Respond with valid JSON only.' }]),
      { role: 'user' as const, content },
    ]

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://planner.local',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenRouter API error: ${response.status} ${error}`)
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: { content: string }
      }>
    }

    const text = data.choices[0]?.message?.content
    if (!text) {
      throw new Error('No content in OpenRouter response')
    }

    // Extract JSON (handles markdown code blocks)
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/)
      || text.match(/\[[\s\S]*\]/)
      || text.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      return JSON.parse(text)
    }

    return JSON.parse(jsonMatch[1] || jsonMatch[0])
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a pipe with OpenAI
 */
export function createOpenAIPipe(config?: {
  apiKey?: string
  model?: string
}): AIPipe {
  return new AIPipe(new OpenAIProvider(config))
}

/**
 * Create a pipe with Anthropic
 */
export function createAnthropicPipe(config?: {
  apiKey?: string
  model?: string
}): AIPipe {
  return new AIPipe(new AnthropicProvider(config))
}

/**
 * Create a pipe with OpenRouter
 */
export function createOpenRouterPipe(config?: {
  apiKey?: string
  model?: string
}): AIPipe {
  return new AIPipe(new OpenRouterProvider(config))
}

/**
 * One-shot generation with OpenAI
 */
export async function generateWithOpenAI<T extends z.ZodType>(
  schema: T,
  prompt: string,
  systemPrompt?: string
): Promise<AIResult<z.infer<T>>> {
  const pipe = createOpenAIPipe()
  return pipe.generate({ schema, prompt, systemPrompt })
}

/**
 * One-shot generation with Anthropic
 */
export async function generateWithAnthropic<T extends z.ZodType>(
  schema: T,
  prompt: string,
  systemPrompt?: string
): Promise<AIResult<z.infer<T>>> {
  const pipe = createAnthropicPipe()
  return pipe.generate({ schema, prompt, systemPrompt })
}

/**
 * One-shot generation with OpenRouter
 */
export async function generateWithOpenRouter<T extends z.ZodType>(
  schema: T,
  prompt: string,
  systemPrompt?: string
): Promise<AIResult<z.infer<T>>> {
  const pipe = createOpenRouterPipe()
  return pipe.generate({ schema, prompt, systemPrompt })
}
