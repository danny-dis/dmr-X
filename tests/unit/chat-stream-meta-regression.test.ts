import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';

// Mocked OUTSIDE the zone (godmode-guard + godmode service are owned by
// parallel agents) so the auto-free stream path can be driven with hanging /
// failing iterators without provider calls, restarts, or DB access.
vi.mock('../../apps/gateway/src/lib/godmode-guard.js', () => ({
  buildGodmodeWrapOrder: vi.fn(),
  ensureGodmodeProxy: vi.fn(),
  isGodmodeStrict: vi.fn(),
  wrapAutoFreeViaGodmode: vi.fn(),
}));
// NOTE: '@dmr-x/godmode' has no vitest alias and does not resolve by node
// from tests/unit, so it is mocked by resolved file path — the same file the
// route's dynamic `await import('@dmr-x/godmode')` resolves to through the
// apps/gateway workspace symlink (services/godmode/src/index.ts). Mocking by
// bare specifier here would create a second, route-invisible instance.
vi.mock('../../services/godmode/src/index.ts', () => ({ getGodmodeService: vi.fn() }));

import {
  buildGodmodeWrapOrder,
  ensureGodmodeProxy,
  isGodmodeStrict,
} from '../../apps/gateway/src/lib/godmode-guard.js';
import { getGodmodeService } from '../../services/godmode/src/index.ts';

type Chunk = { type: string; data?: any };

function parseSSEFrames(body: string): Array<{ json?: any; comment?: string; doneSentinel?: boolean }> {
  return body
    .split('\n\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((block) => {
      if (block === 'data: [DONE]') return { doneSentinel: true as const };
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) return { comment: block };
      const payload = dataLine.slice('data:'.length).trim();
      if (payload === '[DONE]') return { doneSentinel: true as const };
      return { json: JSON.parse(payload) };
    });
}

function dataFrames(body: string): any[] {
  return parseSSEFrames(body)
    .map((f) => f.json)
    .filter((j) => j && !j.error);
}

function errorFrames(body: string): any[] {
  return parseSSEFrames(body)
    .map((f) => f.json)
    .filter((j) => j?.error);
}

async function buildStreamApp(opts: {
  planPrimary?: { providerId: string; modelId: string };
  planChain?: Array<{ providerId: string; modelId: string }>;
  costFilter?: 'free' | 'all';
  adapters: Record<string, () => AsyncGenerator<Chunk>>;
}) {
  const app = Fastify({ logger: false });
  const attempted: string[] = [];
  app.decorate(
    'router',
    {
      getEffectiveCostFilter: () => opts.costFilter ?? 'all',
      route: async () => ({
        plan: {
          primary: opts.planPrimary ?? { providerId: 'p1', modelId: 'm1', adapterType: 'openai', score: 1 },
          chain: (opts.planChain ?? []).map((c) => ({
            provider: { ...c, score: 0.9 },
          })),
          timeoutMs: 30000,
          maxRetries: 1,
        },
      }),
      getCandidates: () => [],
    },
  );
  app.decorate('getAdapter', (providerId: string) => {
    const make = opts.adapters[providerId];
    if (!make) return undefined;
    return {
      executeStream: (..._args: any[]) => {
        attempted.push(providerId);
        return make();
      },
    };
  });
  await app.register(chatRoutes);
  return { app, attempted };
}

async function* gen(chunks: Array<Chunk | undefined>) {
  for (const c of chunks) yield c as Chunk;
}

