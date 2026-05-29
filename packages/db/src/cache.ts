export class MemoryCache {
  private store = new Map<string, { value: string; expires: number }>();
  private hashes = new Map<string, Map<string, string>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds = 3600): void {
    // Clear any existing expiry timer
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    const expires = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expires });

    // Auto-cleanup after expiry
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, ttlSeconds * 1000);

    // Allow the timer to not keep the process alive
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.timers.set(key, timer);
  }

  del(key: string): void {
    this.store.delete(key);
    this.hashes.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  incrBy(key: string, amount: number): number {
    const current = this.get(key);
    const num = current ? parseInt(current, 10) : 0;
    const newVal = num + amount;
    this.set(key, String(newVal));
    return newVal;
  }

  hGet(key: string, field: string): string | null {
    const hash = this.hashes.get(key);
    if (!hash) return null;
    return hash.get(field) ?? null;
  }

  hSet(key: string, field: string, value: string): void {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    hash.set(field, value);
  }

  hIncrBy(key: string, field: string, amount: number): number {
    const current = this.hGet(key, field);
    const num = current ? parseInt(current, 10) : 0;
    const newVal = num + amount;
    this.hSet(key, field, String(newVal));
    return newVal;
  }

  hGetAll(key: string): Record<string, string> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    const result: Record<string, string> = {};
    for (const [field, value] of hash) {
      result[field] = value;
    }
    return result;
  }

  expire(key: string, seconds: number): void {
    const entry = this.store.get(key);
    if (entry) {
      const existing = this.timers.get(key);
      if (existing) clearTimeout(existing);

      entry.expires = Date.now() + seconds * 1000;
      this.store.set(key, entry);

      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, seconds * 1000);

      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }

      this.timers.set(key, timer);
    }
  }

  flush(): void {
    this.store.clear();
    this.hashes.clear();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

export const cache = new MemoryCache();
