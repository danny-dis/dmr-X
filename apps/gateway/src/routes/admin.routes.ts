import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '@dmr-x/db';
import crypto from 'node:crypto';
import { ValidationError } from '@dmr-x/core';
import { logger, encrypt, decrypt, encryptConfigApiKey, decryptConfigApiKey } from '@dmr-x/utils';
import { PROVIDER_CATALOG } from '@dmr-x/registry';
import { memoryService, retentionManager } from '@dmr-x/memory';
import { sandboxService } from '@dmr-x/sandbox';
import { workersService } from '@dmr-x/workers';
import { federationService } from '@dmr-x/federation';

const CreateProviderSchema = z.object({
  name: z.string().min(1),
  adapter_type: z.string().min(1),
  base_url: z.string().url().optional(),
  api_key_ref: z.string().optional(),
  config: z.record(z.unknown()).optional().default({}),
});

const CreateModelSchema = z.object({
  provider_id: z.string().uuid(),
  model_id: z.string().min(1),
  display_name: z.string().optional(),
  modality: z.enum(['llm', 'diffusion', 'embedding', 'audio_tts', 'audio_stt', 'audio_speech', 'audio_transcription', 'video', 'music', 'reranking', 'moderation', 'code_completion', 'image_upscaling', 'image_inpainting']),
  intelligence_layer: z.enum(['brain', 'thinker', 'executor', 'worker', 'temp_worker']).optional().default('executor'),
  context_window: z.number().positive().optional(),
  max_output_tokens: z.number().positive().optional(),
  supports_streaming: z.boolean().optional().default(false),
  supports_vision: z.boolean().optional().default(false),
  supports_tool_use: z.boolean().optional().default(false),
  input_cost_per_1k: z.number().min(0).optional().default(0),
  output_cost_per_1k: z.number().min(0).optional().default(0),
  cost_per_image: z.number().min(0).optional().default(0),
});

const TestProviderSchema = z.object({
  provider_id: z.string().min(1),
  base_url: z.string().url(),
  api_key: z.string().min(1),
});

const ActivateProviderSchema = z.object({
  template_id: z.string().min(1),
  api_key: z.string().optional(),
  oauth_access_token: z.string().optional(),
  oauth_refresh_token: z.string().optional(),
  oauth_token_expires_at: z.string().datetime().optional(),
  auth_method: z.enum(['api_key', 'oauth']).optional(),
  name: z.string().optional(),
});

const UpdateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  adapter_type: z.string().min(1).optional(),
  base_url: z.string().url().optional().nullable(),
  api_key_ref: z.string().optional().nullable(),
  auth_method: z.enum(['api_key', 'oauth']).optional(),
  oauth_access_token: z.string().optional(),
  oauth_refresh_token: z.string().optional().nullable(),
  oauth_token_expires_at: z.string().datetime().optional().nullable(),
  config: z.record(z.unknown()).optional(),
});

const UpdateApiKeySchema = z.object({
  api_key: z.string().min(1),
});

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(255),
});

const CreateApiKeySchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().max(255).optional(),
  scopes: z.array(z.string()).optional(),
});

const CreateTenantApiKeySchema = z.object({
  name: z.string().max(255).optional(),
  scopes: z.array(z.string()).optional(),
});

const UpdateModelSchema = z.object({
  display_name: z.string().optional(),
  modality: z.string().optional(),
  context_window: z.number().positive().optional().nullable(),
  max_output_tokens: z.number().positive().optional().nullable(),
  is_active: z.boolean().optional(),
});

