const DEFAULT_MAX_SIZE = 10_000;
const SWEEP_INTERVAL_MS = 30_000;

interface CacheEntry {
  value: string;
  expires: number;
}

export class MemoryCache {
  private store = new Map<string, CacheEntry>();
  private hashes = new Map<string, Map<string, string>>();
  private hashTTLs = new Map<string, number>();
  private accessOrder = new Map<string, number>();
  private maxSize: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.startSweep();
  }

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      this.accessOrder.delete(key);
      return null;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    this.accessOrder.set(key, Date.now());
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds = 3600): void {
    this.store.delete(key);
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

  delete(key: string): void { this.del(key); }

  incrBy(key: string, amount: number): number {
    const current = this.get(key);
    const num = current ? parseInt(current, 10) : 0;
    const newVal = num + amount;
    this.set(key, String(newVal));
    return newVal;
  }

  hGet(key: string, field: string): string | null {
    const hashExpiry = this.hashTTLs.get(key);
    if (hashExpiry !== undefined && Date.now() > hashExpiry) {
      this.hashes.delete(key);
      this.hashTTLs.delete(key);
      this.accessOrder.delete(key);
      return null;
    }
    const hash = this.hashes.get(key);
    if (!hash) return null;
    this.accessOrder.set(key, Date.now());
    return hash.get(field) ?? null;
  }

  hSet(key: string, field: string, value: string, ttlSeconds?: number): void {
    let hash = this.hashes.get(key);
    if (!hash) {
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
    if (ttlSeconds !== undefined && !this.hashTTLs.has(key)) {
      this.hashTTLs.set(key, Date.now() + ttlSeconds * 1000);
    }
    this.accessOrder.set(key, Date.now());
  }

  hIncrBy(key: string, field: string, amount: number): number {
    const current = this.hGet(key, field);
    const num = current ? parseInt(current, 10) : 0;
    const newVal = num + amount;
    this.hSet(key, field, String(newVal));
    return newVal;
  }

  hGetAll(key: string): Record<string, string> {
    const hashExpiry = this.hashTTLs.get(key);
    if (hashExpiry !== undefined && Date.now() > hashExpiry) {
      this.hashes.delete(key);
      this.hashTTLs.delete(key);
      this.accessOrder.delete(key);
      return {};
    }
    const hash = this.hashes.get(key);
    if (!hash) return {};
    this.accessOrder.set(key, Date.now());
    const result: Record<string, string> = {};
    for (const [field, value] of hash) { result[field] = value; }
    return result;
  }

  expire(key: string, seconds: number): void {
    const entry = this.store.get(key);
    if (entry) {
      entry.expires = Date.now() + seconds * 1000;
      this.store.delete(key);
      this.store.set(key, entry);
    }
    if (this.hashes.has(key)) {
      this.hashTTLs.set(key, Date.now() + seconds * 1000);
    }
    this.accessOrder.set(key, Date.now());
  }

  get size(): number { return this.store.size + this.hashes.size; }
  hashCount(): number { return this.hashes.size; }

  flush(): void {
    this.store.clear();
    this.hashes.clear();
    this.hashTTLs.clear();
    this.accessOrder.clear();
  }

  keys(): string[] {
    const storeKeys = [...this.store.keys()];
    const hashKeys = [...this.hashes.keys()];
    return [...new Set([...storeKeys, ...hashKeys])];
  }

  keysByPrefix(prefix: string): string[] {
    return this.keys().filter((k) => k.startsWith(prefix));
  }

  destroy(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.flush();
  }

  private findLRUKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const key of this.store.keys()) {
      const ts = this.accessOrder.get(key) ?? 0;
      if (ts < oldestTime) { oldestTime = ts; oldestKey = key; }
    }
    for (const key of this.hashes.keys()) {
      if (this.store.has(key)) continue;
      const ts = this.accessOrder.get(key) ?? 0;
      if (ts < oldestTime) { oldestTime = ts; oldestKey = key; }
    }
    return oldestKey;
  }

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
      for (const [key, expires] of this.hashTTLs) {
        if (now > expires) {
          this.hashes.delete(key);
          this.hashTTLs.delete(key);
          this.accessOrder.delete(key);
        }
      }
    }, SWEEP_INTERVAL_MS);
    if (this.sweepTimer && typeof this.sweepTimer === "object" && "unref" in this.sweepTimer) {
      (this.sweepTimer as NodeJS.Timeout).unref();
    }
  }
}

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
  keysByPrefix(prefix: string): string[];
}

export function createNamespacedCache(
  namespace: string,
  backingCache: MemoryCache = cache,
): NamespacedCache {
  const prefix = namespace + ":";
  const p = (key: string) => prefix + key;
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
    flush:      () => {
      for (const key of backingCache.keys()) {
        if (key.startsWith(prefix)) backingCache.del(key);
      }
    },
    keysByPrefix: (pfx) => backingCache.keysByPrefix(prefix + pfx).map((k) => k.slice(prefix.length)),
  };
}

export const cache = new MemoryCache();

