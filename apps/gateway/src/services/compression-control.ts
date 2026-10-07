import { ValidationError } from '@dmr-x/core';
import type { CompressionConfig, CompressionEngine } from './compression.js';

const engines: readonly CompressionEngine[] = ['headroom', 'rtk', 'caveman', 'comment-strip', 'auto'];

/** Request overrides are explicit, bounded controls, never arbitrary engine names. */
export function parseCompressionHeader(value: unknown): Partial<CompressionConfig> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError('Invalid x-compression header');
  if (value === 'off' || value === 'false') return { enabled: false };
  if (value === 'on' || value === 'true') return { enabled: true };
  if (engines.includes(value as CompressionEngine)) return { enabled: true, engine: value as CompressionEngine };
  throw new ValidationError('Invalid x-compression header');
}

/** Global < tenant < API key < explicit request override; false is meaningful. */
export function compressionControlEnabled(
  global: CompressionConfig,
  tenant?: Partial<CompressionConfig> | null,
  key?: Partial<CompressionConfig> | null,
  header?: Partial<CompressionConfig>,
): boolean {
  let enabled = global.enabled;
  for (const config of [tenant, key, header]) {
    if (config?.enabled !== undefined) enabled = config.enabled;
  }
  return enabled;
}
