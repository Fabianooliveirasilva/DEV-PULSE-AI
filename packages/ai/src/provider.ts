import type { z } from 'zod';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CompletionRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

export interface CompletionResult<T> {
  output: T;
  /** Model that actually served the request (may differ from the requested one on fallback). */
  model: string;
  usage: TokenUsage;
}

export type AIProviderErrorKind =
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'REFUSED'
  | 'INVALID_RESPONSE'
  | 'BAD_REQUEST';

export class AIProviderError extends Error {
  constructor(
    readonly kind: AIProviderErrorKind,
    message: string,
    /** Whether the job may be retried later. */
    readonly retryable: boolean,
    /** Usage consumed before the failure (e.g. a refusal or truncated output is still billed). */
    readonly usage?: TokenUsage & { model: string },
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Provider abstraction: business logic never imports a vendor SDK directly. */
export interface AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  isConfigured(): boolean;
  complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>>;
}
