const DEFAULT_MAX_SIZE = 10_000;
const SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_HASH_TTL_MS = 3600_000; // 1 hour default for hashes without explicit TTL

// Doubly-linked list node for key-value entries
interface KVNode {
  key: string;
  value: string;
  expires: number;
  prev: KVNode | null;
  next: KVNode | null;
}

// Hash entry with its own TTL
interface HashEntry {
  fields: Map<string, string>;
  expires: number; // 0 = no expiry, but will be swept by LRU or default TTL
}

/**
 * In-memory LRU cache with O(1) get/set/evict.
 *
 * Uses a doubly-linked list + Map for key-value entries, and a separate
 * Map for hash (Redis-like) entries. Both share the same maxSize cap.
 *
 * Fixes from original implementation:
 * - O(1) LRU eviction (was O(n) linear scan)
 * - Cross-contamination: set()/hSet() clean up cross-map state
 * - Ghost entries: expire() no longer creates orphan accessOrder entries
 * - Hash TTL: hashes without explicit TTL get a 1-hour default
 * - NaN guard: incrBy/hIncrBy handle non-numeric strings
 * - Optimized keys()/keysByPrefix() with no intermediate allocations
 */
export class MemoryCache {
  private kvMap = new Map<string, KVNode>();
  private hashMap = new Map<string, HashEntry>();

  // Doubly-linked list for LRU ordering (head = most recent, tail = least recent)
  private head: KVNode;
  private tail: KVNode;

  private maxSize: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private _size = 0; // kvMap.size + hashMap.size

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    // Sentinel nodes simplify list operations (no null checks needed)
    this.head = { key: '', value: '', expires: 0, prev: null, next: null };
    this.tail = { key: '', value: '', expires: 0, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.startSweep();
  }

  // ---------------------------------------------------------------------------
  // Key-Value operations
  // ---------------------------------------------------------------------------

  get(key: string): string | null {
    const node = this.kvMap.get(key);
    if (!node) return null;

    if (Date.now() > node.expires) {
      this.removeKVNode(node);
      return null;
    }

    // Move to head (most recently used)
    this.moveToHead(node);
    return node.value;
  }

  set(key: string, value: string, ttlSeconds = 3600): void {
    // Fix cross-contamination: clean up hash state if key exists there
    if (this.hashMap.has(key)) {
      this.hashMap.delete(key);
      this._size--;
    }

    const existing = this.kvMap.get(key);
    if (existing) {
      existing.value = value;
      existing.expires = Date.now() + ttlSeconds * 1000;
      this.moveToHead(existing);
      return;
    }

    // Evict if at capacity
    while (this._size >= this.maxSize) {
      this.evictLRU();
    }

    const node: KVNode = {
      key,
      value,
      expires: Date.now() + ttlSeconds * 1000,
      prev: null,
      next: null,
    };

    this.kvMap.set(key, node);
    this.addToHead(node);
    this._size++;
  }

  del(key: string): void {
    const kvNode = this.kvMap.get(key);
    if (kvNode) {
      this.removeKVNode(kvNode);
      this._size--;
      return;
    }

    if (this.hashMap.has(key)) {
      this.hashMap.delete(key);
      this._size--;
    }
  }

  delete(key: string): void { this.del(key); }

  incrBy(key: string, amount: number): number {
    const current = this.get(key);
    const num = current ? parseInt(current, 10) : 0;

    // NaN guard: treat corrupted values as 0
    if (isNaN(num)) {
      this.set(key, String(amount));
      return amount;
    }

    const newVal = num + amount;
    this.set(key, String(newVal));
    return newVal;
  }

  // ---------------------------------------------------------------------------
  // Hash operations (Redis-like hGet/hSet/hIncrBy/hGetAll)
  // ---------------------------------------------------------------------------

  hGet(key: string, field: string): string | null {
    const entry = this.hashMap.get(key);
    if (!entry) return null;

    if (entry.expires > 0 && Date.now() > entry.expires) {
      this.hashMap.delete(key);
      this._size--;
      return null;
    }

    return entry.fields.get(field) ?? null;
  }

  hSet(key: string, field: string, value: string, ttlSeconds?: number): void {
    // Fix cross-contamination: clean up KV state if key exists there
    const kvNode = this.kvMap.get(key);
    if (kvNode) {
      this.removeKVNode(kvNode);
      this._size--;
    }

    let entry = this.hashMap.get(key);
    if (!entry) {
      // Evict if at capacity
      while (this._size >= this.maxSize) {
        this.evictLRU();
      }

      entry = {
        fields: new Map(),
        expires: ttlSeconds !== undefined
          ? Date.now() + ttlSeconds * 1000
          : Date.now() + DEFAULT_HASH_TTL_MS,
      };
      this.hashMap.set(key, entry);
      this._size++;
    } else if (ttlSeconds !== undefined && entry.expires === 0) {
      // Write-once TTL: only set if not already set
      entry.expires = Date.now() + ttlSeconds * 1000;
    }

    entry.fields.set(field, value);
  }

