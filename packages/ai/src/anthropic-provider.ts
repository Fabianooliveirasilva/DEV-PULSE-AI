import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  AIProviderError,
  type AIProvider,
  type CompletionRequest,
  type CompletionResult,
} from './provider.js';

export interface AnthropicProviderOptions {
  apiKey: string | undefined;
  model?: string;
  /** Per-attempt timeout in ms. */
  timeoutMs?: number;
  /** SDK-level retries for 408/409/429/5xx and connection errors. */
  maxRetries?: number;
  effort?: 'low' | 'medium' | 'high';
  /** Injected for tests. */
  client?: Anthropic;
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly defaultModel: string;
  private readonly client: Anthropic | null;
  private readonly effort: 'low' | 'medium' | 'high';

  constructor(options: AnthropicProviderOptions) {
    this.defaultModel = options.model ?? 'claude-opus-5-5';
    this.effort = options.effort ?? 'medium';
    this.client =
      options.client ??
      (options.apiKey
        ? new Anthropic({
            apiKey: options.apiKey,
            timeout: options.timeoutMs ?? 60_000,
            maxRetries: options.maxRetries ?? 2,
          })
        : null);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
    if (!this.client) {
      throw new AIProviderError('NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not configured', false);
    }
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.defaultModel,
        max_tokens: request.maxTokens,
        // Server-side fallback: if the primary model declines, the API retries on a
        // fallback model inside the same call (the served model is reported in `model`).
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: this.effort, format: betaZodOutputFormat(request.schema) },
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      });
    } catch (error) {
      throw mapError(error);
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    if (response.stop_reason === 'refusal') {
      throw new AIProviderError('REFUSED', 'The model declined to analyse this content', false, {
        ...usage,
        model: response.model,
      });
    }
    // Parse only after inspecting stop_reason: a refusal or truncated output is not JSON,
    // but its tokens are still billed and must be recorded.
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const parsed = response.stop_reason === 'end_turn' ? safeJson(text) : undefined;
    const validated = parsed === undefined ? null : request.schema.safeParse(parsed);
    if (!validated?.success) {
      throw new AIProviderError(
        'INVALID_RESPONSE',
        `Structured output missing or invalid (stop_reason=${response.stop_reason})`,
        true,
        {
          ...usage,
          model: response.model,
        },
      );
    }
    return { output: validated.data, model: response.model, usage };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function mapError(error: unknown): AIProviderError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AIProviderError('AUTH', 'Anthropic rejected the API key', false);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AIProviderError('RATE_LIMITED', 'Anthropic rate limit reached', true);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIProviderError('TIMEOUT', 'Anthropic request timed out', true);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AIProviderError(
      'BAD_REQUEST',
      `Anthropic rejected the request: ${error.message}`.slice(0, 500),
      false,
    );
  }
  if (
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return new AIProviderError('UNAVAILABLE', 'Anthropic API is unavailable', true);
  }
  if (error instanceof Anthropic.APIError) {
    return new AIProviderError(
      'UNAVAILABLE',
      `Anthropic API error ${error.status ?? ''}`.trim(),
      true,
    );
  }
  return new AIProviderError(
    'INVALID_RESPONSE',
    (error as Error)?.message?.slice(0, 500) ?? 'Unknown error',
    false,
  );
}
