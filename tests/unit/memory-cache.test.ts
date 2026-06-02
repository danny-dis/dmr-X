import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryCache, createNamespacedCache } from '../../packages/db/src/cache.js';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MemoryCache();
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('missing')).toBeNull();
    });

    it('should overwrite existing values', () => {
      cache.set('key1', 'original');
      cache.set('key1', 'updated');
      expect(cache.get('key1')).toBe('updated');
    });

    it('should expire values after TTL', () => {
      cache.set('key1', 'value1', 10); // 10 seconds TTL
      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(11000); // 11 seconds
      expect(cache.get('key1')).toBeNull();
    });

    it('should use default TTL of 3600 seconds', () => {
      cache.set('key1', 'value1');
      // Should still be available before 3600s
      vi.advanceTimersByTime(3500000); // 3500 seconds
      expect(cache.get('key1')).toBe('value1');

      // Should expire after 3600s
      vi.advanceTimersByTime(200000); // +200s = 3700s total
      expect(cache.get('key1')).toBeNull();
    });
  });

  describe('del', () => {
    it('should delete a key', () => {
      cache.set('key1', 'value1');
      cache.del('key1');
      expect(cache.get('key1')).toBeNull();
    });

    it('should be safe to delete non-existent keys', () => {
      expect(() => cache.del('missing')).not.toThrow();
    });
  });

  describe('incrBy', () => {
    it('should increment from zero for new keys', () => {
      expect(cache.incrBy('counter', 5)).toBe(5);
    });

    it('should increment existing values', () => {
      cache.set('counter', '10');
      expect(cache.incrBy('counter', 3)).toBe(13);
    });

    it('should handle negative increments', () => {
      cache.set('counter', '10');
      expect(cache.incrBy('counter', -3)).toBe(7);
    });
  });

  describe('hash operations', () => {
    describe('hGet/hSet', () => {
      it('should set and get hash fields', () => {
        cache.hSet('user', 'name', 'Alice');
        expect(cache.hGet('user', 'name')).toBe('Alice');
      });

      it('should return null for non-existent fields', () => {
        expect(cache.hGet('user', 'missing')).toBeNull();
      });

      it('should return null for non-existent hash', () => {
        expect(cache.hGet('missing', 'field')).toBeNull();
      });

      it('should support multiple fields', () => {
        cache.hSet('user', 'name', 'Alice');
        cache.hSet('user', 'age', '30');
        expect(cache.hGet('user', 'name')).toBe('Alice');
        expect(cache.hGet('user', 'age')).toBe('30');
      });
    });

    describe('hIncrBy', () => {
      it('should increment from zero for new fields', () => {
        expect(cache.hIncrBy('stats', 'views', 1)).toBe(1);
      });

      it('should increment existing fields', () => {
        cache.hSet('stats', 'views', '10');
        expect(cache.hIncrBy('stats', 'views', 5)).toBe(15);
      });
    });

    describe('hGetAll', () => {
      it('should return all fields', () => {
        cache.hSet('user', 'name', 'Alice');
        cache.hSet('user', 'age', '30');
        const all = cache.hGetAll('user');
        expect(all).toEqual({ name: 'Alice', age: '30' });
      });

      it('should return empty object for non-existent hash', () => {
        expect(cache.hGetAll('missing')).toEqual({});
      });
    });
  });

  describe('expire', () => {
    it('should update TTL for existing key', () => {
      cache.set('key1', 'value1', 5); // 5 second TTL
      cache.expire('key1', 60); // extend to 60 seconds

      vi.advanceTimersByTime(10000); // 10 seconds
      expect(cache.get('key1')).toBe('value1'); // still alive
    });

    it('should expire after new TTL', () => {
      cache.set('key1', 'value1', 60);
      cache.expire('key1', 2); // reduce to 2 seconds

      vi.advanceTimersByTime(3000); // 3 seconds
      expect(cache.get('key1')).toBeNull();
    });

    it('should be safe for non-existent keys', () => {
      expect(() => cache.expire('missing', 10)).not.toThrow();
    });
  });

  describe('flush', () => {
    it('should clear all data', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.hSet('hash1', 'field', 'value');
      cache.flush();

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.hGet('hash1', 'field')).toBeNull();
    });
  });

  describe('auto-cleanup', () => {
    it('should remove expired entries from store', () => {
      cache.set('temp', 'data', 1);
      vi.advanceTimersByTime(1500); // past expiry
      // Entry should be cleaned up — get returns null
      expect(cache.get('temp')).toBeNull();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least-recently-used entries when maxSize is reached', () => {
      const lruCache = new MemoryCache(3);
      lruCache.set('a', '1');
      lruCache.set('b', '2');
      lruCache.set('c', '3');

      // Adding a 4th entry should evict 'a' (LRU)
      lruCache.set('d', '4');
      expect(lruCache.get('a')).toBeNull();
      expect(lruCache.get('b')).toBe('2');
      expect(lruCache.get('c')).toBe('3');
      expect(lruCache.get('d')).toBe('4');
      lruCache.destroy();
    });

    it('should promote accessed entries and evict truly LRU ones', () => {
      const lruCache = new MemoryCache(3);
      lruCache.set('a', '1');
      lruCache.set('b', '2');
      lruCache.set('c', '3');

      // Access 'a' to promote it to MRU
      lruCache.get('a');

      // Now 'b' is LRU; adding 'd' should evict 'b'
      lruCache.set('d', '4');
      expect(lruCache.get('a')).toBe('1');
      expect(lruCache.get('b')).toBeNull();
      expect(lruCache.get('c')).toBe('3');
      expect(lruCache.get('d')).toBe('4');
      lruCache.destroy();
    });

    it('should update LRU position on set() for existing key', () => {
      const lruCache = new MemoryCache(3);
      lruCache.set('a', '1');
      lruCache.set('b', '2');
      lruCache.set('c', '3');

      // Overwrite 'a' — should promote it to MRU
      lruCache.set('a', '1-updated');

      // Now 'b' is LRU; adding 'd' should evict 'b'
      lruCache.set('d', '4');
      expect(lruCache.get('a')).toBe('1-updated');
      expect(lruCache.get('b')).toBeNull();
      lruCache.destroy();
    });
  });

  describe('namespaced cache', () => {
    it('should isolate keys by namespace', () => {
      const ns1 = createNamespacedCache('ns1');
      const ns2 = createNamespacedCache('ns2');

      ns1.set('key', 'value1');
      ns2.set('key', 'value2');

      expect(ns1.get('key')).toBe('value1');
      expect(ns2.get('key')).toBe('value2');
    });

    it('should share the same backing store', () => {
      const ns = createNamespacedCache('test', cache);
      ns.set('shared', 'data');

      // The backing cache should see it with the namespace prefix
      expect(cache.get('test:shared')).toBe('data');
    });

    it('should support hash operations with namespaces', () => {
      const ns = createNamespacedCache('h');

      ns.hSet('user', 'name', 'Alice');
      expect(ns.hGet('user', 'name')).toBe('Alice');
      expect(ns.hGetAll('user')).toEqual({ name: 'Alice' });

      ns.del('user');
      expect(ns.hGet('user', 'name')).toBeNull();
    });
  });
});
