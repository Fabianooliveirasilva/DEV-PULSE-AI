import {
  buildErrorGroupContext,
  buildIncidentContext,
  type ErrorGroupContextInput,
  type IncidentContextInput,
} from './context-builder.js';
import { costUsd } from './pricing.js';
import { PROMPTS, renderUserMessage, type PromptTemplate } from './prompts.js';
import type { AIProvider, TokenUsage } from './provider.js';
import { analysisResultSchema, type AnalysisResult } from './schemas.js';
import { validateAnalysis } from './validator.js';

export interface AnalysisOutcome {
  result: AnalysisResult;
  corrections: string[];
  promptVersion: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
}

export type AnalysisTarget =
  | { kind: 'incident'; input: IncidentContextInput }
  | { kind: 'errorGroup'; input: ErrorGroupContextInput };

export function promptFor(target: AnalysisTarget): PromptTemplate {
  return target.kind === 'incident' ? PROMPTS.incidentAnalysis : PROMPTS.errorGroupAnalysis;
}

/**
 * Orchestrates one analysis: context → prompt → provider → validation → cost.
 * Persistence, budgets and retries are the caller's job (see apps/worker).
 */
export async function runAnalysis(
  provider: AIProvider,
  target: AnalysisTarget,
  maxTokens = 16_000,
): Promise<AnalysisOutcome> {
  const prompt = promptFor(target);
  const context =
    target.kind === 'incident'
      ? buildIncidentContext(target.input)
      : buildErrorGroupContext(target.input);
  const completion = await provider.complete({
    system: prompt.system,
    user: renderUserMessage(prompt, context.text, context.truncated),
    schema: analysisResultSchema,
    maxTokens,
  });
  const { result, corrections } = validateAnalysis(completion.output, context.evidenceIds);
  return {
    result,
    corrections,
    promptVersion: prompt.version,
    provider: provider.name,
    model: completion.model,
    usage: completion.usage,
    costUsd: costUsd(completion.model, completion.usage),
  };
}

/** Rough upper-bound estimate (4 chars ≈ 1 token) used for pre-flight budget checks. */
export function estimateMaxCostUsd(model: string, contextChars: number, maxOutputTokens: number) {
  return costUsd(model, {
    inputTokens: Math.ceil(contextChars / 3) + 1500,
    outputTokens: maxOutputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}
