import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { logger } from '@dmr-x/utils';
import { Router } from '@dmr-x/router';
import { AdapterRegistry, OpenAIAdapter, AnthropicAdapter, OllamaAdapter, ReplicateAdapter, StabilityAdapter, ElevenLabsAdapter, DeepgramAdapter, CohereAdapter, JinaAdapter, GenericOpenAIAdapter } from '@dmr-x/adapters';
import { registryService, HealthChecker, PROVIDER_CATALOG } from '@dmr-x/registry';
import { getPool, getRedis } from '@dmr-x/db';
import { quotaService, keyRotationService } from '@dmr-x/quota';
import { policyService } from '@dmr-x/policy';
import { chatRoutes } from './routes/chat.routes.js';
import { modelsRoutes } from './routes/models.routes.js';
import { imagesRoutes } from './routes/images.routes.js';
import { embeddingsRoutes } from './routes/embeddings.routes.js';
import { audioRoutes } from './routes/audio.routes.js';
import { anthropicRoutes } from './routes/anthropic.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';

export async function createServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

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

  // Initialize adapters with config from env
  if (process.env.OPENAI_API_KEY) {
    await adapterRegistry.initialize('openai', {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    await adapterRegistry.initialize('anthropic', {
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
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
      baseUrl: 'https://api.replicate.com',
      apiKey: process.env.REPLICATE_API_TOKEN,
    });
  }
  if (process.env.STABILITY_API_KEY) {
    await adapterRegistry.initialize('stability', {
      baseUrl: process.env.STABILITY_BASE_URL || 'https://api.stability.ai',
      apiKey: process.env.STABILITY_API_KEY,
    });
  }
  if (process.env.ELEVENLABS_API_KEY) {
    await adapterRegistry.initialize('elevenlabs', {
      baseUrl: 'https://api.elevenlabs.io',
      apiKey: process.env.ELEVENLABS_API_KEY,
    });
  }
  if (process.env.DEEPGRAM_API_KEY) {
    await adapterRegistry.initialize('deepgram', {
      baseUrl: 'https://api.deepgram.com',
      apiKey: process.env.DEEPGRAM_API_KEY,
    });
  }
  if (process.env.COHERE_API_KEY) {
    await adapterRegistry.initialize('cohere', {
      baseUrl: 'https://api.cohere.ai',
      apiKey: process.env.COHERE_API_KEY,
    });
  }
  if (process.env.JINA_API_KEY) {
    await adapterRegistry.initialize('jina', {
      baseUrl: 'https://api.jina.ai',
      apiKey: process.env.JINA_API_KEY,
    });
  }

  // Register GenericOpenAIAdapter for free-tier providers with key rotation
  const freeProviders = PROVIDER_CATALOG.filter(p =>
    p.models.some(m => m.inputCostPer1M === 0 && m.outputCostPer1M === 0)
  );
  for (const provider of freeProviders) {
    // Skip providers with template URLs (e.g., Cloudflare needs {ACCOUNT_ID})
    if (provider.baseUrl.includes('{')) continue;

    // Load keys (supports multiple via GROQ_API_KEYS or GROQ_API_KEY_1, _2, etc.)
    const keys = keyRotationService.loadKeys(provider.id);
    if (keys.length === 0 && provider.envKey) continue; // No keys available
    if (keys.length === 0 && !provider.envKey) {
      // Provider doesn't need a key (e.g., Pollinations)
      const adapter = new GenericOpenAIAdapter(provider.id);
      await adapter.initialize({ baseUrl: provider.baseUrl, apiKey: '' });
      adapterRegistry.register(adapter);
      logger.info({ providerId: provider.id }, 'Registered free-tier adapter (no key)');
      continue;
    }

    // Register adapter with key rotation support
    const adapter = new GenericOpenAIAdapter(provider.id);
    await adapter.initialize({
      baseUrl: provider.baseUrl,
      apiKey: keys[0],
    });
    if (keys.length > 1) {
      adapter.setKeys(keys);
    }
    adapterRegistry.register(adapter);
    logger.info({ providerId: provider.id, keyCount: keys.length }, 'Registered free-tier adapter');
  }

  // Initialize router
  const freeTierStrategy = (process.env.DMRX_FREE_TIER_STRATEGY as any) || 'none';
  const router = new Router({ epsilon: 0.05, quotaService, policyService, freeTierStrategy });
  router.setAdapterExecutor({
    execute: async (providerId, modelId, request) => {
      const adapter = adapterRegistry.get(providerId);
      if (!adapter) throw new Error(`Adapter not found: ${providerId}`);
      return adapter.execute(request);
    },
  });

  // Load candidates from registry
  try {
    const candidates = await registryService.getCandidates();
    router.setCandidates(candidates);
    logger.info({ count: candidates.length }, 'Loaded routing candidates');
  } catch (err) {
    logger.warn({ err }, 'Could not load candidates from registry (DB may not be ready)');
  }

  // Start health checker
  const healthChecker = new HealthChecker(adapterRegistry, 30000);
  healthChecker.start();

  // Make router available to routes
  server.decorate('router', router);
  server.decorate('adapterRegistry', adapterRegistry);

  // CORS
  await server.register(cors, {
    origin: process.env.DMRX_CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  });

  // Rate limiting
  await server.register(rateLimit, {
    max: parseInt(process.env.DMRX_RATE_LIMIT_MAX || '100', 10),
    timeWindow: process.env.DMRX_RATE_LIMIT_WINDOW || '1 minute',
  });

  // Middleware
  await server.register(requestIdMiddleware);
  await server.register(authMiddleware);

  // Health checks
  server.get('/health', async () => ({ status: 'ok' }));

  server.get('/healthz', async (request, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // Check PostgreSQL
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'fail';
      healthy = false;
    }

    // Check Redis
    try {
      const redis = getRedis();
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'fail';
      healthy = false;
    }

    const status = healthy ? 'ok' : 'degraded';
    if (!healthy) {
      reply.status(503);
    }
    return { status, checks };
  });

  server.get('/ready', async (request, reply) => {
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      const redis = getRedis();
      await redis.ping();
      return { status: 'ready' };
    } catch {
      reply.status(503);
      return { status: 'not_ready' };
    }
  });

  server.get('/livez', async () => ({ status: 'alive' }));

  // Routes
  await server.register(chatRoutes, { prefix: '/v1' });
  await server.register(anthropicRoutes, { prefix: '/v1' });
  await server.register(modelsRoutes, { prefix: '/v1' });
  await server.register(imagesRoutes, { prefix: '/v1' });
  await server.register(embeddingsRoutes, { prefix: '/v1' });
  await server.register(audioRoutes, { prefix: '/v1' });
  await server.register(adminRoutes, { prefix: '/v1' });

  // Error handler
  server.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    const code = error.code || 'INTERNAL_ERROR';

    logger.error({ err: error, req: request }, `Request error: ${error.message}`);

    reply.status(statusCode).send({
      error: {
        message: error.message,
        type: code,
        code: statusCode >= 500 ? 'internal_error' : code.toLowerCase(),
      },
    });
  });

  // Cleanup on close
  server.addHook('onClose', async () => {
    healthChecker.stop();
    await adapterRegistry.disposeAll();
  });

  return server;
}
