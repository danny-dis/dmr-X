const DEFAULT_MAX_SIZE = 10_000;
const SWEEP_INTERVAL_MS = 30_000; // 30 seconds

interface CacheEntry {
  value: string;
  expires: number;
}

/**
 * In-memory LRU cache with TTL expiry and a single periodic sweep timer.
 *
 * - Max entries capped at `maxSize` (default 10 000); least-recently-used
 *   entries are evicted when the limit is reached.
 * - TTL expiry is checked lazily on `get()` and proactively by one shared
 *   `setInterval` sweep every 30 s — no per-key timers.
 * - `createNamespacedCache(namespace)` returns a thin wrapper that
 *   automatically prefixes every key with `namespace:`, preventing
 *   collisions between unrelated subsystems.
 * - Both `store` (string cache) and `hashes` (hash cache) entries are
 *   tracked by a unified `accessOrder` map for LRU eviction. This prevents
 *   hash entries from growing unboundedly outside the maxSize limit.
 */
export class MemoryCache {
  /** LRU store for string key-value entries. */
  private store = new Map<string, CacheEntry>();
  /** Hash entries: key -> Map<field, value>. */
  private hashes = new Map<string, Map<string, string>>();
  /** TTL expiry per hash key — expires[key] is the timestamp when the hash expires. */
  private hashTTLs = new Map<string, number>();
  /** Unified LRU access tracking: key -> last-access timestamp (ms). */
  private accessOrder = new Map<string, number>();
  private maxSize: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.startSweep();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      this.accessOrder.delete(key);
      return null;
    }
    // Move to end (most-recently-used)
    this.store.delete(key);
    this.store.set(key, entry);
    this.accessOrder.set(key, Date.now());
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds = 3600): void {
    // If key already exists, delete first so re-insertion puts it at the end
    this.store.delete(key);

    // Evict LRU entries if at capacity (count both store AND hashes)
    while (this.store.size + this.hashes.size >= this.maxSize) {
      const lruKey = this.findLRUKey();
      if (lruKey === undefined) break;
      this.store.delete(lruKey);
      this.hashes.delete(lruKey);
      this.hashTTLs.delete(lruKey);
      this.accessOrder.delete(lruKey);
    }

    const expires = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expires });
    this.accessOrder.set(key, Date.now());
  }

  del(key: string): void {
    this.store.delete(key);
    this.hashes.delete(key);
    this.hashTTLs.delete(key);
    this.accessOrder.delete(key);
  }

  /** Alias for del(key) */
  delete(key: string): void {
    this.del(key);
  }

  incrBy(key: string, amount: number): number {
    const current = this.get(key);
    const num = current ? parseInt(current, 10) : 0;
    const newVal = num + amount;
    this.set(key, String(newVal));
    return newVal;
  }

  hGet(key: string, field: string): string | null {
    // Check hash TTL
    const hashExpiry = this.hashTTLs.get(key);
    if (hashExpiry !== undefined && Date.now() > hashExpiry) {
      this.hashes.delete(key);
      this.hashTTLs.delete(key);
      this.accessOrder.delete(key);
      return null;
    }
    const hash = this.hashes.get(key);
    if (!hash) return null;
    // Update LRU access for hash reads
    this.accessOrder.set(key, Date.now());
    return hash.get(field) ?? null;
  }

  hSet(key: string, field: string, value: string, ttlSeconds?: number): void {
    let hash = this.hashes.get(key);
    if (!hash) {
      // New hash entry — make room first (matching set()'s pattern) so we
      // don't transiently exceed maxSize. Without this, the third hSet into
      // a 3-slot cache would evict one entry and leave size=2.
      while (this.store.size + this.hashes.size >= this.maxSize) {
        const lruKey = this.findLRUKey();
        if (lruKey === undefined) break;
        this.store.delete(lruKey);
        this.hashes.delete(lruKey);
        this.hashTTLs.delete(lruKey);
        this.accessOrder.delete(lruKey);
      }
      hash = new Map();
      this.hashes.set(key, hash);
    }
    hash.set(field, value);

    // Set TTL if provided and no existing TTL
    if (ttlSeconds !== undefined && !this.hashTTLs.has(key)) {
      this.hashTTLs.set(key, Date.now() + ttlSeconds * 1000);
    }

    // Track LRU access (no eviction here — we already made room above)
    this.accessOrder.set(key, Date.now());
  }

  hIncrBy(key: string, field: string, amount: number): number {
    const current = this.hGet(key, field);
    const num = current ? parseInt(current, 10) : 0;
    const newVal = num + amount;
    // Don't pass ttl to hSet — preserve existing TTL
    this.hSet(key, field, String(newVal));
    return newVal;
  }

  hGetAll(key: string): Record<string, string> {
    // Check hash TTL
    const hashExpiry = this.hashTTLs.get(key);
    if (hashExpiry !== undefined && Date.now() > hashExpiry) {
      this.hashes.delete(key);
      this.hashTTLs.delete(key);
      this.accessOrder.delete(key);
      return {};
    }
    const hash = this.hashes.get(key);
    if (!hash) return {};
    // Update LRU access
    this.accessOrder.set(key, Date.now());
    const result: Record<string, string> = {};
    for (const [field, value] of hash) {
      result[field] = value;
    }
    return result;
  }

  expire(key: string, seconds: number): void {
    const entry = this.store.get(key);
    if (entry) {
      entry.expires = Date.now() + seconds * 1000;
      // Re-insert at end (treat as recently accessed)
      this.store.delete(key);
      this.store.set(key, entry);
    }
    // Also update hash TTL if this key has a hash
    if (this.hashes.has(key)) {
      this.hashTTLs.set(key, Date.now() + seconds * 1000);
    }
    this.accessOrder.set(key, Date.now());
  }

  /** Return the total number of entries (store + hashes). */
  get size(): number {
    return this.store.size + this.hashes.size;
  }

  /** Return the number of hash entries (for monitoring). */
  hashCount(): number {
    return this.hashes.size;
  }

  flush(): void {
    this.store.clear();
    this.hashes.clear();
    this.hashTTLs.clear();
    this.accessOrder.clear();
  }

  /**
   * Tear down the sweep timer. Call this in tests or on graceful shutdown.
   */
  destroy(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.flush();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Find the least-recently-used key across both store and hashes.
   * Returns the key with the oldest access timestamp.
   */
  private findLRUKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    // Check store entries (store preserves insertion order but accessOrder
    // gives us the true last-access time)
    for (const key of this.store.keys()) {
      const ts = this.accessOrder.get(key) ?? 0;
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestKey = key;
      }
    }

    // Check hash entries (only hash-only keys; keys in both store and hashes
    // are already considered above)
    for (const key of this.hashes.keys()) {
      if (this.store.has(key)) continue; // already checked
      const ts = this.accessOrder.get(key) ?? 0;
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Single shared interval that walks the map and removes expired entries.
   * Much cheaper than one setTimeout per key.
   */
  private startSweep(): void {
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now > entry.expires) {
          this.store.delete(key);
          this.hashes.delete(key);
          this.hashTTLs.delete(key);
          this.accessOrder.delete(key);
        }
      }
      // Sweep expired hashes (keys not in store but still have TTL entries)
      for (const [key, expires] of this.hashTTLs) {
        if (now > expires) {
          this.hashes.delete(key);
          this.hashTTLs.delete(key);
          this.accessOrder.delete(key);
        }
      }
    }, SWEEP_INTERVAL_MS);

    // Don't keep the Node process alive just for cache sweeps
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      (this.sweepTimer as NodeJS.Timeout).unref();
    }
  }
}

