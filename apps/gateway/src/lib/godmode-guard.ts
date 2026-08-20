/**
 * Shared godmode proxy guard for `auto-free` requests.
 *
 * Flow (pick-then-wrap):
 *  1. Gateway ranks active candidates via the `auto-free` meta-model.
 *  2. The top concrete model(s) are sent through G0DM0D3 for persona wrapping.
 *  3. Godmode relays inference back to DMR-X with that sticky concrete model
 *     (X-DMRX-Godmode-Proxy loop-breaker skips re-wrapping).
 *
 * Used by OpenAI /v1/chat/completions and Anthropic /v1/messages.
 */
import type { CandidateSet } from '@dmr-x/core';
import { isMetaModel, resolveMetaModel } from '@dmr-x/router';
import { logger, resolveGatewayUrl } from '@dmr-x/utils';

/** Last-resort concrete models when the vault has no `auto-free` candidates. */
export const GODMODE_WRAP_FALLBACK = ['codestral-latest', 'gemini-3.1-flash-lite'];

/**
 * @deprecated Prefer {@link buildGodmodeWrapOrder}. Kept as an alias of the
 * empty-vault fallback list so older imports keep compiling.
 */
export const GODMODE_WRAP_ORDER = GODMODE_WRAP_FALLBACK;

const DEFAULT_WRAP_CANDIDATE_LIMIT = 5;

/**
 * True when a completion carries no usable payload — no assistant text and no
 * tool calls. Mirrors the generic-openai adapter's post-response guard
 * (`generic-openai.adapter.ts`, "empty content and no tool calls"): some free
 * upstreams answer HTTP 200 with `content: ""` instead of erroring, which does
 * NOT throw and so cannot be detected by a try/catch alone.
 */
export function isEmptyCompletion(completion: unknown): boolean {
  const message = (completion as any)?.choices?.[0]?.message;
  if (!message) return true;
  const hasContent =
    typeof message.content === 'string' && message.content.length > 0;
  const hasToolCalls =
    Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return !hasContent && !hasToolCalls;
}

/** Reads DMRX_GODMODE_STRICT. When true, an `auto-free` request that cannot
 *  get the godmode proxy up hard-fails instead of silently degrading to an
 *  unwrapped plain provider. */
export function isGodmodeStrict(): boolean {
  return process.env.DMRX_GODMODE_STRICT === 'true';
}

let godmodeRestartInFlight: Promise<boolean> | null = null;

/**
 * Rank gateway candidates with the `auto-free` meta-model and return concrete
 * model ids (pick-first). Empty vault → emergency fallbacks.
 */
export function buildGodmodeWrapOrder(
  candidates: CandidateSet,
  costFilter?: 'free' | 'all',
  limit = DEFAULT_WRAP_CANDIDATE_LIMIT,
): string[] {
  return buildWrapOrderForModel('auto-free', candidates, costFilter, limit);
}

/**
 * Rank gateway candidates for an arbitrary model and return concrete model ids
 * (pick-first). Unlike {@link buildGodmodeWrapOrder} — which is pinned to the
 * `auto-free` meta-model — this resolves the GIVEN model:
 *  - a meta-model alias (e.g. `auto`, `auto-smart`, `auto-fast`) ranks its
 *    candidates through that meta-model's ranker (any family by default);
 *  - a concrete provider/model id (contains '/') is used directly;
 *  - nothing resolvable → emergency fallbacks.
 *
 * Used by the agent loop's opt-in `godmodeWrap` path, where the agent's OWN
 * resolved model (any family) is wrapped rather than a hardcoded `auto-free`.
 */
export function buildWrapOrderForModel(
  model: string,
  candidates: CandidateSet,
  costFilter?: 'free' | 'all',
  limit = DEFAULT_WRAP_CANDIDATE_LIMIT,
): string[] {
  const resolution = resolveMetaModel(model, candidates, costFilter);
  const seen = new Set<string>();
  const order: string[] = [];

  for (const c of resolution?.resolved ?? []) {
    const id = c.modelId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    if (order.length >= limit) break;
  }

  if (order.length > 0) return order;

  // A KNOWN meta-model alias that ranked zero candidates (e.g. an empty
  // vault) must NOT be treated as a concrete model id — wrapping it would
  // re-enter the meta-model and loop. Fall back to the emergency list.
  if (isMetaModel(model)) {
    logger.warn({ model }, 'godmode wrap: meta-model ranked zero candidates — using emergency fallbacks');
    return [...GODMODE_WRAP_FALLBACK];
  }

  // Not a meta-model: treat the model as a concrete id and wrap it directly.
  // Only when it is blank too do we fall back to the emergency list.
  const trimmed = model.trim();
  if (trimmed) {
    logger.warn({ model }, 'godmode wrap: model not resolvable as meta-model — wrapping concrete id directly');
    return [trimmed];
  }

  logger.warn('godmode wrap: no ranked candidates — using emergency fallbacks');
  return [...GODMODE_WRAP_FALLBACK];
}

