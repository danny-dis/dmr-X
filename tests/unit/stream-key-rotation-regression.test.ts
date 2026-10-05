import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';

/**
 * Surgical multi-key serving regressions (streaming focus).
 *
 * Every test uses fake keys + mocked global fetch (or local SQL seeds) — no
 * credentials, no .env, no DB secrets, no real provider calls.
 *
 * Regression map (see key-rotation-review.md):
 *  R1 HTTP 429 retried in place on the SAME key (base.adapter RETRYABLE set).
 *  R2 GenericOpenAI streaming picks a single key, never rotates.
 *  R3 Smart-key join compares hashed vs raw key ids and always misses.
 *  R4 modelId dropped from rotation (per-model quota never consulted).
 *  R5 Hooks record config.apiKey instead of the key that served the request.
 *  R6 Cohere streaming never rotates (single this.apiKey).
 *
 * TDD: these tests FAIL on the pre-fix code (RED) and pass after (GREEN).
 */

import { GenericOpenAIAdapter, CohereAdapter } from '@dmr-x/adapters';
import type { UnifiedRequest } from '@dmr-x/core';
import { keyRotationService, getRateLimitTracker } from '@dmr-x/quota';
import { getDb } from '@dmr-x/db';

const KEY_A = 'sk-test-fake-key-AAAAAAAAAAAAAAAA-0001';
const KEY_B = 'sk-test-fake-key-BBBBBBBBBBBBBBBB-0002';
const INIT_KEY = 'sk-test-fake-init-key-INITKEY-0000';

const realFetch = globalThis.fetch;

function bearer(req: Request): string {
  return req.headers.get('Authorization') ?? '';
}

function errRes(status: number, retryAfter = '0'): Response {
  return new Response(`upstream error ${status}`, {
    status,
    headers: { 'Retry-After': retryAfter },
  });
}

function openAISuccess(model: string): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function openAISSE(text: string): Response {
  const payload =
    `data: {"choices":[{"delta":{"content":${JSON.stringify(text)},"index":0},"index":0}]}\n\n` +
    `data: [DONE]\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function cohereSSE(text: string): Response {
  const payload =
    `data: {"delta":{"message":{"content":{"text":${JSON.stringify(text)}}}}}\n\n` +
    `data: {"finish_reason":"COMPLETE"}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function midStreamErrorSSE(text: string): Response {
  const enc = new TextEncoder();
  const frame = enc.encode(
    `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`,
  );
  // NOTE: enqueue-then-error inside start() would discard the queued chunk
  // (ReadableStream.error() resets the queue). Deliver the token on the first
  // pull and fail on the second so output genuinely precedes the failure.
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) controller.enqueue(frame);
      else controller.error(new Error('mid-stream boom'));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function chatReq(model: string): UnifiedRequest {
  return {
    modality: 'llm',
    model,
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
    metadata: {},
  };
}

async function collectStream(
  adapter: { executeStream(r: UnifiedRequest, o?: unknown): AsyncIterable<unknown> },
  request: UnifiedRequest,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const chunk of adapter.executeStream(request, { timeoutMs: 5000 } as never)) {
    out.push(chunk);
  }
  return out;
}

function tokenTexts(chunks: unknown[]): string[] {
  return chunks
    .filter((c) => (c as { type?: string }).type === 'token')
    .map((c) => {
      const d = (c as { data?: { content?: string } }).data;
      return typeof d?.content === 'string' ? d.content : '';
    })
    .filter(Boolean);
}

