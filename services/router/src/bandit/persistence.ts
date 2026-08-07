import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

import type { ThompsonSampler } from './thompson-sampler.js';

/**
 * How often bandit arm state is flushed to SQLite.
 *
 * Every write through `packages/db/src/client.ts`'s `scheduleSave()` rewrites
 * the *entire* database file — there is no incremental/WAL write path (see
 * the comment at client.ts:340-361: a naive fixed 50ms debounce produced
 * 2217 whole-file rewrites in one run and was the root cause of a corruption
 * bug). `ThompsonSampler.update()` runs on every routed request, so saving
 * on each call would reintroduce exactly that write-amplification problem —
 * potentially worse, since it's now on the hot request path instead of a
 * bulk import.
 *
 * The bandit's posterior (alpha/beta) moves gradually — one request's worth
 * of reward is a tiny nudge, not information that is dangerous to lose. So
 * this batches all arms into a single save on a slow, fixed interval well
 * above the write-amplification danger zone, and flushes once more on
 * graceful shutdown (see `startBanditPersistence`'s returned stop function)
 * so a clean restart loses at most ~30s of learning, never more.
 */
export const BANDIT_PERSIST_INTERVAL_MS = 30_000;

interface BanditArmRow {
  key: string;
  alpha: number;
  beta: number;
  pulls: number;
  total_reward: number;
}

/**
 * Load persisted arm state into a live sampler. Call once at startup,
 * before the sampler is used to select/update anything. Best-effort: a
 * missing table or read failure just leaves the sampler on fresh priors
 * (e.g. first boot, before migration 071 has run) rather than failing
 * gateway startup.
 */
export function loadBanditArms(sampler: ThompsonSampler): number {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT key, alpha, beta, pulls, total_reward FROM bandit_arms')
      .all() as unknown as BanditArmRow[];
    for (const row of rows) {
      sampler.restore(row.key, row.alpha, row.beta, row.pulls, row.total_reward);
    }
    if (rows.length > 0) {
      // What we just restored is by definition already on disk, so seed the
      // change detector to stop the first interval tick rewriting it verbatim.
      lastPersistedPulls = rows.reduce((sum, row) => sum + (row.pulls ?? 0), 0);
      logger.info({ arms: rows.length }, 'Restored bandit arm state from SQLite');
    }
    return rows.length;
  } catch (err) {
    logger.warn({ err }, 'Failed to load bandit arm state — starting from fresh priors');
    return 0;
  }
}

/**
 * Total pulls observed at the last successful save. Used to skip writes when
 * nothing has changed.
 *
 * Without this, the interval below rewrites the whole database every tick
 * even on a gateway serving zero traffic — an UPSERT of identical values
 * still dirties the page, and `scheduleSave()` re-exports the entire file.
 * On a ~10 MB encrypted DB that is ~30 GB of pointless writes per idle day,
 * and write amplification is precisely what corrupted this database before.
 * `pulls` only ever increases (see `ThompsonSampler.update`), so its sum is a
 * sufficient change detector.
 */
let lastPersistedPulls = -1;

/** Reset the change detector. Exposed for tests. */
export function resetBanditPersistenceState(): void {
  lastPersistedPulls = -1;
}

/**
 * Persist every arm's current state. Swallows errors — a bandit bookkeeping
 * failure must never take down the gateway (matches the swallow-all
 * convention already used around bandit updates in router.service.ts).
 *
 * A no-op when no arm has been pulled since the last save.
 */
export function saveBanditArms(sampler: ThompsonSampler): void {
  const arms = sampler.snapshot();
  if (arms.length === 0) return;
  const totalPulls = arms.reduce((sum, arm) => sum + (arm.pulls ?? 0), 0);
  if (totalPulls === lastPersistedPulls) return;
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO bandit_arms (key, provider_id, model_id, alpha, beta, pulls, total_reward, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        alpha = excluded.alpha,
        beta = excluded.beta,
        pulls = excluded.pulls,
        total_reward = excluded.total_reward,
        updated_at = excluded.updated_at
    `);
    for (const arm of arms) {
      stmt.run(
        arm.key,
        arm.providerId ?? null,
        arm.modelId ?? null,
        arm.alpha ?? 0,
        arm.beta ?? 0,
        arm.pulls ?? 0,
        arm.totalReward ?? 0,
      );
    }
    lastPersistedPulls = totalPulls;
  } catch (err) {
    logger.warn({ err }, 'Failed to persist bandit arm state');
  }
}

/**
 * Start the debounced persistence loop for a sampler. Returns a stop
 * function that clears the interval and performs one final synchronous
 * save — call it from the server's shutdown hook so a clean restart never
 * loses more than one interval's worth of learning.
 */
export function startBanditPersistence(
  sampler: ThompsonSampler,
  intervalMs: number = BANDIT_PERSIST_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => saveBanditArms(sampler), intervalMs);
  // Don't let this timer keep the process alive on its own.
  timer.unref?.();
  return () => {
    clearInterval(timer);
    saveBanditArms(sampler);
  };
}
