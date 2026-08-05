import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkGodmodeUpstream,
  clearGodmodeUpstreamCache,
  githubSlug,
} from '../../apps/gateway/src/lib/godmode-upstream.js';

const FORK = 'https://github.com/danny-dis/G0DM0D3.git';
const UPSTREAM = 'https://github.com/elder-plinius/G0DM0D3';
const SHA = 'f6301765fb90eb7b336bdf365319cd2fe44b1187';
const NEWER = 'a'.repeat(40);

/** Stub api.github.com, routing by path so call order does not matter. */
function mockGithub(routes: Record<string, unknown>, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    const body = routes[path];
    if (body === undefined) throw new Error(`unexpected GitHub call: ${path}`);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const HAPPY = {
  '/repos/danny-dis/G0DM0D3/commits/main': { sha: SHA },
  '/repos/elder-plinius/G0DM0D3/commits/main': { sha: SHA },
  '/repos/danny-dis/G0DM0D3/compare/main...elder-plinius:main': { behind_by: 0 },
};

describe('githubSlug', () => {
  it('accepts the shapes DMRX_GODMODE_REPO is actually set to', () => {
    expect(githubSlug(FORK)).toBe('danny-dis/G0DM0D3');
    expect(githubSlug(UPSTREAM)).toBe('elder-plinius/G0DM0D3');
    expect(githubSlug('http://www.github.com/a/b/')).toBe('a/b');
  });

  it('rejects non-GitHub remotes rather than mangling them into a slug', () => {
    expect(githubSlug('https://gitlab.com/a/b.git')).toBeNull();
    expect(githubSlug('git@github.com:a/b.git')).toBeNull();
    expect(githubSlug('/local/path/to/repo')).toBeNull();
  });
});

describe('checkGodmodeUpstream', () => {
  beforeEach(() => {
    clearGodmodeUpstreamCache();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports in-sync when fork, upstream and pin all agree', async () => {
    mockGithub(HAPPY);
    const state = await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(state).toEqual({
      forkHead: SHA,
      upstreamHead: SHA,
      behindUpstream: 0,
      pinnedIsForkHead: true,
    });
    expect(state.error).toBeUndefined();
  });

  it('separates "fork trails upstream" from "pin trails fork"', async () => {
    // Fork has been synced past the commit DMR-X still pins to. That is a
    // ref-bump PR waiting to merge, NOT an upstream sync problem — the two
    // are distinct states and the UI words them differently.
    mockGithub({
      ...HAPPY,
      '/repos/danny-dis/G0DM0D3/commits/main': { sha: NEWER },
      '/repos/elder-plinius/G0DM0D3/commits/main': { sha: NEWER },
    });
    const state = await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(state.behindUpstream).toBe(0);
    expect(state.pinnedIsForkHead).toBe(false);
  });

  it('surfaces how far the fork trails upstream', async () => {
    mockGithub({
      ...HAPPY,
      '/repos/danny-dis/G0DM0D3/compare/main...elder-plinius:main': { behind_by: 7 },
    });
    const state = await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(state.behindUpstream).toBe(7);
  });

  it('does not call GitHub for a non-GitHub repo', async () => {
    const fetchMock = mockGithub(HAPPY);
    const state = await checkGodmodeUpstream('https://gitlab.com/a/b.git', UPSTREAM, SHA);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.forkHead).toBeNull();
    expect(state.error).toMatch(/not on github\.com/i);
  });

  it('degrades to a populated error instead of throwing when GitHub is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const state = await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(state.error).toContain('ECONNREFUSED');
    expect(state.behindUpstream).toBeNull();
    expect(state.pinnedIsForkHead).toBe(false);
  });

  it('explains a 403 as a rate limit, not a permissions problem', async () => {
    mockGithub(HAPPY, 403);
    const state = await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(state.error).toMatch(/rate limit/i);
  });

  it('memoises success so a button-mashing user cannot exhaust the rate limit', async () => {
    const fetchMock = mockGithub(HAPPY);
    await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    const afterFirst = fetchMock.mock.calls.length;
    for (let i = 0; i < 5; i++) await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });

  it('does not cache failures — a blip must not stick for the whole TTL', async () => {
    const failing = vi.fn(async () => { throw new Error('ETIMEDOUT'); });
    vi.stubGlobal('fetch', failing);
    await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(failing.mock.calls.length).toBeGreaterThan(1);

    // ...and the next attempt still gets through to a recovered GitHub.
    mockGithub(HAPPY);
    expect((await checkGodmodeUpstream(FORK, UPSTREAM, SHA)).error).toBeUndefined();
  });

  it('coalesces concurrent checks into one set of GitHub requests', async () => {
    // A double-click on "Check again" fires the second request before the
    // first resolves, so the cache cannot help — without in-flight de-dup both
    // would spend three requests against a 60/hour budget.
    const fetchMock = mockGithub(HAPPY);
    const results = await Promise.all([
      checkGodmodeUpstream(FORK, UPSTREAM, SHA),
      checkGodmodeUpstream(FORK, UPSTREAM, SHA),
      checkGodmodeUpstream(FORK, UPSTREAM, SHA),
    ]);
    expect(fetchMock.mock.calls.length).toBe(3); // three endpoints, once each
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it('releases the in-flight slot after a failure so the next call retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('EAI_AGAIN'); }));
    await Promise.all([
      checkGodmodeUpstream(FORK, UPSTREAM, SHA),
      checkGodmodeUpstream(FORK, UPSTREAM, SHA),
    ]);
    const recovered = mockGithub(HAPPY);
    const state = await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(recovered.mock.calls.length).toBeGreaterThan(0);
    expect(state.error).toBeUndefined();
  });

  it('re-checks once the TTL expires', async () => {
    vi.useFakeTimers();
    const fetchMock = mockGithub(HAPPY);
    await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    const afterFirst = fetchMock.mock.calls.length;
    vi.advanceTimersByTime(16 * 60 * 1000);
    await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('sends the token only when one is configured', async () => {
    const fetchMock = mockGithub(HAPPY);
    await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    const anon = (fetchMock.mock.calls[0]?.[1] ?? {}) as { headers?: Record<string, string> };
    expect(anon.headers?.Authorization).toBeUndefined();

    clearGodmodeUpstreamCache();
    process.env.GITHUB_TOKEN = 'ghp_test';
    const withToken = mockGithub(HAPPY);
    await checkGodmodeUpstream(FORK, UPSTREAM, SHA);
    const authed = (withToken.mock.calls[0]?.[1] ?? {}) as { headers?: Record<string, string> };
    expect(authed.headers?.Authorization).toBe('Bearer ghp_test');
  });
});
