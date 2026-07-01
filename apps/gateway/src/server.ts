import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdapterRegistry, OpenAIAdapter, AnthropicAdapter, OllamaAdapter, ReplicateAdapter, StabilityAdapter, ElevenLabsAdapter, DeepgramAdapter, CohereAdapter, JinaAdapter, GenericOpenAIAdapter, FalAdapter, VeoAdapter, RunwayAdapter, ComfyUIAdapter, createAudioSeparationAdapter, createOcrAdapter, PollinationsImageAdapter, BedrockAdapter, AzureOpenAIAdapter, VertexAIAdapter, GroqAdapter, DeepSeekAdapter, XAIAdapter, OpenRouterAdapter, HuggingFaceAdapter, PerplexityAdapter, TogetherAdapter, FireworksAdapter, CerebrasAdapter, DatabricksAdapter, VLLMAdapter, SambanovaAdapter, NebiusAdapter, NovitaAdapter, MoonshotAdapter, MiniMaxAdapter, LMStudioAdapter, VolcengineAdapter, DashscopeAdapter, NVIDIANIMAdapter } from '@dmr-x/adapters';
import { BenchmarkService, JudgeService } from '@dmr-x/benchmark';
import type { UnifiedRequest } from '@dmr-x/core';
import { Router } from '@dmr-x/router';
import { logger, decryptConfigApiKey, encrypt, decrypt } from '@dmr-x/utils';
import fastifyCompress from '@fastify/compress';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';

import { getTelemetryService, tracer, contentCaptureService } from '@dmr-x/telemetry';
import { trace, SpanStatusCode, SpanKind, propagation, context, type Span } from '@opentelemetry/api';
import { ProviderUnavailableError } from '@dmr-x/core';
import { registryService, HealthChecker, PROVIDER_CATALOG, autoRegisterProviders, discoverMissingModels, enrichExistingModels, syncClassifications, type ProviderTemplate, type ModelTemplate } from '@dmr-x/registry';
import { getDb } from '@dmr-x/db';
import { quotaService, rateLimitService } from '@dmr-x/quota';
import { policyService } from '@dmr-x/policy';
import Fastify from 'fastify';

import { authMiddleware, DEPLOYMENT_MODE } from './middleware/auth.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { threeDRoutes } from './routes/3d.routes.js';
import { adminRoutes, loadActiveProviderCredential } from './routes/admin.routes.js';
import { agenticRoutes } from './routes/agentic.routes.js';
import { anthropicRoutes } from './routes/anthropic.routes.js';
import { audioSeparationRoutes } from './routes/audio-separation.routes.js';
import { audioRoutes } from './routes/audio.routes.js';
import { chatRoutes } from './routes/chat.routes.js';
import { embeddingsRoutes } from './routes/embeddings.routes.js';
import { imagesRoutes } from './routes/images.routes.js';
import { modelsRoutes } from './routes/models.routes.js';
import { ocrRoutes } from './routes/ocr.routes.js';
import { rerankRoutes } from './routes/rerank.routes.js';
import { toolsRoutes, registerToolHandler, registerBuiltinToolHandlers, registerCodingToolHandlers } from './routes/tools.routes.js';
import { videoRoutes } from './routes/video.routes.js';
import { geminiRoutes } from './routes/gemini.routes.js';
import conversationRoutes from './routes/conversation.routes.js';
import { compressionRoutes } from './routes/compression.routes.js';
import { routeDecisionRoutes } from './routes/route.routes.js';
import { validateRoutes } from './routes/validate.routes.js';
import { countTokensRoutes } from './routes/count-tokens.routes.js';

const LOCAL_MODE = process.env.DMRX_LOCAL_MODE === 'true';
declare const Bun: unknown | undefined;
const isBun = typeof Bun !== 'undefined';

// Production-hardening defaults — overridable via env in apps/gateway/src/main.ts
const BODY_LIMIT = parseBodyLimit(process.env.DMRX_BODY_LIMIT, 10 * 1024 * 1024);
const REQUEST_TIMEOUT = parseInt(process.env.DMRX_REQUEST_TIMEOUT || '60000', 10);
const KEEPALIVE_TIMEOUT = parseInt(process.env.DMRX_KEEPALIVE_TIMEOUT || '65000', 10);
const CONNECTION_TIMEOUT = parseInt(process.env.DMRX_CONNECTION_TIMEOUT || '10000', 10);
const MAX_PARAM_LENGTH = parseInt(process.env.DMRX_MAX_PARAM_LENGTH || '200', 10);
const MEMORY_LIMIT = parseBodyLimit(process.env.DMRX_MEMORY_LIMIT, 1_500 * 1024 * 1024);
const TRUST_PROXY = parseTrustProxy(process.env.DMRX_TRUST_PROXY);

function parseBodyLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(trimmed);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 'gb' ? 1024 ** 3
             : unit === 'mb' ? 1024 ** 2
             : unit === 'kb' ? 1024
             : 1;
  return Math.floor(n * mult);
}

function parseTrustProxy(raw: string | undefined): boolean | string {
  if (raw === undefined) return 'loopback';
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  if (['loopback', 'linklocal', 'uniquelocal'].includes(v)) return v;
  return raw.trim();
}

export const SERVER_LIMITS = {
  bodyLimit: BODY_LIMIT,
  requestTimeout: REQUEST_TIMEOUT,
  keepAliveTimeout: KEEPALIVE_TIMEOUT,
  connectionTimeout: CONNECTION_TIMEOUT,
  maxParamLength: MAX_PARAM_LENGTH,
  memoryLimit: MEMORY_LIMIT,
};

