const DEFAULT_MAX_SIZE = 10_000;
const SWEEP_INTERVAL_MS = 30_000; // 30 seconds
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
 */
export class MemoryCache {
    /** LRU store — Map preserves insertion order; re-insert on access. */
    store = new Map();
    hashes = new Map();
    /** TTL expiry per hash key — expires[key] is the timestamp when the hash expires. */
    hashTTLs = new Map();
    maxSize;
    sweepTimer = null;
    constructor(maxSize = DEFAULT_MAX_SIZE) {
        this.maxSize = maxSize;
        this.startSweep();
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expires) {
            this.store.delete(key);
            return null;
        }
        // Move to end (most-recently-used)
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.value;
    }
    set(key, value, ttlSeconds = 3600) {
        // If key already exists, delete first so re-insertion puts it at the end
        this.store.delete(key);
        // Evict LRU entries if at capacity
        while (this.store.size >= this.maxSize) {
            const lruKey = this.store.keys().next().value;
            if (lruKey !== undefined) {
                this.store.delete(lruKey);
                this.hashes.delete(lruKey);
                this.hashTTLs.delete(lruKey);
            }
            else {
                break;
            }
        }
        const expires = Date.now() + ttlSeconds * 1000;
        this.store.set(key, { value, expires });
    }
    del(key) {
        this.store.delete(key);
        this.hashes.delete(key);
        this.hashTTLs.delete(key);
    }
    /** Alias for del(key) */
    delete(key) {
        this.del(key);
    }
    incrBy(key, amount) {
        const current = this.get(key);
        const num = current ? parseInt(current, 10) : 0;
        const newVal = num + amount;
        this.set(key, String(newVal));
        return newVal;
    }
    hGet(key, field) {
        // Check hash TTL
        const hashExpiry = this.hashTTLs.get(key);
        if (hashExpiry !== undefined && Date.now() > hashExpiry) {
            this.hashes.delete(key);
            this.hashTTLs.delete(key);
            return null;
        }
        const hash = this.hashes.get(key);
        if (!hash)
            return null;
        return hash.get(field) ?? null;
    }
    hSet(key, field, value, ttlSeconds) {
        let hash = this.hashes.get(key);
        if (!hash) {
            hash = new Map();
            this.hashes.set(key, hash);
        }
        hash.set(field, value);
        // Set TTL if provided and no existing TTL
        if (ttlSeconds !== undefined && !this.hashTTLs.has(key)) {
            this.hashTTLs.set(key, Date.now() + ttlSeconds * 1000);
        }
    }
    hIncrBy(key, field, amount) {
        const current = this.hGet(key, field);
        const num = current ? parseInt(current, 10) : 0;
        const newVal = num + amount;
        // Don't pass ttl to hSet — preserve existing TTL
        this.hSet(key, field, String(newVal));
        return newVal;
    }
    hGetAll(key) {
        // Check hash TTL
        const hashExpiry = this.hashTTLs.get(key);
        if (hashExpiry !== undefined && Date.now() > hashExpiry) {
            this.hashes.delete(key);
            this.hashTTLs.delete(key);
            return {};
        }
        const hash = this.hashes.get(key);
        if (!hash)
            return {};
        const result = {};
        for (const [field, value] of hash) {
            result[field] = value;
        }
        return result;
    }
    expire(key, seconds) {
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
    }
    flush() {
        this.store.clear();
        this.hashes.clear();
        this.hashTTLs.clear();
    }
    /**
     * Tear down the sweep timer. Call this in tests or on graceful shutdown.
     */
    destroy() {
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
     * Single shared interval that walks the map and removes expired entries.
     * Much cheaper than one setTimeout per key.
     */
    startSweep() {
        this.sweepTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.store) {
                if (now > entry.expires) {
                    this.store.delete(key);
                    this.hashes.delete(key);
                    this.hashTTLs.delete(key);
                }
            }
            // Sweep expired hashes (keys not in store but still have TTL entries)
            for (const [key, expires] of this.hashTTLs) {
                if (now > expires) {
                    this.hashes.delete(key);
                    this.hashTTLs.delete(key);
                }
            }
        }, SWEEP_INTERVAL_MS);
        // Don't keep the Node process alive just for cache sweeps
        if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
            this.sweepTimer.unref();
        }
    }
}
export function createNamespacedCache(namespace, backingCache = cache) {
    const prefix = `${namespace}:`;
    const p = (key) => `${prefix}${key}`;
    return {
        get: (key) => backingCache.get(p(key)),
        set: (key, value, ttl) => backingCache.set(p(key), value, ttl),
        del: (key) => backingCache.del(p(key)),
        delete: (key) => backingCache.del(p(key)),
        incrBy: (key, amount) => backingCache.incrBy(p(key), amount),
        hGet: (key, field) => backingCache.hGet(p(key), field),
        hSet: (key, field, value, ttl) => backingCache.hSet(p(key), field, value, ttl),
        hIncrBy: (key, field, amount) => backingCache.hIncrBy(p(key), field, amount),
        hGetAll: (key) => backingCache.hGetAll(p(key)),
        expire: (key, seconds) => backingCache.expire(p(key), seconds),
        flush: () => backingCache.flush(),
    };
}
// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------
export const cache = new MemoryCache();
//# sourceMappingURL=cache.js.map