/**
 * Bring the godmode proxy online on demand:
 *  - initialized AND reachable → true immediately;
 *  - otherwise → auto-restart via the server-manager in relay mode (reuses
 *    DMR-X's own provider vault — no OpenRouter key required), re-point the
 *    proxy config, re-init. Returns false only if the restart genuinely fails.
 *
 * Restarts are serialized via a module-level in-flight promise so concurrent
 * `auto-free` calls don't each spawn a duplicate child process.
 */
async function restartGodmodeProxy(requestId: string): Promise<boolean> {
  try {
    const { getGodmodeService, setGodmodeConfig } = await import('@dmr-x/godmode');
    const { serverManager } = await import('@dmr-x/server-manager');
    const godmode = getGodmodeService();
    const gatewayUrl = resolveGatewayUrl();

    // First: check if godmode is already reachable on the default URL
    // (externally managed instance — don't spawn a duplicate on the same port).
    const defaultUrl = process.env.GODMODE_API_URL || 'http://localhost:47115';
    try {
      const res = await fetch(`${defaultUrl}/v1/health`, { method: 'GET', signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        // Adopt the persisted api_key when no env key is set. server-manager
        // always generates and persists one when it spawns the sidecar, so
        // this keeps the gateway authenticated against a gateway-managed
        // instance even after an env-less restart (B-006 follow-up) — without
        // it, every relayed wrap would 401 against the keyed sidecar.
        const liveRow = serverManager.getRunningInstance();
        setGodmodeConfig({
          baseUrl: defaultUrl,
          apiKey: process.env.GODMODE_API_KEY || liveRow?.api_key || undefined,
          openrouterApiKey: process.env.OPENROUTER_API_KEY,
          llmBaseUrl: `${gatewayUrl}/v1`,
          llmApiKey: process.env.DMRX_ADMIN_API_KEY || undefined,
        });
        await godmode.initialize();
        logger.info({ requestId, url: defaultUrl }, 'Godmode proxy found healthy (externally managed)');
        return true;
      }
    } catch {
      // not reachable on default URL — fall through to server-manager path
    }

    const live = serverManager.getRunningInstance();
    const liveHealthy = live?.url
      ? await serverManager.healthCheck({ url: live.url, timeoutMs: 2500 }).catch(() => false)
      : false;

    if (liveHealthy) {
      setGodmodeConfig({
        baseUrl: live!.url ?? 'http://localhost:47115',
        apiKey: live!.api_key ?? undefined,
        openrouterApiKey: '',
        llmBaseUrl: live!.llm_base_url ?? `${gatewayUrl}/v1`,
        llmApiKey: live!.llm_api_key ?? undefined,
      });
    } else {
      try {
        await serverManager.stop();
      } catch {
        /* nothing to stop */
      }
      const started = await serverManager.start({
        openrouterApiKey: '',
        llmBaseUrl: `${gatewayUrl}/v1`,
      });
      setGodmodeConfig({
        baseUrl: started.url ?? 'http://localhost:47115',
        apiKey: started.api_key ?? undefined,
        openrouterApiKey: '',
        llmBaseUrl: started.llm_base_url ?? `${gatewayUrl}/v1`,
        llmApiKey: started.llm_api_key ?? undefined,
      });
    }

    await godmode.initialize();
    logger.info({ requestId }, 'Godmode proxy auto-restarted for auto-free request');
    return true;
  } catch (err) {
    logger.error({ err, requestId }, 'Godmode proxy auto-restart failed');
    return false;
  }
}

/** Ensure the godmode proxy is initialized and reachable, auto-restarting it
 *  if necessary. Returns true when the proxy is ready to wrap. */
export async function ensureGodmodeProxy(requestId: string): Promise<boolean> {
  const { getGodmodeService } = await import('@dmr-x/godmode');
  const godmode = getGodmodeService();

  if (godmode.isInitialized()) {
    const reachable = await godmode.healthCheck().catch(() => false);
    if (reachable) return true;
    logger.warn({ requestId }, 'Godmode proxy initialized but unreachable — restarting');
  }

  if (!godmodeRestartInFlight) {
    godmodeRestartInFlight = restartGodmodeProxy(requestId).finally(() => {
      godmodeRestartInFlight = null;
    });
  }
  return godmodeRestartInFlight;
}

export interface GodmodeWrapArgs {
  requestId: string;
  messages: any[];
  /** Model to wrap. For the OpenAI path this is `auto-free`; for the agent
   *  loop's opt-in `godmodeWrap` path it is the agent's OWN resolved model
   *  (any family) — the wrap order is built from this model. */
  model: string;
  /** Live router candidates — ranked to pick the active wrap model(s). */
  candidates: CandidateSet;
  costFilter?: 'free' | 'all';
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** OpenAI-format tool definitions to round-trip through the wrap. */
  tools?: any[];
  tool_choice?: any;
}

export interface GodmodeWrapResult {
  /** 'wrapped' when served via the godmode proxy; 'unavailable' when the proxy
   *  could not be brought up or every picked model failed to wrap. */
  status: 'wrapped' | 'unavailable';
  completion?: any;
  /** Concrete model that successfully wrapped (pick-then-wrap). */
  wrapModel?: string;
  /** Ordered concrete models that were attempted. */
  wrapOrder?: string[];
}

/**
 * Resolve a request through the godmode proxy (non-streaming). The wrap order
 * is built from `args.model` — a meta-model alias ranks its candidates, a
 * concrete model id is wrapped directly (see {@link buildWrapOrderForModel}).
 *
 * Pick-then-wrap: rank vault candidates first, then wrap each concrete model
 * through G0DM0D3 until one succeeds.
 *
 * Streaming stays in the route handlers (SSE framing differs per wire format);
 * use {@link buildWrapOrderForModel} + {@link ensureGodmodeProxy} there.
 */
export async function wrapViaGodmode(
  args: GodmodeWrapArgs,
): Promise<GodmodeWrapResult> {
  const { requestId, messages, model, temperature, maxTokens, topP, candidates, costFilter, tools, tool_choice } = args;
  const wrapOrder = buildWrapOrderForModel(model, candidates, costFilter);
  logger.info(
    { requestId, model, primary: wrapOrder[0], wrapOrder },
    'godmode pick-then-wrap: resolved concrete model(s) for wrap',
  );

  const proxyReady = await ensureGodmodeProxy(requestId).catch(() => false);
  if (!proxyReady) {
    return { status: 'unavailable', wrapOrder };
  }

  const { getGodmodeService } = await import('@dmr-x/godmode');
  const godmode = getGodmodeService();
  if (!godmode.isInitialized()) {
    try {
      await godmode.initialize();
    } catch {
      /* fall through */
    }
  }
  if (!godmode.isInitialized()) {
    return { status: 'unavailable', wrapOrder };
  }

  let completion: any;
  let wrapErr: unknown;
  let usedModel: string | undefined;
  for (const wrapModel of wrapOrder) {
    try {
      const attempt = await godmode.chat({
        messages,
        model: wrapModel,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        ...(tools !== undefined ? { tools } : {}),
        ...(tool_choice !== undefined ? { tool_choice } : {}),
      });
      // A 200 with no content and no tool calls does NOT throw, so without this
      // check the loop would break on a blank completion and hand the caller an
      // empty message. Treat it as a failed attempt and try the next model.
      if (isEmptyCompletion(attempt)) {
        wrapErr = new Error(
          `godmode wrap returned HTTP 200 with empty content and no tool calls (model=${wrapModel})`,
        );
        logger.warn(
          { requestId, wrapModel },
          'godmode wrap returned empty content; trying next picked model',
        );
        continue;
      }
      completion = attempt;
      wrapErr = undefined;
      usedModel = wrapModel;
      break;
    } catch (e) {
      wrapErr = e;
      logger.warn({ requestId, wrapModel, err: e }, 'godmode wrap attempt failed; trying next picked model');
    }
  }
  if (wrapErr || !completion || !usedModel) {
    logger.error({ requestId, err: wrapErr, wrapOrder }, 'all godmode wrap attempts failed');
    return { status: 'unavailable', wrapOrder };
  }
  return { status: 'wrapped', completion, wrapModel: usedModel, wrapOrder };
}

/**
 * Resolve an `auto-free` request through the godmode proxy (non-streaming).
 *
 * Pick-then-wrap: rank vault candidates first, then wrap each concrete model
 * through G0DM0D3 until one succeeds.
 *
 * @deprecated Prefer {@link wrapViaGodmode} which accepts any model; this is a
 * model-agnostic alias pinned to `auto-free` for existing callers.
 */
export async function wrapAutoFreeViaGodmode(
  args: GodmodeWrapArgs,
): Promise<GodmodeWrapResult> {
  return wrapViaGodmode({ ...args, model: 'auto-free' });
}
