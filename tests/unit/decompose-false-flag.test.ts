import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';

import { Router } from '../../services/router/src/router.service.js';
import { GuardrailEngine } from '../../services/router/src/guardrails/guardrail-engine.js';
import { TaskDecomposer } from '../../services/router/src/decomposer/task-decomposer.js';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';
import { semanticCacheService } from '@dmr-x/cache';

/**
 * Live planner root-cause: POST /v1/jobs/:id/plan invokes chat with a large
 * roster; Router.route decomposes the complex prompt, composite fans out to
 * unavailable providers, returns HTTP 200 with empty content → planner 422.
 * Short auto-smart chat (not complex enough) returns 200 text OK.
 *
 * Fix contract (strict TDD):
 *   1. Default complex requests still decompose (behavior preserved).
 *   2. Explicit `decompose: false` in the chat body is validated by
 *      ChatRequestSchema and reaches the router as
 *      metadata.skipDecomposition === true; Router.route then skips
 *      decomposition when that flag is true.
 *   3. planJob sends `decompose: false` on its /v1/chat/completions body.
 */

// ── fixtures: Router ────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateSet[0]> = {}): CandidateSet[0] {
  return {
    providerId: 'test-provider',
    providerName: 'test',
    modelId: 'test-model',
    modality: 'llm',
    intelligenceLayer: 'executor',
    capabilityTier: 'executor',
    capabilities: ['general'],
    costPerInputToken: 0,
    costPerOutputToken: 0,
    costPerImage: 0,
    avgLatencyMs: 1000,
    qualityScore: 0.8,
    isHealthy: true,
    ...overrides,
  };
}

function makeDecomposingRouter(candidates: CandidateSet) {
  const router = new Router(); // default config — enableDecomposition defaults on
  router.setGuardrailEngine(new GuardrailEngine({ enableInput: false, enableOutput: false }));
  router.setCandidates(candidates);
  const calls: Array<{ providerId: string; modelId: string }> = [];
  router.setAdapterExecutor({
    execute: async (providerId: string, modelId: string): Promise<UnifiedResponse> => {
      calls.push({ providerId, modelId });
      return {
        modality: 'llm',
        requestId: 'test',
        providerId,
        modelId,
        message: { role: 'assistant', content: 'ok' },
        latencyMs: 1,
      };
    },
  });
  return { router, calls };
}

/**
 * Long enough (≥100 chars) and hits 2+ task indicators in isComplexPrompt
 * (frontend, backend, api, database, schema, test, deploy, docker, …).
 */
const COMPLEX_PROMPT =
  'Please build the frontend React UI and the backend Node API with a database schema, ' +
  'write unit tests, and deploy the whole stack to Docker on the server.';

function makeComplexRequest(metadata: Record<string, unknown> = {}): UnifiedRequest {
  return {
    modality: 'llm',
    model: 'general-chat',
    messages: [{ role: 'user', content: COMPLEX_PROMPT }] as any,
    stream: false,
    metadata,
  };
}

const ROUTE_OPTS = { path: '/v1/chat/completions', qualityTarget: 'balanced' as const };

// ── fixtures: planJob / fetch (same shape as job-planner-empty-reply) ──────

type FetchInit = RequestInit | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(handler: (url: string, init?: FetchInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: FetchInit }> = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init as FetchInit | undefined);
  });
  return { calls, spy };
}