// ---------------------------------------------------------------------------
// Namespace support  (HIGH #23 — cache key collision between data types)
// ---------------------------------------------------------------------------

/**
 * A thin wrapper around a shared `MemoryCache` that automatically prefixes
 * every key with `namespace:`. This prevents collisions between unrelated
 * subsystems (e.g. rate-limit keys vs quota keys vs usage-tracker keys).
 *
 * Usage:
 *   import { cache, createNamespacedCache } from '@dmr-x/db';
 *   const rlCache = createNamespacedCache('rl');
 *   rlCache.set('openai:gpt-4:rpm', '...');  // stored as "rl:openai:gpt-4:rpm"
 */
export interface NamespacedCache {
  get(key: string): string | null;
  set(key: string, value: string, ttlSeconds?: number): void;
  del(key: string): void;
  delete(key: string): void;
  incrBy(key: string, amount: number): number;
  hGet(key: string, field: string): string | null;
  hSet(key: string, field: string, value: string, ttlSeconds?: number): void;
  hIncrBy(key: string, field: string, amount: number): number;
  hGetAll(key: string): Record<string, string>;
  expire(key: string, seconds: number): void;
  flush(): void;
}

export function createNamespacedCache(
  namespace: string,
  backingCache: MemoryCache = cache,
): NamespacedCache {
  const prefix = `${namespace}:`;
  const p = (key: string) => `${prefix}${key}`;

  return {
    get:        (key)                     => backingCache.get(p(key)),
    set:        (key, value, ttl?)        => backingCache.set(p(key), value, ttl),
    del:        (key)                     => backingCache.del(p(key)),
    delete:     (key)                     => backingCache.del(p(key)),
    incrBy:     (key, amount)             => backingCache.incrBy(p(key), amount),
    hGet:       (key, field)              => backingCache.hGet(p(key), field),
    hSet:       (key, field, value, ttl?) => backingCache.hSet(p(key), field, value, ttl),
    hIncrBy:    (key, field, amount)      => backingCache.hIncrBy(p(key), field, amount),
    hGetAll:    (key)                     => backingCache.hGetAll(p(key)),
    expire:     (key, seconds)            => backingCache.expire(p(key), seconds),
    flush:      ()                        => backingCache.flush(),
  };
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const cache = new MemoryCache();
