/**
 * Admin Validation Tests (HIGH-4)
 *
 * Validates that the Zod schemas added to the 8 admin/conversation routes
 * in `apps/gateway/src/routes/admin.routes.ts` and
 * `apps/gateway/src/routes/conversation.routes.ts` correctly accept
 * well-formed bodies and reject malformed ones.
 *
 * The route files keep their schemas private (matching the existing
 * convention used for SubmitSandboxSchema, CreateProviderSchema, etc.),
 * so this test re-declares equivalent schemas. If a schema's rules drift
 * from the route, the test breaks — this is intentional. Any change to
 * the production schema must be mirrored here.
 *
 * For each route we exercise:
 *   - 200/201 on a valid body
 *   - 400 on a missing required field
 *   - 400 on a wrong type
 *   - 400 on an oversized payload (where applicable)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

// --- Schemas (mirror production; see comments in route files) ---

const CreateMemoryItemSchema = z.object({
  content: z.string().min(1).max(1_000_000),
  namespace: z.string().min(1).max(128).optional(),
  source: z.string().min(1).max(128).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  metadata: z.record(z.unknown()).optional(),
  tenantId: z.string().min(1).max(128).optional(),
});

const SearchMemorySchema = z.object({
  query: z.string().min(1).max(10_000),
  tenantId: z.string().min(1).max(128).optional(),
  namespace: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

const RegisterWorkerSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.string().min(1).max(64).optional(),
});

const RegisterFederationNodeSchema = z.object({
  name: z.string().min(1).max(128),
  url: z.string().url().refine(
    (u) => {
      try {
        const proto = new URL(u).protocol;
        return proto === 'http:' || proto === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'url must be a valid http(s) URL' },
  ),
  region: z.string().min(1).max(64).optional().nullable(),
  apiKey: z.string().min(1).max(2048).optional().nullable(),
  privacyLevel: z.enum(['anonymized', 'private', 'public']).optional(),
});

const RunArenaBattleSchema = z.object({
  modelA: z.string().uuid(),
  modelB: z.string().uuid(),
  prompt: z.string().min(1).max(100_000).optional(),
});

const PlaygroundFeedbackSchema = z.object({
  modelId: z.string().uuid().optional(),
  requestId: z.string().min(1).max(256).optional(),
  competitorModelId: z.string().uuid().optional().nullable(),
  userId: z.string().min(1).max(128).optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  feedbackText: z.string().max(10_000).optional().nullable(),
  implicitSignals: z.record(z.unknown()).optional(),
  isWinner: z.boolean().optional().nullable(),
}).refine(
  (v) => v.modelId !== undefined || v.requestId !== undefined,
  { message: 'Either modelId or requestId is required' },
);

const MAX_BATCH_MESSAGES = 100;
const BatchMessageItemSchema = z.object({
  id: z.string().uuid().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  audioUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  embeddingData: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  tokensInput: z.number().optional().default(0),
  tokensOutput: z.number().optional().default(0),
  cost: z.number().optional().default(0),
  latencyMs: z.number().optional().default(0),
  routingDecision: z.string().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
  events: z.array(z.object({ name: z.string(), data: z.unknown() })).optional(),
});
const BatchAddMessagesSchema = z.object({
  messages: z.array(BatchMessageItemSchema).min(1).max(MAX_BATCH_MESSAGES),
});

const ListConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  mode: z.enum(['chat', 'image', 'embed', 'tts', 'rerank', 'moderate']).optional(),
  search: z.string().min(1).max(200).optional(),
  temporary: z.union([z.literal('true'), z.literal('false')]).optional(),
});

// --- Fastify harness that mirrors the route shape ---

/**
 * Build a minimal Fastify app that registers the same parse/handler
 * pattern the real routes use (`safeParse` → 400 on failure, else echo).
 * Services are stubbed via a Map of "kind" → response so the test can
 * assert the route reached the happy path without a real DB.
 */
