import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  formatCurrency,
  formatCompactCurrency,
  formatBytes,
  formatDuration,
  formatTokens,
  formatNumber,
  formatPercent,
  formatRate,
  formatLatency,
  timeAgo,
  formatTime,
  formatDate,
  formatDateTime,
  maskKey,
  truncate,
} from './formatters';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatCurrency', () => {
  it('formats zero with two decimal places (small-number branch)', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats negative amounts >= 1 with the minus sign before the currency symbol', () => {
    expect(formatCurrency(-5.5)).toBe('-$5.5');
  });

  it('formats very large amounts with grouping and at most 2 decimals', () => {
    expect(formatCurrency(1234567.891)).toBe('$1,234,567.89');
  });

  it('shows up to 4 fractional digits for sub-dollar (fractional-cent) amounts', () => {
    expect(formatCurrency(0.0001)).toBe('$0.0001');
  });

  it('rounds a sub-dollar amount smaller than 4 decimals down to $0.00', () => {
    expect(formatCurrency(0.00001)).toBe('$0.00');
  });

  it('returns the em dash placeholder for non-finite input', () => {
    expect(formatCurrency(NaN)).toBe('—');
    expect(formatCurrency(Infinity)).toBe('—');
  });

  it('treats null/undefined as non-finite and returns the placeholder', () => {
    expect(formatCurrency(null as unknown as number)).toBe('—');
    expect(formatCurrency(undefined as unknown as number)).toBe('—');
  });

  it('honors a non-USD currency code, dropping the trailing .00 for a whole number >= 1', () => {
    expect(formatCurrency(10, 'EUR')).toBe('€10');
  });
});

describe('formatCompactCurrency', () => {
  it('is a pass-through alias for formatCurrency', () => {
    expect(formatCompactCurrency(1234.5)).toBe(formatCurrency(1234.5));
    expect(formatCompactCurrency(0)).toBe(formatCurrency(0));
  });
});

describe('formatBytes', () => {
  it('formats zero as "0 B" regardless of the decimals argument', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats sub-KB values in bytes', () => {
    expect(formatBytes(500)).toBe('500.0 B');
  });

  it('picks the KB unit past 1024', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('keeps the sign for negative byte counts', () => {
    expect(formatBytes(-2048)).toBe('-2.0 KB');
  });

  it('climbs all the way to PB for very large values', () => {
    expect(formatBytes(1024 ** 5 * 5)).toBe('5.0 PB');
  });

  it('respects a custom decimals count', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });

  it('returns "0 B" for non-finite input (same branch as zero, not the placeholder)', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(null as unknown as number)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('formats sub-millisecond durations in microseconds', () => {
    expect(formatDuration(0.5)).toBe('500µs');
  });

  it('formats durations under 10ms with one decimal', () => {
    expect(formatDuration(5)).toBe('5.0ms');
  });

  it('formats durations from 10ms up to 1s with no decimals', () => {
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds with two decimals', () => {
    expect(formatDuration(1500)).toBe('1.50s');
  });

  it('formats minutes with one decimal', () => {
    expect(formatDuration(90_000)).toBe('1.5m');
  });

  it('formats hours with one decimal', () => {
    expect(formatDuration(7_200_000)).toBe('2.0h');
  });

  it('formats days with one decimal', () => {
    expect(formatDuration(90_000_000)).toBe('1.0d');
  });

  it('returns the placeholder for negative durations', () => {
    expect(formatDuration(-5)).toBe('—');
  });

  it('returns the placeholder for non-finite durations', () => {
    expect(formatDuration(NaN)).toBe('—');
    expect(formatDuration(undefined as unknown as number)).toBe('—');
  });
});

describe('formatTokens', () => {
  it('formats a small count with grouping when not compact', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1234567)).toBe('1,234,567');
  });

  it('compacts millions and thousands with one decimal', () => {
    expect(formatTokens(1234567, true)).toBe('1.2M');
    expect(formatTokens(999, true)).toBe('999');
    expect(formatTokens(1500, true)).toBe('1.5K');
  });

  it('keeps the sign for negative compact values', () => {
    expect(formatTokens(-500, true)).toBe('-500');
  });

  it('returns the placeholder for non-finite input', () => {
    expect(formatTokens(NaN)).toBe('—');
    expect(formatTokens(Infinity)).toBe('—');
    expect(formatTokens(-Infinity)).toBe('—');
  });
});

describe('formatNumber', () => {
  it('formats zero and negative integers with grouping when not compact', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-1234)).toBe('-1,234');
  });

  it('compacts to K/M/B with the requested decimals', () => {
    expect(formatNumber(1234, true)).toBe('1.2K');
    expect(formatNumber(-1234567, true)).toBe('-1.2M');
    expect(formatNumber(1_000_000_000, true, 2)).toBe('1.00B');
  });

  it('leaves sub-1000 values unformatted in compact mode', () => {
    expect(formatNumber(999, true)).toBe('999');
  });

  it('does not cap compact formatting above B: a trillion renders as "1000.0B"', () => {
    expect(formatNumber(1e12, true)).toBe('1000.0B');
  });

  it('returns the placeholder for non-finite input, including null/undefined', () => {
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(null as unknown as number)).toBe('—');
    expect(formatNumber(undefined as unknown as number)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formats zero and negative percentages with one decimal by default', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(-12.345, 2)).toBe('-12.35%');
  });

  it('formats a whole-number percentage with a trailing .0', () => {
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('returns the placeholder for non-finite/null/undefined input', () => {
    expect(formatPercent(NaN)).toBe('—');
    expect(formatPercent(null as unknown as number)).toBe('—');
    expect(formatPercent(undefined as unknown as number)).toBe('—');
  });
});

