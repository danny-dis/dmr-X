import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger, decryptConfigApiKey, encrypt, decrypt } from '@dmr-x/utils';
import { Router } from '@dmr-x/router';
import { getTelemetryService } from '@dmr-x/telemetry';
import { AdapterRegistry, OpenAIAdapter, AnthropicAdapter, OllamaAdapter, ReplicateAdapter, StabilityAdapter, ElevenLabsAdapter, DeepgramAdapter, CohereAdapter, JinaAdapter, GenericOpenAIAdapter } from '@dmr-x/adapters';
import type { UnifiedRequest } from '@dmr-x/core';
import { registryService, HealthChecker, PROVIDER_CATALOG, autoRegisterProviders, discoverMissingModels, type ProviderTemplate, type ModelTemplate } from '@dmr-x/registry';
import { getDb } from '@dmr-x/db';
import { quotaService, keyRotationService, rateLimitService } from '@dmr-x/quota';
import { policyService } from '@dmr-x/policy';
import { chatRoutes } from './routes/chat.routes.js';
import { modelsRoutes } from './routes/models.routes.js';
import { imagesRoutes } from './routes/images.routes.js';
import { embeddingsRoutes } from './routes/embeddings.routes.js';
import { audioRoutes } from './routes/audio.routes.js';
import { anthropicRoutes } from './routes/anthropic.routes.js';
import { geminiRoutes } from './routes/gemini.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { toolsRoutes, registerToolHandler } from './routes/tools.routes.js';
import { agenticRoutes } from './routes/agentic.routes.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';

