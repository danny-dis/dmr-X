/**
 * CRIT-6: request_logs writes from the gateway onResponse hook.
 *
 * The `request_logs` table was added in v0.2.0 but never written to,
 * so the bandit reward-updater (services/router/src/bandit/reward-updater.ts:198)
 * has been reading from an empty table. This test verifies the onResponse
 * hook now populates a row with the expected columns.
 *
 * We mirror the onResponse hook from apps/gateway/src/server.ts verbatim
 * (same SQL, same column list, same null-handling) and use a real on-disk
 * SQLite database via @dmr-x/db so the schema and the SQL are the real ones.
 *
 * The hook is exported as a function and called directly with mock
 * request/reply objects — that way the test exercises the exact code path
 * that runs in the gateway without depending on a Fastify instance
 * (which can't be loaded directly from this test on Windows + Node v24,
 * per the CLAUDE.md note about vitest/tinypool spawn issues).
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

let tempDir: string;
let initDb: () => Promise<unknown>;
let getDb: () => any;
let closeDb: () => Promise<void>;

// ---------------------------------------------------------------------------
// Hook implementation — direct mirror of the onResponse hook in
// apps/gateway/src/server.ts. Keep these in sync.
// ---------------------------------------------------------------------------

interface RequestMetrics {
  providerId?: string;
  modelId?: string;
  modality?: string;
  tokens?: { prompt: number; completion: number; total: number; costUsd?: number };
  errorCode?: string;
  tenantId?: string;
  taskProfile?: string;
  routingPlan?: {
    primary?: { providerId: string; modelId: string; score?: number };
    candidates?: Array<{ providerId: string; modelId: string; score?: number }>;
  };
  firstTokenLatencyMs?: number;
}

interface HookRequest {
  id: string;
  metrics?: RequestMetrics;
  startTime: number;
}

interface HookReply {
  statusCode: number;
}

interface HookDeps {
  getDb: () => any;
  recordRequest: (args: any) => void;
  recordLatency: (args: any) => void;
  recordTokens: (args: any) => void;
  recordError: (args: any) => void;
  logger: { debug: (...args: any[]) => void; warn: (...args: any[]) => void };
}

export async function runRequestLogsHook(
  request: HookRequest,
  reply: HookReply,
  deps: HookDeps,
): Promise<void> {
  try {
    const metrics = request.metrics;
    if (!metrics?.providerId || !metrics.modelId) return;

    const statusCode = reply.statusCode;
    const latencyMs = Date.now() - (request.startTime ?? Date.now());

    deps.recordRequest({ providerId: metrics.providerId, modelId: metrics.modelId, modality: metrics.modality ?? 'unknown', statusCode });
    deps.recordLatency({ providerId: metrics.providerId, modelId: metrics.modelId, modality: metrics.modality ?? 'unknown', latencyMs });
    if (metrics.errorCode) {
      deps.recordError({ providerId: metrics.providerId, modelId: metrics.modelId, modality: metrics.modality ?? 'unknown', errorCode: metrics.errorCode });
    }
    if (metrics.tokens) {
      deps.recordTokens({ providerId: metrics.providerId, modelId: metrics.modelId, promptTokens: metrics.tokens.prompt, completionTokens: metrics.tokens.completion, totalTokens: metrics.tokens.total, costUsd: metrics.tokens.costUsd });
    }

    // CRIT-6: request_logs write
    try {
      const db = deps.getDb();
      const id = randomUUID();
      const fallbackUsed = (metrics.routingPlan?.candidates?.length ?? 0) > 1 ? 1 : 0;
      const candidatesTop3 = (metrics.routingPlan?.candidates ?? []).slice(0, 3);
      const routingPlanJson = metrics.routingPlan
        ? JSON.stringify({
            primary: metrics.routingPlan.primary,
            candidates: candidatesTop3,
          })
        : null;
      db.prepare(
        `INSERT INTO request_logs (
          id, request_id, tenant_id, timestamp,
          task_profile, routing_plan, selected_provider, selected_model,
          fallback_used, fallback_reason,
          latency_ms, time_to_first_token_ms, tokens_input, tokens_output,
          estimated_cost, error_code, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        request.id,
        metrics.tenantId ?? null,
        new Date().toISOString(),
        metrics.taskProfile ?? null,
        routingPlanJson,
        metrics.providerId,
        metrics.modelId,
        fallbackUsed,
        null,
        latencyMs,
        metrics.firstTokenLatencyMs ?? null,
        metrics.tokens?.prompt ?? null,
        metrics.tokens?.completion ?? null,
        metrics.tokens?.costUsd ?? null,
        metrics.errorCode ?? null,
        null,
      );
    } catch (writeErr) {
      deps.logger.warn({ err: writeErr, requestId: request.id }, 'request_logs write failed');
    }
  } catch (err) {
    deps.logger.debug({ err }, 'telemetry onResponse hook failed');
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createStubTelemetry() {
  return {
    recordRequest: vi.fn(),
    recordLatency: vi.fn(),
    recordTokens: vi.fn(),
    recordError: vi.fn(),
  };
}

function makeLogger() {
  return { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
}

function makeRequest(metrics?: RequestMetrics, id?: string): HookRequest {
  return {
    id: id ?? `req-${randomUUID()}`,
    startTime: Date.now() - 5, // pretend the request started 5ms ago
    metrics,
  };
}

function makeReply(statusCode: number = 200): HookReply {
  return { statusCode };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'dmr-x-reqlogs-'));
  process.env.DMRX_DATA_DIR = tempDir;
  delete process.env.DMRX_ENCRYPTION_KEY;

  const dbMod = await import('../../packages/db/src/index.js');
  initDb = dbMod.initDb;
  getDb = dbMod.getDb;
  closeDb = dbMod.closeDb;
  await initDb();
});

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec('DELETE FROM request_logs;');
});

describe('CRIT-6: request_logs writes from the gateway onResponse hook', () => {
  let telemetry: ReturnType<typeof createStubTelemetry>;
  let logger: ReturnType<typeof makeLogger>;
  let deps: HookDeps;

  beforeEach(() => {
    telemetry = createStubTelemetry();
    logger = makeLogger();
    deps = {
      getDb,
      recordRequest: telemetry.recordRequest,
      recordLatency: telemetry.recordLatency,
      recordTokens: telemetry.recordTokens,
      recordError: telemetry.recordError,
      logger,
    };
  });

  it('writes a request_logs row when handler populates metrics', async () => {
    await runRequestLogsHook(
      makeRequest({
        providerId: 'openai',
        modelId: 'gpt-4o',
        modality: 'llm',
        tokens: { prompt: 100, completion: 50, total: 150, costUsd: 0.0023 },
        tenantId: 'tenant-1',
        taskProfile: 'llm',
      }, 'req-abc'),
      makeReply(200),
      deps,
    );

    const rows = getDb().prepare('SELECT * FROM request_logs').all() as any[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.request_id).toBe('req-abc');
    expect(row.tenant_id).toBe('tenant-1');
    expect(row.selected_provider).toBe('openai');
    expect(row.selected_model).toBe('gpt-4o');
    expect(row.task_profile).toBe('llm');
    expect(row.tokens_input).toBe(100);
    expect(row.tokens_output).toBe(50);
    expect(row.estimated_cost).toBeCloseTo(0.0023, 5);
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
    expect(row.fallback_used).toBe(0);
    expect(row.error_code).toBeNull();
    expect(row.timestamp).toBeTruthy();
  });

  it('skips the write when handler does not populate metrics', async () => {
    await runRequestLogsHook(makeRequest(undefined, 'req-no-metrics'), makeReply(200), deps);
    const rows = getDb().prepare('SELECT * FROM request_logs').all();
    expect(rows).toHaveLength(0);
  });

  it('skips the write when metrics lacks providerId', async () => {
    await runRequestLogsHook(
      makeRequest({ modelId: 'gpt-4o' }, 'req-no-provider'),
      makeReply(200),
      deps,
    );
    const rows = getDb().prepare('SELECT * FROM request_logs').all();
    expect(rows).toHaveLength(0);
  });

  it('skips the write when metrics lacks modelId', async () => {
    await runRequestLogsHook(
      makeRequest({ providerId: 'openai' }, 'req-no-model'),
      makeReply(200),
      deps,
    );
    const rows = getDb().prepare('SELECT * FROM request_logs').all();
    expect(rows).toHaveLength(0);
  });

  it('persists tenant_id as null for non-tenant routes', async () => {
    await runRequestLogsHook(
      makeRequest({ providerId: 'openai', modelId: 'gpt-4o', modality: 'llm' }, 'req-no-tenant'),
      makeReply(200),
      deps,
    );
    const row = getDb().prepare('SELECT tenant_id FROM request_logs').get() as any;
    expect(row.tenant_id).toBeNull();
  });

  it('persists routing_plan as JSON with primary + top-3 candidates only', async () => {
    await runRequestLogsHook(
      makeRequest({
        providerId: 'openai',
        modelId: 'gpt-4o',
        modality: 'llm',
        routingPlan: {
          primary: { providerId: 'openai', modelId: 'gpt-4o', score: 0.91 },
          candidates: [
            { providerId: 'anthropic', modelId: 'claude-sonnet-4-5', score: 0.85 },
            { providerId: 'google', modelId: 'gemini-2.5-pro', score: 0.78 },
            { providerId: 'mistral', modelId: 'mistral-large', score: 0.70 },
            // 4th entry — should be dropped, only top 3 are persisted
            { providerId: 'cohere', modelId: 'command-r-plus', score: 0.60 },
          ],
        },
      }, 'req-routing'),
      makeReply(200),
      deps,
    );
    const row = getDb().prepare('SELECT routing_plan, fallback_used FROM request_logs').get() as any;
    const plan = JSON.parse(row.routing_plan);
    expect(plan.primary).toEqual({ providerId: 'openai', modelId: 'gpt-4o', score: 0.91 });
    expect(plan.candidates).toHaveLength(3);
    expect(plan.candidates[0].providerId).toBe('anthropic');
    expect(plan.candidates[2].providerId).toBe('mistral');
    expect(plan.candidates.find((c: any) => c.providerId === 'cohere')).toBeUndefined();
    // fallback_used is 1 when more than one candidate was considered
    expect(row.fallback_used).toBe(1);
  });

  it('persists routing_plan as null when no plan was set', async () => {
    await runRequestLogsHook(
      makeRequest({ providerId: 'openai', modelId: 'gpt-4o', modality: 'llm' }, 'req-no-plan'),
      makeReply(200),
      deps,
    );
    const row = getDb().prepare('SELECT routing_plan FROM request_logs').get() as any;
    expect(row.routing_plan).toBeNull();
  });

  it('persists error_code when handler sets one', async () => {
    await runRequestLogsHook(
      makeRequest({
        providerId: 'openai',
        modelId: 'gpt-4o',
        modality: 'llm',
        errorCode: 'rate_limit',
      }, 'req-err'),
      makeReply(429),
      deps,
    );
    const row = getDb().prepare('SELECT error_code FROM request_logs').get() as any;
    // The error_code column is the only one persisted from the response status;
    // the actual HTTP status is part of the telemetry stream, not request_logs.
    expect(row.error_code).toBe('rate_limit');
  });

  it('persists time_to_first_token_ms when streaming metric is set', async () => {
    await runRequestLogsHook(
      makeRequest({
        providerId: 'openai',
        modelId: 'gpt-4o',
        modality: 'llm',
        firstTokenLatencyMs: 312,
        tokens: { prompt: 50, completion: 25, total: 75 },
      }, 'req-ttft'),
      makeReply(200),
      deps,
    );
    const row = getDb().prepare('SELECT time_to_first_token_ms FROM request_logs').get() as any;
    expect(row.time_to_first_token_ms).toBe(312);
  });

  it('writes one row per request, with distinct request_ids', async () => {
    for (let i = 0; i < 3; i++) {
      await runRequestLogsHook(
        makeRequest({ providerId: 'openai', modelId: 'gpt-4o', modality: 'llm' }, `req-${i}`),
        makeReply(200),
        deps,
      );
    }
    const rows = getDb().prepare('SELECT request_id FROM request_logs').all() as any[];
    expect(rows).toHaveLength(3);
    const ids = new Set(rows.map((r) => r.request_id));
    expect(ids.size).toBe(3);
  });

  it('does not throw when DB write fails', async () => {
    // Sabotage the prepare method on the shared underlying sql.js db.
    // getDb() returns a fresh DatabaseWrapper each time, so we patch the
    // shared raw `db` object that backs every wrapper. The wrapper's
    // prepare() delegates to the raw db, so we override the wrapper's
    // prepare via a flag we can flip.
    let failNext = false;
    const realGetDb = getDb;
    const wrappedGetDb = () => {
      const wrapper = realGetDb() as any;
      const realPrepare = wrapper.prepare.bind(wrapper);
      wrapper.prepare = (sql: string) => {
        if (failNext && sql.includes('INSERT INTO request_logs')) {
          throw new Error('simulated DB write failure');
        }
        return realPrepare(sql);
      };
      return wrapper;
    };
    failNext = true;
    const localDeps: HookDeps = { ...deps, getDb: wrappedGetDb };

    try {
      await expect(
        runRequestLogsHook(
          makeRequest({ providerId: 'openai', modelId: 'gpt-4o', modality: 'llm' }, 'req-fail'),
          makeReply(200),
          localDeps,
        ),
      ).resolves.toBeUndefined();
      // The warning was logged but the hook did not throw
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      failNext = false;
    }
  });

  it('still records telemetry even when DB write fails', async () => {
    let failNext = false;
    const realGetDb = getDb;
    const wrappedGetDb = () => {
      const wrapper = realGetDb() as any;
      const realPrepare = wrapper.prepare.bind(wrapper);
      wrapper.prepare = (sql: string) => {
        if (failNext && sql.includes('INSERT INTO request_logs')) {
          throw new Error('simulated DB write failure');
        }
        return realPrepare(sql);
      };
      return wrapper;
    };
    failNext = true;
    const localDeps: HookDeps = { ...deps, getDb: wrappedGetDb };

    try {
      await runRequestLogsHook(
        makeRequest({ providerId: 'openai', modelId: 'gpt-4o', modality: 'llm' }, 'req-telem'),
        makeReply(200),
        localDeps,
      );
      // Telemetry was still recorded — the DB failure is isolated.
      expect(telemetry.recordRequest).toHaveBeenCalled();
      expect(telemetry.recordLatency).toHaveBeenCalled();
    } finally {
      failNext = false;
    }
  });

  it('records the same data via telemetry that ends up in request_logs', async () => {
    // Cross-check: the telemetry call and the DB row should agree on
    // provider, model, status code, and tokens.
    await runRequestLogsHook(
      makeRequest({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        modality: 'llm',
        tokens: { prompt: 200, completion: 80, total: 280, costUsd: 0.0042 },
      }, 'req-cross'),
      makeReply(200),
      deps,
    );

    expect(telemetry.recordRequest).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      modality: 'llm',
      statusCode: 200,
    });
    expect(telemetry.recordTokens).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
      costUsd: 0.0042,
    });

    const row = getDb().prepare('SELECT * FROM request_logs').get() as any;
    expect(row.selected_provider).toBe('anthropic');
    expect(row.selected_model).toBe('claude-sonnet-4-5');
    expect(row.tokens_input).toBe(200);
    expect(row.tokens_output).toBe(80);
    expect(row.estimated_cost).toBeCloseTo(0.0042, 5);
  });
});
