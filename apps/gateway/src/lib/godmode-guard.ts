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
import { resolveMetaModel } from '@dmr-x/router';
import { logger, resolveGatewayUrl } from '@dmr-x/utils';

/** Last-resort concrete models when the vault has no `auto-free` candidates. */
export const GODMODE_WRAP_FALLBACK = ['codestral-latest', 'gemini-3.1-flash-lite'];

/**
 * @deprecated Prefer {@link buildGodmodeWrapOrder}. Kept as an alias of the
 * empty-vault fallback list so older imports keep compiling.
 */
export const GODMODE_WRAP_ORDER = GODMODE_WRAP_FALLBACK;

const DEFAULT_WRAP_CANDIDATE_LIMIT = 5;

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
  const resolution = resolveMetaModel('auto-free', candidates, costFilter);
  const seen = new Set<string>();
  const order: string[] = [];

  for (const c of resolution?.resolved ?? []) {
    const id = c.modelId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    if (order.length >= limit) break;
  }

  if (order.length === 0) {
    logger.warn('auto-free wrap: no ranked candidates — using emergency fallbacks');
    return [...GODMODE_WRAP_FALLBACK];
  }

  return order;
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

    const live = serverManager.getRunningInstance();
    const liveHealthy = live?.url
      ? await serverManager.healthCheck({ url: live.url, timeoutMs: 2500 }).catch(() => false)
      : false;

    if (liveHealthy) {
      setGodmodeConfig({
        baseUrl: live!.url ?? 'http://localhost:7860',
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
        baseUrl: started.url ?? 'http://localhost:7860',
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
  /** Usually `auto-free`; used only for logging. */
  model: string;
  /** Live router candidates — ranked to pick the active wrap model(s). */
  candidates: CandidateSet;
  costFilter?: 'free' | 'all';
  temperature?: number;
  maxTokens?: number;
  topP?: number;
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
 * Resolve an `auto-free` request through the godmode proxy (non-streaming).
 *
 * Pick-then-wrap: rank vault candidates first, then wrap each concrete model
 * through G0DM0D3 until one succeeds.
 *
 * Streaming stays in the route handlers (SSE framing differs per wire format);
 * use {@link buildGodmodeWrapOrder} + {@link ensureGodmodeProxy} there.
 */
export async function wrapAutoFreeViaGodmode(
  args: GodmodeWrapArgs,
): Promise<GodmodeWrapResult> {
  const { requestId, messages, temperature, maxTokens, topP, candidates, costFilter } = args;
  const wrapOrder = buildGodmodeWrapOrder(candidates, costFilter);
  logger.info(
    { requestId, primary: wrapOrder[0], wrapOrder },
    'auto-free pick-then-wrap: resolved concrete model(s) for godmode',
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
      completion = await godmode.chat({
        messages,
        model: wrapModel,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
      });
      wrapErr = undefined;
      usedModel = wrapModel;
      break;
    } catch (e) {
      wrapErr = e;
      logger.warn({ requestId, wrapModel, err: e }, 'auto-free godmode wrap attempt failed; trying next picked model');
    }
  }
  if (wrapErr || !completion || !usedModel) {
    logger.error({ requestId, err: wrapErr, wrapOrder }, 'all godmode wrap attempts failed');
    return { status: 'unavailable', wrapOrder };
  }
  return { status: 'wrapped', completion, wrapModel: usedModel, wrapOrder };
}
