import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage } from './api';
import { safeNext } from './navigation';
import { formatDuration, formatMs, formatPercent } from './utils';

describe('safeNext (open-redirect protection)', () => {
  it.each([
    ['/incidents?active=true', '/incidents?active=true'],
    ['https://evil.example/phish', '/dashboard'],
    ['//evil.example', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
    [null, '/dashboard'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('formatters', () => {
  it('formats durations, latency and percentages', () => {
    expect(formatDuration(15_000)).toBe('15s');
    expect(formatDuration(5 * 60_000)).toBe('5m');
    expect(formatDuration(3 * 3600_000 + 120_000)).toBe('3h 2m');
    expect(formatDuration(50 * 3600_000)).toBe('2d 2h');
    expect(formatMs(182.4)).toBe('182 ms');
    expect(formatMs(1530)).toBe('1.53 s');
    expect(formatMs(null)).toBe('—');
    expect(formatPercent(99.876)).toBe('99.88%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('errorMessage', () => {
  it('prefers field details, then the API message, and never leaks unknown errors', () => {
    expect(
      errorMessage(
        new ApiError(400, 'Validation failed', [{ path: 'email', message: 'Invalid email' }]),
      ),
    ).toBe('email: Invalid email');
    expect(errorMessage(new ApiError(409, 'Already exists'))).toBe('Already exists');
    expect(errorMessage(new TypeError('x is undefined'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
