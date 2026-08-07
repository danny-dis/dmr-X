/**
 * Parses the `X-Provider-Preferences` header — a JSON-encoded
 * `ProviderPreferences` object — into a validated value that gets attached
 * to `UnifiedRequest.metadata.providerPreferences`, where the router
 * pipeline's `applyProviderPreferences()` (services/router/src/pipeline/
 * pipeline.ts) enforces it (order, only, ignore, zdr, price/latency caps).
 *
 * Follows the `X-Quality-Target` precedent (see ./quality-target.ts): a
 * DMR-X-specific routing header read uniformly by every wire-format route
 * (OpenAI/Anthropic/Gemini-shaped and DMR-X-native), instead of a body field
 * that would need to be declared on every per-format Zod request schema and
 * would look out of place on a foreign wire format (e.g. Anthropic's Messages
 * body). A JSON-encoded header carries the full ProviderPreferences shape
 * (arrays, numbers, booleans) in one place regardless of which route reads it.
 *
 * Unlike `parseQualityTarget`, malformed input here is NOT silently coerced
 * to a default: a caller sending this header is stating a routing
 * constraint (e.g. "exclude this provider", "privacy-preserving providers
 * only"), and silently dropping an unparsable constraint is the exact bug
 * this header exists to prevent from recurring. Invalid JSON or an unknown
 * shape throws `ValidationError` (HTTP 400) instead of routing anyway.
 */
import { ValidationError, type ProviderPreferences } from '@dmr-x/core';
import { z } from 'zod';

const ProviderPreferencesSchema = z
  .object({
    strategy: z.enum(['auto', 'direct', 'free', 'fallback', 'pareto']).optional(),
    sort: z.enum(['price', 'throughput', 'latency']).optional(),
    order: z.array(z.string()).optional(),
    only: z.array(z.string()).optional(),
    ignore: z.array(z.string()).optional(),
    allowFallbacks: z.boolean().optional(),
    maxPricePerMillionTokens: z.number().nonnegative().optional(),
    quantizations: z.array(z.string()).optional(),
    requireParameters: z.boolean().optional(),
    zdr: z.boolean().optional(),
    preferredMaxLatencyMs: z.number().positive().optional(),
    preferredMinThroughputTps: z.number().positive().optional(),
  })
  .strict();

/**
 * @param header Raw `request.headers['x-provider-preferences']` value.
 * @returns The validated preferences, or `undefined` if the header was absent/empty.
 * @throws {ValidationError} if the header is present but not valid JSON matching the schema.
 */
export function parseProviderPreferencesHeader(
  header: string | string[] | undefined,
): ProviderPreferences | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError('Invalid X-Provider-Preferences header: not valid JSON', { header: raw });
  }

  const result = ProviderPreferencesSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError('Invalid X-Provider-Preferences header', { errors: result.error.errors });
  }
  return result.data;
}
