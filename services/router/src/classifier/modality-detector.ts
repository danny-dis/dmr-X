import type { Modality } from '@dmr-x/core';
import { MODALITY_ENDPOINTS } from '@dmr-x/core';

/**
 * Paths whose model id is embedded in the URL, so they cannot be enumerated
 * in the exact-match table. Currently just the Google-native Gemini surface
 * (`/v1beta/models/<model>:generateContent`), where `<model>` is arbitrary.
 *
 * Checked only AFTER the exact-match lookup misses, so every existing path
 * resolves exactly as before. Anything matching none of these still throws —
 * a genuinely unregistered path is a bug worth surfacing loudly, and
 * defaulting it to 'llm' would route image and audio traffic to chat models.
 */
const MODALITY_PATTERNS: ReadonlyArray<readonly [RegExp, Modality]> = [
  [/^\/v1(beta)?\/models\/.+:(stream)?generateContent$/, 'llm'],
];

export function detectModality(path: string): Modality {
  const modality = MODALITY_ENDPOINTS[path];
  if (modality) return modality;

  for (const [pattern, patternModality] of MODALITY_PATTERNS) {
    if (pattern.test(path)) return patternModality;
  }

  throw new Error(`Unknown API path: ${path}`);
}