function bodyOf(init?: FetchInit): any {
  if (typeof init?.body !== 'string') return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

const PLAN_JSON = JSON.stringify({
  tasks: [{ ref: 't1', title: 'Design', description: 'd', dependsOn: [] }],
});

// ── 1 + Router gate: default still decomposes; skipDecomposition opts out ──

describe('Router.route decomposition gate', () => {
  let decomposeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    decomposeSpy = vi.spyOn(TaskDecomposer.prototype, 'decompose');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Characterization: the CRITICAL-risk default must stay exactly as-is.
  // Without this, a gate that always skips would "fix" the planner by
  // disabling decomposition for every caller.
  it('still decomposes a complex request when metadata.skipDecomposition is absent', async () => {
    const { router } = makeDecomposingRouter([
      makeCandidate({ providerId: 'a-uuid', providerName: 'provider-a', modelId: 'model-a' }),
    ]);

    const { plan } = await router.route(makeComplexRequest({}), ROUTE_OPTS);

    expect(decomposeSpy).toHaveBeenCalledTimes(1);
    expect(plan.primary.providerId).toBe('dmr-x-composite');
  });

  it('skips decomposition when metadata.skipDecomposition === true', async () => {
    const { router } = makeDecomposingRouter([
      makeCandidate({ providerId: 'a-uuid', providerName: 'provider-a', modelId: 'model-a' }),
    ]);

    const { plan } = await router.route(
      makeComplexRequest({ skipDecomposition: true }),
      ROUTE_OPTS,
    );

    expect(decomposeSpy).not.toHaveBeenCalled();
    expect(plan.primary.providerId).not.toBe('dmr-x-composite');
    expect(plan.primary.providerId).toBe('a-uuid');
  });

  // Only the explicit boolean true skips — any other value keeps the default.
  it('still decomposes when skipDecomposition is not true (false / string / 0)', async () => {
    for (const value of [false, 'true', 0, null]) {
      decomposeSpy.mockClear();
      const { router } = makeDecomposingRouter([
        makeCandidate({ providerId: 'a-uuid', providerName: 'provider-a', modelId: 'model-a' }),
      ]);
      const { plan } = await router.route(
        makeComplexRequest({ skipDecomposition: value }),
        ROUTE_OPTS,
      );
      expect(decomposeSpy, `value=${String(value)}`).toHaveBeenCalledTimes(1);
      expect(plan.primary.providerId, `value=${String(value)}`).toBe('dmr-x-composite');
    }
  });
});

// ── 2: chat schema → router metadata ───────────────────────────────────────

describe('chat schema: decompose:false reaches the router', () => {
  let app: FastifyInstance;
  let captured: UnifiedRequest[];
  let responseContent: string;

  beforeEach(async () => {
    captured = [];
    responseContent = 'ok';
    app = Fastify({ logger: false });
    app.decorate('router', {
      route: async (request: UnifiedRequest) => {
        captured.push(request);
        return {
          plan: {
            primary: {
              providerId: 'prov-1',
              modelId: 'model-1',
              adapterType: 'openai',
              score: 1,
            },
            chain: [],
            timeoutMs: 30_000,
            maxRetries: 1,
          },
          response: {
            modality: 'llm',
            requestId: 'req-1',
            providerId: 'prov-1',
            modelId: 'model-1',
            message: { role: 'assistant', content: responseContent },
            latencyMs: 5,
            finishReason: 'stop',
          } as UnifiedResponse,
        };
      },
      getCandidates: () => [],
    });
    await app.register(chatRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('accepts decompose:false and sets metadata.skipDecomposition === true on the UnifiedRequest', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      // temperature disables the route cache so we always hit router.route.
      payload: {
        model: 'general-chat',
        messages: [{ role: 'user', content: COMPLEX_PROMPT }],
        decompose: false,
        temperature: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].metadata?.skipDecomposition).toBe(true);
  });

  it('does not set skipDecomposition when the body omits decompose', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: {
        model: 'general-chat',
        messages: [{ role: 'user', content: COMPLEX_PROMPT }],
        temperature: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    // Must be absent / not-true — default Router.route behavior is untouched.
    expect(captured[0].metadata?.skipDecomposition).not.toBe(true);
  });

  it('does not set skipDecomposition when decompose is true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: {
        model: 'general-chat',
        messages: [{ role: 'user', content: COMPLEX_PROMPT }],
        decompose: true,
        temperature: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].metadata?.skipDecomposition).not.toBe(true);
  });

  it('never serves a semantic hit for a decompose:false request', async () => {
    vi.spyOn(semanticCacheService, 'isEnabled').mockReturnValue(true);
    const lookup = vi.spyOn(semanticCacheService, 'lookup').mockResolvedValue({
      similarity: 1,
      entry: { response: { modelId: 'old-model', message: { role: 'assistant', content: '' } } },
    } as never);
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: {
        model: 'general-chat',
        messages: [{ role: 'user', content: `Plan ${crypto.randomUUID()}` }],
        decompose: false,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    expect(lookup).not.toHaveBeenCalled();
    expect(res.headers['x-cache']).toBeUndefined();
  });

  it('does not store an empty assistant reply in either chat cache', async () => {
    vi.spyOn(semanticCacheService, 'isEnabled').mockReturnValue(false);
    responseContent = '';
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: {
        model: 'general-chat',
        messages: [{ role: 'user', content: `Empty reply ${crypto.randomUUID()}` }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    expect(res.headers['x-cache']).toBeUndefined();
  });
});

// ── 3: planner body carries decompose:false ────────────────────────────────

let initDb: (...args: unknown[]) => Promise<unknown>;
let closeDb: (...args: unknown[]) => Promise<unknown>;
let getDb: () => any;
let tmpDir: string;
let previousDataDir: string | undefined;
const TENANT = 'tenant-decompose-false';

beforeAll(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dbMod = await import('@dmr-x/db');
  initDb = dbMod.initDb as any;
  closeDb = dbMod.closeDb as any;
  getDb = dbMod.getDb as any;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-decompose-false-'));
  previousDataDir = process.env.DMRX_DATA_DIR;
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // cold run
  }
  await initDb();
  getDb()
    .prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(TENANT, 'decompose-false');
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  const fs = await import('node:fs');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DMRX_DATA_DIR;
  else process.env.DMRX_DATA_DIR = previousDataDir;
});

describe('planJob: decompose:false on the chat body', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends decompose: false so the planner prompt is never composite-decomposed', async () => {
    const { jobStore } = await import('@dmr-x/agent-runtime');
    const { planJob } = await import('../../apps/gateway/src/lib/job-runner.js');

    const job = jobStore.createJob({
      id: crypto.randomUUID(),
      tenantId: TENANT,
      source: 'api',
      brief: 'planner decompose:false fixture',
    } as any);

    const { calls } = stubFetch((url) => {
      if (url.includes('/v1/agents/instances')) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.includes('/v1/chat/completions')) {
        return jsonResponse({
          id: 'cmpl-decomp',
          object: 'chat.completion',
          model: 'auto-smart',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: PLAN_JSON },
              finish_reason: 'stop',
            },
          ],
        });
      }
      return jsonResponse({ error: { message: 'unexpected' } }, 404);
    });

    const result = await planJob(TENANT, job.id, {});
    expect(result.ok).toBe(true);

    const completion = calls.find((c) => c.url.includes('/v1/chat/completions'));
    expect(completion).toBeDefined();
    const body = bodyOf(completion?.init);
    expect(body).not.toBeNull();
    expect(body.decompose).toBe(false);
  });
});
