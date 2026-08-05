/**
 * Upstream-freshness check for the managed G0DM0D3 install.
 *
 * DMR-X runs G0DM0D3 from its own fork (`danny-dis/G0DM0D3`) pinned to a
 * commit SHA, and `.github/workflows/godmode-fork-sync.yml` fast-forwards that
 * fork from `elder-plinius/G0DM0D3` nightly. Four commits are therefore in
 * play and any of them can differ:
 *
 *   upstreamHead  — elder-plinius/G0DM0D3 main
 *   forkHead      — our fork's main (chases upstreamHead nightly)
 *   pinnedRef     — DMRX_GODMODE_REF: what a *fresh* install clones
 *   installedRef  — what is actually checked out on this machine
 *
 * This module answers "how far behind is each of those" so the UI can say it
 * in one sentence instead of showing four SHAs and leaving the user to work it
 * out.
 *
 * Kept out of `godmode.routes.ts` so it is unit-testable without standing up
 * a Fastify instance.
 */

import { logger } from '@dmr-x/utils';

/** The half of the answer that costs a GitHub API call. */
export interface GodmodeUpstreamState {
  forkHead: string | null;
  upstreamHead: string | null;
  /** Commits the fork's main is behind upstream's main; null if unknown. */
  behindUpstream: number | null;
  /** True when the pinned commit is exactly the fork's current HEAD. */
  pinnedIsForkHead: boolean;
  /** Set when GitHub could not be reached or the repo is not on GitHub. */
  error?: string;
}

/**
 * Unauthenticated GitHub allows 60 requests/hour per IP and each check burns
 * three of them. This endpoint sits behind a "Check again" button, so without
 * a cache a user clicking twenty times would exhaust the budget for the whole
 * machine — including anything else sharing that IP. Fifteen minutes is far
 * finer-grained than the nightly workflow that actually moves these commits.
 */
export const UPDATE_CHECK_TTL_MS = 15 * 60 * 1000;

let cache: { at: number; state: GodmodeUpstreamState } | null = null;

/**
 * The single outstanding request, if one is in flight.
 *
 * The cache alone does not stop concurrent calls: a double-click on "Check
 * again" fires the second request before the first has resolved, so neither
 * sees a populated cache and both spend three GitHub requests. Callers that
 * arrive mid-flight join the existing promise instead.
 */
let inflight: Promise<GodmodeUpstreamState> | null = null;

/** Drop the memoised result — for tests, and for an explicit forced refresh. */
export function clearGodmodeUpstreamCache(): void {
  cache = null;
  inflight = null;
}

/** `https://github.com/owner/name(.git)` → `owner/name`; null for anything else. */
export function githubSlug(repoUrl: string): string | null {
  const m = repoUrl.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * GitHub REST with a hard timeout.
 *
 * `fetch` has no default timeout, so a hung connection would pin a Fastify
 * handler open indefinitely. `GITHUB_TOKEN` is used when present purely to
 * raise the rate limit — every endpoint used here is public.
 */
async function githubApi(path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dmr-x',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com${path}`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    // 403 on a public repo is nearly always the rate limit rather than a
    // permissions problem — saying "Forbidden" here would send the user
    // hunting for a token they do not need.
    if (res.status === 403 || res.status === 429) {
      throw new Error('GitHub API rate limit reached — try again later.');
    }
    throw new Error(`GitHub API ${res.status} for ${path}`);
  }
  return res.json();
}

/**
 * HEAD commit SHA of a repo's `main` branch.
 *
 * `main` is hardcoded rather than read from the repo's `default_branch`: both
 * G0DM0D3 repos use it, and resolving it would cost an extra request against
 * the same 60/hour budget this module exists to conserve. A fork whose default
 * branch is something else reports "could not check" — documented alongside
 * `DMRX_GODMODE_UPSTREAM` in docs/CONFIGURATION.md.
 */
async function githubHead(slug: string): Promise<string | null> {
  const json = (await githubApi(`/repos/${slug}/commits/main`)) as { sha?: string };
  return typeof json.sha === 'string' ? json.sha : null;
}

/**
 * How many commits `forkSlug`'s main trails `upstreamSlug`'s main.
 *
 * Uses the compare API's `behind_by` rather than a SHA equality check: a fork
 * carrying a hand-applied hotfix is *ahead* of upstream, which is not the same
 * as being out of date, and equality alone cannot tell those apart.
 */
async function githubBehindBy(forkSlug: string, upstreamSlug: string): Promise<number | null> {
  const upstreamOwner = upstreamSlug.split('/')[0];
  const json = (await githubApi(`/repos/${forkSlug}/compare/main...${upstreamOwner}:main`)) as {
    behind_by?: number;
  };
  return typeof json.behind_by === 'number' ? json.behind_by : null;
}

/**
 * Resolve fork/upstream commit state, memoised for {@link UPDATE_CHECK_TTL_MS}.
 *
 * Never throws: a network failure, a rate limit, or a non-GitHub repo all come
 * back as a populated `error` with null heads. The caller pairs this with the
 * locally-known refs, which are always available — an offline gateway must
 * still be able to tell the user what it has installed.
 */
export async function checkGodmodeUpstream(
  repo: string,
  upstream: string,
  pinnedRef: string
): Promise<GodmodeUpstreamState> {
  const cached = cache;
  if (cached && Date.now() - cached.at <= UPDATE_CHECK_TTL_MS) return cached.state;
  cache = null;

  const unknown = (error: string): GodmodeUpstreamState => ({
    forkHead: null,
    upstreamHead: null,
    behindUpstream: null,
    pinnedIsForkHead: false,
    error,
  });

  const forkSlug = githubSlug(repo);
  const upstreamSlug = githubSlug(upstream);
  if (!forkSlug || !upstreamSlug) {
    // A self-hosted or non-GitHub DMRX_GODMODE_REPO. Not an error condition —
    // there is simply no API to ask, and saying so beats inventing state.
    // Deliberately not cached: it is a pure function of config, and caching it
    // would outlive a config change within the TTL.
    return unknown('Repo is not on github.com — upstream state cannot be checked.');
  }

  if (inflight) return inflight;

  const run = async (): Promise<GodmodeUpstreamState> => {
    try {
      // All three in parallel. `behind_by` does not depend on the two head
      // SHAs, so awaiting it separately only doubled worst-case latency on a
      // request a user is actively waiting on.
      const [forkHead, upstreamHead, behindUpstream] = await Promise.all([
        githubHead(forkSlug),
        githubHead(upstreamSlug),
        githubBehindBy(forkSlug, upstreamSlug),
      ]);
      const state: GodmodeUpstreamState = {
        forkHead,
        upstreamHead,
        behindUpstream,
        pinnedIsForkHead: forkHead !== null && forkHead === pinnedRef,
      };
      cache = { at: Date.now(), state };
      return state;
    } catch (err) {
      // Failures are not cached — a transient network blip should not lock the
      // card into "could not check" for the next fifteen minutes.
      const message = err instanceof Error ? err.message : 'GitHub request failed';
      logger.warn({ err }, 'G0DM0D3 upstream check failed');
      return unknown(message);
    } finally {
      inflight = null;
    }
  };

  inflight = run();
  return inflight;
}