function seedQuotaRow(providerId: string, keyId: string, remaining: number | null, limit: number | null): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO provider_key_rate_limits
       (id, key_id, provider_id, model_id, requests_limit, requests_remaining, last_updated)
     VALUES (?, ?, ?, NULL, ?, ?, datetime('now'))`,
  ).run(
    `${providerId}:${keyId.slice(0, 8)}:${Math.random().toString(36).slice(2)}`,
    keyId,
    providerId,
    limit,
    remaining,
  );
}

function cleanQuotaRows(providerId: string): void {
  try {
    getDb().prepare('DELETE FROM provider_key_rate_limits WHERE provider_id = ?').run(providerId);
  } catch {
    // Table may not exist in a fresh test DB; the seeding test will surface it.
  }
}

// Smart rotation reads provider_key_rate_limits via getDb(); unit tests run
// without an initialized DB, so boot an isolated temp-dir database for this file.
const dbDirectory = mkdtempSync(join(tmpdir(), 'dmrx-stream-key-rotation-'));
const previousDataDir = process.env.DMRX_DATA_DIR;

beforeAll(async () => {
  process.env.DMRX_DATA_DIR = dbDirectory;
  const database = await import('@dmr-x/db');
  await database.initDb();
});

afterAll(async () => {
  const database = await import('@dmr-x/db');
  await database.closeDb();
  if (previousDataDir === undefined) delete process.env.DMRX_DATA_DIR;
  else process.env.DMRX_DATA_DIR = previousDataDir;
});

beforeEach(() => {
  keyRotationService.setStrategy('smart');
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('R1: 429 must fail over, never retry in place on the same key', () => {
  it('single-key 429 costs exactly ONE http attempt (no TemporaryError same-key retry)', async () => {
    const pid = 'test-g429';
    const adapter = new GenericOpenAIAdapter(pid);
    await adapter.initialize({ baseUrl: 'https://upstream.test', apiKey: KEY_A });

    const fetchMock = vi.fn(async () => errRes(429));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(adapter.execute(chatReq('m-429'))).rejects.toMatchObject({ statusCode: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('R2: GenericOpenAI streaming rotates across unique keys pre-output', () => {
  it('stream key-A 429 fails over to key-B and yields content (each key tried once)', async () => {
    const pid = 'test-gstream';
    cleanQuotaRows(pid);
    // Deterministic first pick regardless of the shared rotation cursor (the
    // unit project runs with `retry: 1`): smart rotation must prefer the
    // healthy key-A over the exhausted key-B on every attempt.
    seedQuotaRow(pid, KEY_A, 9, 10);
    seedQuotaRow(pid, KEY_B, 0, 10);
    const adapter = new GenericOpenAIAdapter(pid);
    try {
      await adapter.initialize({ baseUrl: 'https://upstream.test', apiKey: INIT_KEY });
      adapter.setKeys([KEY_A, KEY_B]);

      // Key-scoped failure is attributed per credential: A is spent, B serves.
      const auths: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const req = input as Request;
        auths.push(bearer(req));
        if (bearer(req) === `Bearer ${KEY_A}`) return errRes(429);
        return openAISSE('hello-stream');
      }) as unknown as typeof fetch;

      const chunks = await collectStream(adapter, { ...chatReq('m-stream'), stream: true });
      expect(tokenTexts(chunks).join('')).toContain('hello-stream');
      // Exactly one attempt per unique credential, in pool order, no same-key
      // in-place retry (that retry would show up as a duplicate entry here).
      expect(auths).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    } finally {
      cleanQuotaRows(pid);
    }
  });

  it('stream rotates on 402 pre-output (billing-exhausted key fails over)', async () => {
    const pid = 'test-g402';
    cleanQuotaRows(pid);
    seedQuotaRow(pid, KEY_A, 9, 10);
    seedQuotaRow(pid, KEY_B, 0, 10);
    const adapter = new GenericOpenAIAdapter(pid);
    try {
      await adapter.initialize({ baseUrl: 'https://upstream.test', apiKey: INIT_KEY });
      adapter.setKeys([KEY_A, KEY_B]);

      const auths: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const req = input as Request;
        auths.push(bearer(req));
        if (bearer(req) === `Bearer ${KEY_A}`) return errRes(402);
        return openAISSE('hello-402');
      }) as unknown as typeof fetch;

      const chunks = await collectStream(adapter, { ...chatReq('m-402'), stream: true });
      expect(tokenTexts(chunks).join('')).toContain('hello-402');
      expect(auths).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    } finally {
      cleanQuotaRows(pid);
    }
  });

  it('stream rotates on 401 pre-output (revoked key fails over)', async () => {
    const pid = 'test-g401';
    cleanQuotaRows(pid);
    seedQuotaRow(pid, KEY_A, 9, 10);
    seedQuotaRow(pid, KEY_B, 0, 10);
    const adapter = new GenericOpenAIAdapter(pid);
    try {
      await adapter.initialize({ baseUrl: 'https://upstream.test', apiKey: INIT_KEY });
      adapter.setKeys([KEY_A, KEY_B]);

      const auths: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const req = input as Request;
        auths.push(bearer(req));
        if (bearer(req) === `Bearer ${KEY_A}`) return errRes(401);
        return openAISSE('hello-401');
      }) as unknown as typeof fetch;

      const chunks = await collectStream(adapter, { ...chatReq('m-401'), stream: true });
      expect(tokenTexts(chunks).join('')).toContain('hello-401');
      expect(auths).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    } finally {
      cleanQuotaRows(pid);
    }
  });

  it('GUARD: never retries after output — mid-stream transport error propagates with no second attempt', async () => {
    const pid = 'test-gguard';
    const adapter = new GenericOpenAIAdapter(pid);
    await adapter.initialize({ baseUrl: 'https://upstream.test', apiKey: INIT_KEY });
    adapter.setKeys([KEY_A, KEY_B]);

    const fetchMock = vi.fn(async () => midStreamErrorSSE('partial'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const c of adapter.executeStream(
          { ...chatReq('m-guard'), stream: true },
          { timeoutMs: 5000 } as never,
        )) {
          seen.push(c);
        }
      })(),
    ).rejects.toThrow('mid-stream boom');
    expect(tokenTexts(seen).join('')).toContain('partial');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('embedding rotates across keys too (key-A 429 -> key-B 200)', async () => {
    const pid = 'test-gemb';
    cleanQuotaRows(pid);
    seedQuotaRow(pid, KEY_A, 9, 10);
    seedQuotaRow(pid, KEY_B, 0, 10);
    const adapter = new GenericOpenAIAdapter(pid);
    try {
      await adapter.initialize({ baseUrl: 'https://upstream.test', apiKey: INIT_KEY });
      adapter.setKeys([KEY_A, KEY_B]);

      const auths: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const req = input as Request;
        auths.push(bearer(req));
        if (bearer(req) === `Bearer ${KEY_A}`) return errRes(429);
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      const res = await adapter.execute(
        { modality: 'embedding', model: 'emb-m', input: 'hi', metadata: {} } as UnifiedRequest,
        { timeoutMs: 5000 } as never,
      );
      expect(res.embeddings).toEqual([[0.1, 0.2]]);
      expect(auths).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    } finally {
      cleanQuotaRows(pid);
    }
  });
});

describe('R3: smart rotation matches exhausted-key records regardless of raw/hash form', () => {
  it.each(['raw', 'hashed'] as const)(
    'skips the exhausted key when quota rows are stored %s',
    async (form) => {
      const pid = form === 'raw' ? 'test-smart-raw' : 'test-smart-hash';
      cleanQuotaRows(pid);
      const rowKeyA = form === 'raw' ? KEY_A : keyRotationService.hashKey(KEY_A);
      const rowKeyB = form === 'raw' ? KEY_B : keyRotationService.hashKey(KEY_B);
      seedQuotaRow(pid, rowKeyA, 0, 10); // exhausted
      seedQuotaRow(pid, rowKeyB, 9, 10); // healthy

      keyRotationService.registerKeys(pid, [KEY_A, KEY_B]);
      try {
        // Consecutive picks (not a single pick): the unit project runs with
        // `retry: 1`, and a retry reuses the rotation cursor, so one pick is
        // cursor-dependent. Smart rotation must return the healthy key EVERY
        // time; the pre-fix round-robin fallback alternates A,B in some order.
        const picks = [keyRotationService.getNextKey(pid), keyRotationService.getNextKey(pid)];
        expect(picks).toEqual([KEY_B, KEY_B]);
      } finally {
        cleanQuotaRows(pid);
      }
    },
  );
});

describe('R4: modelId is threaded through rotation', () => {
  it('GenericOpenAI passes request.model into key selection', async () => {
    const pid = 'test-gmodel';
    const adapter = new GenericOpenAIAdapter(pid);
    await adapter.initialize({ baseUrl: 'https://upstream.test', apiKey: INIT_KEY });
    adapter.setKeys([KEY_A, KEY_B]);

    globalThis.fetch = (async () => openAISuccess('model-m')) as unknown as typeof fetch;
    const spy = vi.spyOn(keyRotationService, 'getNextKey');

    await adapter.execute(chatReq('model-m'));
    expect(spy).toHaveBeenCalledWith(pid, 'model-m');
  });
});

describe('R5: usage hooks attribute the key that served the request', () => {
  it('trackResponse records the actual rotated key, not config.apiKey', async () => {
    const pid = 'test-ghooks';
    const adapter = new GenericOpenAIAdapter(pid);
    await adapter.initialize({ baseUrl: 'https://upstream.test', apiKey: INIT_KEY });
    adapter.setKeys([KEY_A, KEY_B]);

    globalThis.fetch = (async () => openAISuccess('m-hooks')) as unknown as typeof fetch;
    const spy = vi.spyOn(getRateLimitTracker(), 'trackResponse');

    await adapter.execute(chatReq('m-hooks'));
    expect(spy).toHaveBeenCalled();
    const recorded = (spy.mock.calls[0]?.[0] as { keyId?: string } | undefined)?.keyId;
    expect([KEY_A, KEY_B]).toContain(recorded);
    expect(recorded).not.toBe(INIT_KEY);
  });
});

describe('R6: Cohere streaming uses equivalent safe rotation', () => {
  it('cohere stream key-first-attempt 429 fails over to the sibling key pre-output', async () => {
    // Cohere's providerId is fixed, so seed smart-rotation rows for a
    // deterministic first pick (healthy A) across retries and suites.
    cleanQuotaRows('cohere');
    seedQuotaRow('cohere', KEY_A, 9, 10);
    seedQuotaRow('cohere', KEY_B, 0, 10);
    const adapter = new CohereAdapter();
    try {
      await adapter.initialize({ baseUrl: 'https://cohere.test', apiKey: 'cohere-init-key-1' });
      adapter.setKeys([KEY_A, KEY_B]);

      const auths: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const req = input as Request;
        auths.push(bearer(req));
        if (bearer(req) === `Bearer ${KEY_A}`) return errRes(429);
        return cohereSSE('hi-cohere');
      }) as unknown as typeof fetch;

      const chunks = await collectStream(adapter, { ...chatReq('command-r'), stream: true });
      expect(tokenTexts(chunks).join('')).toContain('hi-cohere');
      expect(auths).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    } finally {
      cleanQuotaRows('cohere');
    }
  });
});
