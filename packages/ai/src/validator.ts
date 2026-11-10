import { analysisResultSchema, type AnalysisResult } from './schemas.js';

export interface ValidationReport {
  result: AnalysisResult;
  /** Human-readable notes about corrections applied to the model output. */
  corrections: string[];
}

const CLAIMS_OF_ACTION =
  /\b(I|we) (have )?(fixed|restarted|resolved|deployed|patched|rolled back|verified)\b/i;

/**
 * Second line of defence after schema-constrained decoding:
 *  1. Re-parse with zod (the provider may be swapped for one without constrained output).
 *  2. Drop evidence ids that do not exist in the context we sent.
 *  3. Downgrade "supported" hypotheses that cite no valid evidence to HYPOTHESIS.
 *  4. Flag (not silently rewrite) text in which the model claims to have acted.
 */
export function validateAnalysis(raw: unknown, evidenceIds: ReadonlySet<string>): ValidationReport {
  const result = analysisResultSchema.parse(raw);
  const corrections: string[] = [];

  result.hypotheses = result.hypotheses.map((h, index) => {
    const valid = h.evidence.filter((id) => evidenceIds.has(id));
    const dropped = h.evidence.length - valid.length;
    if (dropped > 0)
      corrections.push(
        `Hypothesis ${index + 1}: removed ${dropped} reference(s) to non-existent evidence.`,
      );
    if (h.status === 'SUPPORTED_BY_EVIDENCE' && valid.length === 0) {
      corrections.push(
        `Hypothesis ${index + 1}: downgraded to HYPOTHESIS (no valid evidence cited).`,
      );
      return {
        ...h,
        evidence: valid,
        status: 'HYPOTHESIS',
        confidence: h.confidence === 'high' ? 'medium' : h.confidence,
      };
    }
    return { ...h, evidence: valid };
  });

  const narrative = [
    result.summary,
    result.explanation,
    ...result.suggestedFixes.map((f) => f.title),
  ].join(' ');
  if (CLAIMS_OF_ACTION.test(narrative)) {
    corrections.push(
      'The model output claims an action was taken. DevPulse AI cannot act on your systems; treat this as a suggestion only.',
    );
  }

  return { result, corrections };
}
