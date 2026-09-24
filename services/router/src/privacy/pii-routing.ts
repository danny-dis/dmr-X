/**
 * Privacy/PII-aware routing — Issue #15 P0 Routing.
 *
 * Fail-closed: if PII is detected in a request and failClosedPii is true,
 * the router returns NO candidate rather than risk exposing data to an
 * unvetted provider.
 */

export interface PiiDetectionResult {
  hasPii: boolean;
  categories: Array<'email' | 'phone' | 'name' | 'address' | 'ip' | 'ssn' | 'credit_card' | 'date_of_birth'>;
  severity: 'none' | 'low' | 'medium' | 'high';
}

export interface PrivacyRule {
  /** PII categories this rule applies to. */
  categories: PiiDetectionResult['categories'];
  /** Severity threshold — rule fires at this level and above. */
  threshold: PiiDetectionResult['severity'];
  /** Allowed providers (empty = block all). */
  allowedProviders: string[];
  /** Action: 'block' or 'restrict_to_allowlist'. */
  action: 'block' | 'restrict_to_allowlist';
}

export function detectPii(text: string): PiiDetectionResult {
  const categories: PiiDetectionResult['categories'] = [];
  let score = 0;

  // Email
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text)) {
    categories.push('email');
    score += 2;
  }
  // Phone (rough)
  if (/\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text)) {
    categories.push('phone');
    score += 2;
  }
  // IP address
  if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text)) {
    categories.push('ip');
    score += 1;
  }
  // Credit card (Luhn-like)
  if (/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/.test(text)) {
    categories.push('credit_card');
    score += 3;
  }
  // SSN pattern
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
    categories.push('ssn');
    score += 3;
  }

  let severity: PiiDetectionResult['severity'] = 'none';
  if (score >= 6) severity = 'high';
  else if (score >= 4) severity = 'medium';
  else if (score >= 1) severity = 'low';

  return {
    hasPii: categories.length > 0,
    categories,
    severity,
  };
}

export function applyPrivacyRules(
  candidates: Array<{ providerId: string; modelId: string }>,
  pii: PiiDetectionResult,
  rules: PrivacyRule[],
  failClosed: boolean,
): Array<{ providerId: string; modelId: string }> {
  if (!pii.hasPii) return candidates;

  let allowed = candidates;

  for (const rule of rules) {
    const categoriesOverlap = rule.categories.some((c) => pii.categories.includes(c));
    if (!categoriesOverlap) continue;

    const severityLevels: Array<PiiDetectionResult['severity']> = ['low', 'medium', 'high'];
    const severityIdx = severityLevels.indexOf(pii.severity);
    const thresholdIdx = severityLevels.indexOf(rule.threshold);
    if (severityIdx < thresholdIdx) continue;

    if (rule.action === 'block') {
      if (failClosed) return []; // fail-closed: no candidates
      continue;
    }

    if (rule.action === 'restrict_to_allowlist') {
      allowed = allowed.filter((c) => rule.allowedProviders.includes(c.providerId));
    }
  }

  if (failClosed && allowed.length === 0) return [];

  return allowed;
}
