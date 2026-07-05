/**
 * Parse a human-readable body limit string into a byte count.
 *
 * Accepts plain integers or suffixed values like `"10mb"`, `"1024kb"`, `"1gb"`.
 * Returns `fallback` when `raw` is empty or unparseable.
 */
export function parseBodyLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  // Accept "10mb", "1024kb", "1gb" — case-insensitive
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(trimmed);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 'gb' ? 1024 ** 3
             : unit === 'mb' ? 1024 ** 2
             : unit === 'kb' ? 1024
             : 1;
  return Math.floor(n * mult);
}

/**
 * Parse a trust-proxy env-var value into a boolean or Fastify-compatible preset.
 *
 * Accepts `"true"` / `"1"` / `"yes"` → `true`,
 * `"false"` / `"0"` / `"no"` → `false`,
 * `"loopback"`, `"linklocal"`, `"uniquelocal"` → returned as-is (Fastify presets),
 * anything else → treated as a raw CIDR / IP / comma-separated string.
 * Returns `"loopback"` when `raw` is `undefined`.
 */
export function parseTrustProxy(raw: string | undefined): boolean | string {
  if (raw === undefined) return 'loopback';
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  // Allow Fastify-prescribed preset strings
  if (['loopback', 'linklocal', 'uniquelocal'].includes(v)) return v;
  // Treat anything else as a CIDR / IP / comma-separated list
  return raw.trim();
}