export async function createServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        !isBun && process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    // Production-grade request limits
    bodyLimit: BODY_LIMIT,
    requestTimeout: REQUEST_TIMEOUT,
    keepAliveTimeout: KEEPALIVE_TIMEOUT,
    connectionTimeout: CONNECTION_TIMEOUT,
    // fastify 5: per-router options must be nested under `routerOptions`
    // (top-level keys are deprecated as of v5 and will be removed in v6).
    routerOptions: {
      maxParamLength: MAX_PARAM_LENGTH,
    },
    trustProxy: TRUST_PROXY,
  });

  // Ensure a default tenant exists
  const tenantDb = getDb();
  const defaultTenantName = LOCAL_MODE ? 'local' : 'default';
  const existing = tenantDb.prepare("SELECT id FROM tenants WHERE name = ?").get(defaultTenantName) as { id: string } | undefined;
  if (!existing) {
    tenantDb.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run(crypto.randomUUID(), defaultTenantName);
    logger.info({ tenant: defaultTenantName }, 'Created default tenant');
  }
  if (LOCAL_MODE) {
    logger.info('Running in local mode -- skipping strict auth');
  }

  // Initialize adapters
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(new OpenAIAdapter());
  adapterRegistry.register(new AnthropicAdapter());
  adapterRegistry.register(new OllamaAdapter());
  adapterRegistry.register(new ReplicateAdapter());
  adapterRegistry.register(new StabilityAdapter());
  adapterRegistry.register(new ElevenLabsAdapter());
  adapterRegistry.register(new DeepgramAdapter());
  adapterRegistry.register(new CohereAdapter());
  adapterRegistry.register(new JinaAdapter());
  adapterRegistry.register(new FalAdapter());
  adapterRegistry.register(new VeoAdapter());
  adapterRegistry.register(new RunwayAdapter());
  adapterRegistry.register(new ComfyUIAdapter());
  adapterRegistry.register(new PollinationsImageAdapter());

  // Cloud Provider Adapters
  adapterRegistry.register(new BedrockAdapter());
  adapterRegistry.register(new AzureOpenAIAdapter());
  adapterRegistry.register(new VertexAIAdapter());

  // Fast Inference Adapters
  adapterRegistry.register(new GroqAdapter());
  adapterRegistry.register(new CerebrasAdapter());
  adapterRegistry.register(new SambanovaAdapter());
  adapterRegistry.register(new NVIDIANIMAdapter());

  // LLM Provider Adapters
  adapterRegistry.register(new DeepSeekAdapter());
  adapterRegistry.register(new XAIAdapter());
  adapterRegistry.register(new PerplexityAdapter());
  adapterRegistry.register(new OpenRouterAdapter());
  adapterRegistry.register(new TogetherAdapter());
  adapterRegistry.register(new FireworksAdapter());
  adapterRegistry.register(new HuggingFaceAdapter());
  adapterRegistry.register(new DatabricksAdapter());
  adapterRegistry.register(new VLLMAdapter());
  adapterRegistry.register(new NebiusAdapter());
  adapterRegistry.register(new NovitaAdapter());
  adapterRegistry.register(new MoonshotAdapter());
  adapterRegistry.register(new MiniMaxAdapter());
  adapterRegistry.register(new LMStudioAdapter());
  adapterRegistry.register(new VolcengineAdapter());
  adapterRegistry.register(new DashscopeAdapter());

  // Audio Separation adapters
  adapterRegistry.register(createAudioSeparationAdapter('demucs'));
  adapterRegistry.register(createAudioSeparationAdapter('audioshake'));
  adapterRegistry.register(createAudioSeparationAdapter('stemsplit'));
  // OCR adapters
  adapterRegistry.register(createOcrAdapter('tesseract'));
  adapterRegistry.register(createOcrAdapter('paddleocr'));
  adapterRegistry.register(createOcrAdapter('huggingface'));

  // Initialize adapters with config from env
  if (process.env.OPENAI_API_KEY) {
    await adapterRegistry.initialize('openai', {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    await adapterRegistry.initialize('anthropic', {
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  if (process.env.OLLAMA_BASE_URL) {
    await adapterRegistry.initialize('ollama', {
      baseUrl: process.env.OLLAMA_BASE_URL,
    });
  }
  if (process.env.REPLICATE_API_TOKEN) {
    await adapterRegistry.initialize('replicate', {
      baseUrl: 'https://api.replicate.com/v1',
      apiKey: process.env.REPLICATE_API_TOKEN,
    });
  }
  if (process.env.STABILITY_API_KEY) {
    await adapterRegistry.initialize('stability', {
      baseUrl: process.env.STABILITY_BASE_URL || 'https://api.stability.ai/v1',
      apiKey: process.env.STABILITY_API_KEY,
    });
  }
  if (process.env.ELEVENLABS_API_KEY) {
    await adapterRegistry.initialize('elevenlabs', {
      baseUrl: 'https://api.elevenlabs.io/v1',
      apiKey: process.env.ELEVENLABS_API_KEY,
    });
  }
  if (process.env.DEEPGRAM_API_KEY) {
    await adapterRegistry.initialize('deepgram', {
      baseUrl: 'https://api.deepgram.com/v1',
      apiKey: process.env.DEEPGRAM_API_KEY,
    });
  }
  if (process.env.COHERE_API_KEY) {
    await adapterRegistry.initialize('cohere', {
      baseUrl: 'https://api.cohere.com/v2',
      apiKey: process.env.COHERE_API_KEY,
    });
  }
  if (process.env.JINA_API_KEY) {
    await adapterRegistry.initialize('jina', {
      baseUrl: 'https://api.jina.ai/v1',
      apiKey: process.env.JINA_API_KEY,
    });
  }
  if (process.env.FAL_KEY) {
    await adapterRegistry.initialize('fal', {
      baseUrl: 'https://fal.run',
      apiKey: process.env.FAL_KEY,
    });
  }
  if (process.env.GOOGLE_API_KEY) {
    // The 'google' provider reuses the OpenAI-compatible surface of
    // generativelanguage.googleapis.com. A GenericOpenAIAdapter is registered
    // for it during background init; if the env key is set at boot and the
    // adapter isn't registered yet, this would throw "Adapter not found"
    // and hang the gateway before .listen() is ever called. Swallow it —
    // background init will pick it up.
    try {
      await adapterRegistry.initialize('google', {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: process.env.GOOGLE_API_KEY,
      });
    } catch (err) {
      logger.warn({ err, providerId: 'google' }, 'Skipping google env-init (adapter not registered yet — will retry in background init)');
    }
  }
  if (process.env.GOOGLE_API_KEY) {
    await adapterRegistry.initialize('veo', {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }
  if (process.env.RUNWAY_API_KEY) {
    await adapterRegistry.initialize('runway', {
      baseUrl: 'https://api.dev.runwayml.com/v1',
      apiKey: process.env.RUNWAY_API_KEY,
    });
  }

  // Initialize new cloud provider adapters
  if (process.env.BEDROCK_AWS_ACCESS_KEY_ID || process.env.BEDROCK_AWS_SECRET_ACCESS_KEY) {
    await adapterRegistry.initialize('bedrock', {
      apiKey: process.env.BEDROCK_AWS_ACCESS_KEY_ID,
      accessToken: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY,
    });
  }
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    await adapterRegistry.initialize('azure_openai', {
      baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
    });
  }
  if (process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_API_KEY) {
    try {
      await adapterRegistry.initialize('vertex_ai', {
        apiKey: process.env.GOOGLE_API_KEY,
      });
    } catch (err) {
      logger.warn({ err }, 'Skipping vertex_ai init (will retry in background)');
    }
  }
  if (process.env.GROQ_API_KEY) {
    await adapterRegistry.initialize('groq', {
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  if (process.env.DEEPSEEK_API_KEY) {
    await adapterRegistry.initialize('deepseek', {
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
  }
  if (process.env.XAI_API_KEY) {
    await adapterRegistry.initialize('xai', {
      apiKey: process.env.XAI_API_KEY,
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    await adapterRegistry.initialize('openrouter', {
      apiKey: process.env.OPENROUTER_API_KEY,
    });
  }
  if (process.env.HUGGINGFACE_API_KEY) {
    await adapterRegistry.initialize('huggingface', {
      apiKey: process.env.HUGGINGFACE_API_KEY,
    });
  }
  if (process.env.PERPLEXITY_API_KEY) {
    await adapterRegistry.initialize('perplexity', {
      apiKey: process.env.PERPLEXITY_API_KEY,
    });
  }
  if (process.env.TOGETHER_API_KEY) {
    await adapterRegistry.initialize('together_ai', {
      apiKey: process.env.TOGETHER_API_KEY,
    });
  }
  if (process.env.FIREWORKS_API_KEY) {
    await adapterRegistry.initialize('fireworks_ai', {
      apiKey: process.env.FIREWORKS_API_KEY,
    });
  }
  if (process.env.CEREBRAS_API_KEY) {
    await adapterRegistry.initialize('cerebras', {
      apiKey: process.env.CEREBRAS_API_KEY,
    });
  }
  if (process.env.DATABRICKS_HOST && process.env.DATABRICKS_TOKEN) {
    await adapterRegistry.initialize('databricks', {
      baseUrl: process.env.DATABRICKS_HOST,
      apiKey: process.env.DATABRICKS_TOKEN,
    });
  }
  if (process.env.VLLM_API_BASE) {
    await adapterRegistry.initialize('vllm', {
      baseUrl: process.env.VLLM_API_BASE,
    });
  }
  if (process.env.SAMBA_API_KEY) {
    await adapterRegistry.initialize('sambanova', {
      apiKey: process.env.SAMBA_API_KEY,
    });
  }
  if (process.env.NEBIUS_API_KEY) {
    await adapterRegistry.initialize('nebius', {
      apiKey: process.env.NEBIUS_API_KEY,
    });
  }
  if (process.env.NOVITA_API_KEY) {
    await adapterRegistry.initialize('novita', {
      apiKey: process.env.NOVITA_API_KEY,
    });
  }
  if (process.env.MOONSHOT_API_KEY) {
    await adapterRegistry.initialize('moonshot', {
      apiKey: process.env.MOONSHOT_API_KEY,
    });
  }
  if (process.env.MINIMAX_API_KEY) {
    await adapterRegistry.initialize('minimax', {
      apiKey: process.env.MINIMAX_API_KEY,
    });
  }
  if (process.env.NVIDIA_API_KEY) {
    await adapterRegistry.initialize('nvidia_nim', {
      apiKey: process.env.NVIDIA_API_KEY,
    });
  }
  if (process.env.VOLCENGINE_API_KEY) {
    await adapterRegistry.initialize('volcengine', {
      apiKey: process.env.VOLCENGINE_API_KEY,
    });
  }
  if (process.env.DASHSCOPE_API_KEY) {
    await adapterRegistry.initialize('dashscope', {
      apiKey: process.env.DASHSCOPE_API_KEY,
    });
  }

  // Initialize ComfyUI local video generation (no API key required)
  if (process.env.COMFYUI_BASE_URL) {
    await adapterRegistry.initialize('comfyui', {
      baseUrl: process.env.COMFYUI_BASE_URL,
      maxConcurrent: parseInt(process.env.COMFYUI_MAX_CONCURRENT || '1', 10),
    });
  }

  // Initialize Demucs audio separation (local service)
  if (process.env.DMRX_DEMUCS_BASE_URL) {
    await adapterRegistry.initialize('demucs', {
      baseUrl: process.env.DMRX_DEMUCS_BASE_URL,
    });
  }

  // Initialize cloud audio separation providers
  if (process.env.AUDIO_SHAKE_API_KEY) {
    await adapterRegistry.initialize('audioshake', {
      baseUrl: process.env.DMRX_AUDIO_SHAKE_BASE_URL || 'https://api.audioshake.com/v1',
      apiKey: process.env.AUDIO_SHAKE_API_KEY,
    });
  }
  if (process.env.STEMSPLIT_API_KEY) {
    await adapterRegistry.initialize('stemsplit', {
      baseUrl: process.env.DMRX_STEMSPLIT_BASE_URL || 'https://api.stemsplit.com/v1',
      apiKey: process.env.STEMSPLIT_API_KEY,
    });
  }

  // Initialize OCR providers
  if (process.env.TESSERACT_BASE_URL) {
    await adapterRegistry.initialize('tesseract', {
      baseUrl: process.env.TESSERACT_BASE_URL,
    });
  }
  if (process.env.PADDLEOCR_BASE_URL || process.env.HF_TOKEN) {
    await adapterRegistry.initialize('paddleocr', {
      baseUrl: process.env.PADDLEOCR_BASE_URL || process.env.HF_INFERENCE_URL || 'http://localhost:8000',
      apiKey: process.env.PADDLEOCR_API_KEY || process.env.HF_TOKEN,
    });
  }

  const db = getDb();

  // Warn if encryption is not configured
  if (!process.env.DMRX_ENCRYPTION_KEY) {
    logger.warn('DMRX_ENCRYPTION_KEY not set — provider API keys are stored in plaintext');
  }

  // Initialize router
  const freeTierStrategy = (process.env.DMRX_FREE_TIER_STRATEGY as any) || 'none';
  const router = new Router({
    epsilon: 0.05,
    quotaService,
    policyService,
    rateLimitService,
    freeTierStrategy,
    onProviderSuccess: (providerId: string) => adapterRegistry.recordSuccess(providerId),
    onProviderFailure: (providerId: string) => adapterRegistry.recordFailure(providerId),
    enablePlanner: process.env.DMRX_ENABLE_PLANNER !== 'false',
    enableHandover: process.env.DMRX_ENABLE_HANDOVER !== 'false',
    async summarizationExecutor(input) {
      const candidates = await registryService.getCandidates();
      const cheapCandidates = candidates.filter(c => c.costPerInputToken === 0 && c.costPerOutputToken === 0);
      const candidate = cheapCandidates[0] || candidates[0];

      if (!candidate) {
        return {
          content: input.messages.map(m =>
            typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          ).join('\n'),
          tokens: 0
        };
      }

      const adapter = adapterRegistry.get(candidate.providerId);
      if (!adapter) {
        return {
          content: input.messages.map(m =>
            typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          ).join('\n'),
          tokens: 0
        };
      }

      const request: any = {
        modality: 'llm',
        model: input.model,
        messages: input.messages,
        max_tokens: input.max_tokens,
        temperature: input.temperature,
        stream: false,
        metadata: {}
      };

      try {
        const response = await adapter.execute(request);
        if (response.message?.content && typeof response.message.content === 'string') {
          return {
            content: response.message.content,
            tokens: response.usage?.total_tokens || 0
          };
        }
        return {
          content: input.messages.map(m =>
            typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          ).join('\n'),
          tokens: 0
        };
      } catch {
        return {
          content: input.messages.map(m =>
            typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          ).join('\n'),
          tokens: 0
        };
      }
    }
  });

  // Make router and helpers available
  server.decorate('router', router);
  server.decorate('adapterRegistry', adapterRegistry);
  server.decorate('registerToolHandler', registerToolHandler);
  server.decorate('rateLimitService', rateLimitService);
  server.decorate('quotaService', quotaService);
  // Telemetry reference (must exist before the background start below) —
  // the onResponse hook reads it. Recording is a no-op if the underlying
  // OTel SDK hasn't finished starting yet.
  const telemetry = getTelemetryService();
  server.decorate('telemetry', telemetry);

  // Content capture: start flush timer if enabled
  if (contentCaptureService.isEnabled()) {
    contentCaptureService.startFlushTimer();
    logger.info({ mode: contentCaptureService.getMode() }, 'Content capture enabled');
  }

  // Initialize Benchmark services
  const judgeService = new JudgeService(router);
  const benchmarkService = new BenchmarkService(adapterRegistry, judgeService);
  benchmarkService.startScheduled(); // start 24h cycle
  server.decorate('benchmarkService', benchmarkService);
  server.decorate('judgeService', judgeService);

  // Helper to get adapter by provider ID (UUID or name)
  server.decorate('getAdapter', (providerId: string) => {
    let adapter = adapterRegistry.get(providerId);
    if (!adapter) {
      const row = db.prepare('SELECT name FROM providers WHERE id = ?').get(providerId) as any;
      if (row) adapter = adapterRegistry.get(row.name);
    }
    return adapter;
  });

  router.setAdapterExecutor({
    execute: async (providerId: string, modelId: string, request: UnifiedRequest) => {
      const adapter = (server as any).getAdapter(providerId);
      if (!adapter) {
        // Surface this as a typed 503, not a plain 500. The provider row
        // exists in the DB (the router selected it) but its adapter isn't
        // registered in the in-memory registry — typically because the
        // provider was just activated and the registry hasn't been reloaded
        // yet, or because the adapter type is unknown. A bare `Error` would
        // bubble to the generic error handler and return 500 with no
        // actionable detail; ProviderUnavailableError returns 503 with a
        // message the UI can render.
        throw new ProviderUnavailableError([providerId], 5);
      }
      // Send the model the router actually selected — NOT the raw inbound
      // string. `request.model` may carry a `providerName/model` prefix
      // (e.g. "pollinations/openai-fast") or a meta-model alias (e.g.
      // "free-smart"); the resolved bare model id is in `modelId`. The
      // streaming path already substitutes this (chat.routes.ts); doing it
      // here keeps non-streaming execution consistent and stops the alias /
      // prefixed string from leaking to upstream providers as a model name.
      const outboundRequest = modelId ? { ...request, model: modelId } : request;
      return adapter.execute(outboundRequest);
    },
  });

  // Load candidates from registry
  try {
    const candidates = await registryService.getCandidates();
    router.setCandidates(candidates);
    logger.info({ count: candidates.length }, 'Loaded routing candidates');

    // Load rate limit configs from model_profiles into RateLimitService
    // This enables actual rate limit enforcement for free-tier models
    let rateLimitConfigCount = 0;
    for (const candidate of candidates) {
      const hasRateLimits =
        (candidate.freeTierMetadata?.rateLimits?.rpm ?? 0) > 0 ||
        (candidate.freeTierMetadata?.rateLimits?.rpd ?? 0) > 0 ||
        (candidate.freeTierMetadata?.rateLimits?.tpm ?? 0) > 0 ||
        (candidate.freeTierMetadata?.rateLimits?.tpd ?? 0) > 0;

      if (hasRateLimits) {
        rateLimitService.setConfig(candidate.providerId, candidate.modelId, {
          rpm: candidate.freeTierMetadata!.rateLimits.rpm || undefined,
          rpd: candidate.freeTierMetadata!.rateLimits.rpd || undefined,
          tpm: candidate.freeTierMetadata!.rateLimits.tpm || undefined,
          tpd: candidate.freeTierMetadata!.rateLimits.tpd || undefined,
        });
        rateLimitConfigCount++;
      }
    }
    if (rateLimitConfigCount > 0) {
      logger.info({ count: rateLimitConfigCount }, 'Loaded rate limit configs from catalog');
    }
  } catch (err) {
    logger.warn({ err }, 'Could not load candidates from registry (DB may not be ready)');
  }

  // Expose candidate refresh for admin routes (after provider activation/key updates)
  server.decorate('refreshCandidates', async () => {
    try {
      const candidates = await registryService.getCandidates();
      router.setCandidates(candidates);

      // Refresh rate limit configs from updated model_profiles
      for (const candidate of candidates) {
        const hasRateLimits =
          (candidate.freeTierMetadata?.rateLimits?.rpm ?? 0) > 0 ||
          (candidate.freeTierMetadata?.rateLimits?.rpd ?? 0) > 0 ||
          (candidate.freeTierMetadata?.rateLimits?.tpm ?? 0) > 0 ||
          (candidate.freeTierMetadata?.rateLimits?.tpd ?? 0) > 0;

        if (hasRateLimits) {
          rateLimitService.setConfig(candidate.providerId, candidate.modelId, {
            rpm: candidate.freeTierMetadata!.rateLimits.rpm || undefined,
            rpd: candidate.freeTierMetadata!.rateLimits.rpd || undefined,
            tpm: candidate.freeTierMetadata!.rateLimits.tpm || undefined,
            tpd: candidate.freeTierMetadata!.rateLimits.tpd || undefined,
          });
        }
      }

      logger.info({ count: candidates.length }, 'Refreshed routing candidates');
    } catch (err) {
      logger.warn({ err }, 'Failed to refresh routing candidates');
    }
  });

  // Start health checker — delay initial run to allow all adapters (including
  // those loaded from DB and auto-registered) to fully initialise.
  const healthChecker = new HealthChecker(adapterRegistry, 30000);
  let healthCheckStartTimer: ReturnType<typeof setTimeout> | null = null;
  server.addHook('onListen', async () => {
    healthCheckStartTimer = setTimeout(() => healthChecker.start(), 5000);
    healthCheckStartTimer.unref();
  });

  // Background OAuth token refresh — check every 5 minutes.
  // Uses recursive setTimeout instead of setInterval to avoid overlapping
  // executions if a cycle takes longer than the interval. Providers are
  // refreshed in parallel so one slow/hanging provider doesn't block others.
  const OAUTH_REFRESH_INTERVAL = 5 * 60 * 1000;
  let oauthRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshOAuthTokens = async () => {
    try {
      const rows = db.prepare(
        `SELECT id, name, oauth_refresh_token, oauth_token_expires_at
         FROM providers
         WHERE auth_method = 'oauth'
         AND oauth_token_expires_at IS NOT NULL
         AND oauth_refresh_token IS NOT NULL`
      ).all() as any[];

      const refreshPromises = rows.map(async (row) => {
        const expiresAt = new Date(row.oauth_token_expires_at);
        const bufferMs = 5 * 60 * 1000; // refresh 5 minutes before expiry
        if (expiresAt.getTime() >= Date.now() + bufferMs) return;

        const template = PROVIDER_CATALOG.find(t => t.id === row.name);
        if (!template?.oauthConfig) return;

        try {
          const { OAuthService } = await import('@dmr-x/oauth');
          const oauthService = new OAuthService();
          let refreshToken: string;
          try {
            refreshToken = decrypt(row.oauth_refresh_token);
          } catch (err) {
            logger.warn({ provider: row.name, err }, 'Failed to decrypt OAuth refresh token, using as plaintext');
            refreshToken = row.oauth_refresh_token;
          }
          const newTokens = await oauthService.refreshAccessToken(template.oauthConfig, refreshToken);

          const encAccess = encrypt(newTokens.accessToken);
          const encRefresh = newTokens.refreshToken ? encrypt(newTokens.refreshToken) : row.oauth_refresh_token;
          db.prepare(
            `UPDATE providers SET oauth_access_token = ?, oauth_refresh_token = ?, oauth_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(encAccess, encRefresh, newTokens.expiresAt?.toISOString() || null, row.id);

          // Re-initialize adapter
          const adapter = adapterRegistry.get(row.name);
          if (adapter) {
            const providerRow = db.prepare('SELECT base_url FROM providers WHERE id = ?').get(row.id) as any;
            if (providerRow?.base_url) {
              await adapterRegistry.initialize(row.name, {
                baseUrl: providerRow.base_url,
                accessToken: newTokens.accessToken,
                authMethod: 'oauth',
              });
            }
          }

          logger.info({ provider: row.name }, 'Refreshed OAuth token (background)');
        } catch (err) {
          logger.warn({ provider: row.name, err }, 'Failed to refresh OAuth token (background)');
        }
      });

      await Promise.allSettled(refreshPromises);
    } catch (err) {
      logger.warn({ err }, 'OAuth token refresh check failed');
    }
  };

  const scheduleOAuthRefresh = () => {
    oauthRefreshTimer = setTimeout(async () => {
      await refreshOAuthTokens();
      scheduleOAuthRefresh();
    }, OAUTH_REFRESH_INTERVAL);
    oauthRefreshTimer.unref();
  };
  scheduleOAuthRefresh();

// Start telemetry service in the background — must not block the listener.
// Telemetry has a broken OpenTelemetry import on this OTel version
// (ATTR_SERVICE_NAME was renamed in 1.27+, but we're pinned to 1.25.0)
// and PrometheusExporter construction can hang on some systems. Either
// failure would otherwise keep the gateway from ever calling .listen().
// We log the outcome asynchronously so it's still visible.
void (async () => {
  try {
    await telemetry.start();
    logger.info('Telemetry service started');
  } catch (err) {
    logger.warn({ err }, 'Failed to start telemetry service — continuing without telemetry');
  }
})();

  // CORS — never use wildcard origin; always use explicit origins
  const defaultOrigins = [
    'http://localhost:4200', 'http://localhost:5173',
    'http://127.0.0.1:4200', 'http://127.0.0.1:5173',
  ];
  let corsOrigin: string[];
  if (process.env.DMRX_CORS_ORIGIN) {
    corsOrigin = process.env.DMRX_CORS_ORIGIN.split(',').map(o => o.trim());
  } else {
    corsOrigin = defaultOrigins;
  }
  logger.info({ corsOrigin }, 'CORS configuration');
  await server.register(cors, {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-free-tier-strategy', 'anthropic-version', 'anthropic-beta'],
  });

  // Rate limiting. Uses tenant ID as key when available (authenticated requests),
  // falls back to IP for unauthenticated requests. This prevents noisy neighbor
  // problems where one tenant exhausts all rate limits.
  await server.register(rateLimit, {
    max: parseInt(process.env.DMRX_RATE_LIMIT_MAX || '600', 10),
    timeWindow: process.env.DMRX_RATE_LIMIT_WINDOW || '1 minute',
    keyGenerator: (request) => {
      // Use tenant ID if authenticated (set by auth middleware)
      const tenant = (request as any).tenant;
      if (tenant?.id) {
        return `tenant:${tenant.id}`;
      }
      // Fall back to IP for unauthenticated requests (health checks, models endpoint)
      return request.ip;
    },
  });

  // Multipart uploads (for audio endpoints)
  await server.register(fastifyMultipart, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25MB max
    },
  });

  // Response compression — gzip / brotli / deflate. We only compress
  // responses >= DMRX_COMPRESS_THRESHOLD bytes (default 1 KB) to avoid
  // the CPU cost on tiny JSON envelopes (the typical `{ "error": ... }`
  // body is < 200 bytes). Set the env var to 0 to disable compression.
  // SSE streams are skipped by the plugin because of their streaming Content-Type.
  const compressThreshold = parseInt(process.env.DMRX_COMPRESS_THRESHOLD || '1024', 10);
  const compressEnabled = compressThreshold > 0;
  await server.register(fastifyCompress, {
    threshold: compressEnabled ? Math.max(1024, compressThreshold) : Infinity,
    encodings: ['gzip', 'deflate', 'br'],
  });

  // Serve UI static files
  // In compiled binaries (bun build --compile), import.meta.url is a virtual path.
  // Resolve relative to the actual executable, then fall back to source-relative path.
  const exeDir = path.dirname(process.execPath);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidateDirs = [
    process.env.DMRX_UI_DIR,
    path.join(exeDir, 'public'),
    path.join(__dirname, '..', 'public'),
  ].filter(Boolean) as string[];
  const uiDir = path.resolve(candidateDirs.find(d => { try { return fs.existsSync(d); } catch { return false; } })
    || candidateDirs[candidateDirs.length - 1]);
  try {
    await server.register(fastifyStatic, {
      root: uiDir,
      prefix: '/',
      wildcard: true,
      decorateReply: false,
    });
    logger.info({ dir: uiDir }, 'Serving UI from static directory');
  } catch (err) {
    logger.warn({ err, dir: uiDir }, 'Could not serve UI static files');
  }

  // Middleware
  await server.register(requestIdMiddleware);
  await server.register(authMiddleware);

  // Security headers
  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: *; connect-src 'self'"
    );
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  // Telemetry: record request count + latency per request, token usage
  // and errors when the route handler populated `request.metrics`.
  // Route handlers can set:
  //   (request as any).metrics = {
  //     providerId, modelId, modality,
  //     tokens?: { prompt, completion, total, costUsd? },
  //     errorCode?: string,    // present if the request errored
  //     tenantId?: string,     // CRIT-6: tenant for request_logs row
  //     taskProfile?: string,  // CRIT-6: routing decision audit trail
  //     routingPlan?: {        // CRIT-6: top-3 candidates considered
  //       primary: { providerId, modelId, score },
  //       candidates: Array<{ providerId, modelId, score }>,
  //     },
  //     firstTokenLatencyMs?: number, // CRIT-6: optional TTFT for streaming
  //   }
  // The hook is fire-and-forget — telemetry must never break the request.
  // CRIT-6: a row is also inserted into `request_logs` so the bandit
  // reward-updater can learn across restarts. The write is wrapped in the
  // existing try/catch — a write failure logs a warning and continues.
  // OpenTelemetry: end the root `http.request` span, record the response
  // status / latency, and surface 5xx as span errors so trace UIs can
  // highlight them. This is the second half of the pair started in
  // the onRequest hook above.
  server.addHook('onResponse', async (request, reply) => {
    const span = (request as any).openTelemetrySpan as Span | undefined;
    try {
      const metrics = (request as any).metrics as
        | {
            providerId?: string;
            modelId?: string;
            modality?: string;
            tokens?: {
              prompt: number;
              completion: number;
              total: number;
              costUsd?: number;
            };
            errorCode?: string;
            tenantId?: string;
            taskProfile?: string;
            routingPlan?: {
              primary?: { providerId: string; modelId: string; score?: number };
              candidates?: Array<{ providerId: string; modelId: string; score?: number }>;
            };
            firstTokenLatencyMs?: number;
            qualityTarget?: string;
            freeTierStrategy?: string;
          }
        | undefined;
      if (metrics?.providerId && metrics.modelId) {
        const statusCode = reply.statusCode;
        const latencyMs = Date.now() - ((request as any).startTime ?? Date.now());

        telemetry.recordRequest({
          providerId: metrics.providerId,
          modelId: metrics.modelId,
          modality: metrics.modality ?? 'unknown',
          statusCode,
        });
        telemetry.recordLatency({
          providerId: metrics.providerId,
          modelId: metrics.modelId,
          modality: metrics.modality ?? 'unknown',
          latencyMs,
        });
        if (metrics.errorCode) {
          telemetry.recordError({
            providerId: metrics.providerId,
            modelId: metrics.modelId,
            modality: metrics.modality ?? 'unknown',
            errorCode: metrics.errorCode,
          });
        }
        if (metrics.tokens) {
          telemetry.recordTokens({
            providerId: metrics.providerId,
            modelId: metrics.modelId,
            promptTokens: metrics.tokens.prompt,
            completionTokens: metrics.tokens.completion,
            totalTokens: metrics.tokens.total,
            costUsd: metrics.tokens.costUsd,
          });
        }

        // Tag the OTel span with the routing outcome so a trace shows
        // which provider the gateway picked for this request.
        if (span) {
          span.setAttribute('router.selected_provider', metrics.providerId);
          span.setAttribute('router.selected_model', metrics.modelId);
          if (metrics.modality) span.setAttribute('router.modality', metrics.modality);
        }

        // CRIT-6: write a row to `request_logs` so the bandit reward-updater
        // (services/router/src/bandit/reward-updater.ts:198) has data to
        // compute per-provider reward signals. The table was added in the
        // v0.2.0 schema but never populated — this closes the loop.
        //
        // The write is single-row, prepared-statement, no transaction. With
        // the 50ms debounced save in packages/db/src/client.ts, burst writes
        // batch into a single disk write.
        try {
          const requestLogsDb = getDb();
          const id = crypto.randomUUID();
          const fallbackUsed = (metrics.routingPlan?.candidates?.length ?? 0) > 1 ? 1 : 0;
          // Top-3 candidates only — keep the row narrow.
          const candidatesTop3 = (metrics.routingPlan?.candidates ?? []).slice(0, 3);
          const routingPlanJson = metrics.routingPlan
            ? JSON.stringify({
                primary: metrics.routingPlan.primary,
                candidates: candidatesTop3,
              })
            : null;
          requestLogsDb.prepare(
            `INSERT INTO request_logs (
              id, request_id, tenant_id, timestamp,
              task_profile, routing_plan, selected_provider, selected_model,
              fallback_used, fallback_reason,
              latency_ms, time_to_first_token_ms, tokens_input, tokens_output,
              estimated_cost, error_code, error_message,
              quality_target, free_tier_strategy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id,
            request.id,
            metrics.tenantId ?? null,
            new Date().toISOString(),
            metrics.taskProfile ?? null,
            routingPlanJson,
            metrics.providerId,
            metrics.modelId,
            fallbackUsed,
            null,
            latencyMs,
            metrics.firstTokenLatencyMs ?? null,
            metrics.tokens?.prompt ?? null,
            metrics.tokens?.completion ?? null,
            metrics.tokens?.costUsd ?? null,
            metrics.errorCode ?? null,
            null,
            metrics.qualityTarget ?? null,
            metrics.freeTierStrategy ?? null,
          );

          // Publish dashboard stats update for SSE subscribers
          const publishStats = (server as any).publishDashboardStatsUpdate;
          if (publishStats) {
            publishStats({
              type: 'request_completed',
              provider: metrics.providerId,
              model: metrics.modelId,
              latency_ms: latencyMs,
              tokens: (metrics.tokens?.prompt ?? 0) + (metrics.tokens?.completion ?? 0),
              cost: metrics.tokens?.costUsd ?? 0,
              error: !!metrics.errorCode,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (writeErr) {
          // Persistence failures must never break the request. The debounced
          // save will retry the export on the next batch, so a single bad
          // row is fine.
          logger.warn({ err: writeErr, requestId: request.id }, 'request_logs write failed');
        }

        // Content capture: record the call event for ML-ready streaming
        if (contentCaptureService.isEnabled()) {
          contentCaptureService.record({
            type: 'llm_call',
            providerId: metrics.providerId,
            modelId: metrics.modelId,
            requestId: request.id,
            inputTokens: metrics.tokens?.prompt,
            outputTokens: metrics.tokens?.completion,
            latencyMs,
            statusCode,
            error: metrics.errorCode,
          });
        }
      }
    } catch (err) {
      // Telemetry failures must never affect the request
      logger.debug({ err }, 'telemetry onResponse hook failed');
    } finally {
      if (span) {
        try {
          const statusCode = reply.statusCode;
          span.setAttribute('http.status_code', statusCode);
          const latencyMs = Date.now() - ((request as any).startTime ?? Date.now());
          span.setAttribute('http.duration_ms', latencyMs);
          if (statusCode >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
        } catch (err) {
          // Span manipulation must never break the request either
          logger.debug({ err }, 'otel onResponse span finalisation failed');
        } finally {
          span.end();
        }
      }
    }
  });

  // Health checks
  server.get('/health', async () => ({ status: 'ok' }));

  server.get('/healthz', async (_request, reply) => {
    const checks: Record<string, { status: string; detail?: string }> = {};
    let healthy = true;

    // 1) SQLite read
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      checks.db_read = { status: 'ok' };
    } catch (err) {
      checks.db_read = { status: 'fail', detail: err instanceof Error ? err.message : String(err) };
      healthy = false;
    }

    // 2) SQLite write — catches read-only filesystems / locked DB
    try {
      const db = getDb();
      db.exec('CREATE TEMP TABLE IF NOT EXISTS _hc(id INTEGER); DROP TABLE _hc;');
      checks.db_write = { status: 'ok' };
    } catch (err) {
      checks.db_write = { status: 'fail', detail: err instanceof Error ? err.message : String(err) };
      healthy = false;
    }

    // 3) Router has loaded at least one candidate (otherwise no requests can be served)
    try {
      const router = (server as any).router;
      const count = router?.getCandidateCount?.() ?? 0;
      if (count > 0) {
        checks.candidates = { status: 'ok', detail: `${count} candidates` };
      } else {
        checks.candidates = { status: 'fail', detail: 'no routing candidates loaded' };
        healthy = false;
      }
    } catch (err) {
      checks.candidates = { status: 'fail', detail: err instanceof Error ? err.message : String(err) };
      healthy = false;
    }

    // 4) Memory pressure — RSS compared against DMRX_MEMORY_LIMIT
    try {
      const rss = process.memoryUsage().rss;
      if (rss < MEMORY_LIMIT) {
        checks.memory = { status: 'ok', detail: `${Math.round(rss / 1024 / 1024)}MB / ${Math.round(MEMORY_LIMIT / 1024 / 1024)}MB` };
      } else {
        checks.memory = { status: 'fail', detail: `rss ${Math.round(rss / 1024 / 1024)}MB exceeds limit ${Math.round(MEMORY_LIMIT / 1024 / 1024)}MB` };
        healthy = false;
      }
    } catch (err) {
      checks.memory = { status: 'fail', detail: err instanceof Error ? err.message : String(err) };
    }

    const status = healthy ? 'ok' : 'degraded';
    if (!healthy) reply.status(503);
    return {
      status,
      checks,
      uptime: Math.round(process.uptime()),
    };
  });

  server.get('/ready', async (_request, reply) => {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      // Also check router has loaded candidates
      const router = (server as any).router;
      if (!router || router.getCandidateCount() === 0) {
        reply.status(503);
        return { status: 'not_ready', reason: 'no_routing_candidates' };
      }
      return { status: 'ready' };
    } catch {
      reply.status(503);
      return { status: 'not_ready' };
    }
  });

  server.get('/livez', async () => ({ status: 'alive' }));

  // OpenTelemetry: stamp start time on every request AND start the
  // root `http.request` span. The span is the parent of every downstream
  // span (router.*, adapter.fetch) emitted for this request — without it,
  // the OTel SDK receives a tree of disconnected spans.
  //
  // We honour an incoming W3C `traceparent` header so this gateway can
  // participate in a trace that was started upstream (e.g. by a frontend
  // SDK, a service mesh sidecar, or another DMR-X gateway in a federation).
  // The propagation.extract call is a no-op when no `traceparent` is
  // present, so it is always safe.
  server.addHook('onRequest', async (request) => {
    (request as any).startTime = Date.now();

    // Pull the W3C context out of the inbound headers (if any) so the
    // span we are about to start uses the upstream trace id.
    const parentCtx = propagation.extract(context.active(), request.headers);
    const span = tracer.startSpan(
      'http.request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': request.method,
          'http.target': request.url,
          'url.path': request.url.split('?')[0],
          'url.scheme': (request.headers['x-forwarded-proto'] as string) || 'http',
          'http.host': (request.headers['host'] as string) || 'unknown',
          'server.address': (request.headers['host'] as string) || 'unknown',
          'request.id': request.id,
        },
      },
      parentCtx,
    );
    // Stash the span on the request so route handlers + the onResponse
    // hook can attach attributes and end it. We don't call
    // `startActiveSpan` here because Fastify already has its own async
    // context that would be lost across route boundaries.
    (request as any).openTelemetrySpan = span;
    (request as any).openTelemetryContext = trace.setSpan(parentCtx, span);
  });

  // Error handler — must be set BEFORE server.register(...) so that the
  // custom shape (`{ error: { message, type, code } }`) is captured by
  // child contexts. Setting it after register means the child context
  // (admin, chat, etc.) keeps Fastify's default shape
  // (`{ statusCode, code, error: "Bad Request", message }`), which the
  // UI surfaces as the unhelpful string "Bad Request".
  server.setErrorHandler((error, request, reply) => {
    // fastify 5 typed the error parameter as `unknown` (it was `FastifyError`
    // in v4). Cast to any to preserve the previous access pattern — the
    // existing `error.statusCode / error.code / error.message / error.stack`
    // shape is unchanged at runtime, so this is a TS-only adjustment.
    const err = error as any;
    const statusCode = err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';

    // OpenTelemetry: record the exception on the active span (started in
    // the onRequest hook) so the trace UI can show the failure mode.
    // Don't crash the request if span manipulation itself fails.
    try {
      const span = (request as any).openTelemetrySpan as Span | undefined;
      if (span && span.isRecording()) {
        span.recordException(err);
        span.setAttribute('error.type', code);
        span.setAttribute('error.message', err.message);
      }
    } catch {
      // swallow — telemetry must never break the error path
    }

    // Always log full error server-side (with request id so logs and
    // client payloads are correlatable)
    logger.error(
      { err, req: request, requestId: request.id },
      `Request error: ${err.message}`,
    );

    // For 500+ errors, hide all internal details from clients — unless
    // we're in dev / local-mode, where we surface the real message so
    // the UI toast and gateway log line up while debugging. CRIT-2:
    // LOCAL_MODE is the frozen module-level constant — re-reading
    // process.env here would re-introduce the live-bypass vulnerability
    // that the constant was added to prevent.
    const isDev = LOCAL_MODE || process.env.NODE_ENV !== 'production';
    const clientMessage = statusCode >= 500 && !isDev ? 'Internal server error' : err.message;
    const clientType = statusCode >= 500 && !isDev ? 'server_error' : code;

    const errorBody: Record<string, unknown> = {
      message: clientMessage,
      type: clientType,
      code: statusCode >= 500 && !isDev ? 'internal_error' : code.toLowerCase(),
    };

    // For 5xx, include the request id so users can quote it in support
    // tickets (matches the pattern used by Stripe, GitHub, Cloudflare).
    // The x-request-id response header carries the same value.
    if (statusCode >= 500) {
      errorBody.request_id = request.id;
      if (isDev) {
        // Dev-only: surface the real error so the UI toast and pino log
        // line up. Production keeps `error.message` out of the wire.
        errorBody.dev_message = err.message;
        errorBody.dev_stack = err.stack;
      }

      // Surface 5xx to the live telemetry SSE stream so the observability
      // dashboard can show them in real time. Uses optional chaining so
      // tests / alternate builds without the publish function still work.
      (server as any).recordTelemetryEvent?.({
        level: 'error',
        service: 'gateway',
        message: err.message,
        metadata: {
          path: request.url,
          method: request.method,
          statusCode,
          requestId: request.id,
        },
      });
    }

    reply.status(statusCode).send({ error: errorBody });
  });

// Routes
   await server.register(chatRoutes, { prefix: '/v1' });
   await server.register(anthropicRoutes, { prefix: '/v1' });
   await server.register(geminiRoutes, { prefix: '/v1' });
   await server.register(modelsRoutes, { prefix: '/v1' });
   await server.register(imagesRoutes, { prefix: '/v1' });
   await server.register(embeddingsRoutes, { prefix: '/v1' });
   await server.register(rerankRoutes, { prefix: '/v1' });
   await server.register(audioRoutes, { prefix: '/v1' });
   await server.register(audioSeparationRoutes, { prefix: '/v1' });
   await server.register(ocrRoutes, { prefix: '/v1' });
   await server.register(videoRoutes, { prefix: '/v1' });
   await server.register(threeDRoutes, { prefix: '/v1' });
   await server.register(adminRoutes, { prefix: '/v1' });
   await server.register(toolsRoutes, { prefix: '/v1' });
   registerBuiltinToolHandlers();
   registerCodingToolHandlers();
   await server.register(agenticRoutes, { prefix: '/v1' });
   await server.register(conversationRoutes, { prefix: '/v1' });
   await server.register(compressionRoutes, { prefix: '/v1' });
   await server.register(routeDecisionRoutes, { prefix: '/v1' });
   await server.register(validateRoutes);
   await server.register(countTokensRoutes, { prefix: '/v1' });

  // SPA fallback: serve index.html for non-API GET requests.
  // Pre-read index.html at startup so we catch missing UI builds early
  // and don't throw on every unknown GET path.
  let indexHtml: string | null = null;
  try {
    indexHtml = await fs.promises.readFile(path.join(uiDir, 'index.html'), 'utf8');
  } catch {
    logger.warn({ uiDir }, 'UI index.html not found — SPA fallback disabled');
  }

  server.setNotFoundHandler(async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (request.method !== 'GET' || pathname.startsWith('/v1/') || pathname.startsWith('/health')) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    if (!indexHtml) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    return reply.type('text/html').send(indexHtml);
  });

  // Cleanup on close
  server.addHook('onClose', async () => {
    if (healthCheckStartTimer) {
      clearTimeout(healthCheckStartTimer);
      healthCheckStartTimer = null;
    }
    if (oauthRefreshTimer) {
      clearTimeout(oauthRefreshTimer);
      oauthRefreshTimer = null;
    }
    healthChecker.stop();
    contentCaptureService.stop();
    await adapterRegistry.disposeAll();
  });

  // Warn if running in local mode (auth disabled)
  if (LOCAL_MODE) {
    logger.warn('LOCAL MODE: Authentication is disabled. Set DMRX_LOCAL_MODE=false for production.');
  }

  // Log deployment mode
  if (DEPLOYMENT_MODE === 'managed') {
    logger.info('MANAGED MODE: Admin routes and UI are disabled.');
  }

  // Validate admin API key strength in production
  if (!LOCAL_MODE) {
    const adminKey = process.env.DMRX_ADMIN_API_KEY;
    if (!adminKey || adminKey === 'replace-with-admin-key' || adminKey.length < 16) {
      logger.warn('DMRX_ADMIN_API_KEY is weak or unset. Set a strong key for production.');
    }
  }

  // ---------------------------------------------------------------------------
  // Background initialisation
  //
  // The following work does NOT need to block the listener. Moving it off the
  // boot path is what gets the gateway from "5+ minutes to /health" to
  // "sub-second to /health" on a cold start.
  // ---------------------------------------------------------------------------
  const runBackgroundInit = (): void => {
    const initStart = Date.now();
    logger.info('Background initialisation started');

    void (async () => {
      // 1) Auto-register any new catalog items
      try {
        const newlyRegistered = await autoRegisterProviders();
        if (newlyRegistered.length > 0) {
          logger.info(
            { count: newlyRegistered.length },
            'Auto-registered new catalog providers',
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to auto-register providers');
      }

      // 1.5) Sync model classifications (pricing tiers)
      try {
        syncClassifications();
      } catch (err) {
        logger.warn({ err }, 'Failed to sync model classifications');
      }

      // 2) Backfill model profiles for any OpenAI-compatible provider whose
      //    catalog entry was empty but whose DB row already existed before
      //    the live-discovery logic shipped.
      try {
        const backfilled = await discoverMissingModels();
        if (backfilled > 0) {
          logger.info(
            { count: backfilled },
            'Backfilled missing model profiles via /v1/models discovery',
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to backfill missing models');
      }

      // 2.5) Enrich existing models with catalog data (costs, context windows).
      //      Models discovered from /v1/models before catalog enrichment was
      //      added have $0 costs and 0 context — update them from the catalog.
      try {
        const enriched = await enrichExistingModels();
        if (enriched > 0) {
          logger.info(
            { count: enriched },
            'Enriched existing models with catalog data',
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to enrich existing models');
      }

      // 3) Load all registered providers from DB and initialise adapters
      const registeredProviders = db.prepare('SELECT * FROM providers').all() as any[];

      for (const row of registeredProviders) {
        const template = PROVIDER_CATALOG.find((t) => t.id === row.name);
        let config: any;
        try {
          config = JSON.parse(row.config || '{}');
        } catch {
          config = {};
        }
        // Prefer the new provider_keys table (migration 015). The legacy
        // config.apiKey column is still used as a fallback so providers
        // that existed before the migration keep working without an
        // explicit backfill.
        const activeCredential = loadActiveProviderCredential(row.id);
        let apiKey = activeCredential.apiKey;
        if (!apiKey) {
          decryptConfigApiKey(config);
          apiKey =
            config.apiKey || (row.api_key_ref ? process.env[row.api_key_ref] : undefined);
        }

        // Register a GenericOpenAIAdapter on demand for OpenAI-compatible rows.
        // Catalog rows go through `template.apiFormat === 'openai'`. Custom
        // providers added via the dialog (e.g. tokenrouter) have no catalog
        // template, so we also accept `adapter_type === 'openai' | 'generic-openai'`
        // directly. The 'google' provider uses the GenericOpenAIAdapter for the
        // OpenAI-compatible surface of generativelanguage.googleapis.com, so we
        // also check for 'google'. Without this, every gateway restart loses the
        // custom adapter and the next chat request fails with "Adapter not found".
        const isOpenaiCompatRow =
          template?.apiFormat === 'openai' ||
          row.adapter_type === 'openai' ||
          row.adapter_type === 'generic-openai' ||
          row.adapter_type === 'google';
        if (!adapterRegistry.get(row.name) && isOpenaiCompatRow) {
          const adapter = new GenericOpenAIAdapter(row.name);
          adapterRegistry.register(adapter);
        }

        const adapter = adapterRegistry.get(row.name);
        const baseUrl = row.base_url || template?.baseUrl;
        const authMethod = row.auth_method || 'api_key';

        // OAuth flow
        if (authMethod === 'oauth' && row.oauth_access_token && adapter && baseUrl) {
          let accessToken: string;
          try {
            accessToken = decrypt(row.oauth_access_token);
          } catch {
            accessToken = row.oauth_access_token; // already plaintext
          }

          if (
            row.oauth_token_expires_at &&
            new Date(row.oauth_token_expires_at) < new Date(Date.now() + 60_000)
          ) {
            if (row.oauth_refresh_token && template?.oauthConfig) {
              try {
                const { OAuthService } = await import('@dmr-x/oauth');
                const oauthService = new OAuthService();
                let refreshToken: string;
                try {
                  refreshToken = decrypt(row.oauth_refresh_token);
                } catch {
                  refreshToken = row.oauth_refresh_token;
                }
                const newTokens = await oauthService.refreshAccessToken(
                  template.oauthConfig,
                  refreshToken,
                );
                accessToken = newTokens.accessToken;
                const encAccess = encrypt(newTokens.accessToken);
                const encRefresh = newTokens.refreshToken
                  ? encrypt(newTokens.refreshToken)
                  : row.oauth_refresh_token;
                db.prepare(
                  `UPDATE providers SET oauth_access_token = ?, oauth_refresh_token = ?, oauth_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`,
                ).run(
                  encAccess,
                  encRefresh,
                  newTokens.expiresAt?.toISOString() || null,
                  row.id,
                );
                logger.info({ providerId: row.name }, 'Refreshed OAuth token on startup');
              } catch (err) {
                logger.warn(
                  { providerId: row.name, err },
                  'Failed to refresh OAuth token on startup',
                );
              }
            }
          }

          try {
            await adapterRegistry.initialize(row.name, {
              baseUrl,
              accessToken,
              authMethod: 'oauth',
            });
            logger.info({ providerId: row.name }, 'Initialized adapter with OAuth token');
          } catch (err) {
            logger.warn(
              { providerId: row.name, err },
              'Failed to initialize adapter with OAuth token',
            );
          }
          continue;
        }

        // API-key flow
        if (adapter && baseUrl && (apiKey || !template?.envKey)) {
          try {
            await adapterRegistry.initialize(row.name, {
              baseUrl,
              apiKey: apiKey || '',
            });
            logger.info({ providerId: row.name }, 'Initialized adapter from DB/Env');
          } catch (err) {
            logger.warn(
              { providerId: row.name, err },
              'Failed to initialize adapter on startup',
            );
          }
        }
      }

      // 4) Re-activate ALL models that were incorrectly deactivated by
      //    the old health check logic. The `available_only` filter in
      //    /admin/models handles key-based visibility, so is_active
      //    should only reflect intentional user/registry decisions.
      try {
        const reactivated = db.prepare(
          `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
           WHERE is_active = 0`
        ).run();
        if (reactivated.changes > 0) {
          logger.info({ count: reactivated.changes }, 'Re-activated models deactivated by previous health checks');
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to re-activate models during background init');
      }

      // 5) Activate models for providers that have keys (or are keyless)
      try {
        const allProviders = db
          .prepare(
            `SELECT id, name, config, is_healthy, auth_method, oauth_access_token FROM providers`,
          )
          .all() as any[];
        for (const p of allProviders) {
          const cfg = JSON.parse(p.config || '{}');
          const template = PROVIDER_CATALOG.find((t) => t.id === p.name);
          const needsNoKey = template?.envKey === '';

          if (needsNoKey && !p.is_healthy) {
            db.prepare(
              `UPDATE providers SET is_healthy = 1, consecutive_failures = 0, updated_at = datetime('now') WHERE id = ?`,
            ).run(p.id);
            logger.info({ provider: p.name }, 'Re-activated keyless provider');
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to activate models during background init');
      }

      // 5) Refresh the candidate set so any newly-registered providers
      //    or model profiles become routable.
      try {
        const candidates = registryService.getCandidates();
        router.setCandidates(candidates);
        logger.info(
          { count: candidates.length },
          'Refreshed routing candidates after background init',
        );
      } catch (err) {
        logger.warn({ err }, 'Failed to refresh candidates after background init');
      }

      logger.info(
        { durationMs: Date.now() - initStart },
        'Background initialisation complete',
      );
    })();

    // ─── Periodic Health Check ──────────────────────────────────────
    // Every 5 minutes, verify provider health and key validity.
    // Marks providers unhealthy but does NOT deactivate models — the
    // `available_only` filter in /admin/models handles visibility.
    const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    setInterval(() => {
      void (async () => {
        try {
          const providers = db.prepare(
            `SELECT id, name, base_url, is_healthy, tier FROM providers WHERE tier != 'inactive'`
          ).all() as Array<{ id: string; name: string; base_url: string | null; is_healthy: number; tier: string }>;

          for (const p of providers) {
            const template = PROVIDER_CATALOG.find(t => t.id === p.name);
            const needsNoKey = template?.envKey === '';

            // Skip keyless providers (Pollinations) — they're always healthy
            if (needsNoKey) continue;

            // Check if provider still has active keys
            const activeKey = db.prepare(
              `SELECT 1 FROM provider_keys
               WHERE provider_id = ? AND is_active = 1
                 AND (api_key_encrypted IS NOT NULL OR oauth_access_token_encrypted IS NOT NULL)
               LIMIT 1`
            ).get(p.id);

            if (!activeKey && !needsNoKey) {
              // No active keys — mark provider as unhealthy.
              // Do NOT deactivate models here: the `available_only` filter
              // in /admin/models already hides models from keyless providers.
              // Deactivating them would erase user-added models that should
              // persist regardless of key status.
              if (p.is_healthy) {
                db.prepare(
                  `UPDATE providers SET is_healthy = 0, updated_at = datetime('now') WHERE id = ?`
                ).run(p.id);
              }
            }
          }
        } catch (err) {
          logger.warn({ err }, 'Periodic health check failed');
        }
      })();
    }, HEALTH_CHECK_INTERVAL_MS);
  };

  return { server, runBackgroundInit };
}