  hIncrBy(key: string, field: string, amount: number): number {
    const current = this.hGet(key, field);
    const num = current ? parseInt(current, 10) : 0;

    // NaN guard
    if (isNaN(num)) {
      this.hSet(key, field, String(amount));
      return amount;
    }

    const newVal = num + amount;
    this.hSet(key, field, String(newVal));
    return newVal;
  }

  hGetAll(key: string): Record<string, string> {
    const entry = this.hashMap.get(key);
    if (!entry) return {};

    if (entry.expires > 0 && Date.now() > entry.expires) {
      this.hashMap.delete(key);
      this._size--;
      return {};
    }

    const result: Record<string, string> = {};
    for (const [field, value] of entry.fields) {
      result[field] = value;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // TTL / Metadata
  // ---------------------------------------------------------------------------

  expire(key: string, seconds: number): void {
    // Fix ghost entries: only update if key actually exists
    const kvNode = this.kvMap.get(key);
    if (kvNode) {
      kvNode.expires = Date.now() + seconds * 1000;
      this.moveToHead(kvNode);
      return;
    }

    const hashEntry = this.hashMap.get(key);
    if (hashEntry) {
      hashEntry.expires = Date.now() + seconds * 1000;
    }
    // Non-existent keys: do nothing (no ghost entries)
  }

  get size(): number { return this._size; }
  hashCount(): number { return this.hashMap.size; }

  flush(): void {
    this.kvMap.clear();
    this.hashMap.clear();
    this._size = 0;
    // Reset linked list
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  keys(): string[] {
    const result: string[] = [];
    // KV keys in LRU order (most recent first)
    for (let node = this.head!.next; node !== this.tail; node = node!.next) {
      result.push(node!.key);
    }
    // Hash keys (not in LRU order, but that's fine for hash entries)
    for (const key of this.hashMap.keys()) {
      if (!this.kvMap.has(key)) {
        result.push(key);
      }
    }
    return result;
  }

  keysByPrefix(prefix: string): string[] {
    const result: string[] = [];
    // KV keys in LRU order
    for (let node = this.head!.next; node !== this.tail; node = node!.next) {
      if (node!.key.startsWith(prefix)) {
        result.push(node!.key);
      }
    }
    // Hash keys
    for (const key of this.hashMap.keys()) {
      if (key.startsWith(prefix) && !this.kvMap.has(key)) {
        result.push(key);
      }
    }
    return result;
  }

  destroy(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.flush();
  }

  // ---------------------------------------------------------------------------
  // Private linked list helpers (all O(1))
  // ---------------------------------------------------------------------------

  private addToHead(node: KVNode): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private removeNode(node: KVNode): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private moveToHead(node: KVNode): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeKVNode(node: KVNode): void {
    this.removeNode(node);
    this.kvMap.delete(node.key);
  }

  private evictLRU(): void {
    // Evict least recently used KV node (tail.prev)
    const lru = this.tail.prev;
    if (lru && lru !== this.head) {
      this.removeKVNode(lru);
      this._size--;
      return;
    }

    // If no KV nodes, evict oldest hash entry (arbitrary, no LRU for hashes)
    for (const [key] of this.hashMap) {
      this.hashMap.delete(key);
      this._size--;
      break;
    }
  }

  // ---------------------------------------------------------------------------
  // Sweep timer: clean up expired entries periodically
  // ---------------------------------------------------------------------------

  private startSweep(): void {
    this.sweepTimer = setInterval(() => {
      const now = Date.now();

      // Sweep expired KV nodes (traverse from tail, oldest first)
      for (let node = this.tail.prev; node !== this.head; ) {
        const prev = node!.prev;
        if (now > node!.expires) {
          this.removeKVNode(node!);
          this._size--;
        }
        node = prev;
      }

      // Sweep expired hash entries
      for (const [key, entry] of this.hashMap) {
        if (entry.expires > 0 && now > entry.expires) {
          this.hashMap.delete(key);
          this._size--;
        }
      }
    }, SWEEP_INTERVAL_MS);

    if (this.sweepTimer && typeof this.sweepTimer === "object" && "unref" in this.sweepTimer) {
      (this.sweepTimer as NodeJS.Timeout).unref();
    }
  }
}

// ---------------------------------------------------------------------------
// Namespaced cache wrapper (unchanged from original)
// ---------------------------------------------------------------------------

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
