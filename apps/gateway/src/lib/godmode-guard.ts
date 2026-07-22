/**
 * Shared godmode proxy guard for `auto-free` requests.
 *
 * Single source of truth for the guarantee that any `auto-free` request is
 * served through the G0DM0D3 godmode proxy, and that the proxy is auto-
 * restarted on demand if it is down at the moment the API is called.
 *
 * Used by every chat endpoint that accepts an explicit `model` field
 * (OpenAI /v1/chat/completions and Anthropic /v1/messages). The Gemini
 * endpoint has no client-supplied model selector, and agent-chat derives its
 * model from the agent definition, so neither can request `auto-free`.
 */
import { logger } from '@dmr-x/utils';

/** Model wrap-order tried against the godmode proxy (full multi-candidate
 *  fallback in the vault first, then concrete models the vault reliably
 *  serves), keeping the WRAP intact instead of dropping to an unwrapped
 *  response. */
export const GODMODE_WRAP_ORDER = ['auto-free', 'codestral-latest', 'gemini-3.1-flash-lite'];

/** Reads DMRX_GODMODE_STRICT. When true, an `auto-free` request that cannot
 *  get the godmode proxy up hard-fails instead of silently degrading to an
 *  unwrapped plain provider. */
export function isGodmodeStrict(): boolean {
  return process.env.DMRX_GODMODE_STRICT === 'true';
}

let godmodeRestartInFlight: Promise<boolean> | null = null;

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
    const gatewayUrl = process.env.DMRX_GATEWAY_URL || `http://localhost:${process.env.PORT || 47113}`;

    const live = serverManager.getRunningInstance();
    const liveHealthy = live?.url
      ? await serverManager.healthCheck({ url: live.url, timeoutMs: 2500 }).catch(() => false)
      : false;

    if (liveHealthy) {
      // Registered + healthy but the proxy lost its config — re-point + re-init.
      setGodmodeConfig({
        baseUrl: live!.url ?? 'http://localhost:7860',
        openrouterApiKey: '',
        llmBaseUrl: live!.llm_base_url ?? `${gatewayUrl}/v1`,
        llmApiKey: live!.llm_api_key ?? undefined,
      });
    } else {
      // No instance, or it died. Tear down any zombie then boot fresh in relay
      // mode (reuses DMR-X's provider vault — no OpenRouter key needed).
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
 *  if necessary. Returns true when the proxy is ready to wrap `auto-free`. */
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
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface GodmodeWrapResult {
  /** 'wrapped' when served via the godmode proxy; 'unavailable' when the proxy
   *  could not be brought up (caller decides strict-fail vs concrete fallback). */
  status: 'wrapped' | 'unavailable';
  completion?: any;
}

/**
 * Resolve an `auto-free` request through the godmode proxy (non-streaming).
 *
 * - Ensures (and auto-restarts) the proxy.
 * - Returns `{ status: 'wrapped', completion }` with the OpenAI-shaped
 *   completion, or `{ status: 'unavailable' }` if the proxy is down and could
 *   not be restarted. Callers convert `completion` to their wire format and
 *   handle strict-mode / concrete fallback.
 *
 * Streaming is intentionally NOT handled here: each endpoint's SSE framing
 * differs (OpenAI chunks vs Anthropic events vs Gemini `data:` lines), so the
 * caller runs its own streaming loop after `ensureGodmodeProxy()` returns
 * ready. `GODMODE_WRAP_ORDER` is exported for that purpose.
 */
export async function wrapAutoFreeViaGodmode(
  args: GodmodeWrapArgs,
): Promise<GodmodeWrapResult> {
  const { requestId, messages, model, temperature, maxTokens, topP } = args;
  const proxyReady = await ensureGodmodeProxy(requestId).catch(() => false);
  if (!proxyReady) {
    return { status: 'unavailable' };
  }

  const { getGodmodeService } = await import('@dmr-x/godmode');
  const godmode = getGodmodeService();
  if (!godmode.isInitialized()) {
    try {
      await godmode.initialize();
    } catch {
      /* fall through to wrap-attempt error handling */
    }
  }
  if (!godmode.isInitialized()) {
    return { status: 'unavailable' };
  }

  // Non-streaming: collect the wrapped completion.
  let completion: any;
  let wrapErr: unknown;
  for (const wrapModel of GODMODE_WRAP_ORDER) {
    try {
      completion = await godmode.chat({
        messages,
        model: wrapModel,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
      });
      wrapErr = undefined;
      break;
    } catch (e) {
      wrapErr = e;
      logger.warn({ requestId, wrapModel, err: e }, 'auto-free godmode wrap attempt failed; trying next model');
    }
  }
  if (wrapErr || !completion) {
    logger.error({ requestId, err: wrapErr }, 'all godmode wrap attempts failed');
    return { status: 'unavailable' };
  }
  return { status: 'wrapped', completion };
}
