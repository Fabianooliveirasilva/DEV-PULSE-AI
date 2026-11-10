// Secret redaction for ingested logs and for anything sent to the AI provider.
// Two layers: key-based (field names that usually hold secrets) and value-based
// (patterns that look like credentials regardless of where they appear).

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY =
  /(pass(word|wd|phrase)?|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth|cookie|set-cookie|session|credential|signature|client[-_]?secret|card[-_]?number|cvv|ssn)/i;

const VALUE_PATTERNS: readonly [RegExp, string][] = [
  // Authorization header values
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/]+=*/g, `$1 ${REDACTED}`],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, REDACTED],
  // Provider keys (Anthropic, OpenAI-style, Stripe, GitHub, Slack, AWS access key ids)
  [/\bsk-(ant-)?[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // DevPulse ingestion keys
  [/\bdp_[A-Za-z0-9]{8}_[A-Za-z0-9]{24,}\b/g, REDACTED],
  // Credentials embedded in URLs: scheme://user:pass@host
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, `$1${REDACTED}@`],
  // key=value / key: value pairs inside free text
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
    `$1=${REDACTED}`,
  ],
];

// Payment card numbers: 13-19 digits (optionally grouped) that also pass the Luhn check,
// so epoch timestamps and numeric ids are left alone.
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactText(input: string): string {
  let out = input;
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out.replace(CARD_CANDIDATE, (match) =>
    luhnValid(match.replace(/[ -]/g, '')) ? REDACTED : match,
  );
}

export interface RedactOptions {
  maxDepth?: number;
  maxKeys?: number;
  maxStringLength?: number;
}

/** Deep-copies a JSON-like value, masking sensitive keys and secret-looking values. */
export function redactValue(value: unknown, options: RedactOptions = {}, depth = 0): unknown {
  const { maxDepth = 5, maxKeys = 50, maxStringLength = 2000 } = options;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return truncate(redactText(value), maxStringLength);
  if (depth >= maxDepth) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) {
    return value.slice(0, maxKeys).map((item) => redactValue(item, options, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, maxKeys)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(inner, options, depth + 1);
    }
    return out;
  }
  return undefined; // functions, symbols, bigint: dropped
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}
