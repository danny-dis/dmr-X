/**
 * Parse the X-Quality-Target header value into a valid QualityTarget.
 * Invalid or missing values fall back to 'balanced'.
 *
 * Usage:
 *   const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);
 */
export type QualityTarget = 'frontier' | 'balanced' | 'economy';

const VALID_TARGETS: ReadonlySet<string> = new Set(['frontier', 'balanced', 'economy']);

export function parseQualityTarget(header: string | undefined): QualityTarget {
  const value = header?.toLowerCase()?.trim();
  if (value && VALID_TARGETS.has(value)) {
    return value as QualityTarget;
  }
  return 'balanced';
}
