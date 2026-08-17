/**
 * needlePreFilter — cheap first-stage tool pre-router.
 *
 * POSTs the query + tools to the local Needle 2 router (services/needle-router,
 * bound at localhost:8011) and returns the subset of input tools that Needle
 * matched. NEVER throws: any failure returns `undefined` so the caller falls
 * back to the full tool list.
 *
 * Needle 2 is an OPTIMISATION — it trims the tool list before the real model
 * sees it. It is never load-bearing, so it gets a hard latency budget.
 *
 * MEASURED REALITY (old Needle, JAX inference, 2026-08-03 — now replaced):
 *   The old Needle (JAX) had a floor of 52-81s per call on CPU — per-token
 *   dispatch overhead in the decode loop. That's why this filter shipped
 *   off-by-default.
 *
 * Needle 2 (cactus-needle) replaces the JAX serving path with a C engine
 * (ctypes FFI). The first query is instant; subsequent queries are bounded
 * by the C engine's throughput. If that holds, this filter can actually
 * complete inside the latency budget — but it remains opt-in until measured
 * on this machine.
 *
 *   - The filter is OFF BY DEFAULT via a settings-backed toggle
 *     (`needleRouterEnabled` in the `settings` table, default false when
 *     absent) read fresh on every call — no gateway restart needed to flip
 *     it. See `isNeedleEnabled()`.
 *   - `GET /v1/admin/needle/status` reports live reachability, the enabled
 *     flag, and the outcome/latency of the last real attempt, so an operator
 *     turning this on gets honest, immediate feedback instead of a silent
 *     no-op.
 *   - The env-level kill switch (`DMRX_NEEDLE_TIMEOUT_MS=0`) still works and
 *     takes precedence, for anyone who wants a hard override outside the DB.
 *
 * Tune with:
 *   DMRX_NEEDLE_TIMEOUT_MS   budget in ms (default 1500, 0 disables the filter)
 *   DMRX_NEEDLE_URL          override the endpoint
 */

import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';

const DEFAULT_NEEDLE_URL = 'http://localhost:8011/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 1500;
const NEEDLE_ENABLED_SETTINGS_KEY = 'needleRouterEnabled';

function timeoutMs(): number {
  const raw = process.env.DMRX_NEEDLE_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function needleUrl(): string {
  return process.env.DMRX_NEEDLE_URL || DEFAULT_NEEDLE_URL;
}

/** Origin (`http://host:port`) the chat-completions URL resolves to, for deriving `/health`. */
function needleOrigin(): string {
  try {
    return new URL(needleUrl()).origin;
  } catch {
    return 'http://localhost:8011';
  }
}

/** `/health` endpoint for the configured Needle instance — used by the admin status route. */
export function needleHealthUrl(): string {
  return `${needleOrigin()}/health`;
}

/**
 * Settings-backed runtime toggle, read fresh on every call (sql.js is
 * in-memory, so this costs a map lookup, not I/O). Defaults to `false` when
 * the row is absent — see the module doc for why the filter ships opt-in.
 */
export function isNeedleEnabled(): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(NEEDLE_ENABLED_SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return false;
    return JSON.parse(row.value) === true;
  } catch (err) {
    logger.warn({ err }, 'Failed to read needleRouterEnabled setting — treating Needle as disabled');
    return false;
  }
}

export type NeedleOutcome =
  | 'disabled'
  | 'matched'
  | 'no_match'
  | 'timeout'
  | 'http_error'
  | 'network_error';

export interface NeedleTelemetry {
  /** ISO timestamp of the last time `needlePreFilter` did anything (including a disabled short-circuit). */
  lastAttemptAt: string | null;
  lastOutcome: NeedleOutcome | null;
  /** Wall-clock ms for the last real network attempt. `null` for 'disabled' (no attempt was made). */
  lastLatencyMs: number | null;
  lastError: string | null;
  lastMatchedCount: number | null;
  lastToolCount: number | null;
}

let telemetry: NeedleTelemetry = {
  lastAttemptAt: null,
  lastOutcome: null,
  lastLatencyMs: null,
  lastError: null,
  lastMatchedCount: null,
  lastToolCount: null,
};

/** In-process snapshot of the last `needlePreFilter` call, surfaced via `/v1/admin/needle/status`. */
export function getNeedleTelemetry(): NeedleTelemetry {
  return { ...telemetry };
}

function recordTelemetry(partial: Omit<NeedleTelemetry, 'lastAttemptAt'>): void {
  telemetry = { lastAttemptAt: new Date().toISOString(), ...partial };
}

export async function needlePreFilter(
  tools: any[] | undefined,
  query: string,
  topK = 5,
): Promise<any[] | undefined> {
  const budget = timeoutMs();
  // Env-level kill switch — skip the network call entirely. Takes precedence
  // over the settings toggle since it's meant as a hard override.
  if (budget === 0) return tools;

  if (!tools || tools.length < 2) {
    return tools;
  }

  if (!isNeedleEnabled()) {
    recordTelemetry({
      lastOutcome: 'disabled',
      lastLatencyMs: null,
      lastError: null,
      lastMatchedCount: null,
      lastToolCount: tools.length,
    });
    return tools;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  const start = Date.now();

  try {
    const res = await fetch(needleUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'needle2',
        messages: [{ role: 'user', content: query }],
        tools,
      }),
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - start;

    if (!res.ok) {
      recordTelemetry({
        lastOutcome: 'http_error',
        lastLatencyMs: elapsedMs,
        lastError: `HTTP ${res.status}`,
        lastMatchedCount: null,
        lastToolCount: tools.length,
      });
      return undefined;
    }

    const data = (await res.json()) as any;
    const matched: string[] = [];
    const toolCalls = data?.choices?.[0]?.message?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const name = tc?.function?.name;
        if (name && !matched.includes(name)) {
          matched.push(name);
        }
      }
    }

    if (matched.length === 0) {
      recordTelemetry({
        lastOutcome: 'no_match',
        lastLatencyMs: elapsedMs,
        lastError: null,
        lastMatchedCount: 0,
        lastToolCount: tools.length,
      });
      return undefined;
    }

    const matchedSet = new Set(matched);
    const narrowed = tools.filter(
      (t) => t?.function?.name && matchedSet.has(t.function.name),
    );

    recordTelemetry({
      lastOutcome: 'matched',
      lastLatencyMs: elapsedMs,
      lastError: null,
      lastMatchedCount: matched.length,
      lastToolCount: tools.length,
    });

    return narrowed.slice(0, topK);
  } catch (err) {
    const elapsedMs = Date.now() - start;
    // Abort is the expected path when Needle is slower than its budget, and
    // it is logged at debug so a slow-but-working Needle does not spam warn.
    if ((err as { name?: string })?.name === 'AbortError') {
      recordTelemetry({
        lastOutcome: 'timeout',
        lastLatencyMs: elapsedMs,
        lastError: `exceeded ${budget}ms budget`,
        lastMatchedCount: null,
        lastToolCount: tools.length,
      });
      logger.debug(
        { budgetMs: budget, elapsedMs, toolCount: tools?.length },
        'Needle pre-filter exceeded its latency budget — using the full tool list',
      );
    } else {
      recordTelemetry({
        lastOutcome: 'network_error',
        lastLatencyMs: elapsedMs,
        lastError: (err as Error)?.message ?? String(err),
        lastMatchedCount: null,
        lastToolCount: tools.length,
      });
    }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
