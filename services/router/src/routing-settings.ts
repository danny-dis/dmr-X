import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * User-tunable routing weights for convex combination scoring.
 * Modeled after freellmapi's routing strategy system.
 */

export type RoutingStrategy = 'priority' | 'balanced' | 'smartest' | 'fastest' | 'reliable' | 'custom';

export interface RoutingWeights {
  reliability: number;
  speed: number;
  intelligence: number;
  cost: number;
}

// Preset weight vectors (must sum to 1)
export const ROUTING_PRESETS: Record<Exclude<RoutingStrategy, 'priority' | 'custom'>, RoutingWeights> = {
  balanced: { reliability: 0.35, speed: 0.20, intelligence: 0.25, cost: 0.20 },
  smartest: { reliability: 0.25, speed: 0.10, intelligence: 0.50, cost: 0.15 },
  fastest: { reliability: 0.25, speed: 0.50, intelligence: 0.10, cost: 0.15 },
  reliable: { reliability: 0.50, speed: 0.15, intelligence: 0.15, cost: 0.20 },
};

const SETTINGS_KEY = 'routing_strategy';
const CUSTOM_WEIGHTS_KEY = 'routing_custom_weights';

/**
 * Get the current routing strategy.
 */
export function getRoutingStrategy(): RoutingStrategy {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value?: string } | undefined;
    if (row?.value && isValidStrategy(row.value)) {
      return row.value as RoutingStrategy;
    }
  } catch {
    // DB not available
  }
  return 'balanced';
}

/**
 * Set the routing strategy.
 */
export function setRoutingStrategy(strategy: RoutingStrategy): void {
  if (!isValidStrategy(strategy)) {
    throw new Error(`Invalid routing strategy: ${strategy}`);
  }
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(SETTINGS_KEY, strategy);
    logger.info({ strategy }, 'Routing strategy updated');
  } catch (error) {
    logger.error({ err: error, strategy }, 'Failed to set routing strategy');
  }
}

/**
 * Get custom weights (for 'custom' strategy).
 */
export function getCustomWeights(): RoutingWeights {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(CUSTOM_WEIGHTS_KEY) as { value?: string } | undefined;
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<RoutingWeights>;
      if (isValidWeights(parsed)) {
        return normalizeWeights(parsed);
      }
    }
  } catch {
    // DB not available or parse error
  }
  return { ...ROUTING_PRESETS.balanced };
}

/**
 * Set custom weights.
 */
export function setCustomWeights(weights: Partial<RoutingWeights>): void {
  const normalized = normalizeWeights(weights);
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(CUSTOM_WEIGHTS_KEY, JSON.stringify(normalized));
    logger.info({ weights: normalized }, 'Custom routing weights updated');
  } catch (error) {
    logger.error({ err: error }, 'Failed to set custom weights');
  }
}

/**
 * Get the effective weights for the current strategy.
 */
export function getEffectiveWeights(): RoutingWeights {
  const strategy = getRoutingStrategy();
  if (strategy === 'priority') {
    // Priority mode: no scoring, just use the manual chain order
    return { reliability: 0, speed: 0, intelligence: 0, cost: 0 };
  }
  if (strategy === 'custom') {
    return getCustomWeights();
  }
  return ROUTING_PRESETS[strategy] ?? ROUTING_PRESETS.balanced;
}

/**
 * Get all available routing profiles (for UI).
 */
export function getRoutingProfiles(): Array<{ id: string; name: string; description: string; weights: RoutingWeights }> {
  return [
    { id: 'priority', name: 'Priority', description: 'Manual chain order, no scoring', weights: { reliability: 0, speed: 0, intelligence: 0, cost: 0 } },
    { id: 'balanced', name: 'Balanced', description: 'Even mix of all factors', weights: ROUTING_PRESETS.balanced },
    { id: 'smartest', name: 'Smartest', description: 'Prioritize intelligence/quality', weights: ROUTING_PRESETS.smartest },
    { id: 'fastest', name: 'Fastest', description: 'Prioritize low latency', weights: ROUTING_PRESETS.fastest },
    { id: 'reliable', name: 'Reliable', description: 'Prioritize success rate', weights: ROUTING_PRESETS.reliable },
    { id: 'custom', name: 'Custom', description: 'User-tuned weight vector', weights: getCustomWeights() },
  ];
}

// ── Helpers ──

function isValidStrategy(s: string): s is RoutingStrategy {
  return ['priority', 'balanced', 'smartest', 'fastest', 'reliable', 'custom'].includes(s);
}

function isValidWeights(w: Partial<RoutingWeights>): w is Partial<RoutingWeights> {
  if (!w || typeof w !== 'object') return false;
  const keys = ['reliability', 'speed', 'intelligence', 'cost'];
  return keys.every(k => {
    const v = (w as any)[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  });
}

function normalizeWeights(w: Partial<RoutingWeights>): RoutingWeights {
  const raw = {
    reliability: w.reliability ?? 0.25,
    speed: w.speed ?? 0.25,
    intelligence: w.intelligence ?? 0.25,
    cost: w.cost ?? 0.25,
  };
  const sum = raw.reliability + raw.speed + raw.intelligence + raw.cost;
  if (sum <= 0) return ROUTING_PRESETS.balanced;
  return {
    reliability: raw.reliability / sum,
    speed: raw.speed / sum,
    intelligence: raw.intelligence / sum,
    cost: raw.cost / sum,
  };
}

/**
 * Initialize settings table if it doesn't exist.
 */
export function initSettingsTable(): void {
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  } catch (error) {
    logger.warn({ err: error }, 'Failed to initialize settings table');
  }
}