const ENV_KEYS = [
  'DMRX_AUTOFREE_STREAM_TIMEOUT_MS',
  'DMRX_AUTOFREE_TTFT_MS',
  'DMRX_AUTOFREE_PROXY_READY_MS',
  'DMRX_AUTOFREE_KEEPALIVE_MS',
  'DMRX_FALLBACK_TIMEOUT_MS',
  'DMRX_UPSTREAM_STREAM_TIMEOUT_MS',
  'DMRX_STREAM_TTFT_MS',
];
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  vi.mocked(buildGodmodeWrapOrder).mockReset();
  vi.mocked(ensureGodmodeProxy).mockReset();
  vi.mocked(isGodmodeStrict).mockReset();
  vi.mocked(getGodmodeService).mockReset();
  delete process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS;
  delete process.env.DMRX_AUTOFREE_TTFT_MS;
  delete process.env.DMRX_AUTOFREE_PROXY_READY_MS;
  delete process.env.DMRX_AUTOFREE_KEEPALIVE_MS;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('chat stream meta regression (gateway zone only)', () => {
  it('abandons a hung provider before semantic output even when it ignores abort', { timeout: 2000 }, async () => {
    process.env.DMRX_STREAM_TTFT_MS = '80';
    process.env.DMRX_FALLBACK_TIMEOUT_MS = '2000';
    const { app, attempted } = await buildStreamApp({
      planPrimary: { providerId: 'hung', modelId: 'hung-model' },
      planChain: [{ providerId: 'healthy', modelId: 'healthy-model' }],
      adapters: {
        hung: async function* () {
          yield { type: 'token', data: { role: 'assistant' } };
          await new Promise(() => {});
        },
        healthy: () => gen([{ type: 'token', data: { content: 'recovered' } }, { type: 'done' }]),
      },
    });
    try {
      const res = await app.inject({
        method: 'POST', url: '/chat/completions',
        payload: { model: 'auto-fast', messages: [{ role: 'user', content: 'hi' }], stream: true },
      });
      expect(attempted).toEqual(['hung', 'healthy']);
      expect(errorFrames(res.body)).toEqual([]);
      expect(dataFrames(res.body).map((f) => f.choices?.[0]?.delta?.content ?? '').join('')).toBe('recovered');
      expect(dataFrames(res.body).every((f) => f.model === 'healthy-model')).toBe(true);
    } finally { await app.close(); }
  });

  it('skips undefined chunks from a degrading provider instead of emitting stream_error chunk.type', async () => {
    const { app } = await buildStreamApp({
      planPrimary: { providerId: 'p1', modelId: 'm1' },
      adapters: {
        p1: () =>
          gen([
            { type: 'token', data: { content: 'hello' } },
            undefined, // degrading provider yields a nullish frame mid-stream
            { type: 'token', data: { content: ' world' } },
            { type: 'done' },
          ]),
      },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        payload: { model: 'auto', messages: [{ role: 'user', content: 'hi' }], stream: true },
      });
      expect(res.statusCode).toBe(200);
      expect(errorFrames(res.body)).toEqual([]);
      const frames = dataFrames(res.body);
      const text = frames
        .map((f) => f.choices?.[0]?.delta?.content ?? '')
        .join('');
      expect(text).toBe('hello world');
      expect(parseSSEFrames(res.body).filter((f) => f.doneSentinel).length).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('does not swallow genuine errors: post-output failure still surfaces stream_error', async () => {
    const { app } = await buildStreamApp({
      planPrimary: { providerId: 'p1', modelId: 'm1' },
      adapters: {
        p1: async function* () {
          yield { type: 'token', data: { content: 'partial' } };
          throw new Error('upstream exploded');
        },
      },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        payload: { model: 'auto', messages: [{ role: 'user', content: 'hi' }], stream: true },
      });
      expect(res.statusCode).toBe(200);
      const errs = errorFrames(res.body);
      expect(errs.length).toBe(1);
      expect(errs[0].error.message).toContain('upstream exploded');
    } finally {
      await app.close();
    }
  });

  it('emits exactly one terminal frame for a double-done iterator (DONE finite)', async () => {
    const { app } = await buildStreamApp({
      planPrimary: { providerId: 'p1', modelId: 'm1' },
      adapters: {
        p1: () =>
          gen([
            { type: 'token', data: { content: 'AB' } },
            { type: 'done' },
            { type: 'done' },
          ]),
      },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        payload: { model: 'auto', messages: [{ role: 'user', content: 'hi' }], stream: true },
      });
      expect(res.statusCode).toBe(200);
      expect(errorFrames(res.body)).toEqual([]);
      const stops = dataFrames(res.body).filter(
        (f) => f.choices?.[0]?.finish_reason === 'stop' || f.choices?.[0]?.finish_reason === 'tool_calls',
      );
      expect(stops.length).toBe(1);
      expect(parseSSEFrames(res.body).filter((f) => f.doneSentinel).length).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('tool-only turn succeeds with finish_reason tool_calls (no zero-content error)', async () => {
    const toolCalls = [{ id: 'c1', type: 'function', function: { name: 'get_time', arguments: '{}' } }];
    const { app } = await buildStreamApp({
      planPrimary: { providerId: 'p1', modelId: 'm1' },
      adapters: {
        p1: () =>
          gen([
            { type: 'token', data: { tool_calls: toolCalls } },
            { type: 'done' },
          ]),
      },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        payload: {
          model: 'auto',
          messages: [{ role: 'user', content: 'what time is it' }],
          tools: [{ type: 'function', function: { name: 'get_time' } }],
          stream: true,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(errorFrames(res.body)).toEqual([]);
      const frames = dataFrames(res.body);
      const last = frames[frames.length - 1];
      expect(last.choices?.[0]?.finish_reason).toBe('tool_calls');
      expect(frames.some((f) => (f.choices?.[0]?.delta as any)?.tool_calls?.length === 1)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('strict free fallback reports the ACTUAL serving model/provider, never the failed primary', async () => {
    const { app, attempted } = await buildStreamApp({
      planPrimary: { providerId: 'free-a', modelId: 'free-model-a' },
      planChain: [{ providerId: 'free-b', modelId: 'free-model-b' }],
      costFilter: 'free',
      adapters: {
        'free-a': async function* () {
          throw new Error('free-a exhausted');
          yield { type: 'token', data: { content: 'unreachable' } };
        },
        'free-b': () =>
          gen([
            { type: 'token', data: { content: 'fallback answer' } },
            { type: 'done' },
          ]),
        'paid-provider': () =>
          gen([
            { type: 'token', data: { content: 'paid answer' } },
            { type: 'done' },
          ]),
      },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        headers: { 'x-cost-filter': 'free' },
        payload: { model: 'free', messages: [{ role: 'user', content: 'hi' }], stream: true },
      });
      expect(res.statusCode).toBe(200);
      // strict free-only: paid provider must never be attempted
      expect(attempted).toEqual(['free-a', 'free-b']);
      expect(errorFrames(res.body)).toEqual([]);
      const frames = dataFrames(res.body);
      expect(frames.length).toBeGreaterThan(0);
      for (const f of frames) {
        expect(f.model).toBe('free-model-b');
        expect(f.model).not.toBe('free-model-a');
      }
      const providers = new Set(frames.map((f) => f.dmrx_provider ?? f.provider));
      expect(providers).toEqual(new Set(['free-b']));
    } finally {
      await app.close();
    }
  });

  it('clears per-attempt stream timers: every created timer is cleared by request end', async () => {
    const created: unknown[] = [];
    const cleared: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const setSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms: any, ...a: any[]) => {
      const h = realSetTimeout(fn, ms, ...a);
      created.push(h);
      return h;
    }) as any);
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((h: any) => {
      cleared.push(h);
      return realClearTimeout(h);
    }) as any);
    try {
      const { app } = await buildStreamApp({
        planPrimary: { providerId: 'p1', modelId: 'm1' },
        adapters: {
          p1: () => gen([{ type: 'token', data: { content: 'ok' } }, { type: 'done' }]),
        },
      });
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/chat/completions',
          payload: { model: 'auto', messages: [{ role: 'user', content: 'hi' }], stream: true },
        });
        expect(res.statusCode).toBe(200);
      } finally {
        await app.close();
      }
      expect(created.length).toBeGreaterThan(0);
      for (const h of created) expect(cleared).toContain(h);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});

describe('auto-free godmode stream bounds (gateway zone only)', () => {
  async function buildGodmodeApp() {
    const app = Fastify({ logger: false });
    app.decorate('router', {
      getEffectiveCostFilter: () => 'all',
      route: async () => ({
        plan: {
          primary: { providerId: 'p1', modelId: 'm1', adapterType: 'openai', score: 1 },
          chain: [],
          timeoutMs: 30000,
          maxRetries: 1,
        },
      }),
      getCandidates: () => [],
    });
    app.decorate('getAdapter', () => undefined);
    await app.register(chatRoutes);
    return app;
  }

  function mockGodmodeStream(models: Record<string, () => AsyncGenerator<any>>) {
    vi.mocked(buildGodmodeWrapOrder).mockReturnValue(Object.keys(models));
    vi.mocked(ensureGodmodeProxy).mockResolvedValue(true);
    vi.mocked(getGodmodeService).mockReturnValue({
      isInitialized: () => true,
      chatStreamFull: (args: any) => models[args.model](),
    } as any);
  }

  it('falls back to the free router when wrapping fails before output in non-strict mode', async () => {
    process.env.DMRX_AUTOFREE_KEEPALIVE_MS = '0';
    mockGodmodeStream({ 'gm-empty': async function* () {} });
    const { app, attempted } = await buildStreamApp({
      autoFreeWrap: true,
      planPrimary: { providerId: 'p-good', modelId: 'free-model' },
      adapters: { 'p-good': () => gen([
        { type: 'token', data: { content: 'direct free answer' } }, { type: 'done' },
      ]) },
    });
    try {
      const response = await app.inject({ method: 'POST', url: '/chat/completions',
        headers: { 'x-cost-filter': 'free', 'x-free-tier-strategy': 'free_only' },
        payload: { model: 'auto-free', messages: [{ role: 'user', content: 'hello' }], stream: true },
      });
      expect(attempted).toEqual(['p-good']);
      expect(dataFrames(response.body).some((x) => x?.choices?.[0]?.delta?.content === 'direct free answer')).toBe(true);
      expect(errorFrames(response.body)).toEqual([]);
    } finally { await app.close(); }
  });

  it('closes with an explicit error when every wrapped stream is empty', { timeout: 1500 }, async () => {
    process.env.DMRX_AUTOFREE_KEEPALIVE_MS = '0';
    process.env.DMRX_GODMODE_STRICT = 'true';
    mockGodmodeStream({
      'gm-empty-a': async function* () {},
      'gm-empty-b': async function* () {},
    });
    vi.mocked(isGodmodeStrict).mockReturnValue(true);
    const app = await buildGodmodeApp();
    try {
      const res = await app.inject({
        method: 'POST', url: '/chat/completions',
        payload: { model: 'auto-free', messages: [{ role: 'user', content: 'hi' }], stream: true },
      });
      expect(errorFrames(res.body)[0]?.error.message).toContain('all godmode stream attempts failed');
      expect(parseSSEFrames(res.body).filter((f) => f.doneSentinel).length).toBe(1);
    } finally { await app.close(); }
  });

  it(
    'aborts a stalled wrap attempt on per-model TTFT and serves the next candidate BEFORE output',
    { timeout: 8000 },
    async () => {
      process.env.DMRX_AUTOFREE_TTFT_MS = '120';
      process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS = '10000';
      process.env.DMRX_AUTOFREE_KEEPALIVE_MS = '0';
      let hangCount = 0;
      mockGodmodeStream({
        'gm-hang': async function* () {
          hangCount++;
          await new Promise(() => {}); // never yields, never throws
          yield { content: 'unreachable' };
        },
        'gm-ok': () =>
          (async function* () {
            yield { content: 'recovered' };
          })(),
      });
      const app = await buildGodmodeApp();
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/chat/completions',
          payload: { model: 'auto-free', messages: [{ role: 'user', content: 'hi' }], stream: true },
        });
        expect(res.statusCode).toBe(200);
        expect(hangCount).toBe(1);
        expect(errorFrames(res.body)).toEqual([]);
        const frames = dataFrames(res.body);
        const text = frames.map((f) => f.choices?.[0]?.delta?.content ?? '').join('');
        expect(text).toBe('recovered');
        // actual serving model reported, never the stalled primary
        for (const f of frames) expect(f.model).toBe('gm-ok');
        expect(parseSSEFrames(res.body).filter((f) => f.doneSentinel).length).toBe(1);
      } finally {
        await app.close();
      }
    },
  );

  it(
    'keepalive comments are not semantic output: stalled attempt still fails over, stream stays intact',
    { timeout: 8000 },
    async () => {
      process.env.DMRX_AUTOFREE_TTFT_MS = '150';
      process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS = '10000';
      process.env.DMRX_AUTOFREE_KEEPALIVE_MS = '15';
      mockGodmodeStream({
        'gm-hang': async function* () {
          await new Promise(() => {});
          yield { content: 'unreachable' };
        },
        'gm-ok': () =>
          (async function* () {
            yield { content: 'after ping' };
          })(),
      });
      const app = await buildGodmodeApp();
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/chat/completions',
          payload: { model: 'auto-free', messages: [{ role: 'user', content: 'hi' }], stream: true },
        });
        expect(res.statusCode).toBe(200);
        // server keepalive comments were emitted while waiting pre-first-chunk
        expect(res.body).toContain(': ping');
        expect(errorFrames(res.body)).toEqual([]);
        const text = dataFrames(res.body)
          .map((f) => f.choices?.[0]?.delta?.content ?? '')
          .join('');
        expect(text).toBe('after ping');
        expect(parseSSEFrames(res.body).filter((f) => f.doneSentinel).length).toBe(1);
      } finally {
        await app.close();
      }
    },
  );

  it(
    'bounds an unavailable sidecar: strict mode emits a meaningful bounded error fast',
    { timeout: 8000 },
    async () => {
      process.env.DMRX_AUTOFREE_PROXY_READY_MS = '100';
      process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS = '10000';
      vi.mocked(buildGodmodeWrapOrder).mockReturnValue(['gm-a']);
      vi.mocked(ensureGodmodeProxy).mockImplementation(() => new Promise(() => {})); // sidecar never comes up
      vi.mocked(isGodmodeStrict).mockReturnValue(true);
      const app = await buildGodmodeApp();
      try {
        const started = Date.now();
        const res = await app.inject({
          method: 'POST',
          url: '/chat/completions',
          payload: { model: 'auto-free', messages: [{ role: 'user', content: 'hi' }], stream: true },
        });
        const elapsed = Date.now() - started;
        expect(elapsed).toBeLessThan(5000);
        const errs = errorFrames(res.body);
        expect(errs.length).toBeGreaterThan(0);
        expect(errs[0].error.message).toMatch(/godmode proxy unavailable/);
      } finally {
        await app.close();
      }
    },
  );

  it(
    'clears all godmode stream timers (proxy-ready, TTFT, keepalive, watchdog)',
    { timeout: 8000 },
    async () => {
      process.env.DMRX_AUTOFREE_TTFT_MS = '80';
      process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS = '10000';
      process.env.DMRX_AUTOFREE_KEEPALIVE_MS = '10';
      process.env.DMRX_AUTOFREE_PROXY_READY_MS = '5000';
      mockGodmodeStream({
        'gm-hang': async function* () {
          await new Promise(() => {});
          yield { content: 'unreachable' };
        },
        'gm-ok': () =>
          (async function* () {
            yield { content: 'timers clean' };
          })(),
      });
      const createdTimeouts: unknown[] = [];
      const clearedTimeouts: unknown[] = [];
      const createdIntervals: unknown[] = [];
      const clearedIntervals: unknown[] = [];
      const realSetTimeout = globalThis.setTimeout;
      const realClearTimeout = globalThis.clearTimeout;
      const realSetInterval = globalThis.setInterval;
      const realClearInterval = globalThis.clearInterval;
      const spies = [
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms: any, ...a: any[]) => {
          const h = realSetTimeout(fn, ms, ...a);
          createdTimeouts.push(h);
          return h;
        }) as any),
        vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((h: any) => {
          clearedTimeouts.push(h);
          return realClearTimeout(h);
        }) as any),
        vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: any, ms: any, ...a: any[]) => {
          const h = realSetInterval(fn, ms, ...a);
          createdIntervals.push(h);
          return h;
        }) as any),
        vi.spyOn(globalThis, 'clearInterval').mockImplementation(((h: any) => {
          clearedIntervals.push(h);
          return realClearInterval(h);
        }) as any),
      ];
      try {
        const app = await buildGodmodeApp();
        try {
          const res = await app.inject({
            method: 'POST',
            url: '/chat/completions',
            payload: { model: 'auto-free', messages: [{ role: 'user', content: 'hi' }], stream: true },
          });
          expect(res.statusCode).toBe(200);
          expect(errorFrames(res.body)).toEqual([]);
          expect(res.body).toContain('timers clean');
        } finally {
          await app.close();
        }
        // proxy-ready + TTFT + watchdog timers all created and all cleared
        expect(createdTimeouts.length).toBeGreaterThanOrEqual(3);
        for (const h of createdTimeouts) expect(clearedTimeouts).toContain(h);
        // keepalive interval created while waiting, cleared on first output
        expect(createdIntervals.length).toBeGreaterThanOrEqual(1);
        for (const h of createdIntervals) expect(clearedIntervals).toContain(h);
      } finally {
        for (const s of spies) s.mockRestore();
      }
    },
  );

  it(
    'never retries after output started: mid-stream godmode failure closes, does not mix models',
    { timeout: 8000 },
    async () => {
      process.env.DMRX_AUTOFREE_TTFT_MS = '500';
      process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS = '10000';
      process.env.DMRX_AUTOFREE_KEEPALIVE_MS = '0';
      let okCalls = 0;
      mockGodmodeStream({
        'gm-first': () =>
          (async function* () {
            yield { content: 'partial output then stall-fail' };
            throw new Error('mid-stream provider death');
          })(),
        'gm-second': () =>
          (async function* () {
            okCalls++;
            yield { content: 'MUST NOT APPEAR' };
          })(),
      });
      const app = await buildGodmodeApp();
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/chat/completions',
          payload: { model: 'auto-free', messages: [{ role: 'user', content: 'hi' }], stream: true },
        });
        expect(res.statusCode).toBe(200);
        expect(okCalls).toBe(0);
        expect(res.body).not.toContain('MUST NOT APPEAR');
        expect(res.body).toContain('partial output then stall-fail');
        // every semantic frame belongs to the first (actual) model
        for (const f of dataFrames(res.body)) expect(f.model).toBe('gm-first');
      } finally {
        await app.close();
      }
    },
  );
});
