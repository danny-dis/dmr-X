"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const cache_js_1 = require("../../packages/db/src/cache.js");
(0, vitest_1.describe)('MemoryCache', () => {
    let cache;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
        cache = new cache_js_1.MemoryCache();
    });
    (0, vitest_1.afterEach)(() => {
        cache.destroy();
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.describe)('get/set', () => {
        (0, vitest_1.it)('should store and retrieve values', () => {
            cache.set('key1', 'value1');
            (0, vitest_1.expect)(cache.get('key1')).toBe('value1');
        });
        (0, vitest_1.it)('should return null for non-existent keys', () => {
            (0, vitest_1.expect)(cache.get('missing')).toBeNull();
        });
        (0, vitest_1.it)('should overwrite existing values', () => {
            cache.set('key1', 'original');
            cache.set('key1', 'updated');
            (0, vitest_1.expect)(cache.get('key1')).toBe('updated');
        });
        (0, vitest_1.it)('should expire values after TTL', () => {
            cache.set('key1', 'value1', 10); // 10 seconds TTL
            (0, vitest_1.expect)(cache.get('key1')).toBe('value1');
            vitest_1.vi.advanceTimersByTime(11000); // 11 seconds
            (0, vitest_1.expect)(cache.get('key1')).toBeNull();
        });
        (0, vitest_1.it)('should use default TTL of 3600 seconds', () => {
            cache.set('key1', 'value1');
            // Should still be available before 3600s
            vitest_1.vi.advanceTimersByTime(3500000); // 3500 seconds
            (0, vitest_1.expect)(cache.get('key1')).toBe('value1');
            // Should expire after 3600s
            vitest_1.vi.advanceTimersByTime(200000); // +200s = 3700s total
            (0, vitest_1.expect)(cache.get('key1')).toBeNull();
        });
    });
    (0, vitest_1.describe)('del', () => {
        (0, vitest_1.it)('should delete a key', () => {
            cache.set('key1', 'value1');
            cache.del('key1');
            (0, vitest_1.expect)(cache.get('key1')).toBeNull();
        });
        (0, vitest_1.it)('should be safe to delete non-existent keys', () => {
            (0, vitest_1.expect)(() => cache.del('missing')).not.toThrow();
        });
    });
    (0, vitest_1.describe)('incrBy', () => {
        (0, vitest_1.it)('should increment from zero for new keys', () => {
            (0, vitest_1.expect)(cache.incrBy('counter', 5)).toBe(5);
        });
        (0, vitest_1.it)('should increment existing values', () => {
            cache.set('counter', '10');
            (0, vitest_1.expect)(cache.incrBy('counter', 3)).toBe(13);
        });
        (0, vitest_1.it)('should handle negative increments', () => {
            cache.set('counter', '10');
            (0, vitest_1.expect)(cache.incrBy('counter', -3)).toBe(7);
        });
    });
    (0, vitest_1.describe)('hash operations', () => {
        (0, vitest_1.describe)('hGet/hSet', () => {
            (0, vitest_1.it)('should set and get hash fields', () => {
                cache.hSet('user', 'name', 'Alice');
                (0, vitest_1.expect)(cache.hGet('user', 'name')).toBe('Alice');
            });
            (0, vitest_1.it)('should return null for non-existent fields', () => {
                (0, vitest_1.expect)(cache.hGet('user', 'missing')).toBeNull();
            });
            (0, vitest_1.it)('should return null for non-existent hash', () => {
                (0, vitest_1.expect)(cache.hGet('missing', 'field')).toBeNull();
            });
            (0, vitest_1.it)('should support multiple fields', () => {
                cache.hSet('user', 'name', 'Alice');
                cache.hSet('user', 'age', '30');
                (0, vitest_1.expect)(cache.hGet('user', 'name')).toBe('Alice');
                (0, vitest_1.expect)(cache.hGet('user', 'age')).toBe('30');
            });
        });
        (0, vitest_1.describe)('hIncrBy', () => {
            (0, vitest_1.it)('should increment from zero for new fields', () => {
                (0, vitest_1.expect)(cache.hIncrBy('stats', 'views', 1)).toBe(1);
            });
            (0, vitest_1.it)('should increment existing fields', () => {
                cache.hSet('stats', 'views', '10');
                (0, vitest_1.expect)(cache.hIncrBy('stats', 'views', 5)).toBe(15);
            });
        });
        (0, vitest_1.describe)('hGetAll', () => {
            (0, vitest_1.it)('should return all fields', () => {
                cache.hSet('user', 'name', 'Alice');
                cache.hSet('user', 'age', '30');
                const all = cache.hGetAll('user');
                (0, vitest_1.expect)(all).toEqual({ name: 'Alice', age: '30' });
            });
            (0, vitest_1.it)('should return empty object for non-existent hash', () => {
                (0, vitest_1.expect)(cache.hGetAll('missing')).toEqual({});
            });
        });
    });
    (0, vitest_1.describe)('expire', () => {
        (0, vitest_1.it)('should update TTL for existing key', () => {
            cache.set('key1', 'value1', 5); // 5 second TTL
            cache.expire('key1', 60); // extend to 60 seconds
            vitest_1.vi.advanceTimersByTime(10000); // 10 seconds
            (0, vitest_1.expect)(cache.get('key1')).toBe('value1'); // still alive
        });
        (0, vitest_1.it)('should expire after new TTL', () => {
            cache.set('key1', 'value1', 60);
            cache.expire('key1', 2); // reduce to 2 seconds
            vitest_1.vi.advanceTimersByTime(3000); // 3 seconds
            (0, vitest_1.expect)(cache.get('key1')).toBeNull();
        });
        (0, vitest_1.it)('should be safe for non-existent keys', () => {
            (0, vitest_1.expect)(() => cache.expire('missing', 10)).not.toThrow();
        });
    });
    (0, vitest_1.describe)('flush', () => {
        (0, vitest_1.it)('should clear all data', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.hSet('hash1', 'field', 'value');
            cache.flush();
            (0, vitest_1.expect)(cache.get('key1')).toBeNull();
            (0, vitest_1.expect)(cache.get('key2')).toBeNull();
            (0, vitest_1.expect)(cache.hGet('hash1', 'field')).toBeNull();
        });
    });
    (0, vitest_1.describe)('auto-cleanup', () => {
        (0, vitest_1.it)('should remove expired entries from store', () => {
            cache.set('temp', 'data', 1);
            vitest_1.vi.advanceTimersByTime(1500); // past expiry
            // Entry should be cleaned up — get returns null
            (0, vitest_1.expect)(cache.get('temp')).toBeNull();
        });
    });
    (0, vitest_1.describe)('LRU eviction', () => {
        (0, vitest_1.it)('should evict least-recently-used entries when maxSize is reached', () => {
            const lruCache = new cache_js_1.MemoryCache(3);
            lruCache.set('a', '1');
            lruCache.set('b', '2');
            lruCache.set('c', '3');
            // Adding a 4th entry should evict 'a' (LRU)
            lruCache.set('d', '4');
            (0, vitest_1.expect)(lruCache.get('a')).toBeNull();
            (0, vitest_1.expect)(lruCache.get('b')).toBe('2');
            (0, vitest_1.expect)(lruCache.get('c')).toBe('3');
            (0, vitest_1.expect)(lruCache.get('d')).toBe('4');
            lruCache.destroy();
        });
        (0, vitest_1.it)('should promote accessed entries and evict truly LRU ones', () => {
            const lruCache = new cache_js_1.MemoryCache(3);
            lruCache.set('a', '1');
            lruCache.set('b', '2');
            lruCache.set('c', '3');
            // Access 'a' to promote it to MRU
            lruCache.get('a');
            // Now 'b' is LRU; adding 'd' should evict 'b'
            lruCache.set('d', '4');
            (0, vitest_1.expect)(lruCache.get('a')).toBe('1');
            (0, vitest_1.expect)(lruCache.get('b')).toBeNull();
            (0, vitest_1.expect)(lruCache.get('c')).toBe('3');
            (0, vitest_1.expect)(lruCache.get('d')).toBe('4');
            lruCache.destroy();
        });
        (0, vitest_1.it)('should update LRU position on set() for existing key', () => {
            const lruCache = new cache_js_1.MemoryCache(3);
            lruCache.set('a', '1');
            lruCache.set('b', '2');
            lruCache.set('c', '3');
            // Overwrite 'a' — should promote it to MRU
            lruCache.set('a', '1-updated');
            // Now 'b' is LRU; adding 'd' should evict 'b'
            lruCache.set('d', '4');
            (0, vitest_1.expect)(lruCache.get('a')).toBe('1-updated');
            (0, vitest_1.expect)(lruCache.get('b')).toBeNull();
            lruCache.destroy();
        });
    });
    (0, vitest_1.describe)('namespaced cache', () => {
        (0, vitest_1.it)('should isolate keys by namespace', () => {
            const ns1 = (0, cache_js_1.createNamespacedCache)('ns1');
            const ns2 = (0, cache_js_1.createNamespacedCache)('ns2');
            ns1.set('key', 'value1');
            ns2.set('key', 'value2');
            (0, vitest_1.expect)(ns1.get('key')).toBe('value1');
            (0, vitest_1.expect)(ns2.get('key')).toBe('value2');
        });
        (0, vitest_1.it)('should share the same backing store', () => {
            const ns = (0, cache_js_1.createNamespacedCache)('test', cache);
            ns.set('shared', 'data');
            // The backing cache should see it with the namespace prefix
            (0, vitest_1.expect)(cache.get('test:shared')).toBe('data');
        });
        (0, vitest_1.it)('should support hash operations with namespaces', () => {
            const ns = (0, cache_js_1.createNamespacedCache)('h');
            ns.hSet('user', 'name', 'Alice');
            (0, vitest_1.expect)(ns.hGet('user', 'name')).toBe('Alice');
            (0, vitest_1.expect)(ns.hGetAll('user')).toEqual({ name: 'Alice' });
            ns.del('user');
            (0, vitest_1.expect)(ns.hGet('user', 'name')).toBeNull();
        });
    });
});
//# sourceMappingURL=memory-cache.test.js.map