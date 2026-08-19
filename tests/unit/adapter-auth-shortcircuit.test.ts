import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for provider-wide auth failure short-circuiting.
 *
 * BUG: `KEY_SCOPED_STATUSES` contains 401/403/404/429, so ANY of them makes the
 * key-rotation loop walk the entire pool. That is correct for 429 (a genuine
 * per-key quota signal) but wrong for 401/403 when the credential was revoked
 * PROVIDER-WIDE: every key returns the same 403 and the loop burns all N keys,
 * each with its own nested HTTP backoff, until the caller's timeout expires.
 *
 * Observed live: `tokenrouter` returned 403 for every model
 * (claude-sonnet-4.5, gpt-5.2, qwen3.5, seedream-4.5, deepseek-v4-pro) across a
 * 7-key pool. `/v1/chat/completions` hung for 57s and returned nothing instead
 * of failing fast with the auth error.
 *
 * FIX: once TWO DISTINCT keys have returned the same auth status (401/403),
 * treat it as provider-scoped and stop rotating — surface the error immediately.
 * A single key failing 401/403 still rotates (that key may simply be bad).
 * 429 rotation is untouched.
 *
 * These tests model the loop semantics rather than importing BaseAdapter, whose
 * construction pulls in the full adapter/telemetry/config stack.
 */

const KEY_SCOPED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 429]);
const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403]);

class HttpErr extends Error {
  constructor(public statusCode: number) {
    super('http ' + statusCode);
  }
}

/**
 * Mirrors the FIXED rotation logic in
 * services/adapters/src/base.adapter.ts (withKeyRotation) and
 * services/adapters/src/generic-openai/generic-openai.adapter.ts (executeChat).
 */
function rotate(
  poolSize: number,
  attemptFn: (keyIndex: number) => Promise<string>,
): Promise<{ result?: string; error?: unknown; attempts: number }> {
  return (async () => {
    const attempts = Math.max(1, poolSize);
    let lastError: unknown;
    let authFailures = 0;
    let used = 0;

    for (let i = 0; i < attempts; i++) {
      used++;
      try {
        return { result: await attemptFn(i), attempts: used };
      } catch (error) {
        lastError = error;
        const status = (error as { statusCode?: number })?.statusCode;

        if (status && AUTH_STATUSES.has(status)) {
          authFailures++;
          // Two distinct keys rejected with the same auth status => the
          // credential problem is provider-wide, not key-scoped.
          if (authFailures >= 2) {
            return { error, attempts: used };
          }
        }

        if (i === attempts - 1 || !status || !KEY_SCOPED_STATUSES.has(status)) {
          return { error, attempts: used };
        }
      }
    }
    return { error: lastError, attempts: used };
  })();
}

describe('provider-wide auth failure short-circuit', () => {
  it('stops after 2 keys when every key returns 403 (was: all 7)', async () => {
    const fn = vi.fn(async () => {
      throw new HttpErr(403);
    });
    const out = await rotate(7, fn);

    expect(out.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    expect((out.error as HttpErr).statusCode).toBe(403);
  });

  it('stops after 2 keys when every key returns 401', async () => {
    const out = await rotate(7, async () => {
      throw new HttpErr(401);
    });
    expect(out.attempts).toBe(2);
  });

  it('still walks the WHOLE pool for 429 (per-key quota is real)', async () => {
    const fn = vi.fn(async () => {
      throw new HttpErr(429);
    });
    const out = await rotate(5, fn);

    expect(out.attempts).toBe(5);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('a SINGLE bad key still rotates and succeeds on the next', async () => {
    const fn = vi.fn(async (i: number) => {
      if (i === 0) throw new HttpErr(403);
      return 'ok';
    });
    const out = await rotate(7, fn);

    expect(out.result).toBe('ok');
    expect(out.attempts).toBe(2);
  });

  it('mixed 429 then 403 rotates for the 429 and does not short-circuit early', async () => {
    const fn = vi.fn(async (i: number) => {
      if (i === 0) throw new HttpErr(429);
      return 'ok';
    });
    const out = await rotate(4, fn);

    expect(out.result).toBe('ok');
    expect(out.attempts).toBe(2);
  });

  it('a non-key-scoped status (500) fails immediately without rotating', async () => {
    const fn = vi.fn(async () => {
      throw new HttpErr(500);
    });
    const out = await rotate(7, fn);

    expect(out.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a single-key pool makes exactly one attempt on 403', async () => {
    const fn = vi.fn(async () => {
      throw new HttpErr(403);
    });
    const out = await rotate(1, fn);

    expect(out.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on the first key without consuming the pool', async () => {
    const fn = vi.fn(async () => 'first');
    const out = await rotate(7, fn);

    expect(out.result).toBe('first');
    expect(out.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('404 still rotates the full pool (model may exist on another account)', async () => {
    const fn = vi.fn(async () => {
      throw new HttpErr(404);
    });
    const out = await rotate(3, fn);

    expect(out.attempts).toBe(3);
  });
});
