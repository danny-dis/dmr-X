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
 * - POST /v1/godmode/feedback — Submit feedback to the EMA learning loop
 * - GET  /v1/godmode/feedback/stats — Get learning statistics (EMA state)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import { getGodmodeService, setGodmodeConfig } from '@dmr-x/godmode';
import { serverManager } from '@dmr-x/server-manager';
import type {
  GodmodeChatRequest,
  UltraplinianRequest,
  ConsortiumRequest,
  AutotuneAnalyzeRequest,
  ParseltongueEncodeRequest,
  TransformRequest,
  GodmodeConfig,
  GodmodeFeedbackRequest,
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

const FeedbackSchema = z.object({
  message_id: z.string().min(1),
  context_type: z.enum(['code', 'creative', 'analytical', 'conversational', 'chaotic']),
  model: z.string().optional(),
  persona: z.string().optional(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  params: z.record(z.number()),
  response_text: z.string().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

function replyError(err: unknown): { error: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  return { error: 'server_operation_failed', message };
}

export async function godmodeRoutes(server: FastifyInstance): Promise<void> {
  const service = getGodmodeService();

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

    if (body.stream) {
      // Streaming response
      reply.header('Content-Type', 'text/event-stream');
      reply.header('Cache-Control', 'no-cache');
      reply.header('Connection', 'keep-alive');

      const stream = service.chatStream(body);
      for await (const chunk of stream) {
        const data = JSON.stringify({
          choices: [{ delta: { content: chunk } }],
        });
        reply.raw.write(`data: ${data}\n\n`);
      }
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return reply;
    }

    return service.chat(body);
  });

  // ULTRAPLINIAN
  server.post('/godmode/ultraplinian', async (request, reply) => {
    const parsed = UltraplinianSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as UltraplinianRequest & { stream?: boolean };

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
      const res = await serverManager.install({
        openrouterApiKey: body.openrouterApiKey ?? process.env.OPENROUTER_API_KEY,
        llmBaseUrl: body.llmBaseUrl,
        llmApiKey: body.llmApiKey,
      });
      const relay = res.openrouter_key_ref?.startsWith('relay:')
        ? res.openrouter_key_ref.slice('relay:'.length)
        : null;
      // Point the proxy at the freshly-launched server.
      setGodmodeConfig({
        baseUrl: res.url ?? 'http://localhost:7860',
        apiKey: res.api_key ?? undefined,
        openrouterApiKey: relay ? '' : (process.env.OPENROUTER_API_KEY ?? ''),
        llmBaseUrl: relay ?? undefined,
        llmApiKey: relay ? res.llm_api_key ?? undefined : undefined,
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
      // No OpenRouter key and no explicit relay → default to routing through
      // DMR-X itself (reuses the host's provider vault, incl. LOCAL MODE).
      const gatewayUrl = process.env.DMRX_GATEWAY_URL || `http://localhost:${process.env.PORT || 47113}`;
      const useRelay = !body.openrouterApiKey && !process.env.OPENROUTER_API_KEY;
      const llmBaseUrl = body.llmBaseUrl ?? (useRelay ? `${gatewayUrl}/v1` : undefined);
      const res = await serverManager.start({
        openrouterApiKey: body.openrouterApiKey ?? process.env.OPENROUTER_API_KEY,
        llmBaseUrl,
        llmApiKey: body.llmApiKey,
      });
      const relay = res.openrouter_key_ref?.startsWith('relay:')
        ? res.openrouter_key_ref.slice('relay:'.length)
        : null;
      setGodmodeConfig({
        baseUrl: res.url ?? 'http://localhost:7860',
        apiKey: res.api_key ?? undefined,
        openrouterApiKey: relay ? '' : (process.env.OPENROUTER_API_KEY ?? ''),
        llmBaseUrl: relay ?? undefined,
        llmApiKey: relay ? res.llm_api_key ?? undefined : undefined,
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
  server.get('/godmode/server/status', async () => {
    const inst = serverManager.getRunningInstance();
    if (!inst) {
      return { status: 'stopped', running: false };
    }
    let healthy = false;
    try {
      healthy = await serverManager.healthCheck({ url: inst.url ?? '' });
    } catch {
      healthy = false;
    }
    return { status: healthy ? 'running' : inst.status, running: healthy, runtime: inst.runtime, url: inst.url };
  });

  // Current config the proxy is pointed at.
  server.get('/godmode/server/config', async () => {
    const cfg = service.getConfig();
    return {
      baseUrl: cfg?.baseUrl,
      hasApiKey: Boolean(cfg?.apiKey),
      openrouterConfigured: Boolean(cfg?.openrouterApiKey),
    };
  });

  // AutoTune analyze
  server.post('/godmode/autotune', async (request) => {
    const parsed = AutotuneAnalyzeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as AutotuneAnalyzeRequest;
    return service.autotuneAnalyze(body);
  });

  // Parseltongue encode
  server.post('/godmode/parseltongue', async (request) => {
    const parsed = ParseltongueEncodeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as ParseltongueEncodeRequest;
    return service.parseltongueEncode(body);
  });

  // STM transform
  server.post('/godmode/transform', async (request) => {
    const parsed = TransformSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as TransformRequest;
    return service.transform(body);
  });

  // ─── Feedback / EMA learning loop ───────────────────────────────────────

  // Submit feedback for the G0DM0D3 EMA learning loop.
  server.post('/godmode/feedback', async (request, reply) => {
    const parsed = FeedbackSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as GodmodeFeedbackRequest;

    // Explicit guard: rating must be 1 or -1 (already enforced by schema).
    if (body.rating !== 1 && body.rating !== -1) {
      reply.code(400);
      return { error: 'Invalid request', message: 'rating must be 1 or -1' };
    }

    try {
      return await service.submitFeedback(body);
    } catch (err: any) {
      logger.error({ err }, 'G0DM0D3 feedback submission failed');
      return replyError(err);
    }
  });

  // Get learning statistics (EMA state) for the feedback loop.
  server.get('/godmode/feedback/stats', async () => {
    try {
      return await service.getFeedbackStats();
    } catch (err: any) {
      logger.error({ err }, 'G0DM0D3 feedback stats failed');
      return replyError(err);
    }
  });
}
