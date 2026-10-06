/**
 * Godmode Routes — G0DM0D3 integration endpoints for DMR-X.
 *
 * Provides:
 * - POST /v1/godmode/chat — Chat with AutoTune/Parseltongue/STM pipeline
 * - POST /v1/godmode/ultraplinian — Multi-model racing
 * - POST /v1/godmode/consortium — Hive-mind synthesis
 * - POST /v1/godmode/autotune — Analyze message for optimal params
 * - POST /v1/godmode/parseltongue — Encode text with obfuscation
 * - POST /v1/godmode/transform — Apply STM modules
 * - GET  /v1/godmode/tier — Get tier information
 * - GET  /v1/godmode/health — Health check
 * - GET  /v1/godmode/server/updates — Pinned vs fork vs upstream commit state
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { logger, resolveGatewayUrl } from '@dmr-x/utils';
import { getGodmodeService, setGodmodeConfig } from '@dmr-x/godmode';
import { serverManager, getGodmodeRepoInfo, getInstalledGodmodeRef } from '@dmr-x/server-manager';
import { checkGodmodeUpstream } from '../lib/godmode-upstream.js';
import { validateBaseUrlForSSRF, type ValidatedURL } from './admin-ssrf.js';
import type {
  GodmodeChatRequest,
  UltraplinianRequest,
  ConsortiumRequest,
  AutotuneAnalyzeRequest,
  ParseltongueEncodeRequest,
  TransformRequest,
  GodmodeConfig,
} from '@dmr-x/godmode';

// ─── Schemas ────────────────────────────────────────────────────────────────

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const GodmodeChatSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  model: z.string().optional(),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  godmode: z.boolean().optional().default(true),
  custom_system_prompt: z.string().optional(),
  autotune: z.boolean().optional().default(true),
  autotune_strategy: z.enum(['adaptive', 'precise', 'balanced', 'creative', 'chaotic']).optional(),
  parseltongue: z.boolean().optional().default(true),
  parseltongue_technique: z.enum(['leetspeak', 'unicode', 'zwj', 'mixedcase', 'phonetic', 'random']).optional(),
  parseltongue_intensity: z.enum(['light', 'medium', 'heavy']).optional(),
  stm_modules: z.array(z.enum(['hedge_reducer', 'direct_mode', 'curiosity_bias', 'casual_mode'])).optional(),
  contribute_to_dataset: z.boolean().optional().default(false),
});

const UltraplinianSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  tier: z.enum(['fast', 'standard', 'smart', 'power', 'ultra']).optional().default('fast'),
  godmode: z.boolean().optional().default(true),
  custom_system_prompt: z.string().optional(),
  autotune: z.boolean().optional().default(true),
  strategy: z.enum(['adaptive', 'precise', 'balanced', 'creative', 'chaotic']).optional(),
  parseltongue: z.boolean().optional().default(true),
  parseltongue_technique: z.enum(['leetspeak', 'unicode', 'zwj', 'mixedcase', 'phonetic', 'random']).optional(),
  parseltongue_intensity: z.enum(['light', 'medium', 'heavy']).optional(),
  stm_modules: z.array(z.enum(['hedge_reducer', 'direct_mode', 'curiosity_bias', 'casual_mode'])).optional(),
  max_tokens: z.number().positive().optional(),
  contribute_to_dataset: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(false),
});

const ConsortiumSchema = UltraplinianSchema.extend({
  orchestrator_model: z.string().optional(),
});

const AutotuneAnalyzeSchema = z.object({
  message: z.string().min(1),
  conversation_history: z.array(ChatMessageSchema).optional(),
  strategy: z.enum(['adaptive', 'precise', 'balanced', 'creative', 'chaotic']).optional(),
  overrides: z.record(z.number()).optional(),
});

const ParseltongueEncodeSchema = z.object({
  text: z.string().min(1),
  technique: z.enum(['leetspeak', 'unicode', 'zwj', 'mixedcase', 'phonetic', 'random']).optional(),
  intensity: z.enum(['light', 'medium', 'heavy']).optional(),
  custom_triggers: z.array(z.string()).optional(),
});

const TransformSchema = z.object({
  text: z.string().min(1),
  modules: z.array(z.enum(['hedge_reducer', 'direct_mode', 'curiosity_bias', 'casual_mode'])).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

function replyError(err: unknown): { error: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  return { error: 'server_operation_failed', message };
}

/**
 * Self-heal guard for godmode inference routes: if the sidecar is not up,
 * bring it online via the shared godmode-guard (the same restart path the
 * `auto-free` flow uses). Without this, every godmode panel request dies
 * with a connection error whenever the sidecar is down — e.g. after a
 * gateway restart while DMRX_GODMODE_AUTOSTART was false, which is exactly
 * how "godmode stopped working through dmrx" surfaced.
 */
