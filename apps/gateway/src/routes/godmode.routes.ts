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
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import { getGodmodeService } from '@dmr-x/godmode';
import type {
  GodmodeChatRequest,
  UltraplinianRequest,
  ConsortiumRequest,
  AutotuneAnalyzeRequest,
  ParseltongueEncodeRequest,
  TransformRequest,
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
  server.post('/godmode/ultraplinian', async (request) => {
    const parsed = UltraplinianSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as UltraplinianRequest;
    return service.ultraplinian(body);
  });

  // CONSORTIUM
  server.post('/godmode/consortium', async (request) => {
    const parsed = ConsortiumSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data as ConsortiumRequest;
    return service.consortium(body);
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
}
