import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, getDb, closeDb, createNamespacedCache } from '@dmr-x/db';
import { UsageTracker, usageTracker } from '../../services/billing/src/usage-tracker.js';

const cache = createNamespacedCache('usage');

// Direct access to the underlying MemoryCache so tests can probe TTL behavior
// via the same backing store that UsageTracker writes to.
const { cache: underlyingCache } = await import('@dmr-x/db');

const RT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DAILY_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const MONTHLY_TTL_SECONDS = 365 * 24 * 60 * 60; // 365 days

const SEVEN_DAYS_MS = RT_TTL_SECONDS * 1000;
const NINETY_DAYS_MS = DAILY_TTL_SECONDS * 1000;
const THREE_SIXTY_FIVE_DAYS_MS = MONTHLY_TTL_SECONDS * 1000;

function insertTenant(id: string, name: string): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)').run(id, name);
}

describe('UsageTracker', () => {
  let tempDir: string;
  let originalDataDir: string | undefined;
  let tracker: UsageTracker;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dmrx-usage-tracker-'));
    originalDataDir = process.env.DMRX_DATA_DIR;
    process.env.DMRX_DATA_DIR = tempDir;
    await initDb();
    tracker = new UsageTracker();
  });

  afterAll(async () => {
    // Flush the shared usage:* cache namespace so subsequent test files
    // (e.g. tests/unit/memory-cache.test.ts) don't see leftover entries.
    cache.flush();
    await closeDb();
    if (originalDataDir === undefined) {
      delete process.env.DMRX_DATA_DIR;
    } else {
      process.env.DMRX_DATA_DIR = originalDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clear the shared `usage:*` namespace so each test sees a clean cache.
    cache.flush();
    insertTenant('tenant-test-1', 'Test Tenant');
    // Also clear the SQLite usage_records table so queryRecords starts from empty.
    getDb().prepare('DELETE FROM usage_records').run();
  });

  describe('record()', () => {
    it('populates createdAt on the returned record (no post-INSERT SELECT)', () => {
      const before = Date.now();
      const result = tracker.record({
        tenantId: 'tenant-test-1',
        providerId: 'openai',
        modelId: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        costCents: 1,
        requestId: 'req-1',
      });
      expect(result.id).toBeTruthy();
      expect(result.createdAt).toBeTruthy();
      // Format is "YYYY-MM-DD HH:MM:SS" in local time — must match exactly
      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      // Parse as local time (no timezone suffix — the format is naive local time)
      const ts = Date.parse(result.createdAt.replace(' ', 'T'));
      expect(Number.isNaN(ts)).toBe(false);
      // The recorded timestamp should be within 5 seconds of "now" (allowing for
      // small execution drift, including the prior DELETE on the table).
      expect(Math.abs(before - ts)).toBeLessThan(5_000);
    });

    it('persists the record to SQLite so queryRecords can find it', () => {
      const result = tracker.record({
        tenantId: 'tenant-test-1',
        providerId: 'openai',
        modelId: 'gpt-4',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        costCents: 5,
        requestId: 'req-persist-1',
      });
      const rows = tracker.queryRecords({ tenantId: 'tenant-test-1' });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(result.id);
      expect(rows[0].requestId).toBe('req-persist-1');
    });

    it('increments the real-time cache counters for tenant + provider + model', () => {
      tracker.record({
        tenantId: 'tenant-test-1',
        providerId: 'openai',
        modelId: 'gpt-4',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        costCents: 5,
        requestId: 'req-rt-1',
      });
      const rt = tracker.getRealtimeUsage('tenant-test-1', 'openai', 'gpt-4');
      expect(rt.requests).toBe(1);
      expect(rt.inputTokens).toBe(10);
      expect(rt.outputTokens).toBe(20);
      expect(rt.totalTokens).toBe(30);
      expect(rt.costCents).toBe(5);
    });

    it('increments the global real-time counter for the tenant', () => {
      tracker.record({
        tenantId: 'tenant-test-1',
        providerId: 'openai',
        modelId: 'gpt-4',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costCents: 1,
        requestId: 'req-global-1',
      });
      tracker.record({
        tenantId: 'tenant-test-1',
        providerId: 'anthropic',
        modelId: 'claude-3',
        inputTokens: 5,
        outputTokens: 5,
        totalTokens: 10,
        costCents: 2,
        requestId: 'req-global-2',
      });
      const global = tracker.getRealtimeUsage('tenant-test-1');
      expect(global.requests).toBe(2);
      expect(global.totalTokens).toBe(12);
      expect(global.costCents).toBe(3);
    });
  });

  describe('TTL behavior', () => {
    it('sets the real-time key TTL to ≤ 7 days + 1 minute', () => {
      vi.useFakeTimers();
      try {
        const before = Date.now();
        tracker.record({
          tenantId: 'tenant-test-1',
          providerId: 'openai',
          modelId: 'gpt-4',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          costCents: 1,
          requestId: 'req-ttl-1',
        });
        // The RT key is `rt:<tenant>:<provider>:<model>`. Read the underlying
        // hash TTL via the same backing MemoryCache the tracker uses.
        // MemoryCache stores hashTTLs in a private map — we cast to access.
        const internalTtl = (underlyingCache as unknown as { hashTTLs: Map<string, number> })
          .hashTTLs.get('usage:rt:tenant-test-1:openai:gpt-4');
        expect(internalTtl).toBeDefined();
        const elapsedMs = internalTtl! - before;
        // Allow a 1-minute jitter for the time it took to execute record()
        const sevenDaysOneMinMs = SEVEN_DAYS_MS + 60_000;
        expect(elapsedMs).toBeLessThanOrEqual(sevenDaysOneMinMs);
        // And the TTL must be at least 7 days (the recorded constant)
        expect(elapsedMs).toBeGreaterThanOrEqual(SEVEN_DAYS_MS - 60_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('sets the daily key TTL to approximately 90 days', () => {
      vi.useFakeTimers();
      try {
        const before = Date.now();
        tracker.record({
          tenantId: 'tenant-test-1',
          providerId: 'openai',
          modelId: 'gpt-4',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          costCents: 1,
          requestId: 'req-ttl-daily',
        });
        const day = new Date();
        const dayStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const internalTtl = (underlyingCache as unknown as { hashTTLs: Map<string, number> })
          .hashTTLs.get(`usage:daily:tenant-test-1:${dayStr}`);
        expect(internalTtl).toBeDefined();
        const elapsedMs = internalTtl! - before;
        // Allow a 1-minute jitter
        expect(elapsedMs).toBeGreaterThanOrEqual(NINETY_DAYS_MS - 60_000);
        expect(elapsedMs).toBeLessThanOrEqual(NINETY_DAYS_MS + 60_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('sets the monthly key TTL to approximately 365 days', () => {
      vi.useFakeTimers();
      try {
        const before = Date.now();
        tracker.record({
          tenantId: 'tenant-test-1',
          providerId: 'openai',
          modelId: 'gpt-4',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          costCents: 1,
          requestId: 'req-ttl-monthly',
        });
        const month = new Date();
        const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
        const internalTtl = (underlyingCache as unknown as { hashTTLs: Map<string, number> })
          .hashTTLs.get(`usage:monthly:tenant-test-1:${monthStr}`);
        expect(internalTtl).toBeDefined();
        const elapsedMs = internalTtl! - before;
        expect(elapsedMs).toBeGreaterThanOrEqual(THREE_SIXTY_FIVE_DAYS_MS - 60_000);
        expect(elapsedMs).toBeLessThanOrEqual(THREE_SIXTY_FIVE_DAYS_MS + 60_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('expires the RT key after 7 days + 1 minute has elapsed (behavioral)', () => {
      // Behavioral test: after the TTL elapses, hGet returns null.
      vi.useFakeTimers();
      try {
        tracker.record({
          tenantId: 'tenant-test-1',
          providerId: 'openai',
          modelId: 'gpt-4',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          costCents: 1,
          requestId: 'req-expire-rt',
        });
        // Just before the TTL — data is still there
        vi.setSystemTime(Date.now() + SEVEN_DAYS_MS - 1000);
        expect(cache.hGet('rt:tenant-test-1:openai:gpt-4', 'requests')).toBe('1');

        // Advance past the TTL
        vi.setSystemTime(Date.now() + 2000);
        expect(cache.hGet('rt:tenant-test-1:openai:gpt-4', 'requests')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('singleton export', () => {
    it('exposes a default usageTracker instance', () => {
      expect(usageTracker).toBeInstanceOf(UsageTracker);
    });
  });
});
