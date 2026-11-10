import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeLogMessage } from '../log-normalize.js';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function randomAlphanumeric(length: number) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHANUM[bytes[i]! % ALPHANUM.length];
  return out;
}

/**
 * Ingestion API key: `dp_<prefix>_<secret>`. Only sha256(key) is persisted;
 * the prefix is stored in clear to let users recognise their keys.
 */
export function generateApiKey() {
  const prefix = randomAlphanumeric(8);
  const key = `dp_${prefix}_${randomAlphanumeric(32)}`;
  return { key, prefix, hash: sha256Hex(key) };
}

export function parseApiKey(key: string): { prefix: string } | null {
  const match = /^dp_([A-Za-z0-9]{8})_[A-Za-z0-9]{32}$/.exec(key);
  return match?.[1] ? { prefix: match[1] } : null;
}

/** Fingerprint of a log message's normalised shape, scoped per application by the caller. */
export function logFingerprint(message: string): string {
  return sha256Hex(normalizeLogMessage(message));
}
