// Turns a concrete log message into a stable "shape" so that occurrences of the same
// error with different ids/numbers/timestamps are grouped together.

const RULES: readonly [RegExp, string][] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\b/g, '<timestamp>'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<email>'],
  [/\bhttps?:\/\/[^\s"')]+/gi, '<url>'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(:\d+)?\b/g, '<ip>'],
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/\b[0-9a-f]{16,}\b/gi, '<hex>'],
  [/"[^"]{0,200}"/g, '"<str>"'],
  [/'[^']{0,200}'/g, "'<str>'"],
  // Digits anywhere (also glued to units such as "3000ms" or ids such as "worker7").
  [/\d+(\.\d+)?/g, '<n>'],
];

export function normalizeLogMessage(message: string): string {
  // Group on the first line only: stack frames vary with deploys and line numbers.
  let out = (message.split('\n', 1)[0] ?? '').trim();
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.replace(/\s+/g, ' ').slice(0, 500);
}

/** Extracts a leading error class such as `TypeError` or `ECONNREFUSED` when present. */
export function extractErrorType(message: string): string | null {
  const firstLine = message.split('\n', 1)[0] ?? '';
  const named = /^\s*(?:Uncaught\s+)?([A-Z][A-Za-z0-9]*(?:Error|Exception|Fault))\b/.exec(
    firstLine,
  );
  if (named?.[1]) return named[1];
  const code = /\b(E[A-Z]{3,}[A-Z_]*)\b/.exec(firstLine);
  if (code?.[1]) return code[1];
  const http = /\b(?:HTTP|status)\s*(5\d\d|4\d\d)\b/i.exec(firstLine);
  if (http?.[1]) return `HTTP ${http[1]}`;
  return null;
}