async function ensureGodmodeProxyReady(): Promise<boolean> {
  const { ensureGodmodeProxy } = await import('../lib/godmode-guard.js');
  return ensureGodmodeProxy('godmode-route').catch(() => false);
}

/** 503 reply when the proxy could not be brought online. */
function proxyUnavailableReply(reply: {
  status: (code: number) => { send: (payload: unknown) => unknown };
}) {
  return reply.status(503).send({
    error: 'godmode_unavailable',
    message: 'G0DM0D3 proxy unavailable — not running and auto-start failed',
  });
}


export async function godmodeRoutes(server: FastifyInstance): Promise<void> {
  const service = getGodmodeService();

  // Ensure service is initialized before handling requests
  if (!service.isInitialized()) {
    try {
      await service.initialize();
    } catch (err) {
      logger.warn({ err }, 'GodmodeService initialization deferred — will retry on first request');
    }
  }

  // Health check
  server.get('/godmode/health', async () => {
    const healthy = await service.healthCheck();
    return { status: healthy ? 'ok' : 'unhealthy' };
  });

  // Tier info
  server.get('/godmode/tier', async () => {
    try {
      return await service.getTierInfo();
    } catch (err: any) {
      logger.warn({ err }, 'Failed to get tier info');
      return { error: 'Failed to get tier info', message: err.message };
    }
  });

  // Chat
  server.post('/godmode/chat', async (request, reply) => {
    const parsed = GodmodeChatSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as GodmodeChatRequest;

    // Self-heal: ensure the sidecar is up before touching it (chat relays
    // inference through the gateway vault, so a down sidecar must restart).
    if (!(await ensureGodmodeProxyReady())) {
      return proxyUnavailableReply(reply);
    }

    // Model resolution + fallback (pick-then-wrap). When no model is supplied,
    // rank the live vault candidates with the same picker the `auto-free` flow
    // uses. Either way, build an ORDERED candidate list and try each in turn:
    // a single pick can 403 (quota) or answer with an empty completion, and
    // dying on the first attempt is what produced the 500s the UI saw.
    const { buildGodmodeWrapOrder, buildWrapOrderForModel, isEmptyCompletion } =
      await import('../lib/godmode-guard.js');
    const router = (server as any).router as { getCandidates?: () => any };
    const costFilter = (request.headers['x-cost-filter'] as 'free' | 'all') || undefined;
    const candidates = router?.getCandidates?.() ?? [];
    const wrapOrder = body.model
      ? buildWrapOrderForModel(body.model, candidates, costFilter)
      : buildGodmodeWrapOrder(candidates, costFilter);
    if (wrapOrder.length === 0) {
      throw new ValidationError(
        'No model available for godmode wrap — add provider candidates or pass model explicitly',
        {},
      );
    }
    logger.info({ wrapOrder }, 'godmode chat: resolved model order via DMR-X router');

    if (body.stream) {
      // Streaming response. A picked model can fail before its first delta
      // (upstream 403/500 surfaces as a throw from chatStream), so retry the
      // next pick until one actually produces output — nothing is written to
      // the wire until the first successful chunk.
      reply.header('Content-Type', 'text/event-stream');
      reply.header('Cache-Control', 'no-cache');
      reply.header('Connection', 'keep-alive');

      let committed = false;
      let streamErr: unknown;
      for (const wrapModel of wrapOrder) {
        try {
          let yielded = false;
          for await (const chunk of service.chatStream({ ...body, model: wrapModel })) {
            yielded = true;
            committed = true;
            const data = JSON.stringify({
              choices: [{ delta: { content: chunk } }],
            });
            reply.raw.write(`data: ${data}\n\n`);
          }
          if (committed) {
            streamErr = undefined;
            break;
          }
          streamErr = new Error(`godmode stream for ${wrapModel} produced no content`);
        } catch (err) {
          streamErr = err;
          // Once bytes are on the wire we cannot switch models mid-stream.
          if (committed) break;
          logger.warn({ wrapModel, err }, 'godmode chat stream attempt failed; trying next picked model');
        }
      }
      if (!committed && streamErr) {
        const data = JSON.stringify({
          error: { message: (streamErr as Error).message ?? 'godmode stream failed' },
        });
        reply.raw.write(`data: ${data}\n\n`);
      }
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return reply;
    }

    let chatErr: unknown;
    for (const wrapModel of wrapOrder) {
      try {
        const attempt = await service.chat({ ...body, model: wrapModel });
        // A 200 with no content and no tool calls does NOT throw — treat it as
        // a failed attempt and try the next pick instead of returning it.
        if (isEmptyCompletion(attempt)) {
          chatErr = new Error(`godmode chat for ${wrapModel} returned empty content`);
          logger.warn({ wrapModel }, 'godmode chat attempt returned empty content; trying next picked model');
          continue;
        }
        return attempt;
      } catch (err) {
        chatErr = err;
        logger.warn({ wrapModel, err }, 'godmode chat attempt failed; trying next picked model');
      }
    }
    throw chatErr ?? new Error('godmode chat failed for every picked model');
  });

  // ULTRAPLINIAN
  server.post('/godmode/ultraplinian', async (request, reply) => {
    const parsed = UltraplinianSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as UltraplinianRequest & { stream?: boolean };

    if (!(await ensureGodmodeProxyReady())) {
      return proxyUnavailableReply(reply);
    }

    if (body.stream) {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      try {
        for await (const evt of service.ultraplinianStream(body)) {
          const e = evt as { event: string; data: unknown };
          reply.raw.write(`event: ${e.event}\n`);
          reply.raw.write(`data: ${JSON.stringify(e.data)}\n\n`);
        }
      } catch (err: any) {
        reply.raw.write(`event: race:error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      reply.raw.write('event: done\ndata: [DONE]\n\n');
      reply.raw.end();
      return reply;
    }

    return service.ultraplinian(body);
  });

  // CONSORTIUM
  server.post('/godmode/consortium', async (request, reply) => {
    const parsed = ConsortiumSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as ConsortiumRequest & { stream?: boolean };

    if (!(await ensureGodmodeProxyReady())) {
      return proxyUnavailableReply(reply);
    }

    if (body.stream) {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      try {
        for await (const evt of service.consortiumStream(body)) {
          const e = evt as { event: string; data: unknown };
          reply.raw.write(`event: ${e.event}\n`);
          reply.raw.write(`data: ${JSON.stringify(e.data)}\n\n`);
        }
      } catch (err: any) {
        reply.raw.write(`event: consortium:error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      reply.raw.write('event: done\ndata: [DONE]\n\n');
      reply.raw.end();
      return reply;
    }

    return service.consortium(body);
  });

  // ─── Server management (G0DM0D3 auto-install) ─────────────────────────────

  // Install + clone the pinned G0DM0D3 repo.
  server.post('/godmode/server/install', async (request) => {
    try {
      const body = (request.body ?? {}) as { openrouterApiKey?: string; llmBaseUrl?: string; llmApiKey?: string };
      // C4 — SSRF: validate llmBaseUrl against private/loopback ranges before
      // passing it to serverManager.install(). The godmode lifecycle endpoints
      // are tenant-authenticated, not admin-authenticated, so any tenant key
      // could point the relay at an internal host without this check.
      if (body.llmBaseUrl) {
        await validateBaseUrlForSSRF(body.llmBaseUrl);
      }
      const res = await serverManager.install({
        openrouterApiKey: '',
        llmBaseUrl: body.llmBaseUrl,
        llmApiKey: body.llmApiKey
      });
      const relay = res.openrouter_key_ref?.startsWith('relay:')
        ? res.openrouter_key_ref.slice('relay:'.length)
        : null;
      // Point the proxy at the freshly-launched server.
      setGodmodeConfig({
        baseUrl: res.url ?? 'http://localhost:47115',
        apiKey: res.api_key ?? undefined,
        openrouterApiKey: '',
        llmBaseUrl: res.llm_base_url || relay || `${resolveGatewayUrl().replace(/\/+$/, '')}/v1`,
        llmApiKey: res.llm_api_key ?? undefined,
      });
      await getGodmodeService().initialize();
      return { status: res.status, url: res.url, runtime: res.runtime, id: res.id };
    } catch (err: any) {
      logger.error({ err }, 'G0DM0D3 install/start failed');
      return replyError(err);
    }
  });

  // Start an already-installed server (re-run start for a stopped instance).
  server.post('/godmode/server/start', async (request) => {
    try {
      const body = (request.body ?? {}) as { openrouterApiKey?: string; llmBaseUrl?: string; llmApiKey?: string };
      // Godmode is DMR-X's wrapping companion. Provider-vault credentials
      // never select a direct OpenRouter inference path.
      const gatewayUrl = resolveGatewayUrl();
      // C4 — SSRF: validate llmBaseUrl before passing to serverManager.start()
      if (body.llmBaseUrl) {
        await validateBaseUrlForSSRF(body.llmBaseUrl);
      }
      const llmBaseUrl = body.llmBaseUrl || `${gatewayUrl.replace(/\/+$/, '')}/v1`;
      const res = await serverManager.start({
        openrouterApiKey: '',
        llmBaseUrl,
        llmApiKey: body.llmApiKey
      });
      const relay = res.openrouter_key_ref?.startsWith('relay:')
        ? res.openrouter_key_ref.slice('relay:'.length)
        : null;
      setGodmodeConfig({
        baseUrl: res.url ?? 'http://localhost:47115',
        apiKey: res.api_key ?? undefined,
        openrouterApiKey: '',
        llmBaseUrl: res.llm_base_url || relay || `${resolveGatewayUrl().replace(/\/+$/, '')}/v1`,
        llmApiKey: res.llm_api_key ?? undefined,
      });
      await getGodmodeService().initialize();
      return { status: res.status, url: res.url, runtime: res.runtime, id: res.id };
    } catch (err: any) {
      logger.error({ err, stack: err?.stack }, 'G0DM0D3 start failed');
      return replyError(err);
    }
  });

  // Stop a running server.
  server.post('/godmode/server/stop', async () => {
    try {
      await serverManager.stop();
      return { status: 'stopped' };
    } catch (err: any) {
      logger.error({ err }, 'G0DM0D3 stop failed');
      return replyError(err);
    }
  });

  // Current server status (from persisted server_instances).
  //
  // `installed` distinguishes "never cloned" from "cloned but stopped" — the
  // UI needs this to decide whether to offer Install (clone + deps) or Start
  // (launch an existing checkout). Both endpoints self-heal either way
  // (start() clones if missing), but the distinction drives what the button
  // says and whether a fresh install shows meaningful progress.
  server.get('/godmode/server/status', async () => {
    const installed = serverManager.isInstalled();
    const inst = serverManager.getRunningInstance();
    if (!inst) {
      return { status: installed ? 'stopped' : 'not_installed', running: false, installed };
    }
    let healthy = false;
    try {
      healthy = await serverManager.healthCheck({ url: inst.url ?? '' });
    } catch {
      healthy = false;
    }
    return {
      status: healthy ? 'running' : inst.status,
      running: healthy,
      runtime: inst.runtime,
      url: inst.url,
      installed,
    };
  });

  // How the installed G0DM0D3 relates to upstream elder-plinius/G0DM0D3.
  //
  // Always 200, even when GitHub is unreachable: the locally-known half
  // (pinned + installed ref) is always available, and an offline gateway must
  // still be able to tell the user what it is running. `error` in the body
  // signals the remote half is missing and the UI degrades to "could not
  // check". See lib/godmode-upstream.ts for the caching and failure rules.
  server.get('/godmode/server/updates', async () => {
    const { repo, ref, upstream } = getGodmodeRepoInfo();
    return {
      repo,
      upstream,
      pinnedRef: ref,
      installedRef: getInstalledGodmodeRef(),
      checkedAt: new Date().toISOString(),
      ...(await checkGodmodeUpstream(repo, upstream, ref)),
    };
  });

  // Current config the proxy is pointed at.
  server.get('/godmode/server/config', async () => {
    const cfg = service.getConfig();
    return {
      baseUrl: cfg?.baseUrl,
      hasApiKey: Boolean(cfg?.apiKey),
      openrouterConfigured: Boolean(cfg?.openrouterApiKey),
      inferenceMode: cfg?.llmBaseUrl ? 'dmrx-relay' : 'unconfigured',
      llmBaseUrl: cfg?.llmBaseUrl,
      ...getGodmodeRepoInfo(),
    };
  });

  // AutoTune analyze
  server.post('/godmode/autotune', async (request, reply) => {
    const parsed = AutotuneAnalyzeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as AutotuneAnalyzeRequest;
    if (!(await ensureGodmodeProxyReady())) {
      return proxyUnavailableReply(reply);
    }
    return service.autotuneAnalyze(body);
  });

  // Parseltongue encode
  server.post('/godmode/parseltongue', async (request, reply) => {
    const parsed = ParseltongueEncodeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as ParseltongueEncodeRequest;
    if (!(await ensureGodmodeProxyReady())) {
      return proxyUnavailableReply(reply);
    }
    return service.parseltongueEncode(body);
  });

  // STM transform
  server.post('/godmode/transform', async (request, reply) => {
    const parsed = TransformSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as TransformRequest;
    if (!(await ensureGodmodeProxyReady())) {
      return proxyUnavailableReply(reply);
    }
    return service.transform(body);
  });
}
