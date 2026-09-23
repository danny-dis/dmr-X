import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { jobStore, type Job } from '@dmr-x/agent-runtime';

// Regression: live POST /v1/jobs/:id/plan returned HTTP 422
// "planner returned an empty response" while the completion body still
// carried a usable plan. Two root causes, both in planJob:
//
//   1. Extraction: extractText short-circuits on body.content/output/result
//      with `??`. An empty-string top-level field (or a content-parts array
//      that is non-nullish) shadows choices[0].message.content, so a real
//      plan is reported as empty / or the array blows up .trim().
//   2. Model selection: quality_target: 'frontier' was sent in the JSON body,
//      but chat.routes only reads the x-quality-target header — Zod strips
//      the unknown body key, so the planner always ran at 'balanced'.
//
// These fixtures use the shapes the gateway and OpenAI-compatible providers
// actually emit. Do NOT invent a successful plan for a genuinely empty body:
// the empty-content case below must still fail with the empty-response error.

let initDb: (...args: unknown[]) => Promise<unknown>;
let closeDb: (...args: unknown[]) => Promise<unknown>;
let getDb: () => any;

let tmpDir: string;
let previousDataDir: string | undefined;
const TENANT = 'tenant-empty-reply';

const PLAN_JSON = JSON.stringify({
  tasks: [{ ref: 't1', title: 'Design', description: 'd', dependsOn: [] }],
});

type FetchInit = RequestInit | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeAll(async () => {
  const dbMod = await import('@dmr-x/db');
  initDb = dbMod.initDb as any;
  closeDb = dbMod.closeDb as any;
  getDb = dbMod.getDb as any;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-empty-reply-'));
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
    .run(TENANT, 'empty-reply');
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DMRX_DATA_DIR;
  else process.env.DMRX_DATA_DIR = previousDataDir;
});

function makeJob(): Job {
  return jobStore.createJob({
    id: crypto.randomUUID(),
    tenantId: TENANT,
    source: 'api',
    brief: 'build a planner regression fixture',
  } as any);
}

/** Capture every fetch call so we can assert headers and body shape. */
function stubFetch(handler: (url: string, init?: FetchInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: FetchInit }> = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init as FetchInit | undefined);
  });
  return { calls, spy };
}

function headersOf(init?: FetchInit): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

function bodyOf(init?: FetchInit): any {
  if (typeof init?.body !== 'string') return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

describe('planJob: empty-reply regression', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts a plan when top-level content is an empty string but choices carry the JSON', async () => {
    // Live shape: a proxy/envelope may put content:"" at the top level while
    // the OpenAI choices path still holds the completion. `??` stops at "".
    const { planJob } = await import('../../apps/gateway/src/lib/job-runner.js');
    const job = makeJob();

    stubFetch((url) => {
      if (url.includes('/v1/agents/instances')) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.includes('/v1/chat/completions')) {
        return jsonResponse({
          id: 'cmpl-1',
          object: 'chat.completion',
          model: 'auto-smart',
          content: '', // shadows choices under `??`
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
    if (result.ok) expect(result.taskCount).toBeGreaterThan(0);
  });

  it('extracts a plan when message.content is an array of text parts', async () => {
    // Anthropic-style parts leaking through an OpenAI envelope. Returning the
    // raw array made `.trim()` throw (or read as empty) instead of parsing.
    const { planJob } = await import('../../apps/gateway/src/lib/job-runner.js');
    const job = makeJob();

    stubFetch((url) => {
      if (url.includes('/v1/agents/instances')) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.includes('/v1/chat/completions')) {
        return jsonResponse({
          id: 'cmpl-2',
          object: 'chat.completion',
          model: 'auto-smart',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: PLAN_JSON }],
              },
              finish_reason: 'stop',
            },
          ],
        });
      }
      return jsonResponse({ error: { message: 'unexpected' } }, 404);
    });

    const result = await planJob(TENANT, job.id, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.taskCount).toBeGreaterThan(0);
  });

  it('sends frontier quality via the x-quality-target header the chat route actually reads', async () => {
    const { planJob } = await import('../../apps/gateway/src/lib/job-runner.js');
    const job = makeJob();

    const { calls } = stubFetch((url) => {
      if (url.includes('/v1/agents/instances')) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.includes('/v1/chat/completions')) {
        return jsonResponse({
          id: 'cmpl-3',
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

    await planJob(TENANT, job.id, {});

    const completion = calls.find((c) => c.url.includes('/v1/chat/completions'));
    expect(completion).toBeDefined();
    const headers = headersOf(completion?.init);
    expect(headers['x-quality-target']).toBe('frontier');
    // Body quality_target alone is stripped by the chat route's Zod schema.
    expect(bodyOf(completion?.init)?.model).toBeTruthy();
  });

  it('still reports an empty response when the completion body has no usable text', async () => {
    // Provider truth: thought-only / length-truncated turn with content "".
    // Must NOT be papered over with a fake plan.
    const { planJob } = await import('../../apps/gateway/src/lib/job-runner.js');
    const job = makeJob();

    stubFetch((url) => {
      if (url.includes('/v1/agents/instances')) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.includes('/v1/chat/completions')) {
        return jsonResponse({
          id: 'cmpl-empty',
          object: 'chat.completion',
          model: 'auto-smart',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '' },
              finish_reason: 'length',
            },
          ],
        });
      }
      return jsonResponse({ error: { message: 'unexpected' } }, 404);
    });

    const result = await planJob(TENANT, job.id, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty response/i);
  });
});