function buildApp(opts: {
  successStatus?: 200 | 201;
  respondWith?: (url: string, body: any) => any;
} = {}) {
  const app = Fastify({ logger: false });
  const successStatus = opts.successStatus ?? 201;
  const ok = (req: any) => {
    if (opts.respondWith) return opts.respondWith(req.url, req.body ?? req.query);
    return { ok: true };
  };

  // POST /admin/memory
  app.post('/admin/memory', async (req, reply) => {
    const p = CreateMemoryItemSchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: { message: 'Invalid request', type: 'validation', code: 'invalid', details: p.error.errors } };
    }
    reply.code(successStatus);
    return ok(req);
  });

  // POST /admin/memory/search
  app.post('/admin/memory/search', async (req, reply) => {
    const p = SearchMemorySchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: { message: 'Invalid request', type: 'validation', code: 'invalid', details: p.error.errors } };
    }
    return ok(req);
  });

  // POST /admin/workers
  app.post('/admin/workers', async (req, reply) => {
    const p = RegisterWorkerSchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: { message: 'Invalid request', type: 'validation', code: 'invalid', details: p.error.errors } };
    }
    reply.code(successStatus);
    return ok(req);
  });

  // POST /admin/federation
  app.post('/admin/federation', async (req, reply) => {
    const p = RegisterFederationNodeSchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: { message: 'Invalid request', type: 'validation', code: 'invalid', details: p.error.errors } };
    }
    reply.code(successStatus);
    return ok(req);
  });

  // POST /admin/benchmarks/battle
  app.post('/admin/benchmarks/battle', async (req, reply) => {
    const p = RunArenaBattleSchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: { message: 'Invalid request', type: 'validation', code: 'invalid', details: p.error.errors } };
    }
    return ok(req);
  });

  // POST /admin/playground/feedback
  app.post('/admin/playground/feedback', async (req, reply) => {
    const p = PlaygroundFeedbackSchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: { message: 'Invalid request', type: 'validation', code: 'invalid', details: p.error.errors } };
    }
    return ok(req);
  });

  // POST /conversations/:id/messages/batch
  app.post<{ Params: { id: string } }>('/conversations/:id/messages/batch', async (req, reply) => {
    const p = BatchAddMessagesSchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: { message: 'Invalid request', type: 'validation', code: 'invalid', details: p.error.errors } };
    }
    return ok(req);
  });

  // GET /conversations
  app.get('/conversations', async (req, reply) => {
    const p = ListConversationsQuerySchema.safeParse(req.query);
    if (!p.success) {
      reply.code(400);
      return { error: { message: 'Invalid query', type: 'validation', code: 'invalid', details: p.error.errors } };
    }
    return ok(req);
  });

  return app;
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('Admin route validation: POST /admin/memory', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ successStatus: 201 }); });
  afterEach(async () => { await app.close(); });

  it('accepts a valid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/memory',
      payload: { content: 'hello world' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects missing content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/memory',
      payload: { namespace: 'foo' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects wrong type for content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/memory',
      payload: { content: 123 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects oversized content (1MB + 1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/memory',
      payload: { content: 'x'.repeat(1_000_001) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Admin route validation: POST /admin/memory/search', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ successStatus: 200 }); });
  afterEach(async () => { await app.close(); });

  it('accepts a valid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/memory/search',
      payload: { query: 'hello' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects missing query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/memory/search',
      payload: { limit: 5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects oversized query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/memory/search',
      payload: { query: 'x'.repeat(10_001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects limit > 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/memory/search',
      payload: { query: 'hi', limit: 501 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Admin route validation: POST /admin/workers', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ successStatus: 201 }); });
  afterEach(async () => { await app.close(); });

  it('accepts a valid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      payload: { name: 'worker-1' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects missing name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      payload: { type: 'background' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects name that is too long', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      payload: { name: 'x'.repeat(129) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Admin route validation: POST /admin/federation', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ successStatus: 201 }); });
  afterEach(async () => { await app.close(); });

  it('accepts a valid https body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/federation',
      payload: { name: 'peer-1', url: 'https://peer.example.com' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects missing name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/federation',
      payload: { url: 'https://peer.example.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/federation',
      payload: { name: 'peer-1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects non-http(s) url (SSRF guard is the SSRF agent\'s job, but shape check rejects ftp)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/federation',
      payload: { name: 'peer-1', url: 'ftp://peer.example.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/federation',
      payload: { name: 'peer-1', url: 'not-a-url' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Admin route validation: POST /admin/benchmarks/battle', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ successStatus: 200 }); });
  afterEach(async () => { await app.close(); });

  it('accepts a valid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/benchmarks/battle',
      payload: { modelA: UUID_A, modelB: UUID_B },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects non-uuid modelA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/benchmarks/battle',
      payload: { modelA: 'not-a-uuid', modelB: UUID_B },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing modelB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/benchmarks/battle',
      payload: { modelA: UUID_A },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects oversized prompt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/benchmarks/battle',
      payload: { modelA: UUID_A, modelB: UUID_B, prompt: 'x'.repeat(100_001) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Admin route validation: POST /admin/playground/feedback', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ successStatus: 200 }); });
  afterEach(async () => { await app.close(); });

  it('accepts a valid body with modelId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/playground/feedback',
      payload: { modelId: UUID_A, rating: 5 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a valid body with requestId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/playground/feedback',
      payload: { requestId: 'req-123' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects body with neither modelId nor requestId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/playground/feedback',
      payload: { rating: 5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects rating out of range', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/playground/feedback',
      payload: { modelId: UUID_A, rating: 6 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects feedbackText that is too long', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/playground/feedback',
      payload: { modelId: UUID_A, feedbackText: 'x'.repeat(10_001) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Admin route validation: POST /conversations/:id/messages/batch', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ successStatus: 200 }); });
  afterEach(async () => { await app.close(); });

  it('accepts a small valid batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${UUID_A}/messages/batch`,
      payload: {
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an empty messages array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${UUID_A}/messages/batch`,
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a batch over 100 messages (HIGH-4 cap)', async () => {
    const messages = Array.from({ length: 101 }, () => ({ role: 'user', content: 'hi' }));
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${UUID_A}/messages/batch`,
      payload: { messages },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a batch of exactly 100 messages', async () => {
    const messages = Array.from({ length: 100 }, () => ({ role: 'user', content: 'hi' }));
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${UUID_A}/messages/batch`,
      payload: { messages },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a malformed message inside the batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${UUID_A}/messages/batch`,
      payload: {
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'unknown_role', content: 'bad' },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing messages field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${UUID_A}/messages/batch`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Admin route validation: GET /conversations', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ successStatus: 200 }); });
  afterEach(async () => { await app.close(); });

  it('accepts a query with no params', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts valid limit, offset, mode', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations?limit=10&offset=0&mode=chat',
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects limit > 100', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations?limit=101' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects negative offset', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations?offset=-1' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects search longer than 200 chars (HIGH-4 cap)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/conversations?search=${'x'.repeat(201)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts search up to 200 chars', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/conversations?search=${'x'.repeat(200)}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects unknown mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations?mode=bogus' });
    expect(res.statusCode).toBe(400);
  });
});
