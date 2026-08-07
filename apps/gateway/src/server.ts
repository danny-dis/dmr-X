import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdapterRegistry, OpenAIAdapter, AnthropicAdapter, OllamaAdapter, ReplicateAdapter, StabilityAdapter, ElevenLabsAdapter, DeepgramAdapter, CohereAdapter, JinaAdapter, GenericOpenAIAdapter, GenericAnthropicAdapter, FalAdapter, VeoAdapter, RunwayAdapter, ComfyUIAdapter, createAudioSeparationAdapter, createOcrAdapter, PollinationsImageAdapter, BedrockAdapter, AzureOpenAIAdapter, VertexAIAdapter, GroqAdapter, DeepSeekAdapter, XAIAdapter, OpenRouterAdapter, HuggingFaceAdapter, PerplexityAdapter, TogetherAdapter, FireworksAdapter, CerebrasAdapter, DatabricksAdapter, VLLMAdapter, SambanovaAdapter, NebiusAdapter, NovitaAdapter, MoonshotAdapter, MiniMaxAdapter, GeminiAPIAdapter, LMStudioAdapter, VolcengineAdapter, DashscopeAdapter, NVIDIANIMAdapter, AntigravityAdapter } from '@dmr-x/adapters';
import { BenchmarkService, JudgeService } from '@dmr-x/benchmark';
import type { UnifiedRequest } from '@dmr-x/core';
import { Router, loadBanditArms, startBanditPersistence } from '@dmr-x/router';
import { logger, decryptConfigApiKey, encrypt, decrypt, parseBodyLimit, parseTrustProxy } from '@dmr-x/utils';
import fastifyCompress from '@fastify/compress';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';

import { getTelemetryService, contentCaptureService, retentionService } from '@dmr-x/telemetry';
import { ProviderUnavailableError } from '@dmr-x/core';
import { registryService, HealthChecker, PROVIDER_CATALOG, autoRegisterProviders, discoverMissingModels, enrichExistingModels, repairModelProfiles, syncClassifications, classifyFreeProviderModels } from '@dmr-x/registry';
import { getDb } from '@dmr-x/db';
import { agentScheduler } from '@dmr-x/agent-runtime';
import { quotaService, getRateLimitService } from '@dmr-x/quota';
import { policyService } from '@dmr-x/policy';
import Fastify from 'fastify';