const LOCAL_MODE = process.env.DMRX_LOCAL_MODE === 'true';
declare const Bun: unknown | undefined;
const isBun = typeof Bun !== 'undefined';

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

  // Auto-register any new catalog items FIRST (first-run or updates)
  const db = getDb();
  try {
    const newlyRegistered = await autoRegisterProviders();
    if (newlyRegistered.length > 0) {
      logger.info({ count: newlyRegistered.length }, 'Auto-registered new catalog providers');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to auto-register providers');
  }

  // Backfill model_profiles for any OpenAI-compatible provider whose catalog
  // entry was empty (e.g. Pollinations) but whose DB row already existed before
  // the live-discovery logic shipped. Idempotent: providers that already have
  // model profiles are skipped.
  try {
    const backfilled = await discoverMissingModels();
    if (backfilled > 0) {
      logger.info({ count: backfilled }, 'Backfilled missing model profiles via /v1/models discovery');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to backfill missing models');
  }

  // Load all registered providers from DB and initialize adapters
  const registeredProviders = db.prepare('SELECT * FROM providers').all() as any[];
  for (const row of registeredProviders) {
    const template = PROVIDER_CATALOG.find(t => t.id === row.name);
    const config = JSON.parse(row.config || '{}');
    decryptConfigApiKey(config);
    const apiKey = config.apiKey || (row.api_key_ref ? process.env[row.api_key_ref] : undefined);

    // If adapter not yet registered, register GenericOpenAIAdapter if it's OpenAI-compatible
    if (!adapterRegistry.get(row.name) && template?.apiFormat === 'openai') {
      const adapter = new GenericOpenAIAdapter(row.name);
      adapterRegistry.register(adapter);
    }

    const adapter = adapterRegistry.get(row.name);
    const baseUrl = row.base_url || template?.baseUrl;
    const authMethod = row.auth_method || 'api_key';

    // OAuth token initialization
    if (authMethod === 'oauth' && row.oauth_access_token && adapter && baseUrl) {
      let accessToken: string;
      try {
        accessToken = decrypt(row.oauth_access_token);
      } catch {
        accessToken = row.oauth_access_token; // already plaintext
      }

      // Check if token is expired — try to refresh
      if (row.oauth_token_expires_at && new Date(row.oauth_token_expires_at) < new Date(Date.now() + 60000)) {
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
            const newTokens = await oauthService.refreshAccessToken(template.oauthConfig, refreshToken);
            accessToken = newTokens.accessToken;
            const encAccess = encrypt(newTokens.accessToken);
            const encRefresh = newTokens.refreshToken ? encrypt(newTokens.refreshToken) : row.oauth_refresh_token;
            db.prepare(
              `UPDATE providers SET oauth_access_token = ?, oauth_refresh_token = ?, oauth_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
            ).run(encAccess, encRefresh, newTokens.expiresAt?.toISOString() || null, row.id);
            logger.info({ providerId: row.name }, 'Refreshed OAuth token on startup');
          } catch (err) {
            logger.warn({ providerId: row.name, err }, 'Failed to refresh OAuth token on startup');
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
        logger.warn({ providerId: row.name, err }, 'Failed to initialize adapter with OAuth token');
      }
    } else if (adapter && baseUrl && (apiKey || !template?.envKey)) {
      try {
        await adapterRegistry.initialize(row.name, {
          baseUrl,
          apiKey: apiKey || '',
        });
        logger.info({ providerId: row.name }, 'Initialized adapter from DB/Env');
      } catch (err) {
        logger.warn({ providerId: row.name, err }, 'Failed to initialize adapter on startup');
      }
    }
  }

  // Activate models for providers that have keys or don't need one
  const allProviders = db.prepare(
    `SELECT id, name, config, is_healthy, auth_method, oauth_access_token FROM providers`
  ).all() as any[];
  for (const p of allProviders) {
    const cfg = JSON.parse(p.config || '{}');
    const template = PROVIDER_CATALOG.find(t => t.id === p.name);
    const needsNoKey = template?.envKey === '';

    // Ensure keyless providers (like Pollinations) are always healthy
    if (needsNoKey && !p.is_healthy) {
      db.prepare(
        `UPDATE providers SET is_healthy = 1, consecutive_failures = 0, updated_at = datetime('now') WHERE id = ?`
      ).run(p.id);
      logger.info({ provider: p.name }, 'Re-activated keyless provider');
    }

    const hasOAuthToken = p.auth_method === 'oauth' && !!p.oauth_access_token;
    if (cfg.hasKey || hasOAuthToken || needsNoKey) {
      const updated = db.prepare(
        `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
         WHERE provider_id = ? AND is_active = 0`
      ).run(p.id);
      if (updated.changes > 0) {
        logger.info({ provider: p.name, models: updated.changes }, 'Activated models for provider');
      }
    }
  }

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
  });

  // Make router and helpers available
  server.decorate('router', router);
  server.decorate('adapterRegistry', adapterRegistry);
  server.decorate('registerToolHandler', registerToolHandler);

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
    execute: async (providerId: string, _modelId: string, request: UnifiedRequest) => {
      const adapter = (server as any).getAdapter(providerId);
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

  // Expose candidate refresh for admin routes (after provider activation/key updates)
  server.decorate('refreshCandidates', async () => {
    try {
      const candidates = await registryService.getCandidates();
      router.setCandidates(candidates);
      logger.info({ count: candidates.length }, 'Refreshed routing candidates');
    } catch (err) {
      logger.warn({ err }, 'Failed to refresh routing candidates');
    }
  });

  // Start health checker — delay initial run to allow all adapters (including
  // those loaded from DB and auto-registered) to fully initialise.
  const healthChecker = new HealthChecker(adapterRegistry, 30000);
  setTimeout(() => healthChecker.start(), 5000);

  // Background OAuth token refresh — check every 5 minutes
  const OAUTH_REFRESH_INTERVAL = 5 * 60 * 1000;
  const oauthRefreshTimer = setInterval(async () => {
    try {
      const rows = db.prepare(
        `SELECT id, name, oauth_refresh_token, oauth_token_expires_at
         FROM providers
         WHERE auth_method = 'oauth'
         AND oauth_token_expires_at IS NOT NULL
         AND oauth_refresh_token IS NOT NULL`
      ).all() as any[];

      for (const row of rows) {
        const expiresAt = new Date(row.oauth_token_expires_at);
        const bufferMs = 5 * 60 * 1000; // refresh 5 minutes before expiry
        if (expiresAt.getTime() < Date.now() + bufferMs) {
          const template = PROVIDER_CATALOG.find(t => t.id === row.name);
          if (!template?.oauthConfig) continue;

          try {
            const { OAuthService } = await import('@dmr-x/oauth');
            const oauthService = new OAuthService();
            let refreshToken: string;
            try {
              refreshToken = decrypt(row.oauth_refresh_token);
            } catch {
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
        }
      }
    } catch (err) {
      logger.warn({ err }, 'OAuth token refresh check failed');
    }
  }, OAUTH_REFRESH_INTERVAL);
  oauthRefreshTimer.unref();

  // Start telemetry service (fire-and-forget — must not crash the server)
  try {
    const telemetry = getTelemetryService();
    await telemetry.start();
    logger.info('Telemetry service started');
  } catch (err) {
    logger.warn({ err }, 'Failed to start telemetry service — continuing without telemetry');
  }

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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-free-tier-strategy'],
  });

  // Rate limiting
  await server.register(rateLimit, {
    max: parseInt(process.env.DMRX_RATE_LIMIT_MAX || '100', 10),
    timeWindow: process.env.DMRX_RATE_LIMIT_WINDOW || '1 minute',
  });

  // Multipart uploads (for audio endpoints)
  await server.register(fastifyMultipart, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25MB max
    },
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
  const uiDir = candidateDirs.find(d => { try { return fs.existsSync(d); } catch { return false; } })
    || candidateDirs[candidateDirs.length - 1];
  try {
    await server.register(fastifyStatic, {
      root: uiDir,
      prefix: '/',
      wildcard: false,
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
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    );
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  // Health checks
  server.get('/health', async () => ({ status: 'ok' }));

  server.get('/healthz', async (_request, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // Check SQLite
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      checks.sqlite = 'ok';
    } catch {
      checks.sqlite = 'fail';
      healthy = false;
    }

    const status = healthy ? 'ok' : 'degraded';
    if (!healthy) {
      reply.status(503);
    }
    return { status, checks };
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

  // Routes
  await server.register(chatRoutes, { prefix: '/v1' });
  await server.register(anthropicRoutes, { prefix: '/v1' });
  await server.register(geminiRoutes, { prefix: '/v1' });
  await server.register(modelsRoutes, { prefix: '/v1' });
  await server.register(imagesRoutes, { prefix: '/v1' });
  await server.register(embeddingsRoutes, { prefix: '/v1' });
  await server.register(audioRoutes, { prefix: '/v1' });
  await server.register(adminRoutes, { prefix: '/v1' });
  await server.register(toolsRoutes, { prefix: '/v1' });
  await server.register(agenticRoutes, { prefix: '/v1' });

  // SPA fallback — serve index.html for non-API GET requests
  server.get('*', async (request, reply) => {
    if (request.url.startsWith('/v1/') || request.url.startsWith('/health')) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    const indexHtml = await fs.promises.readFile(path.join(uiDir, 'index.html'), 'utf8');
    return reply.type('text/html').send(indexHtml);
  });

  // Error handler
  server.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    const code = error.code || 'INTERNAL_ERROR';

    // Always log full error server-side
    logger.error({ err: error, req: request }, `Request error: ${error.message}`);

    // For 500+ errors, hide all internal details from clients
    const clientMessage = statusCode >= 500 ? 'Internal server error' : error.message;
    const clientType = statusCode >= 500 ? 'server_error' : code;

    reply.status(statusCode).send({
      error: {
        message: clientMessage,
        type: clientType,
        code: statusCode >= 500 ? 'internal_error' : code.toLowerCase(),
      },
    });
  });

  // Cleanup on close
  server.addHook('onClose', async () => {
    clearInterval(oauthRefreshTimer);
    healthChecker.stop();
    await adapterRegistry.disposeAll();
  });

  // Warn if running in local mode (auth disabled)
  if (LOCAL_MODE) {
    logger.warn('LOCAL MODE: Authentication is disabled. Set DMRX_LOCAL_MODE=false for production.');
  }

  // Validate admin API key strength in production
  if (!LOCAL_MODE) {
    const adminKey = process.env.DMRX_ADMIN_API_KEY;
    if (!adminKey || adminKey === 'replace-with-admin-key' || adminKey.length < 16) {
      logger.warn('DMRX_ADMIN_API_KEY is weak or unset. Set a strong key for production.');
    }
  }

  return server;
}