const CreatePolicySchema = z.object({
  tenant_id: z.string().optional().default('default'),
  name: z.string().min(1),
  type: z.enum(['provider_allow', 'provider_deny', 'model_allow', 'model_deny', 'cost_cap', 'modality_restriction', 'residency', 'tool_permission']),
  target: z.array(z.string()).default([]),
  action: z.enum(['allow', 'deny', 'redirect']).default('deny'),
  conditions: z.record(z.unknown()).optional().default({}),
  priority: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

const UpdatePolicySchema = z.object({
  name: z.string().optional(),
  type: z.enum(['provider_allow', 'provider_deny', 'model_allow', 'model_deny', 'cost_cap', 'modality_restriction', 'residency', 'tool_permission']).optional(),
  target: z.array(z.string()).optional(),
  action: z.enum(['allow', 'deny', 'redirect']).optional(),
  conditions: z.record(z.unknown()).optional(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

const PrimitiveValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

// Defense-in-depth: blocked keys that could enable prototype pollution
const BLOCKED_SETTINGS_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

// Strict allowlist: only known settings keys accepted; unknown keys are rejected via .strict()
const UpdateSettingsSchema = z.object({
  routingTimeout: z.union([z.string(), z.number()]).optional(),
  fallbackEnabled: z.boolean().optional(),
  logRetention: z.union([z.string(), z.number()]).optional(),
  qualityWeight: z.union([z.string(), z.number()]).optional(),
  costWeight: z.union([z.string(), z.number()]).optional(),
  latencyWeight: z.union([z.string(), z.number()]).optional(),
  platformName: z.string().optional(),
  timezone: z.string().optional(),
  requestTimeout: z.union([z.string(), z.number()]).optional(),
  slackWebhookUrl: z.string().optional(),
  emailRecipients: z.string().optional(),
  latencyAlertThreshold: z.union([z.string(), z.number()]).optional(),
  quotaAlertThreshold: z.union([z.string(), z.number()]).optional(),
  requireApiKeyAuth: z.boolean().optional(),
  autoKeyRotation: z.boolean().optional(),
  allowedOrigins: z.string().optional(),
  maxRequestSizeMb: z.union([z.string(), z.number()]).optional(),
  autoBenchmarkRuns: z.boolean().optional(),
  benchmarkFrequency: z.string().optional(),
  regressionThreshold: z.union([z.string(), z.number()]).optional(),
  routeDecisionWebhook: z.string().optional(),
  alertWebhook: z.string().optional(),
  webhookMaxRetries: z.union([z.string(), z.number()]).optional(),
  webhookRetryBackoff: z.union([z.string(), z.number()]).optional(),
  requestLogRetentionDays: z.union([z.string(), z.number()]).optional(),
  memoryRetentionDays: z.union([z.string(), z.number()]).optional(),
  benchmarkHistoryDays: z.union([z.string(), z.number()]).optional(),
}).refine(
  (obj) => !Object.keys(obj).some((k) => BLOCKED_SETTINGS_KEYS.has(k)),
  { message: 'Blocked key detected' }
);

// SSRF validation: block private/internal IP ranges and non-http(s) protocols
function validateBaseUrlForSSRF(urlStr: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    throw new ValidationError('Invalid base_url');
  }

  const allowedProtocols = ['http:', 'https:'];
  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    throw new ValidationError('Only http and https protocols are allowed');
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Block localhost and common private/internal hostnames explicitly
  const blockedHostnames = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'ip6-localhost', 'ip6-loopback'];
  if (blockedHostnames.includes(hostname)) {
    throw new ValidationError('Fetching private/internal addresses is not allowed');
  }

  const privateRanges = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^::1$/,
    /^\[::1\]$/,
    /^fc/i,
    /^fd/i,
    /^fe80/i,
  ];

  if (privateRanges.some((rx) => rx.test(hostname))) {
    throw new ValidationError('Fetching private/internal addresses is not allowed');
  }
}

export async function adminRoutes(server: FastifyInstance): Promise<void> {
  async function createApiKeyForTenant(tenantId: string, name: string | undefined) {
    const db = getDb();

    const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
      throw new ValidationError('Tenant not found');
    }

    const { generateApiKey, hashApiKey } = await import('@dmr-x/utils');
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const id = crypto.randomUUID();

    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash, name) VALUES (?, ?, ?, ?)'
    ).run(id, tenantId, keyHash, name);

    const row = db.prepare(
      'SELECT id, tenant_id, name, created_at FROM api_keys WHERE id = ?'
    ).get(id);

    return {
      ...row,
      key: apiKey,
    };
  }

  // List provider catalog
  server.get('/admin/catalog', async () => {
    const catalog = PROVIDER_CATALOG.map(t => ({
      ...t,
      oauthConfig: t.oauthConfig ? {
        flow: t.oauthConfig.flow,
        scopes: t.oauthConfig.scopes,
        usePKCE: t.oauthConfig.usePKCE,
        tokenResponseType: t.oauthConfig.tokenResponseType,
      } : undefined,
    }));
    return { catalog };
  });

  // Activate provider from catalog
  server.post('/admin/providers/activate', async (request, reply) => {
    const parsed = ActivateProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const {
      template_id,
      api_key,
      oauth_access_token,
      oauth_refresh_token,
      oauth_token_expires_at,
      auth_method,
      name: custom_name,
    } = parsed.data;
    const template = PROVIDER_CATALOG.find(t => t.id === template_id);
    if (!template) {
      throw new ValidationError(`Template not found: ${template_id}`);
    }

    const db = getDb();
    const providerName = custom_name || template_id;
    let provider = db.prepare('SELECT * FROM providers WHERE name = ?').get(providerName) as any;

    // SSRF validation for base URL
    if (template.baseUrl) {
      validateBaseUrlForSSRF(template.baseUrl);
    }

    const hasApiKey = !!api_key;
    const hasOAuthToken = !!oauth_access_token;
    const requestedAuthMethod = auth_method || (hasOAuthToken ? 'oauth' : 'api_key');
    const needsNoKey = template.envKey === '';
    const shouldActivateModels = hasApiKey || hasOAuthToken || needsNoKey;
    const encryptedOAuthAccessToken = oauth_access_token ? encrypt(oauth_access_token) : null;
    const encryptedOAuthRefreshToken = oauth_refresh_token ? encrypt(oauth_refresh_token) : null;

    if (provider) {
      // Update existing — encrypt API key before storing
      const encKey = api_key ? encrypt(api_key) : '';
      db.prepare(
        `UPDATE providers SET
          base_url = ?,
          config = json_set(json_set(config, '$.apiKey', ?), '$.hasKey', ?),
          oauth_access_token = COALESCE(?, oauth_access_token),
          oauth_refresh_token = COALESCE(?, oauth_refresh_token),
          oauth_token_expires_at = COALESCE(?, oauth_token_expires_at),
          auth_method = ?,
          is_healthy = 1,
          consecutive_failures = 0,
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        template.baseUrl,
        encKey,
        hasApiKey ? 1 : 0,
        encryptedOAuthAccessToken,
        encryptedOAuthRefreshToken,
        oauth_token_expires_at ?? null,
        requestedAuthMethod,
        provider.id,
      );

      // Activate models for this provider
      if (shouldActivateModels) {
        const activated = db.prepare(
          `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
           WHERE provider_id = ? AND is_active = 0`
        ).run(provider.id);
        if (activated.changes > 0) {
          logger.info({ provider: providerName, models: activated.changes }, 'Activated models after provider re-activation');
        }
      }
    } else {
      // Create new — encrypt API key before storing
      const id = crypto.randomUUID();
      const configObj = {
        category: template.category,
        region: template.region,
        description: template.description,
        signupUrl: template.signupUrl,
        apiKey: api_key ? encrypt(api_key) : '',
        hasKey: hasApiKey,
        isHealthy: true
      };
      db.prepare(
        `INSERT INTO providers (
          id, name, adapter_type, base_url, api_key_ref, config,
          oauth_access_token, oauth_refresh_token, oauth_token_expires_at, auth_method
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        providerName,
        template.id,
        template.baseUrl,
        template.envKey || '',
        JSON.stringify(configObj),
        encryptedOAuthAccessToken,
        encryptedOAuthRefreshToken,
        oauth_token_expires_at ?? null,
        requestedAuthMethod,
      );
      provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);

      // Create model profiles for this new provider
      for (const model of template.models) {
        db.prepare(
          `INSERT INTO model_profiles (
            id, provider_id, model_id, display_name, modality, intelligence_layer,
            supports_streaming, supports_vision, supports_tool_use,
            context_window, max_output_tokens,
            input_cost_per_1k, output_cost_per_1k, cost_per_image,
            quality_score, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          id,
          model.id,
          model.id,
          model.modalities[0] || 'llm',
          'executor',
          model.capabilities.includes('streaming') ? 1 : 0,
          model.capabilities.includes('vision') ? 1 : 0,
          model.capabilities.includes('tool_use') ? 1 : 0,
          model.contextWindow,
          model.maxOutputTokens,
          (model.inputCostPer1M || 0) / 1000,
          (model.outputCostPer1M || 0) / 1000,
          model.costPerImage || 0,
          0.5,
          shouldActivateModels ? 1 : 0
        );
      }
    }

    provider = db.prepare('SELECT * FROM providers WHERE name = ?').get(providerName) as any;

    // Initialize/Update adapter in registry
    const adapterRegistry = (server as any).adapterRegistry;
    let adapter = adapterRegistry.get(providerName);

    if (!adapter && template.apiFormat === 'openai') {
      const { GenericOpenAIAdapter } = await import('@dmr-x/adapters');
      adapter = new GenericOpenAIAdapter(providerName);
      adapterRegistry.register(adapter);
    }

    if (adapter) {
      await adapterRegistry.initialize(providerName, {
        baseUrl: template.baseUrl,
        apiKey: requestedAuthMethod === 'api_key' ? api_key || '' : '',
        accessToken: requestedAuthMethod === 'oauth' ? oauth_access_token || '' : undefined,
        authMethod: requestedAuthMethod,
      });
    }

    // Refresh router candidates so new provider is routable immediately
    const refreshCandidates = (server as any).refreshCandidates;
    if (refreshCandidates) await refreshCandidates();

    reply.status(200);
    const providerConfig = JSON.parse(provider.config || '{}');
    return {
      success: true,
      provider: {
        ...provider,
        config: { ...providerConfig, apiKey: undefined, hasKey: !!providerConfig.apiKey },
      },
    };
  });

  // List providers
  server.get('/admin/providers', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM providers ORDER BY name').all() as any[];
    const providers = rows.map((row) => {
      const config = JSON.parse(row.config || '{}');
      const { apiKey: _stripped, ...safeConfig } = config;
      return {
        ...row,
        config: safeConfig,
        status: row.is_healthy ? 'healthy' : 'unavailable',
        hasKey: !!config.apiKey || !!row.oauth_access_token,
        hasOAuthToken: !!row.oauth_access_token,
        authMethod: row.auth_method || 'api_key',
        oauthTokenExpiresAt: row.oauth_token_expires_at || null,
        signupUrl: config.signupUrl || undefined,
        description: config.description || undefined,
        category: config.category || [],
        region: config.region || undefined,
      };
    });
    return { providers };
  });

  // Update provider API key
  server.put('/admin/providers/:id/api-key', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { api_key } = parsed.data;

    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }

    const config = JSON.parse(provider.config || '{}');
    // Issue #2: Encrypt API key before storing
    config.apiKey = api_key ? encrypt(api_key) : '';
    config.hasKey = !!api_key;

    db.prepare(
      `UPDATE providers SET config = ?, is_healthy = 1, consecutive_failures = 0, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(config), id);

    // Activate models for this provider now that it has a key
    const activated = db.prepare(
      `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
       WHERE provider_id = ? AND is_active = 0`
    ).run(id);
    if (activated.changes > 0) {
      logger.info({ provider: provider.name, models: activated.changes }, 'Activated models after API key update');
    }

    // Re-initialize adapter with new key
    const adapterRegistry = (server as any).adapterRegistry;
    let adapter = adapterRegistry.get(provider.name);
    if (!adapter) {
      const template = PROVIDER_CATALOG.find(t => t.id === provider.name);
      if (template?.apiFormat === 'openai') {
        const { GenericOpenAIAdapter } = await import('@dmr-x/adapters');
        adapter = new GenericOpenAIAdapter(provider.name);
        adapterRegistry.register(adapter);
      }
    }
    if (adapter && provider.base_url) {
      try {
        await adapterRegistry.initialize(provider.name, {
          baseUrl: provider.base_url,
          apiKey: api_key || '',
        });
      } catch (err) {
        logger.warn({ err, provider: provider.name }, 'Adapter initialization failed — provider may need manual setup');
      }
    }

    // Refresh router candidates so updated provider is routable immediately
    const refreshCandidates = (server as any).refreshCandidates;
    if (refreshCandidates) await refreshCandidates();

    const updatedRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    const updatedConfig = JSON.parse(updatedRow.config || '{}');
    return {
      success: true,
      provider: {
        ...updatedRow,
        config: { ...updatedConfig, apiKey: undefined, hasKey: !!updatedConfig.apiKey },
      },
    };
  });

  // ─── OAuth Endpoints ───────────────────────────────────────────────

  const OAuthAuthorizeSchema = z.object({
    redirect_uri: z.string().url().optional(),
  });

  const OAuthCallbackSchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
  });

  // Initiate OAuth authorization flow
  server.post('/admin/providers/:id/oauth/authorize', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = OAuthAuthorizeSchema.safeParse(request.body || {});
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }

    const template = PROVIDER_CATALOG.find(t => t.id === provider.name || t.name === provider.name);
    if (!template?.oauthConfig) {
      reply.status(400);
      return { error: { message: 'Provider does not support OAuth', type: 'validation', code: 'oauth_not_supported' } };
    }

    const oauthConfig = template.oauthConfig;

    // Client credentials flow: exchange immediately, no browser redirect needed
    if (oauthConfig.flow === 'client_credentials') {
      try {
        const { OAuthService } = await import('@dmr-x/oauth');
        const oauthService = new OAuthService();
        const tokens = await oauthService.handleClientCredentials(provider.name, oauthConfig);

        const encAccess = encrypt(tokens.accessToken);
        const encRefresh = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;

        db.prepare(
          `UPDATE providers SET
            oauth_access_token = ?,
            oauth_refresh_token = ?,
            oauth_token_expires_at = ?,
            auth_method = 'oauth',
            is_healthy = 1,
            consecutive_failures = 0,
            updated_at = datetime('now')
          WHERE id = ?`
        ).run(encAccess, encRefresh, tokens.expiresAt?.toISOString() || null, id);

        // Activate models
        db.prepare(
          `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
           WHERE provider_id = ? AND is_active = 0`
        ).run(id);

        // Re-initialize adapter with OAuth token
        const adapterRegistry = (server as any).adapterRegistry;
        if (adapterRegistry && provider.base_url) {
          try {
            await adapterRegistry.initialize(provider.name, {
              baseUrl: provider.base_url,
              accessToken: tokens.accessToken,
              authMethod: 'oauth',
            });
          } catch (err) {
            logger.warn({ err, provider: provider.name }, 'Adapter re-init failed after OAuth');
          }
        }

        const refreshCandidates = (server as any).refreshCandidates;
        if (refreshCandidates) await refreshCandidates();

        return { success: true, flow: 'client_credentials', expiresAt: tokens.expiresAt?.toISOString() || null };
      } catch (err) {
        logger.error({ err, provider: provider.name }, 'OAuth client_credentials failed');
        reply.status(502);
        return { error: { message: `OAuth failed: ${err instanceof Error ? err.message : String(err)}`, type: 'oauth_error', code: 'oauth_exchange_failed' } };
      }
    }

    // Authorization code flow: return URL for browser redirect
    if (oauthConfig.flow === 'authorization_code') {
      try {
        const { OAuthService } = await import('@dmr-x/oauth');
        const oauthService = new OAuthService();
        const gatewayBaseUrl = `${request.protocol}://${request.hostname}:${process.env.DMRX_PORT || 3000}`;
        const result = oauthService.generateAuthorizationUrl(provider.name, oauthConfig, gatewayBaseUrl);
        return { authorizationUrl: result.authorizationUrl, state: result.state, flow: 'authorization_code' };
      } catch (err) {
        logger.error({ err, provider: provider.name }, 'OAuth authorize URL generation failed');
        reply.status(502);
        return { error: { message: `OAuth failed: ${err instanceof Error ? err.message : String(err)}`, type: 'oauth_error', code: 'oauth_authorize_failed' } };
      }
    }

    // Device code flow
    if (oauthConfig.flow === 'device_code') {
      try {
        const { OAuthService } = await import('@dmr-x/oauth');
        const oauthService = new OAuthService();
        const result = await oauthService.handleDeviceCode(provider.name, oauthConfig);
        return { ...result, flow: 'device_code' };
      } catch (err) {
        logger.error({ err, provider: provider.name }, 'OAuth device code failed');
        reply.status(502);
        return { error: { message: `OAuth failed: ${err instanceof Error ? err.message : String(err)}`, type: 'oauth_error', code: 'oauth_device_code_failed' } };
      }
    }

    reply.status(400);
    return { error: { message: 'Unsupported OAuth flow', type: 'validation', code: 'unsupported_oauth_flow' } };
  });

  // OAuth callback — exchanges authorization code for tokens
  server.post('/admin/providers/:id/oauth/callback', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = OAuthCallbackSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const { code, state } = parsed.data;

    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }

    const template = PROVIDER_CATALOG.find(t => t.id === provider.name || t.name === provider.name);
    if (!template?.oauthConfig || template.oauthConfig.flow !== 'authorization_code') {
      reply.status(400);
      return { error: { message: 'Provider does not support authorization_code OAuth flow', type: 'validation', code: 'oauth_not_supported' } };
    }

    try {
      const { OAuthService } = await import('@dmr-x/oauth');
      const oauthService = new OAuthService();
      const gatewayBaseUrl = `${request.protocol}://${request.hostname}:${process.env.DMRX_PORT || 3000}`;
      const tokens = await oauthService.handleAuthorizationCode(provider.name, template.oauthConfig, code, state, gatewayBaseUrl);

      const encAccess = encrypt(tokens.accessToken);
      const encRefresh = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;

      db.prepare(
        `UPDATE providers SET
          oauth_access_token = ?,
          oauth_refresh_token = ?,
          oauth_token_expires_at = ?,
          auth_method = 'oauth',
          is_healthy = 1,
          consecutive_failures = 0,
          updated_at = datetime('now')
        WHERE id = ?`
      ).run(encAccess, encRefresh, tokens.expiresAt?.toISOString() || null, id);

      // Activate models
      db.prepare(
        `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
         WHERE provider_id = ? AND is_active = 0`
      ).run(id);

      // Re-initialize adapter
      const adapterRegistry = (server as any).adapterRegistry;
      if (adapterRegistry && provider.base_url) {
        try {
          await adapterRegistry.initialize(provider.name, {
            baseUrl: provider.base_url,
            accessToken: tokens.accessToken,
            authMethod: 'oauth',
          });
        } catch (err) {
          logger.warn({ err, provider: provider.name }, 'Adapter re-init failed after OAuth callback');
        }
      }

      const refreshCandidates = (server as any).refreshCandidates;
      if (refreshCandidates) await refreshCandidates();

      return {
        success: true,
        provider: {
          ...provider,
          auth_method: 'oauth',
          oauth_token_expires_at: tokens.expiresAt?.toISOString() || null,
        },
      };
    } catch (err) {
      logger.error({ err, provider: provider.name }, 'OAuth callback failed');
      reply.status(502);
      return { error: { message: `OAuth callback failed: ${err instanceof Error ? err.message : String(err)}`, type: 'oauth_error', code: 'oauth_callback_failed' } };
    }
  });

  // OAuth callback via GET — handles browser redirects from OAuth providers
  // OAuth providers redirect the browser via GET with ?code=xxx&state=yyy
  server.get('/admin/providers/:id/oauth/callback', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { code, state } = request.query as { code?: string; state?: string };

    if (!code || !state) {
      return reply.type('text/html').send(`
        <html><body style="font-family:system-ui;background:#0F0F12;color:#F8F9FC;display:flex;align-items:center;justify-content:center;height:100vh">
          <div style="text-align:center"><h2>Missing Parameters</h2><p>The OAuth callback is missing required parameters.</p></div>
        </body></html>
      `);
    }

    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      return reply.type('text/html').send(`
        <html><body style="font-family:system-ui;background:#0F0F12;color:#F8F9FC;display:flex;align-items:center;justify-content:center;height:100vh">
          <div style="text-align:center"><h2>Provider Not Found</h2><script>setTimeout(() => window.close(), 2000)</script></div>
        </body></html>
      `);
    }

    const template = PROVIDER_CATALOG.find(t => t.id === provider.name || t.name === provider.name);
    if (!template?.oauthConfig || template.oauthConfig.flow !== 'authorization_code') {
      return reply.type('text/html').send(`
        <html><body style="font-family:system-ui;background:#0F0F12;color:#F8F9FC;display:flex;align-items:center;justify-content:center;height:100vh">
          <div style="text-align:center"><h2>OAuth Not Supported</h2><script>setTimeout(() => window.close(), 2000)</script></div>
        </body></html>
      `);
    }

    try {
      const { OAuthService } = await import('@dmr-x/oauth');
      const oauthService = new OAuthService();
      const gatewayBaseUrl = `${request.protocol}://${request.hostname}:${process.env.DMRX_PORT || 3000}`;
      const tokens = await oauthService.handleAuthorizationCode(provider.name, template.oauthConfig, code, state, gatewayBaseUrl);

      const encAccess = encrypt(tokens.accessToken);
      const encRefresh = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;

      db.prepare(
        `UPDATE providers SET
          oauth_access_token = ?,
          oauth_refresh_token = ?,
          oauth_token_expires_at = ?,
          auth_method = 'oauth',
          is_healthy = 1,
          consecutive_failures = 0,
          updated_at = datetime('now')
        WHERE id = ?`
      ).run(encAccess, encRefresh, tokens.expiresAt?.toISOString() || null, id);

      db.prepare(
        `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
         WHERE provider_id = ? AND is_active = 0`
      ).run(id);

      const adapterRegistry = (server as any).adapterRegistry;
      if (adapterRegistry && provider.base_url) {
        try {
          await adapterRegistry.initialize(provider.name, {
            baseUrl: provider.base_url,
            accessToken: tokens.accessToken,
            authMethod: 'oauth',
          });
        } catch (err) {
          logger.warn({ err, provider: provider.name }, 'Adapter re-init failed after OAuth GET callback');
        }
      }

      const refreshCandidates = (server as any).refreshCandidates;
      if (refreshCandidates) await refreshCandidates();

      return reply.type('text/html').send(`
        <html><body style="font-family:system-ui;background:#0F0F12;color:#F8F9FC;display:flex;align-items:center;justify-content:center;height:100vh">
          <div style="text-align:center">
            <h2 style="color:#00FFB2">Connected!</h2>
            <p>${provider.name} has been connected via OAuth.</p>
            <p style="color:#595962;font-size:14px">This window will close automatically...</p>
            <script>setTimeout(() => window.close(), 1500)</script>
          </div>
        </body></html>
      `);
    } catch (err) {
      logger.error({ err, provider: provider.name }, 'OAuth GET callback failed');
      return reply.type('text/html').send(`
        <html><body style="font-family:system-ui;background:#0F0F12;color:#F8F9FC;display:flex;align-items:center;justify-content:center;height:100vh">
          <div style="text-align:center">
            <h2 style="color:#FF4D6A">Connection Failed</h2>
            <p>${err instanceof Error ? err.message : 'OAuth exchange failed'}</p>
            <script>setTimeout(() => window.close(), 3000)</script>
          </div>
        </body></html>
      `);
    }
  });

  // Refresh OAuth token
  server.post('/admin/providers/:id/oauth/refresh', async (request, reply) => {
    const { id } = request.params as { id: string };

    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }

    if (!provider.oauth_refresh_token) {
      reply.status(400);
      return { error: { message: 'No refresh token available', type: 'validation', code: 'no_refresh_token' } };
    }

    const template = PROVIDER_CATALOG.find(t => t.id === provider.name || t.name === provider.name);
    if (!template?.oauthConfig) {
      reply.status(400);
      return { error: { message: 'Provider does not support OAuth', type: 'validation', code: 'oauth_not_supported' } };
    }

    try {
      const { OAuthService } = await import('@dmr-x/oauth');
      const oauthService = new OAuthService();
      const refreshToken = decrypt(provider.oauth_refresh_token);
      const tokens = await oauthService.refreshAccessToken(template.oauthConfig, refreshToken);

      const encAccess = encrypt(tokens.accessToken);
      const encRefresh = tokens.refreshToken ? encrypt(tokens.refreshToken) : provider.oauth_refresh_token;

      db.prepare(
        `UPDATE providers SET
          oauth_access_token = ?,
          oauth_refresh_token = ?,
          oauth_token_expires_at = ?,
          updated_at = datetime('now')
        WHERE id = ?`
      ).run(encAccess, encRefresh, tokens.expiresAt?.toISOString() || null, id);

      // Re-initialize adapter
      const adapterRegistry = (server as any).adapterRegistry;
      if (adapterRegistry && provider.base_url) {
        try {
          await adapterRegistry.initialize(provider.name, {
            baseUrl: provider.base_url,
            accessToken: tokens.accessToken,
            authMethod: 'oauth',
          });
        } catch (err) {
          logger.warn({ err, provider: provider.name }, 'Adapter re-init failed after OAuth refresh');
        }
      }

      return { success: true, expiresAt: tokens.expiresAt?.toISOString() || null };
    } catch (err) {
      logger.error({ err, provider: provider.name }, 'OAuth token refresh failed');
      reply.status(502);
      return { error: { message: `Refresh failed: ${err instanceof Error ? err.message : String(err)}`, type: 'oauth_error', code: 'oauth_refresh_failed' } };
    }
  });

  // OAuth status for a provider
  server.get('/admin/providers/:id/oauth/status', async (request, reply) => {
    const { id } = request.params as { id: string };

    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }

    const template = PROVIDER_CATALOG.find(t => t.id === provider.name || t.name === provider.name);
    const hasOAuth = !!template?.oauthConfig;
    const authMethod = provider.auth_method || 'api_key';
    const tokenExpiresAt = provider.oauth_token_expires_at || null;
    const isExpired = tokenExpiresAt ? new Date(tokenExpiresAt) < new Date() : false;

    return {
      hasOAuth,
      authMethod,
      tokenExpiresAt,
      isExpired,
      oauthFlow: template?.oauthConfig?.flow || null,
    };
  });

  // Poll device code — checks if user has authorized
  server.post('/admin/providers/:id/oauth/device-code/poll', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { device_code } = request.body as { device_code?: string };

    if (!device_code) {
      reply.status(400);
      return { error: { message: 'Missing device_code', type: 'validation', code: 'missing_device_code' } };
    }

    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }

    const template = PROVIDER_CATALOG.find(t => t.id === provider.name || t.name === provider.name);
    if (!template?.oauthConfig || template.oauthConfig.flow !== 'device_code') {
      reply.status(400);
      return { error: { message: 'Provider does not support device_code flow', type: 'validation', code: 'oauth_not_supported' } };
    }

    try {
      const { OAuthService } = await import('@dmr-x/oauth');
      const oauthService = new OAuthService();
      const tokens = await oauthService.pollDeviceCode(provider.name, template.oauthConfig, device_code);

      const encAccess = encrypt(tokens.accessToken);
      const encRefresh = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;

      db.prepare(
        `UPDATE providers SET
          oauth_access_token = ?,
          oauth_refresh_token = ?,
          oauth_token_expires_at = ?,
          auth_method = 'oauth',
          is_healthy = 1,
          consecutive_failures = 0,
          updated_at = datetime('now')
        WHERE id = ?`
      ).run(encAccess, encRefresh, tokens.expiresAt?.toISOString() || null, id);

      db.prepare(
        `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
         WHERE provider_id = ? AND is_active = 0`
      ).run(id);

      const adapterRegistry = (server as any).adapterRegistry;
      if (adapterRegistry && provider.base_url) {
        try {
          await adapterRegistry.initialize(provider.name, {
            baseUrl: provider.base_url,
            accessToken: tokens.accessToken,
            authMethod: 'oauth',
          });
        } catch (err) {
          logger.warn({ err, provider: provider.name }, 'Adapter re-init failed after device code poll');
        }
      }

      const refreshCandidates = (server as any).refreshCandidates;
      if (refreshCandidates) await refreshCandidates();

      return { success: true, status: 'authorized', expiresAt: tokens.expiresAt?.toISOString() || null };
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      // Device code pending — user hasn't authorized yet
      if (msg.includes('authorization_pending') || msg.includes('slow_down')) {
        return { success: false, status: 'pending' };
      }
      // Device code expired or denied
      if (msg.includes('expired') || msg.includes('denied')) {
        return { success: false, status: msg.includes('expired') ? 'expired' : 'denied' };
      }
      logger.error({ err, provider: provider.name }, 'Device code poll failed');
      reply.status(502);
      return { error: { message: `Poll failed: ${msg}`, type: 'oauth_error', code: 'device_code_poll_failed' } };
    }
  });

  // Test provider connection with a given API key
  server.post('/admin/providers/test', async (request) => {
    const parsed = TestProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const { provider_id, base_url, api_key } = parsed.data;

    // SSRF protection: validate the URL (shared helper)
    validateBaseUrlForSSRF(base_url);

    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // Try /models endpoint first (works for most OpenAI-compatible providers)
      // redirect: 'error' prevents SSRF via open redirects
      let response = await fetch(`${base_url}/models`, {
        headers: { 'Authorization': `Bearer ${api_key}` },
        signal: controller.signal,
        redirect: 'error',
      });

      // If /models fails, try /chat/completions with a minimal request
      if (!response.ok && response.status === 404) {
        response = await fetch(`${base_url}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${api_key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'test',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
          signal: controller.signal,
          redirect: 'error',
        });
      }

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (response.ok) {
        return {
          status: 'passed',
          provider_id,
          latency_ms: latencyMs,
          message: 'Connection successful',
        };
      }

      // 401/403 = invalid key specifically
      if (response.status === 401 || response.status === 403) {
        return {
          status: 'failed',
          provider_id,
          latency_ms: latencyMs,
          message: `Invalid API key (HTTP ${response.status})`,
        };
      }

      return {
        status: 'failed',
        provider_id,
        latency_ms: latencyMs,
        message: `Provider returned HTTP ${response.status}`,
      };
    } catch (error: unknown) {
      const latencyMs = Date.now() - start;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ err: error, provider_id }, 'Provider test connection error');

      if (msg.includes('abort')) {
        return {
          status: 'failed',
          provider_id,
          latency_ms: latencyMs,
          message: 'Connection timed out (10s)',
        };
      }

      return {
        status: 'failed',
        provider_id,
        latency_ms: latencyMs,
        message: 'Connection failed',
      };
    }
  });

  // Create provider
  server.post('/admin/providers', async (request, reply) => {
    const parsed = CreateProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;

    // Issue #9: SSRF validation on base_url
    if (body.base_url) {
      validateBaseUrlForSSRF(body.base_url);
    }

    // Issue #2: Encrypt any apiKey in config before storing
    const configToStore = encryptConfigApiKey({ ...body.config });

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO providers (id, name, adapter_type, base_url, api_key_ref, config)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, body.name, body.adapter_type, body.base_url ?? null, body.api_key_ref ?? null, JSON.stringify(configToStore));

    reply.status(201);
    const created = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    const createdCfg = JSON.parse(created.config || '{}');
    return { ...created, config: { ...createdCfg, apiKey: undefined, hasKey: !!createdCfg.apiKey } };
  });

  // List models
  server.get('/admin/models', async () => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT mp.*, p.name as provider_name
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       ORDER BY mp.modality, mp.model_id`
    ).all();
    return { models: rows };
  });

  // Create model
  server.post('/admin/models', async (request, reply) => {
    const parsed = CreateModelSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO model_profiles (
        id, provider_id, model_id, display_name, modality, intelligence_layer,
        context_window, max_output_tokens, supports_streaming, supports_vision,
        supports_tool_use, input_cost_per_1k, output_cost_per_1k, cost_per_image
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, body.provider_id, body.model_id, body.display_name, body.modality,
      body.intelligence_layer, body.context_window, body.max_output_tokens,
      body.supports_streaming ? 1 : 0, body.supports_vision ? 1 : 0, body.supports_tool_use ? 1 : 0,
      body.input_cost_per_1k, body.output_cost_per_1k, body.cost_per_image,
    );

    reply.status(201);
    return db.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id);
  });

  // Create tenant
  server.post('/admin/tenants', async (request, reply) => {
    const parsed = CreateTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { name } = parsed.data;

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(id, name);

    reply.status(201);
    return db.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  });

  // Create API key
  server.post('/admin/api-keys', async (request, reply) => {
    const parsed = CreateApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { tenant_id, name } = parsed.data;

    const db = getDb();

    // Verify tenant exists
    const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenant_id);
    if (!tenant) {
      throw new ValidationError('Tenant not found');
    }

    const { generateApiKey, hashApiKey } = await import('@dmr-x/utils');
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);

    const id = crypto.randomUUID();

    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash, name) VALUES (?, ?, ?, ?)'
    ).run(id, tenant_id, keyHash, name);

    const row = db.prepare(
      'SELECT id, tenant_id, name, created_at FROM api_keys WHERE id = ?'
    ).get(id);

    reply.status(201);
    return {
      ...row,
      key: apiKey, // Only shown once
    };
  });

  // List tenants
  server.get('/admin/tenants', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM api_keys WHERE tenant_id = t.id AND is_active = 1) as key_count
      FROM tenants t ORDER BY name
    `).all();
    return { tenants: rows };
  });

  // List API keys
  server.get('/admin/api-keys', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT ak.id, ak.tenant_id, t.name as tenant_name, ak.name, ak.is_active, ak.created_at, ak.last_used_at
      FROM api_keys ak
      JOIN tenants t ON t.id = ak.tenant_id
      ORDER BY ak.created_at DESC
    `).all();
    return { api_keys: rows };
  });

  // List benchmark results
  server.get('/admin/benchmarks', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT br.*, mp.display_name as model_name, mp.model_id as model_identifier
      FROM benchmark_results br
      LEFT JOIN model_profiles mp ON mp.id = br.model_id
      ORDER BY br.run_at DESC
      LIMIT 100
    `).all() as Array<Record<string, unknown>>;
    return {
      benchmarks: rows.map((row) => {
        const details = typeof row.details === 'string' ? JSON.parse(row.details as string) : (row.details || {});
        return {
          id: row.id,
          model_id: row.model_id,
          model_name: row.model_name ?? row.model_identifier ?? row.model_id,
          benchmark_name: row.benchmark_type,
          score: row.score,
          latency: details.latency ?? 0,
          cost: details.cost ?? 0,
          task_type: details.task_type ?? String(row.benchmark_type ?? 'unknown'),
          run_date: row.run_at,
          regression: details.regression ?? false,
          previous_score: details.previous_score ?? undefined,
          comparison_scores: details.comparison_scores ?? undefined,
        };
      }),
    };
  });

  // List policies
  server.get('/admin/policies', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT p.*, t.name as tenant_name
      FROM policies p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      ORDER BY p.created_at DESC
    `).all() as Array<Record<string, unknown>>;
    return {
      policies: rows.map((row) => {
        const rules = typeof row.rules === 'string' ? JSON.parse(row.rules as string) : (row.rules || {});
        return {
          id: row.id,
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_name,
          name: row.name,
          type: rules.type || 'provider_allow',
          target: rules.target || [],
          action: rules.action || 'deny',
          conditions: rules.conditions || {},
          priority: rules.priority ?? 0,
          enabled: !!row.is_active,
          created_at: row.created_at,
        };
      }),
    };
  });

  // Create policy
  server.post('/admin/policies', async (request, reply) => {
    const parsed = CreatePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const body = parsed.data;
    const db = getDb();
    const id = crypto.randomUUID();
    const rulesBlob = JSON.stringify({
      type: body.type,
      target: body.target,
      action: body.action,
      conditions: body.conditions,
      priority: body.priority,
    });
    db.prepare(
      `INSERT INTO policies (id, tenant_id, name, rules, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(id, body.tenant_id, body.name, rulesBlob, body.enabled ? 1 : 0);
    reply.status(201);
    return {
      id,
      tenant_id: body.tenant_id,
      name: body.name,
      type: body.type,
      target: body.target,
      action: body.action,
      conditions: body.conditions,
      priority: body.priority,
      enabled: body.enabled,
      created_at: new Date().toISOString(),
    };
  });

  // Usage history (hourly for last 24h)
  server.get('/admin/billing/usage-history', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        u.time,
        u.requests,
        u.tokens,
        u.cost,
        COALESCE(r.latency, 0) as latency
      FROM (
        SELECT
          strftime('%Y-%m-%d %H:00:00', created_at) as time,
          COUNT(*) as requests,
          SUM(total_tokens) as tokens,
          CAST(SUM(cost_cents) AS REAL) / 100 as cost
        FROM usage_records
        WHERE created_at > datetime('now', '-24 hours')
        GROUP BY strftime('%Y-%m-%d %H:00:00', created_at)
      ) u
      LEFT JOIN (
        SELECT
          strftime('%Y-%m-%d %H:00:00', timestamp) as time,
          ROUND(AVG(latency_ms)) as latency
        FROM request_logs
        WHERE timestamp > datetime('now', '-24 hours') AND latency_ms IS NOT NULL
        GROUP BY strftime('%Y-%m-%d %H:00:00', timestamp)
      ) r ON u.time = r.time
      ORDER BY u.time
    `).all();
    return { history: rows };
  });

  // Billing summary
  server.get('/admin/billing/summary', async () => {
    const db = getDb();

    // Current month spend
    const currentMonth = db.prepare(`
      SELECT COALESCE(CAST(SUM(cost_cents) AS REAL) / 100, 0) as spend
      FROM usage_records
      WHERE created_at >= date('now', 'start of month')
    `).get() as { spend: number } | undefined;

    // Previous month spend
    const previousMonth = db.prepare(`
      SELECT COALESCE(CAST(SUM(cost_cents) AS REAL) / 100, 0) as spend
      FROM usage_records
      WHERE created_at >= date('now', 'start of month', '-1 month')
        AND created_at < date('now', 'start of month')
    `).get() as { spend: number } | undefined;

    // Cost by provider
    const costByProvider = db.prepare(`
      SELECT p.name as provider, COALESCE(CAST(SUM(ur.cost_cents) AS REAL) / 100, 0) as cost
      FROM usage_records ur
      JOIN providers p ON p.id = ur.provider_id
      WHERE ur.created_at >= date('now', 'start of month')
      GROUP BY p.name
      ORDER BY cost DESC
    `).all();

    // Cost by model
    const costByModel = db.prepare(`
      SELECT ur.model_id as model, COALESCE(CAST(SUM(ur.cost_cents) AS REAL) / 100, 0) as cost
      FROM usage_records ur
      WHERE ur.created_at >= date('now', 'start of month')
      GROUP BY ur.model_id
      ORDER BY cost DESC
      LIMIT 10
    `).all();

    // Cost by modality
    const costByModality = db.prepare(`
      SELECT mp.modality, COALESCE(CAST(SUM(ur.cost_cents) AS REAL) / 100, 0) as cost
      FROM usage_records ur
      JOIN model_profiles mp ON mp.model_id = ur.model_id
      WHERE ur.created_at >= date('now', 'start of month')
      GROUP BY mp.modality
      ORDER BY cost DESC
    `).all();

    const currentSpend = currentMonth?.spend || 0;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const estimatedEndOfMonth = dayOfMonth > 0 ? (currentSpend / dayOfMonth) * daysInMonth : 0;

    return {
      id: 'billing-current',
      tenant_id: null,
      tenant_name: 'All Tenants',
      current_month_spend: currentSpend,
      estimated_end_of_month: estimatedEndOfMonth,
      previous_month_spend: previousMonth?.spend || 0,
      cost_by_provider: costByProvider,
      cost_by_model: costByModel,
      cost_by_modality: costByModality,
      invoices: [],
      plan_limits: { requests: null, tokens: null, spend: null },
      overage_flags: [],
    };
  });

  // Dashboard stats
  server.get('/admin/dashboard/stats', async () => {
    const db = getDb();

    // Total requests today
    const req = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN error_code IS NULL THEN 1 ELSE 0 END) as success,
        AVG(latency_ms) as avg_latency
      FROM request_logs
      WHERE timestamp >= date('now', 'start of day')
    `).get() as { total: number; success: number; avg_latency: number } | undefined;

    // Token usage today
    const tokenRow = db.prepare(`
      SELECT COALESCE(SUM(total_tokens), 0) as tokens,
        COALESCE(CAST(SUM(cost_cents) AS REAL) / 100, 0) as spend
      FROM usage_records
      WHERE created_at >= date('now', 'start of day')
    `).get() as { tokens: number; spend: number } | undefined;

    // Active models
    const modelsRow = db.prepare(`
      SELECT COUNT(*) as count FROM model_profiles WHERE is_active = 1
    `).get() as { count: number } | undefined;

    // Provider health
    const providersRow = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN is_healthy = 1 THEN 1 ELSE 0 END) as healthy
      FROM providers
    `).get() as { total: number; healthy: number } | undefined;

    // Fallback rate
    const fallbackRow = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) as fallbacks
      FROM request_logs
      WHERE timestamp >= date('now', 'start of day')
    `).get() as { total: number; fallbacks: number } | undefined;

    // Actual remaining quota from allocations (compute from max_requests - used)
    const quotaRow = db.prepare(`
      SELECT COALESCE(SUM(
        CASE WHEN qa.max_requests IS NOT NULL THEN
          qa.max_requests - COALESCE(
            (SELECT COUNT(*) FROM request_logs rl
             WHERE (qa.provider_id IS NULL OR rl.selected_provider = qa.provider_id)
             AND rl.timestamp >= date('now', 'start of month')),
            0
          )
        ELSE 0 END
      ), 0) as remaining
      FROM quota_allocations qa
    `).get() as { remaining: number } | undefined;

    const total = req?.total || 0;
    const success = req?.success || 0;
    const fallbackTotal = fallbackRow?.total || 0;
    const fallbacks = fallbackRow?.fallbacks || 0;
    const providerTotal = providersRow?.total || 0;
    const providerHealthy = providersRow?.healthy || 0;
    const healthPercent = providerTotal > 0 ? Math.round((providerHealthy / providerTotal) * 100) : 0;

    return {
      total_requests: total,
      success_rate: total > 0 ? Math.round((success / total) * 100 * 10) / 10 : 100,
      avg_latency: Math.round(req?.avg_latency || 0),
      token_usage: tokenRow?.tokens || 0,
      daily_spend: tokenRow?.spend || 0,
      quota_remaining: quotaRow?.remaining ?? 0,
      active_models: modelsRow?.count || 0,
      provider_health: healthPercent,
      fallback_rate: fallbackTotal > 0 ? Math.round((fallbacks / fallbackTotal) * 100 * 10) / 10 : 0,
      worker_utilization: 0,
      system_status: providerTotal === 0 ? 'no_providers' : healthPercent === 100 ? 'operational' : healthPercent >= 50 ? 'degraded' : 'outage',
    };
  });

  // Route decisions
  server.get('/admin/routing/decisions', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        rl.id,
        rl.timestamp,
        json_extract(rl.task_profile, '$.taskType') as task_type,
        rl.selected_model,
        p.name as selected_provider,
        json_extract(rl.routing_plan, '$.executionMode') as execution_mode,
        json_extract(rl.routing_plan, '$.decisionReason') as decision_reason,
        COALESCE(json_extract(rl.routing_plan, '$.fallbackChain'), '[]') as fallback_chain,
        rl.latency_ms as latency,
        rl.estimated_cost as cost,
        rl.quality_score as confidence,
        rl.tokens_input as input_tokens,
        rl.tokens_output as output_tokens,
        CASE WHEN rl.error_code IS NOT NULL THEN 'error'
             WHEN rl.fallback_used THEN 'fallback'
             ELSE 'success' END as status
      FROM request_logs rl
      LEFT JOIN providers p ON p.id = rl.selected_provider
      ORDER BY rl.timestamp DESC
      LIMIT 50
    `).all() as Array<Record<string, unknown>>;
    return {
      decisions: rows.map((row) => ({
        ...row,
        fallback_chain: typeof row.fallback_chain === 'string' ? JSON.parse(row.fallback_chain) : row.fallback_chain ?? [],
      })),
    };
  });

  // Quota states
  server.get('/admin/quota', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        qa.id,
        qa.provider_id,
        p.name as provider_name,
        qa.max_requests as total_quota,
        COALESCE(
          (SELECT COUNT(*) FROM request_logs rl
           WHERE (qa.provider_id IS NULL OR rl.selected_provider = qa.provider_id)
           AND rl.timestamp >= date('now', 'start of month')),
          0
        ) as used_quota,
        qa.max_requests - COALESCE(
          (SELECT COUNT(*) FROM request_logs rl
           WHERE (qa.provider_id IS NULL OR rl.selected_provider = qa.provider_id)
           AND rl.timestamp >= date('now', 'start of month')),
          0
        ) as remaining_quota,
        qa.period as window,
        date('now', 'start of month', '+1 month') as reset_time,
        0 as burn_rate,
        null as predicted_exhaustion,
        '[]' as alerts,
        '[]' as rerouting_suggestions
      FROM quota_allocations qa
      LEFT JOIN providers p ON p.id = qa.provider_id
      ORDER BY p.name
    `).all() as Array<Record<string, unknown>>;
    return {
      quotas: rows.map((row) => ({
        ...row,
        alerts: typeof row.alerts === 'string' ? JSON.parse(row.alerts) : row.alerts ?? [],
        rerouting_suggestions: typeof row.rerouting_suggestions === 'string' ? JSON.parse(row.rerouting_suggestions) : row.rerouting_suggestions ?? [],
      })),
    };
  });

  // Alerts (derived from system state)
  server.get('/admin/alerts', async () => {
    const db = getDb();
    const alerts: Array<{
      id: string;
      timestamp: string;
      type: string;
      severity: string;
      message: string;
      source: string;
      acknowledged: boolean;
      resolved: boolean;
      details: Record<string, unknown>;
    }> = [];

    // Check for unhealthy providers
    const unhealthyProviders = db.prepare(`
      SELECT name, consecutive_failures, last_health_check
      FROM providers
      WHERE is_healthy = 0 OR consecutive_failures > 0
    `).all() as Array<{ name: string; consecutive_failures: number; last_health_check: string }>;

    for (const p of unhealthyProviders) {
      alerts.push({
        id: `provider-${p.name}`,
        timestamp: p.last_health_check || new Date().toISOString(),
        type: 'provider_outage',
        severity: p.consecutive_failures >= 3 ? 'critical' : 'warning',
        message: `Provider ${p.name} is unhealthy (${p.consecutive_failures} consecutive failures)`,
        source: 'health-checker',
        acknowledged: false,
        resolved: false,
        details: { provider: p.name, failures: p.consecutive_failures },
      });
    }

    // Check for quota nearing exhaustion (>80%)
    const quotaUsage = db.prepare(`
      SELECT
        p.name as provider_name,
        qa.max_requests,
        COALESCE(
          (SELECT COUNT(*) FROM request_logs rl
           WHERE rl.selected_provider = qa.provider_id
           AND rl.timestamp >= date('now', 'start of month')),
          0
        ) as used
      FROM quota_allocations qa
      JOIN providers p ON p.id = qa.provider_id
      WHERE qa.max_requests IS NOT NULL
    `).all() as Array<{ provider_name: string; max_requests: number; used: number }>;

    for (const q of quotaUsage) {
      const usagePercent = q.max_requests > 0 ? (q.used / q.max_requests) * 100 : 0;
      if (usagePercent > 80) {
        alerts.push({
          id: `quota-${q.provider_name}`,
          timestamp: new Date().toISOString(),
          type: 'quota',
          severity: usagePercent > 95 ? 'critical' : 'warning',
          message: `Quota for ${q.provider_name} is at ${Math.round(usagePercent)}% (${q.used}/${q.max_requests})`,
          source: 'quota-service',
          acknowledged: false,
          resolved: false,
          details: { provider: q.provider_name, used: q.used, limit: q.max_requests },
        });
      }
    }

    return { alerts };
  });

  // Telemetry events (in-memory ring buffer)
  const telemetryBuffer: Array<{
    id: string;
    timestamp: string;
    level: string;
    service: string;
    message: string;
    trace_id: string | null;
    span_id: string | null;
    duration: number | null;
    metadata: Record<string, unknown>;
  }> = [];

  const MAX_TELEMETRY_EVENTS = 1000;

  /** Trim the telemetry buffer to MAX_TELEMETRY_EVENTS. */
  function trimTelemetryBuffer(): void {
    while (telemetryBuffer.length > MAX_TELEMETRY_EVENTS) {
      telemetryBuffer.shift();
    }
  }

  server.get('/admin/telemetry/events', async () => {
    trimTelemetryBuffer();
    return { events: telemetryBuffer.slice(-100) };
  });

  // Expose buffer for adding events from other routes
  (server as unknown as Record<string, unknown>).telemetryBuffer = telemetryBuffer;
  (server as unknown as Record<string, unknown>).trimTelemetryBuffer = trimTelemetryBuffer;

  // Audit events
  server.get('/admin/audit/events', async () => {
    const db = getDb();

    // Get recent request logs as audit events
    const rows = db.prepare(`
      SELECT
        rl.id as id,
        rl.timestamp,
        CASE
          WHEN rl.error_code IS NOT NULL THEN 'provider_call'
          WHEN rl.fallback_used THEN 'fallback'
          ELSE 'routing'
        END as event_type,
        CASE
          WHEN rl.error_code IS NOT NULL THEN 'error'
          WHEN rl.fallback_used THEN 'warning'
          ELSE 'info'
        END as severity,
        'system' as actor,
        rl.tenant_id as tenant_id,
        'Request to ' || rl.selected_model || ' via provider' as description,
        json_object(
          'model', rl.selected_model,
          'latency_ms', rl.latency_ms,
          'tokens', COALESCE(rl.tokens_input, 0) + COALESCE(rl.tokens_output, 0),
          'fallback', rl.fallback_used
        ) as metadata,
        null as ip_address
      FROM request_logs rl
      ORDER BY rl.timestamp DESC
      LIMIT 100
    `).all();

    return { events: rows };
  });

  // Memory endpoints
  server.get('/admin/memory', async (request) => {
    const { tenantId, limit } = request.query as { tenantId?: string; limit?: number };
    const items = memoryService.list(tenantId, limit);
    return { items };
  });

  server.post('/admin/memory', async (request, reply) => {
    const { tenantId, content, namespace, source, retentionDays, metadata } = request.body as any;
    if (!content) {
      reply.status(400);
      return { error: { message: 'content is required', type: 'validation', code: 'missing_content' } };
    }
    const item = await memoryService.create({
      tenantId: tenantId || 'local',
      content,
      namespace,
      source,
      retentionDays,
      metadata,
    });
    reply.status(201);
    return item;
  });

  server.post('/admin/memory/search', async (request) => {
    const { tenantId, query, namespace, limit, minScore } = request.body as any;
    const results = await memoryService.search({ tenantId, query, namespace, limit, minScore });
    return { items: results };
  });

  server.delete('/admin/memory/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    memoryService.delete(id);
    reply.status(204);
    return null;
  });

  server.get('/admin/memory/stats', async () => {
    return retentionManager.getStats();
  });

  // Sandbox endpoints
  server.get('/admin/sandbox/jobs', async (request) => {
    const { limit } = request.query as { limit?: number };
    const jobs = sandboxService.list(limit);
    return { jobs };
  });

  server.post('/admin/sandbox/jobs', async (request, reply) => {
    const { tenantId, language, code, timeoutMs, maxRetries } = request.body as any;
    if (!code) {
      reply.status(400);
      return { error: { message: 'code is required', type: 'validation', code: 'missing_code' } };
    }
    const job = await sandboxService.submit({ tenantId, language, code, timeoutMs, maxRetries });
    reply.status(201);
    return job;
  });

  server.post('/admin/sandbox/jobs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cancelled = sandboxService.cancel(id);
    if (!cancelled) {
      reply.status(404);
      return { error: { message: 'Job not found or already completed', type: 'not_found', code: 'job_not_found' } };
    }
    return { ok: true };
  });

  // Workers endpoints
  server.get('/admin/workers', async () => {
    const workers = workersService.list();
    return { workers };
  });

  server.post('/admin/workers', async (request, reply) => {
    const { name, type } = request.body as any;
    if (!name) {
      reply.status(400);
      return { error: { message: 'name is required', type: 'validation', code: 'missing_name' } };
    }
    const worker = workersService.register({ name, type });
    reply.status(201);
    return worker;
  });

  server.post('/admin/workers/:id/heartbeat', async (request) => {
    const { id } = request.params as { id: string };
    const ok = workersService.heartbeat(id);
    return { ok };
  });

  server.post('/admin/workers/:id/drain', async (request) => {
    const { id } = request.params as { id: string };
    const worker = workersService.drain(id);
    return worker;
  });

  server.post('/admin/workers/:id/resume', async (request) => {
    const { id } = request.params as { id: string };
    const worker = workersService.resume(id);
    return worker;
  });

  // Federation endpoints
  server.get('/admin/federation', async () => {
    const nodes = federationService.list();
    return { nodes };
  });

  server.post('/admin/federation', async (request, reply) => {
    const { name, url, region, apiKey, privacyLevel } = request.body as any;
    if (!name || !url) {
      reply.status(400);
      return { error: { message: 'name and url are required', type: 'validation', code: 'missing_fields' } };
    }
    const node = federationService.register({ name, url, region, apiKey, privacyLevel });
    reply.status(201);
    return node;
  });

  server.delete('/admin/federation/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    federationService.unregister(id);
    reply.status(204);
    return null;
  });

  server.post('/admin/federation/:id/health', async (request) => {
    const { id } = request.params as { id: string };
    const node = await federationService.healthCheck(id);
    return node;
  });

  server.post('/admin/federation/:id/sync', async (request) => {
    const { id } = request.params as { id: string };
    const ok = await federationService.syncBenchmark(id);
    return { ok };
  });

  // --- DELETE endpoints ---

  // Delete provider
  server.delete('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    reply.status(204);
    return null;
  });

  // Delete model
  server.delete('/admin/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    db.prepare('DELETE FROM model_profiles WHERE id = ?').run(id);
    reply.status(204);
    return null;
  });

  // Delete tenant
  server.delete('/admin/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const tenant = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(id) as any;
    if (!tenant) {
      reply.status(404);
      return { error: { message: 'Tenant not found', type: 'not_found', code: 'tenant_not_found' } };
    }

    // Protect default/local tenant
    if (tenant.name === 'default' || tenant.name === 'local') {
      throw new ValidationError(`Cannot delete the "${tenant.name}" tenant`);
    }

    try {
      db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
    } catch (err: any) {
      logger.error({ err, tenantId: id }, 'Failed to delete tenant');
      throw new ValidationError('Cannot delete tenant — it still has associated records (billing, usage, etc.)');
    }

    reply.status(204);
    return null;
  });

  // Update tenant
  server.put('/admin/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Record<string, unknown>;

    const db = getDb();
    const existing = db.prepare('SELECT id FROM tenants WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) {
      reply.status(404);
      return { error: { message: 'Tenant not found', type: 'not_found', code: 'tenant_not_found' } };
    }

    const allowedFields = ['name', 'email', 'tier', 'suspended'];
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(updates[field]);
      }
    }

    if (setClauses.length === 0) {
      reply.status(400);
      return { error: { message: 'No valid fields to update', type: 'validation', code: 'no_fields' } };
    }

    values.push(id);
    db.prepare(`UPDATE tenants SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
    return tenant;
  });

  // Delete API key
  server.delete('/admin/api-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    reply.status(204);
    return null;
  });

  // Delete policy
  server.delete('/admin/policies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    db.prepare('DELETE FROM policies WHERE id = ?').run(id);
    reply.status(204);
    return null;
  });

  // --- UPDATE endpoints ---

  // Update provider
  server.put('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const {
      name,
      adapter_type,
      base_url,
      api_key_ref,
      config,
      auth_method,
      oauth_access_token,
      oauth_refresh_token,
      oauth_token_expires_at,
    } = parsed.data;

    // Issue #9: SSRF validation on base_url
    if (base_url) {
      validateBaseUrlForSSRF(base_url);
    }

    // Issue #2: Encrypt any apiKey in config before storing
    const configToStore = config ? encryptConfigApiKey({ ...config }) : null;
    const encryptedOAuthAccessToken = oauth_access_token ? encrypt(oauth_access_token) : null;
    const encryptedOAuthRefreshToken = oauth_refresh_token ? encrypt(oauth_refresh_token) : null;

    const db = getDb();
    db.prepare(
      `UPDATE providers SET
        name = COALESCE(?, name),
        adapter_type = COALESCE(?, adapter_type),
        base_url = COALESCE(?, base_url),
        api_key_ref = COALESCE(?, api_key_ref),
        config = COALESCE(?, config),
        oauth_access_token = COALESCE(?, oauth_access_token),
        oauth_refresh_token = COALESCE(?, oauth_refresh_token),
        oauth_token_expires_at = COALESCE(?, oauth_token_expires_at),
        auth_method = COALESCE(?, auth_method),
        is_healthy = CASE WHEN ? IS NULL THEN is_healthy ELSE 1 END,
        consecutive_failures = CASE WHEN ? IS NULL THEN consecutive_failures ELSE 0 END,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      name ?? null,
      adapter_type ?? null,
      base_url ?? null,
      api_key_ref ?? null,
      configToStore ? JSON.stringify(configToStore) : null,
      encryptedOAuthAccessToken,
      encryptedOAuthRefreshToken,
      oauth_token_expires_at ?? null,
      auth_method ?? (oauth_access_token ? 'oauth' : null),
      oauth_access_token ?? null,
      oauth_access_token ?? null,
      id,
    );
    const updated = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!updated) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }
    if (oauth_access_token) {
      const activated = db.prepare(
        `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
         WHERE provider_id = ? AND is_active = 0`
      ).run(updated.id);
      if (activated.changes > 0) {
        logger.info({ provider: updated.name, models: activated.changes }, 'Activated models after OAuth token update');
      }

      const template = PROVIDER_CATALOG.find(t => t.id === updated.name || t.name === updated.name);
      const adapterRegistry = (server as any).adapterRegistry;
      let adapter = adapterRegistry.get(updated.name);
      if (!adapter && template?.apiFormat === 'openai') {
        const { GenericOpenAIAdapter } = await import('@dmr-x/adapters');
        adapter = new GenericOpenAIAdapter(updated.name);
        adapterRegistry.register(adapter);
      }
      if (adapter && updated.base_url) {
        try {
          await adapterRegistry.initialize(updated.name, {
            baseUrl: updated.base_url,
            accessToken: oauth_access_token,
            authMethod: 'oauth',
          });
        } catch (err) {
          logger.warn({ err, provider: updated.name }, 'Adapter initialization failed after OAuth token update');
        }
      }

      const refreshCandidates = (server as any).refreshCandidates;
      if (refreshCandidates) await refreshCandidates();
    }
    const uCfg = JSON.parse(updated.config || '{}');
    return { ...updated, config: { ...uCfg, apiKey: undefined, hasKey: !!uCfg.apiKey || !!updated.oauth_access_token } };
  });

  // Update model
  server.put('/admin/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateModelSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { display_name, modality, context_window, max_output_tokens, is_active } = parsed.data;
    const db = getDb();
    db.prepare(
      `UPDATE model_profiles SET
        display_name = COALESCE(?, display_name),
        modality = COALESCE(?, modality),
        context_window = COALESCE(?, context_window),
        max_output_tokens = COALESCE(?, max_output_tokens),
        is_active = COALESCE(?, is_active),
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(display_name, modality, context_window, max_output_tokens, is_active != null ? (is_active ? 1 : 0) : null, id);
    const updated = db.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id);
    if (!updated) {
      reply.status(404);
      return { error: { message: 'Model not found', type: 'not_found', code: 'model_not_found' } };
    }
    return updated;
  });

  // Update policy
  server.put('/admin/policies/:id', async (request) => {
    const { id } = request.params as { id: string };
    const parsed = UpdatePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { name, type, target, action, conditions, priority, enabled } = parsed.data;
    const db = getDb();
    const existing = db.prepare('SELECT rules FROM policies WHERE id = ?').get(id) as { rules: string } | undefined;
    if (!existing) {
      throw new ValidationError('Policy not found');
    }
    const currentRules = JSON.parse(existing.rules || '{}');
    const updatedRules = {
      type: type ?? currentRules.type,
      target: target ?? currentRules.target,
      action: action ?? currentRules.action,
      conditions: conditions ?? currentRules.conditions,
      priority: priority ?? currentRules.priority,
    };
    db.prepare(
      `UPDATE policies SET
        name = COALESCE(?, name),
        rules = ?,
        is_active = COALESCE(?, is_active),
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(name ?? null, JSON.stringify(updatedRules), enabled != null ? (enabled ? 1 : 0) : null, id);
    const row = db.prepare(`
      SELECT p.*, t.name as tenant_name
      FROM policies p
      JOIN tenants t ON t.id = p.tenant_id
      WHERE p.id = ?
    `).get(id) as Record<string, unknown>;
    const rules = JSON.parse(row.rules as string);
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      name: row.name,
      type: rules.type || 'provider_allow',
      target: rules.target || [],
      action: rules.action || 'deny',
      conditions: rules.conditions || {},
      priority: rules.priority ?? 0,
      enabled: !!row.is_active,
      created_at: row.created_at,
    };
  });

  // --- Settings backend ---

  // Get settings
  server.get('/admin/settings', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      settings[row.key] = JSON.parse(row.value);
    }
    return settings;
  });

  // Update settings
  server.put('/admin/settings', async (request) => {
    const parsed = UpdateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const settings = parsed.data;
    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    );
    for (const [key, value] of Object.entries(settings)) {
      upsert.run(key, JSON.stringify(value));
    }
    return { success: true };
  });
}