import { initializeAdapters } from './adapter-init.js';
import { registerSecurity } from './security-headers.js';
import { registerHealthEndpoints } from './health-endpoints.js';
import { registerOAuthRefresh } from './oauth-refresh.js';
import { registerTelemetryHooks } from './telemetry-hooks.js';
import {
  publishDashboardStatsThrottled,
  publishDashboardStatsUpdate,
  recordTelemetryEvent,
} from './admin-events.js';
import { authMiddleware, DEPLOYMENT_MODE } from './middleware/auth.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { registerSiemForwarding } from './middleware/siem-forward.middleware.js';
import { threeDRoutes } from './routes/3d.routes.js';
import { banditRoutes } from './routes/bandit.routes.js';
import { adminRoutes, loadActiveProviderCredential, loadAllActiveProviderKeys } from './routes/admin.routes.js';
import { mcpAdminRoutes, connectPersistedMcpServers } from './routes/mcp-admin.routes.js';
import { a2aProxyRoutes } from './routes/a2a-proxy.routes.js';
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
import { moderationRoutes } from './routes/moderation.routes.js';
import { toolsRoutes, registerToolHandler, registerBuiltinToolHandlers, registerCodingToolHandlers, sweepStaleSandboxes } from './routes/tools.routes.js';
import { registerReceptionistToolHandlers } from './lib/receptionist-tools.js';
import { videoRoutes } from './routes/video.routes.js';
import { geminiRoutes, geminiNativeRoutes } from './routes/gemini.routes.js';
import conversationRoutes from './routes/conversation.routes.js';
import { compressionRoutes } from './routes/compression.routes.js';
import { routeDecisionRoutes } from './routes/route.routes.js';
import { validateRoutes } from './routes/validate.routes.js';
import { countTokensRoutes } from './routes/count-tokens.routes.js';
import { agentRoutes } from './routes/agent.routes.js';
import { registerSkillRoutes } from './routes/skill.routes.js';
import { registerJobRoutes } from './routes/job.routes.js';
import { jobQueue } from './lib/job-queue.js';
import { agentChatRoutes } from './routes/agent-chat.routes.js';
import { agentDispatchRoutes } from './routes/agent-dispatch.routes.js';
import { createAgentConcurrencyGuard } from './middleware/agent-concurrency.middleware.js';
import { cloudcodeRoutes } from './routes/cloudcode.routes.js';
import { godmodeRoutes } from './routes/godmode.routes.js';
import { promptRoutes } from './routes/prompt.routes.js';
import { registerContextRoutes } from './routes/context.routes.js';
import { registerWorkflowRoutes } from './routes/workflow.routes.js';

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
    // L1 — strip client-supplied x-request-id to prevent log injection /
    // correlation-id spoofing. Always generate a server-side UUID instead
    // of trusting client input that could contain control characters.
    // Clients needing correlation should generate their own UUID.
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
  adapterRegistry.register(new GeminiAPIAdapter());
  adapterRegistry.register(new VLLMAdapter());
  adapterRegistry.register(new NebiusAdapter());
  adapterRegistry.register(new NovitaAdapter());
  adapterRegistry.register(new MoonshotAdapter());
  adapterRegistry.register(new MiniMaxAdapter());
  adapterRegistry.register(new LMStudioAdapter());
  adapterRegistry.register(new VolcengineAdapter());
  adapterRegistry.register(new DashscopeAdapter());
  adapterRegistry.register(new AntigravityAdapter());

  // Audio Separation adapters
  adapterRegistry.register(createAudioSeparationAdapter('demucs'));
  adapterRegistry.register(createAudioSeparationAdapter('audioshake'));
  adapterRegistry.register(createAudioSeparationAdapter('stemsplit'));
  // OCR adapters
  adapterRegistry.register(createOcrAdapter('tesseract'));
  adapterRegistry.register(createOcrAdapter('paddleocr'));
  adapterRegistry.register(createOcrAdapter('huggingface'));

  // Initialize adapters with config from env
  await initializeAdapters(adapterRegistry);

  const db = getDb();

  // Validate admin API key strength in production
  const MIN_ADMIN_API_KEY_LENGTH = 32;
  if (!LOCAL_MODE) {
    const adminKey = process.env.DMRX_ADMIN_API_KEY;
    if (!adminKey || adminKey === 'replace-with-admin-key' || adminKey.length < MIN_ADMIN_API_KEY_LENGTH) {
      throw new Error(`DMRX_ADMIN_API_KEY must be at least ${MIN_ADMIN_API_KEY_LENGTH} characters in production. Set a strong, unique key.`);
    }
  }

  // Validate encryption key in production
  if (!LOCAL_MODE) {
    const encryptionKey = process.env.DMRX_ENCRYPTION_KEY;
    if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
      throw new Error('DMRX_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) in production for AES-256-GCM encryption. Generate with: openssl rand -hex 32');
    }
  }
  
  logger.info('Security validation passed for admin key and encryption key');

  // Initialize router
  const freeTierStrategy = (process.env.DMRX_FREE_TIER_STRATEGY as any) || 'none';
  const router = new Router({
    epsilon: 0.05,
    quotaService,
    policyService,
    rateLimitService: getRateLimitService(),
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
      } catch (err) {
        logger.warn({ err }, 'Summarization adapter failed, using fallback');
        return {
          content: input.messages.map(m =>
            typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          ).join('\n'),
          tokens: 0
        };
      }
    }
  });

  // Restore Thompson bandit arm state persisted by a previous run (see
  // packages/db/src/migrations/071_bandit_arms.sql). Best-effort: on a
  // fresh DB or read failure the sampler just starts from its priors.
  loadBanditArms(router.getSampler());
  // Persist arm state on a slow debounced interval — not on every reward
  // update — because every SQLite write here rewrites the whole DB file
  // (see services/router/src/bandit/persistence.ts for the reasoning).
  // stopBanditPersistence() is invoked from the onClose hook below so a
  // clean shutdown always flushes the latest state.
  const stopBanditPersistence = startBanditPersistence(router.getSampler());

  // Make router and helpers available
  server.decorate('router', router);
  server.decorate('adapterRegistry', adapterRegistry);
  server.decorate('registerToolHandler', registerToolHandler);
  server.decorate('rateLimitService', getRateLimitService());
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

  // Attach telemetry-event + dashboard-stat publishers on the ROOT instance.
  // Decorations on the root are inherited by Fastify-encapsulated plugins,
  // so every `(server as any).recordTelemetryEvent?.(...)` call site across
  // chat/tools/auth/telemetry-hooks finally reaches the admin buffer.
  server.decorate('recordTelemetryEvent', recordTelemetryEvent);
  server.decorate('publishDashboardStatsUpdate', publishDashboardStatsUpdate);
  server.decorate('publishDashboardStatsThrottled', publishDashboardStatsThrottled);

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
        getRateLimitService().setConfig(candidate.providerId, candidate.modelId, {
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
          getRateLimitService().setConfig(candidate.providerId, candidate.modelId, {
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
  //
  // Scoped to DMRX_PROVIDER_ALLOWLIST when one is set. Probing EVERY
  // registered adapter is what made the gateway fall over: the catalog
  // registers 40+ providers, each probe retries to attempt 4 on failure, so
  // one 30s tick fired 160+ concurrent outbound requests. That exhausted
  // sockets and killed the process; pm2 restarted it, and any in-flight agent
  // turn saw a dead socket — surfaced to callers as the misleading
  // "All providers currently unavailable". Multi-step agent runs (10 turns)
  // hit the storm repeatedly, which is why job tasks died while a
  // single-turn direct call survived.
  //
  // getCandidates() already honours the allowlist, so unlisted providers can
  // never be routed to. Health-probing them was pure overhead against
  // credentials the operator does not have.
  const healthChecker = new HealthChecker({ intervalMs: 30_000 });
  server.addHook('onListen', async () => {
    // Register health checks for all providers after a short delay
    setTimeout(async () => {
      const allowlist = (process.env.DMRX_PROVIDER_ALLOWLIST ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const registered = adapterRegistry.list();
      const monitored = allowlist.length
        ? registered.filter((id) => allowlist.includes(id))
        : registered;

      if (allowlist.length && monitored.length < registered.length) {
        logger.info(
          { monitored: monitored.length, registered: registered.length, allowlist },
          'Health checks scoped to DMRX_PROVIDER_ALLOWLIST',
        );
      }

      for (const id of monitored) {
        const adapter = adapterRegistry.peek(id);
        if (adapter) {
          healthChecker.startProviderCheck(id, async () => {
            // Use the generation-capability probe (not the boot-time
            // healthCheck()) for the periodic check. healthCheck() only hits
            // the /models endpoint and THROWS on any non-200 (404 model
            // removed, 429 rate-limit, 5xx, network blip). A single transient
            // 404 would be caught and flip is_healthy=0, poisoning the DB and
            // excluding the provider from getCandidates() forever. The
            // generation probe correctly treats only 401/403 (revoked key) as
            // unhealthy and tolerates 404/429/5xx as "reachable".
            try {
              if (typeof (adapter as any).checkGenerationCapability === 'function') {
                return await (adapter as any).checkGenerationCapability();
              }
              const result = await adapter.healthCheck();
              return result.healthy;
            } catch {
              return false;
            }
          });
        }
      }
    }, 5000).unref();
  });

  // Background OAuth token refresh — check every 5 minutes.
  let { oauthRefreshTimer } = registerOAuthRefresh(server, db, adapterRegistry);

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
    // x-quality-target / x-cost-filter / x-compression are read by route
    // handlers but were missing here, so a UI served from a different origin
    // than the gateway (the Vite dev server on :4200) had them stripped by the
    // browser and silently lost its routing hints.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'x-free-tier-strategy',
      'x-quality-target',
      'x-cost-filter',
      'x-compression',
      'anthropic-version',
      'anthropic-beta',
    ],
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
      // Build outputs are content-addressed: `/assets/*` filenames (Vite
      // hashed bundles) never change for a given content, so they can be
      // cached for a year, immutable. Everything else (notably `index.html`,
      // which re-addresses the assets on every rebuild) must be revalidated
      // so already-open tabs never serve stale bundle references.
      cacheControl: false,
      setHeaders(res, filePath) {
        const relative = path.relative(uiDir, filePath).split(path.sep).join('/');
        if (relative.startsWith('assets/')) {
          res.raw.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.raw.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
      },
    });
    logger.info({ dir: uiDir }, 'Serving UI from static directory');
  } catch (err) {
    logger.warn({ err, dir: uiDir }, 'Could not serve UI static files');
  }

  // Middleware
  await server.register(requestIdMiddleware);
  await server.register(authMiddleware);

  // Compliance layer: SIEM audit forwarding (no-op unless DMRX_SIEM_URL set)
  registerSiemForwarding(server);

  // Security headers & error handler (must be set BEFORE route registration)
  registerSecurity(server);

  // Telemetry hooks (onRequest starts OTel spans, onResponse ends them)
  registerTelemetryHooks(server, telemetry);

  // Per-tenant concurrency cap on agent/agentic/tool endpoints. Returns 429
  // instead of letting unbounded concurrent subagent requests overload the
  // provider tier. Chat-completions and provider passthrough are unaffected.
  const agentConcurrencyGuard = createAgentConcurrencyGuard();
  server.addHook('preHandler', (request, reply, done) => {
    const url = (request.routeOptions?.url as string) || request.url || '';
    if (
      url.includes('/agents') ||
      url.includes('/agentic') ||
      url.includes('/tools/')
    ) {
      const admitted = agentConcurrencyGuard.guard(request, reply);
      if (!admitted) return; // 429 already sent (hijacked)
    }
    done();
  });

  // Health endpoints
  registerHealthEndpoints(server, { router, MEMORY_LIMIT });

// Routes
   await server.register(chatRoutes, { prefix: '/v1' });
   await server.register(anthropicRoutes, { prefix: '/v1' });
   await server.register(geminiRoutes, { prefix: '/v1' });
   // Google-native Gemini paths (/v1beta/models/<model>:generateContent).
   // Registered at the root, not under /v1, because the Gemini SDKs build
   // those URLs themselves and cannot be pointed at /v1/gemini/*.
   await server.register(geminiNativeRoutes);
   await server.register(modelsRoutes, { prefix: '/v1' });
   await server.register(imagesRoutes, { prefix: '/v1' });
   await server.register(embeddingsRoutes, { prefix: '/v1' });
   await server.register(rerankRoutes, { prefix: '/v1' });
   // Was written but never mounted, so POST /v1/moderations 404d despite the
   // playground offering a Moderate mode that calls it.
   await server.register(moderationRoutes, { prefix: '/v1' });
   await server.register(audioRoutes, { prefix: '/v1' });
   await server.register(audioSeparationRoutes, { prefix: '/v1' });
   await server.register(ocrRoutes, { prefix: '/v1' });
   await server.register(videoRoutes, { prefix: '/v1' });
   await server.register(threeDRoutes, { prefix: '/v1' });
   await server.register(adminRoutes, { prefix: '/v1' });
   await server.register(banditRoutes, { prefix: '/v1' });
   // Registered after adminRoutes so the real /admin/mcp/servers surface sits
   // alongside the legacy /admin/mcp/aggregation/* file-only endpoints.
   await server.register(mcpAdminRoutes, { prefix: '/v1' });
   await server.register(a2aProxyRoutes, { prefix: '/v1' });
   await server.register(toolsRoutes, { prefix: '/v1' });
   registerBuiltinToolHandlers();
   registerCodingToolHandlers();
   registerReceptionistToolHandlers();
   sweepStaleSandboxes();
    logger.info('Registering route: agenticRoutes');
    await server.register(agenticRoutes, { prefix: '/v1' });
    logger.info('Registering route: conversationRoutes');
    await server.register(conversationRoutes, { prefix: '/v1' });
    logger.info('Registering route: compressionRoutes');
    await server.register(compressionRoutes, { prefix: '/v1' });
    logger.info('Registering route: routeDecisionRoutes');
    await server.register(routeDecisionRoutes, { prefix: '/v1' });
    logger.info('Registering route: validateRoutes');
    await server.register(validateRoutes);
    logger.info('Registering route: countTokensRoutes');
    await server.register(countTokensRoutes, { prefix: '/v1' });
    logger.info('Registering route: agentRoutes');
    await server.register(agentRoutes, { prefix: '/v1' });
    logger.info('Registering route: skillRoutes');
    await server.register(registerSkillRoutes, { prefix: '/v1' });
    logger.info('Registering route: jobRoutes');
    await server.register(registerJobRoutes, { prefix: '/v1' });
    logger.info('Registering route: agentChatRoutes');
    await server.register(agentChatRoutes, { prefix: '/v1' });
    logger.info('Registering route: agentDispatchRoutes');
    await server.register(agentDispatchRoutes, { prefix: '/v1' });
    logger.info('Registering route: cloudcodeRoutes');
    await server.register(cloudcodeRoutes); // Cloud Code protocol (Antigravity/agy)
    logger.info('Registering route: godmodeRoutes');
    await server.register(godmodeRoutes, { prefix: '/v1' }); // G0DM0D3 integration

    // Rehydrate: if a G0DM0D3 server was left 'running' in server_instances,
    // point the proxy at it (env-based wiring remains the fallback).
    try {
      const { serverManager } = await import('@dmr-x/server-manager');
      const { setGodmodeConfig } = await import('@dmr-x/godmode');
      const live = serverManager.getRunningInstance();
      if (live && live.url) {
        // Relay mode (no OpenRouter key) if the instance was started that way.
        const relayMatch = live.openrouter_key_ref?.startsWith('relay:')
          ? live.openrouter_key_ref.slice('relay:'.length)
          : null;
        setGodmodeConfig({
          baseUrl: live.url,
          apiKey: live.api_key ?? undefined,
          openrouterApiKey: relayMatch ? '' : (process.env.OPENROUTER_API_KEY ?? ''),
          llmBaseUrl: relayMatch ?? undefined,
          llmApiKey: relayMatch ? live.llm_api_key ?? undefined : undefined,
        });
        logger.info({ url: live.url, relay: Boolean(relayMatch) }, 'Rehydrated G0DM0D3 proxy config from server_instances');
      }
    } catch (err) {
      logger.warn({ err }, 'G0DM0D3 rehydration skipped (no persisted running instance)');
    }

    // G0DM0D3 process auto-boot is deferred to main.ts (startCompanionServices)
    // so it never blocks listen()/health. Rehydration above is enough here.

    logger.info('Registering route: promptRoutes');
    await server.register(promptRoutes, { prefix: '/v1' }); // L1B3RT4S prompt library
    logger.info('Registering route: contextRoutes');
    await server.register(registerContextRoutes, { prefix: '/v1' });
    logger.info('Registering route: workflowRoutes');
    await server.register(registerWorkflowRoutes, { prefix: '/v1' });
    logger.info('All routes registered');

  // Start the agent scheduler in the background — must not block the listener.
  // AgentScheduler.start() loads persisted jobs and polls every 30s; its
  // interval is unref()'d so it never keeps the event loop alive. A failure
  // here must never prevent the gateway from serving traffic.
  try {
    agentScheduler.start();
    logger.info('Agent scheduler started');
  } catch (err) {
    logger.warn({ err }, 'Failed to start agent scheduler — continuing without scheduling');
  }

  // A job marked 'running' with nothing driving it was interrupted by a crash
  // or a restart, and would otherwise sit untouched forever. Re-queue it;
  // runJobPass reclaims any task stranded mid-flight, so it resumes rather
  // than re-running the interrupted task. Never fatal to startup.
  try {
    const concurrency = Number(process.env.DMRX_JOB_CONCURRENCY);
    if (Number.isFinite(concurrency) && concurrency > 0) {
      jobQueue.configure({ concurrency });
    }
    const tenantIds = (getDb().prepare('SELECT id FROM tenants').all() as Array<{ id: string }>)
      .map((row) => row.id);
    const recovered = jobQueue.recoverInterrupted(tenantIds);
    logger.info({ tenants: tenantIds.length, recovered }, 'Job queue started');
  } catch (err) {
    logger.warn({ err }, 'Failed to recover interrupted jobs — continuing');
  }

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
    // `/.well-known/*` is a machine-discovery namespace (RFC 8615), never a UI
    // route. Answering it with the SPA shell makes a client probing for an
    // agent card read `200 text/html` as "endpoint exists but is broken".
    if (pathname.startsWith('/.well-known/')) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    // Only browser navigations get the SPA shell. Every browser sends
    // `text/html` in Accept; API clients (curl, fetch, SDKs) do not — and
    // handing them a 200 HTML page for a mistyped API path hides the 404.
    if (!String(request.headers.accept ?? '').includes('text/html')) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    return reply.type('text/html').send(indexHtml);
  });

  // Cleanup on close
  server.addHook('onClose', async () => {
    if (oauthRefreshTimer) {
      clearTimeout(oauthRefreshTimer);
      oauthRefreshTimer = null;
    }
    healthChecker.stopAll();
    contentCaptureService.stop();
    stopBanditPersistence();
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

  // Validate admin API key strength in production (must be at least 32 characters)
  if (!LOCAL_MODE) {
    const adminKey = process.env.DMRX_ADMIN_API_KEY;
    if (!adminKey || adminKey === 'replace-with-admin-key' || adminKey.length < 32) {
      logger.warn('DMRX_ADMIN_API_KEY is weak or unset. Set a strong key (>= 32 characters) for production.');
    }
  }

  // ---------------------------------------------------------------------------
  // Background initialisation
  //
  // The following work does NOT need to block the listener. Moving it off the
  // boot path is what gets the gateway from "5+ minutes to /health" to
  // "sub-second to /health" on a cold start.
  // ---------------------------------------------------------------------------
  //
  // Seed provider_keys rows from .env on boot.
  //
  // The router only routes to providers that have an *active* row in the
  // provider_keys table (migration 015), but nothing previously persisted the
  // .env keys into that table on startup — so a fresh/provisioned DB (or one
  // wiped by a corruption-recovery backup) left every provider keyless, which
  // cascaded into zero routable candidates and a permanent 503. Operators
  // expect keys in .env to "just work"; this step makes that true by
  // upserting a Default key row for every provider whose catalog envKey is set.
  // Idempotent: it leaves existing active keys (and manually-added ones) alone.
  const seedEnvKeysToProviderKeys = (db: ReturnType<typeof getDb>): number => {
    let seeded = 0;
    for (const template of PROVIDER_CATALOG) {
      const envKey = template.envKey;
      if (!envKey) continue; // keyless provider (e.g. pollinations) — skip
      const apiKey = process.env[envKey];
      if (!apiKey) continue; // no key present in env for this provider
      const provider = db
        .prepare('SELECT id, name FROM providers WHERE name = ?')
        .get(template.id) as { id: string; name: string } | undefined;
      if (!provider) continue; // provider not registered in DB yet
      const hasActive = db
        .prepare(
          'SELECT 1 FROM provider_keys WHERE provider_id = ? AND is_active = 1 LIMIT 1',
        )
        .get(provider.id);
      if (hasActive) continue; // already keyed — don't overwrite
      const keyTier: 'free' | 'paid' =
        // Keyless providers are labelled free; keyed ones default to paid.
        template.models.length > 0 && template.models.every((m) => !!m.freeTier)
          ? 'free'
          : 'paid';
      db.prepare(
        `INSERT INTO provider_keys (
          id, provider_id, label, tier,
          api_key_encrypted, auth_method, priority, is_active,
          created_at, updated_at
        ) VALUES (?, ?, 'Default', ?, ?, 'api_key', 0, 1, datetime('now'), datetime('now'))`,
      ).run(
        `${provider.id}-default`,
        provider.id,
        keyTier,
        encrypt(apiKey),
      );
      // A fresh key means the provider can route — clear the poisoned
      // is_healthy=0 that a prior failed health sweep may have left behind.
      // Also mirror the key's tier onto the denormalised `providers.tier`
      // column (admin.routes.ts's `recomputeProviderTier` owns this column
      // for multi-key providers, but isn't reachable from here — this is
      // the single-key case seedEnvKeysToProviderKeys always produces, so
      // setting it directly is equivalent and keeps the Dashboard's
      // free/paid provider counts correct for providers seeded from .env).
      db.prepare(
        `UPDATE providers SET is_healthy = 1, consecutive_failures = 0, tier = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(keyTier, provider.id);
      seeded++;
      logger.info({ provider: provider.name, envKey }, 'Seeded provider key from .env');
    }
    return seeded;
  };

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

      // 1.2) Seed provider_keys from .env so keyed providers are routable
      //      even after a fresh/provisioned/recovered DB wipe. Idempotent.
      try {
        const seeded = seedEnvKeysToProviderKeys(db);
        if (seeded > 0) {
          logger.info({ count: seeded }, 'Seeded provider keys from .env on boot');
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to seed provider keys from .env');
      }

      // 1.5) Sync model classifications (pricing tiers)
      try {
        syncClassifications();
      } catch (err) {
        logger.warn({ err }, 'Failed to sync model classifications');
      }

      // 1.6) Auto-classify models for providers in DMRX_FREE_PROVIDERS
      try {
        classifyFreeProviderModels();
      } catch (err) {
        logger.warn({ err }, 'Failed to classify free provider models');
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

      // 2.75) Repair/sanitize persisted model_profiles: zero negative pricing
      //       (OpenRouter's "-1" sentinel stored as -1000), deactivate
      //       OpenRouter's virtual routing models, and backfill capabilities
      //       + free-tier metadata for rows written before the discovery
      //       pipeline carried them.
      try {
        const repaired = await repairModelProfiles();
        if (repaired > 0) {
          logger.info(
            { count: repaired },
            'Repaired model profiles (negative pricing, virtuals, capability/free-tier backfill)',
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to repair model profiles');
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
        // Resolve the runtime API key with precedence:
        //   1. A fresh env var referenced by the row (row.api_key_ref, e.g.
        //      MISTRAL_API_KEY) — overrides any stale stored value.
        //   2. The new provider_keys table (migration 015).
        //   3. The legacy config.apiKey column (older providers).
        // The env var is FIRST so an operator can rotate/refresh a key in
        // .env without needing to overwrite the persisted (possibly stale
        // or revoked) DB value.
        decryptConfigApiKey(config);
        // Precedence: fresh env var (row.api_key_ref, e.g. MISTRAL_API_KEY)
        //  > provider_keys table (migration 015) > legacy config.apiKey.
        // The env var wins so an operator can rotate/refresh a key in .env
        // without overwriting a persisted (possibly stale/revoked) DB value.
        const envKey = row.api_key_ref ? process.env[row.api_key_ref] : undefined;
        let apiKey =
          envKey || loadActiveProviderCredential(row.id).apiKey || config.apiKey;
        if (!apiKey && template?.envKey) {
          apiKey = process.env[template.envKey];
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

        // Register GenericAnthropicAdapter for Anthropic-compatible rows
        const isAnthropicCompatRow =
          template?.apiFormat === 'anthropic' ||
          row.adapter_type === 'anthropic' ||
          row.adapter_type === 'generic-anthropic';
        if (!adapterRegistry.get(row.name) && isAnthropicCompatRow && row.adapter_type !== 'anthropic') {
          const adapter = new GenericAnthropicAdapter(row.name);
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
          if (!apiKey && template?.envKey) {
            // A provider that REQUIRES a key resolved to none. Surface this
            // loudly instead of letting requests silently 401/502 upstream.
            logger.warn(
              {
                providerId: row.name,
                expectedEnvVar: template.envKey,
              },
              `No API key resolved for keyed provider — set ${template.envKey} in .env or add a key via the admin UI. Requests will fail auth until then.`,
            );
          }
          try {
            await adapterRegistry.initialize(row.name, {
              baseUrl,
              apiKey: apiKey || '',
            });
            // Hand the adapter the FULL vault pool so it can rotate when one
            // free-tier key is exhausted. initialize() only ever receives a
            // single credential, so without this every extra key an operator
            // stored sat unused and a 429 failed the request outright.
            const pool = loadAllActiveProviderKeys(row.id);
            const withEnvFirst = apiKey && !pool.includes(apiKey) ? [apiKey, ...pool] : pool;
            if (withEnvFirst.length > 1) {
              const setKeys = (adapter as { setKeys?: (k: string[]) => void }).setKeys;
              if (typeof setKeys === 'function') {
                setKeys.call(adapter, withEnvFirst);
                logger.info(
                  { providerId: row.name, keyCount: withEnvFirst.length },
                  'Loaded multi-key rotation pool from provider vault',
                );
              }
            }
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
      // Only revive models belonging to providers that live discovery could
      // NOT reach. Discovery is authoritative for providers it can list: it
      // reactivates what upstream still serves and deactivates what it does
      // not. A blanket `is_active = 1` here ran after discovery and undid that
      // every boot, resurrecting model ids the provider had removed.
      try {
        const reactivated = db.prepare(
          `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
           WHERE is_active = 0
             AND provider_id NOT IN (
               SELECT DISTINCT provider_id FROM model_profiles
               WHERE is_active = 1
             )`
        ).run();
        if (reactivated.changes > 0) {
          logger.info({ count: reactivated.changes }, 'Re-activated models for providers discovery could not reach');
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
          // A provider has a usable key if its envKey resolves to a non-empty
          // value (set in process.env) or it is keyless by design.
          const hasKey = !!template?.envKey && !!process.env[template.envKey];
          const keyConfigured = needsNoKey || hasKey;

          // Re-activate providers that are intended to be used (keyless or
          // keyed) but were previously marked unhealthy by transient
          // health-check timeouts. Keeping them healthy preserves a large
          // candidate pool so meta-models like `auto` can spread traffic
          // across backends instead of funnelling onto a single survivor.
          // Genuinely-dead providers (revoked keys, hard network failures)
          // are still caught at request time by the circuit breaker + fallback.
          if (keyConfigured && !p.is_healthy) {
            db.prepare(
              `UPDATE providers SET is_healthy = 1, consecutive_failures = 0, updated_at = datetime('now') WHERE id = ?`,
            ).run(p.id);
            logger.info({ provider: p.name, hasKey }, 'Re-activated provider (was transiently unhealthy)');
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to activate models during background init');
      }

      // 6) Refresh the candidate set so any newly-registered providers
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
