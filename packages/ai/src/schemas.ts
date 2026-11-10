import { z } from 'zod';

/**
 * Structured output contract for every analysis. The provider is constrained to this
 * schema, then the result is re-validated locally (see validator.ts) before persisting.
 */
export const hypothesisSchema = z.object({
  cause: z
    .string()
    .describe('A possible root cause, stated as a hypothesis unless evidence confirms it.'),
  status: z
    .enum(['HYPOTHESIS', 'SUPPORTED_BY_EVIDENCE'])
    .describe('SUPPORTED_BY_EVIDENCE only when evidence ids below directly show this cause.'),
  confidence: z.enum(['low', 'medium', 'high']),
  evidence: z
    .array(z.string())
    .describe(
      'Ids of context items (e.g. "check:3", "log:7", "event:2") that support this hypothesis.',
    ),
});

export const analysisResultSchema = z.object({
  summary: z.string().describe('Two or three sentences a developer can read in ten seconds.'),
  explanation: z.string().describe('Plain-language explanation of what the evidence shows.'),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  severityRationale: z.string(),
  errorCategory: z
    .enum([
      'AVAILABILITY',
      'LATENCY',
      'NETWORK',
      'DNS',
      'TLS',
      'AUTHENTICATION',
      'CONFIGURATION',
      'DEPENDENCY',
      'APPLICATION_BUG',
      'RESOURCE_EXHAUSTION',
      'DATA',
      'UNKNOWN',
    ])
    .describe('Best-fitting category; UNKNOWN when the evidence is insufficient.'),
  hypotheses: z.array(hypothesisSchema),
  suggestedFixes: z.array(
    z.object({
      title: z.string(),
      steps: z.array(z.string()),
      risk: z.enum(['low', 'medium', 'high']),
    }),
  ),
  preventiveActions: z.array(z.string()),
  missingInformation: z
    .array(z.string())
    .describe('Data that would be needed to confirm or reject the hypotheses.'),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