describe('formatRate', () => {
  it('appends the unit and a /s suffix by default', () => {
    expect(formatRate(1500, 'req')).toBe('1.5K req/s');
  });

  it('omits the /s suffix when perSec is false', () => {
    expect(formatRate(42, 'tok', false)).toBe('42 tok');
  });
});

describe('formatLatency', () => {
  it('joins p50/p95/p99 durations with middle dots', () => {
    expect(formatLatency(5, 250, 1500)).toBe('p50 5.0ms · p95 250ms · p99 1.50s');
  });
});

describe('timeAgo', () => {
  it('renders "0s ago" for the current instant', () => {
    const now = new Date('2024-06-01T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(timeAgo(now)).toBe('0s ago');
  });

  it('renders seconds, minutes, hours and days for the right buckets', () => {
    const now = new Date('2024-06-01T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(timeAgo(new Date(now.getTime() - 5_000))).toBe('5s ago');
    expect(timeAgo(new Date(now.getTime() - 90_000))).toBe('1m ago');
    expect(timeAgo(new Date(now.getTime() - 7_200_000))).toBe('2h ago');
    expect(timeAgo(new Date(now.getTime() - 172_800_000))).toBe('2d ago');
  });

  it('accepts an ISO string identically to a Date', () => {
    const now = new Date('2024-06-01T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const past = new Date(now.getTime() - 90_000).toISOString();
    expect(timeAgo(past)).toBe('1m ago');
  });

  it('clamps a future timestamp to "0s ago" instead of a negative number', () => {
    const now = new Date('2024-06-01T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(timeAgo(new Date(now.getTime() + 10_000))).toBe('0s ago');
  });
});

describe('formatDate / formatTime / formatDateTime', () => {
  it('accept an ISO string and a Date for the same instant identically', () => {
    const iso = '2024-03-15T14:05:09.000Z';
    const date = new Date(iso);
    expect(formatDate(iso)).toBe(formatDate(date));
    expect(formatTime(iso)).toBe(formatTime(date));
    expect(formatDateTime(iso)).toBe(formatDateTime(date));
  });

  it('formatDate renders "Mon D, YYYY"', () => {
    expect(formatDate('2024-03-15T14:05:09.000Z')).toMatch(/^[A-Za-z]{3} \d{1,2}, \d{4}$/);
  });

  it('formatTime renders hour:minute:second with an AM/PM marker', () => {
    expect(formatTime('2024-03-15T14:05:09.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}\s?[AP]M$/);
  });

  it('formatTime honors custom Intl.DateTimeFormatOptions', () => {
    const out = formatTime('2024-03-15T14:05:09.000Z', { hour: '2-digit', minute: '2-digit' });
    expect(out).toMatch(/^\d{2}:\d{2}\s?[AP]M$/);
  });

  it('formatDateTime renders "Mon D, HH:MM AM/PM"', () => {
    expect(formatDateTime('2024-03-15T14:05:09.000Z')).toMatch(/^[A-Za-z]{3} \d{1,2}, \d{2}:\d{2}\s?[AP]M$/);
  });

  it('returns the placeholder for null, undefined, or an invalid date', () => {
    expect(formatDate(null as unknown as string)).toBe('—');
    expect(formatDate(undefined as unknown as string)).toBe('—');
    expect(formatDate(new Date('invalid'))).toBe('—');
    expect(formatTime(null as unknown as string)).toBe('—');
    expect(formatTime(undefined as unknown as string)).toBe('—');
    expect(formatTime(new Date('invalid'))).toBe('—');
    expect(formatDateTime(null as unknown as string)).toBe('—');
    expect(formatDateTime(undefined as unknown as string)).toBe('—');
    expect(formatDateTime(new Date('invalid'))).toBe('—');
  });
});

describe('maskKey', () => {
  it('returns an empty string for an empty/falsy key', () => {
    expect(maskKey('')).toBe('');
    expect(maskKey(null as unknown as string)).toBe('');
  });

  it('fully masks a key no longer than 2x the visible count', () => {
    expect(maskKey('abcd')).toBe('••••');
    expect(maskKey('abcdefgh')).toBe('••••••••');
  });

  it('shows a prefix/suffix with an ellipsis for longer keys', () => {
    expect(maskKey('abcdefghij')).toBe('abcd…ghij');
  });

  it('respects a custom visible count', () => {
    expect(maskKey('abcdefghijklmno', 2)).toBe('ab…no');
  });
});

describe('truncate', () => {
  it('returns the string unchanged when within the max length', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and appends an ellipsis when over the max length', () => {
    expect(truncate('hello world', 5)).toBe('hell…');
  });

  it('returns an empty string for an empty/falsy input', () => {
    expect(truncate('')).toBe('');
    expect(truncate(null as unknown as string)).toBe('');
  });

  it('uses the default max of 80 when not specified', () => {
    const long = 'x'.repeat(100);
    expect(truncate(long)).toBe('x'.repeat(79) + '…');
  });
});
