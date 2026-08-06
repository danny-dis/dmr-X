import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { ValidationError } from '@dmr-x/core';
import { getDb } from '@dmr-x/db';
import { federationService } from '@dmr-x/federation';
import { memoryService, retentionManager } from '@dmr-x/memory';
import { PROVIDER_CATALOG, discoverOpenAIModels, registryService } from '@dmr-x/registry';
import { sandboxService } from '@dmr-x/sandbox';
import { logger, encrypt, decrypt, encryptConfigApiKey, eventBus, SystemEvents } from '@dmr-x/utils';
import { workersService } from '@dmr-x/workers';
import { trace, type Span } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import { Agent } from 'undici';
import { z } from 'zod';

import { parseQualityTarget } from '../utils/quality-target.js';
import { parseProviderPreferencesHeader } from '../utils/provider-preferences.js';
import { compressionService } from '../services/compression.js';
import { computeSavings } from '../services/savings.js';
import { refreshAdminKey } from '../middleware/auth.middleware.js';
import { validateBaseUrlForSSRF, type ValidatedURL } from './admin-ssrf.js';
import { isNeedleEnabled, getNeedleTelemetry, needleHealthUrl } from '../lib/needlePreFilter.js';

const HTML_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => HTML_ESCAPE[c]!);
}

// ─── Hybrid .env Sync ─────────────────────────────────────────────────────
//
// When an API key is set via the admin UI, also persist it to the .env
// file so the key survives database corruption or migration resets.
// The env var acts as a fallback: loadActiveProviderCredential() checks
// provider_keys → config.apiKey → process.env[api_key_ref] in order, so
// the DB-stored key always takes precedence when available.
//
// The .env file is located by walking up from DMRX_DATA_DIR to the project
// root, looking for the file that contains DMRX_DATA_DIR or PORT entries.
// If no .env is found, we skip silently (container/K8s deployments may
// not use .env files).

/** Locate the primary .env file for the running instance. */
function findEnvFile(): string | null {
  // Candidate directories: project root (where turbo.json lives), CWD, data dir
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
    process.env.DMRX_DATA_DIR ? path.dirname(process.env.DMRX_DATA_DIR) : '',
  ].filter(Boolean);

  for (const dir of candidates) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      return envPath;
    }
  }
  return null;
}

/**
 * Upsert an environment variable in a .env file.
 * - If `KEY=...` exists, replaces the value (preserves comments/blank lines)
 * - If not found, appends `KEY=value` at the end
 * - Also updates process.env so the running process picks it up immediately
 */
function upsertEnvVar(envPath: string, key: string, value: string): void {
  try {
    let content = fs.readFileSync(envPath, 'utf-8');
    const regex = new RegExp(`^${key}=.*$`, 'm');

    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      // Ensure trailing newline before appending
      if (content.length > 0 && !content.endsWith('\n')) {
        content += '\n';
      }
      content += `${key}=${value}\n`;
    }

    fs.writeFileSync(envPath, content, 'utf-8');
    // Update the running process so the new key takes effect without restart
    process.env[key] = value;
  } catch (err) {
    logger.warn({ err, envPath, key }, 'Failed to sync API key to .env file (non-fatal)');
  }
}

/**
 * Sync an API key to the .env file for the given provider.
 * Looks up the provider's catalog entry to find the correct env-var name.
 */
function syncApiKeyToEnvFile(providerName: string, apiKey: string | undefined): void {
  if (!apiKey) return; // Don't write empty keys — only sync actual secrets

  // Find the catalog entry to get the envKey
  const template = PROVIDER_CATALOG.find(t => t.id === providerName);
  if (!template?.envKey) return; // No env-var mapping for this provider

  const envPath = findEnvFile();
  if (!envPath) return; // No .env file found — skip silently

  upsertEnvVar(envPath, template.envKey, apiKey);
  logger.info({ provider: providerName, envKey: template.envKey, envPath }, 'Synced API key to .env file');
}

/**
 * Remove an API key from the .env file (set to empty) for the given provider.
 * Called when a key is deleted or deactivated.
 */
function removeApiKeyFromEnvFile(providerName: string): void {
  const template = PROVIDER_CATALOG.find(t => t.id === providerName);
  if (!template?.envKey) return;

  const envPath = findEnvFile();
  if (!envPath) return;

  upsertEnvVar(envPath, template.envKey, '');
  logger.info({ provider: providerName, envKey: template.envKey }, 'Cleared API key from .env file');
}

/**
 * Log an admin action to the audit log for SOC2/ISO27001 compliance.
 * All create/update/delete operations on sensitive resources should be logged.
 */
function logAdminAction(
  request: any,
  action: string,
  resourceType: string,
  resourceId?: string,
  details?: Record<string, unknown>
): void {
  try {
    const db = getDb();
    const adminKeyHash = request.headers['x-api-key']
      ? crypto.createHash('sha256').update(request.headers['x-api-key']).digest('hex').slice(0, 16)
      : 'unknown';

    db.prepare(
      `INSERT INTO admin_audit_log (id, admin_key_hash, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      adminKeyHash,
      action,
      resourceType,
      resourceId || null,
      details ? JSON.stringify(details) : null,
      request.ip || null,
      request.headers['user-agent'] || null
    );
  } catch (err) {
    // Don't let audit logging failures break admin operations
    logger.warn({ err, action, resourceType }, 'Failed to write admin audit log');
  }
}

/**
 * Pull the current OTel trace_id / span_id off the active span, if any.
 *
 * - `trace_id` is the 32-char hex id of the request's trace.  It is the
 *   value that ties multiple spans (gateway -> router -> adapter.fetch)
 *   together in a trace UI.
 * - `span_id` is the 16-char hex id of the *active* span when this
 *   helper was called. For events emitted from request handlers, that
 *   is the `http.request` span started in `apps/gateway/src/server.ts`.
 *
 * Both return `null` when no SDK has registered a global provider, or
 * when there is no active span on the current async context.
 */
function getActiveTraceContext(): { traceId: string | null; spanId: string | null } {
  try {
    const span = trace.getActiveSpan() as Span | undefined;
    if (!span) return { traceId: null, spanId: null };
    const ctx = span.spanContext();
    if (!ctx || ctx.traceId === '00000000000000000000000000000000') {
      return { traceId: null, spanId: null };
    }
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  } catch {
    return { traceId: null, spanId: null };
  }
}

const CreateProviderSchema = z.object({
  name: z.string().min(1),
  adapter_type: z.string().min(1),
  base_url: z.string().url().optional().nullable(),
  api_key_ref: z.string().optional().nullable(),
  // The `providers` table has no dedicated columns for these, so the route
  // handler merges them into the `config` JSON blob. The dialog sends
  // them as top-level fields because that's what the UI form model carries.
  region: z.string().optional().nullable(),
  priority: z.number().int().min(0).optional().default(0),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.unknown()).optional().default({}),
  /** Tier of the key being attached. Defaults to 'paid' for backward
   * compatibility — operators who want to label a key as free must opt in.
   * When the dialog is opened from the Free Tier page, the UI passes
   * 'free' explicitly. */
  tier: z.enum(['free', 'paid']).default('paid'),
});

const CreateModelSchema = z.object({
  provider_id: z.string().uuid(),
  model_id: z.string().min(1),
  display_name: z.string().optional(),
  modality: z.enum(['llm', 'diffusion', 'embedding', 'audio_tts', 'audio_stt', 'audio_speech', 'audio_transcription', 'video', 'music', 'reranking', 'moderation', 'code_completion', 'image_upscaling', 'image_inpainting', 'vision', '3d']),
  intelligence_layer: z.enum(['brain', 'thinker', 'executor', 'worker', 'temp_worker']).optional().default('executor'),
  capability_tier: z.enum(['frontier', 'strong', 'balanced', 'fast', 'economy']).optional().default('balanced'),
  // 9-Dimension Taxonomy Fields
  architecture: z.enum(['dense', 'moe', 'ssm', 'hybrid', 'unknown']).optional(),
  task_categories: z.array(z.string()).optional(),
  context_tier: z.enum(['short', 'medium', 'long', 'ultra', 'massive']).optional(),
  deployment: z.enum(['cloud', 'self_hosted', 'on_device']).optional(),
  reasoning_mode: z.enum(['fixed', 'adaptive', 'hybrid']).optional(),
  safety_tier: z.enum(['unrestricted', 'standard', 'restricted']).optional(),
  agentic_level: z.enum(['chat', 'tool_use', 'autonomous']).optional(),
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
  // provider_id is the only strictly-required field. The UI only knows the
  // provider's DB UUID (and the secret is encrypted at rest), so requiring
  // the client to echo back the base_url/api_key would always fail.
  provider_id: z.string().min(1),
  // Optional overrides: callers that already have a live key/baseUrl handy
  // (e.g. the test-connection dialog at provider creation time, before the
  // row is written) can pass them to verify connectivity up front. When
  // omitted, the server looks up the row and decrypts the stored key.
  base_url: z.string().url().optional(),
  api_key: z.string().optional(),
});

const ActivateProviderSchema = z.object({
  template_id: z.string().min(1),
  api_key: z.string().optional(),
  oauth_access_token: z.string().optional(),
  oauth_refresh_token: z.string().optional(),
  oauth_token_expires_at: z.string().datetime().optional(),
  auth_method: z.enum(['api_key', 'oauth']).optional(),
  name: z.string().optional(),
  /**
   * Optional label for the initial key. When omitted the key is
   * labelled "Default". When specified, it's used as-is so operators
   * can name their keys meaningfully (e.g. "Work", "Personal").
   */
  key_label: z.string().min(1).max(64).optional(),
  /**
   * Tier of the key being attached. The catalog entry sets a sensible
   * default (free when every model is free, paid otherwise) but the
   * caller can override — a free key for Google has the same shape as
   * a paid one, and the user knows which is which.
   */
  tier: z.enum(['free', 'paid']).optional(),
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
  // Same rationale as CreateProviderSchema — the dialog sends these as
  // top-level fields but the table has no columns for them, so they get
  // merged into the config JSON.
  region: z.string().optional().nullable(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

const UpdateApiKeySchema = z.object({
  api_key: z.string().min(1),
  /**
   * Tier of the key being attached. Defaults to 'paid' to preserve
   * the historical behaviour — operators who want to label a key as
   * free must opt in. The default-key row is updated, so the next call
   * without `tier` will leave the value alone.
   */
  tier: z.enum(['free', 'paid']).optional(),
});

/**
 * Schema for adding a *second* (or third, etc.) key to an existing
 * provider. The tier and credentials are required-ish (the API key OR
 * an OAuth access token must be supplied); the label is operator-only.
 */
const AddProviderKeySchema = z
  .object({
    label: z.string().min(1).max(64).optional(),
    tier: z.enum(['free', 'paid']).default('paid'),
    api_key: z.string().min(1).optional(),
    oauth_access_token: z.string().min(1).optional(),
    oauth_refresh_token: z.string().min(1).optional(),
    oauth_token_expires_at: z.string().datetime().optional(),
    auth_method: z.enum(['api_key', 'oauth']).optional(),
    priority: z.number().int().min(0).max(1000).default(0),
  })
  .refine(
    (v) => !!v.api_key || !!v.oauth_access_token,
    { message: 'Either api_key or oauth_access_token is required' },
  );

const RotateProviderKeySchema = z
  .object({
    label: z.string().min(1).max(64).optional(),
    tier: z.enum(['free', 'paid']).optional(),
    api_key: z.string().min(1).optional(),
    oauth_access_token: z.string().min(1).optional(),
    oauth_refresh_token: z.string().min(1).optional(),
    oauth_token_expires_at: z.string().datetime().optional(),
    auth_method: z.enum(['api_key', 'oauth']).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.label !== undefined ||
      v.tier !== undefined ||
      v.api_key !== undefined ||
      v.oauth_access_token !== undefined ||
      v.oauth_refresh_token !== undefined ||
      v.oauth_token_expires_at !== undefined ||
      v.auth_method !== undefined ||
      v.priority !== undefined ||
      v.is_active !== undefined,
    { message: 'No fields to update' },
  );

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(255),
});

/**
 * Agent RBAC roles, mirroring AGENT_ROLES in
 * services/agent-registry/src/agent-permissions.ts. Note that 'admin' also
 * unlocks cross-tenant reads there, so it should be assigned deliberately.
 */
const AgentRoleSchema = z.enum(['admin', 'developer', 'user', 'viewer']);

const CreateApiKeySchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().max(255).optional(),
  scopes: z.array(z.string()).optional(),
  allowed_tools: z.array(z.string()).optional(),
  role: AgentRoleSchema.optional(),
  expires_at: z.string().datetime().optional().nullable(),
  compression_enabled: z.boolean().optional(),
  compression_algorithm: z.enum(['auto', 'smartcrusher', 'codecompressor', 'kompress']).optional(),
  compression_reversible: z.boolean().optional(),
});

const UpdateApiKeyRoleSchema = z.object({
  role: AgentRoleSchema,
});

const CreateTenantApiKeySchema = z.object({
  name: z.string().max(255).optional(),
  scopes: z.array(z.string()).optional(),
  compression_enabled: z.boolean().optional(),
  compression_algorithm: z.enum(['auto', 'smartcrusher', 'codecompressor', 'kompress']).optional(),
  compression_reversible: z.boolean().optional(),
});

const UpdateModelSchema = z.object({
  model_id: z.string().min(1).optional(),
  display_name: z.string().optional(),
  modality: z.string().optional(),
  context_window: z.number().positive().optional().nullable(),
  max_output_tokens: z.number().positive().optional().nullable(),
  is_active: z.boolean().optional(),
});

const CreatePolicySchema = z.object({
  tenant_id: z.string().optional().default('default'),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['provider_allow', 'provider_deny', 'model_allow', 'model_deny', 'cost_cap', 'modality_restriction', 'residency', 'tool_permission']).optional().default('model_allow'),
  target: z.array(z.string()).optional().default([]),
  action: z.enum(['allow', 'deny', 'redirect', 'rate_limit', 'tag']).default('deny'),
  match: z.object({
    model: z.string().optional(),
    tenantId: z.string().optional(),
    tag: z.string().optional(),
    modality: z.string().optional(),
  }).optional(),
  conditions: z.record(z.unknown()).optional().default({}),
  priority: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

const UpdatePolicySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['provider_allow', 'provider_deny', 'model_allow', 'model_deny', 'cost_cap', 'modality_restriction', 'residency', 'tool_permission']).optional(),
  target: z.array(z.string()).optional(),
  action: z.enum(['allow', 'deny', 'redirect', 'rate_limit', 'tag']).optional(),
  match: z.object({
    model: z.string().optional(),
    tenantId: z.string().optional(),
    tag: z.string().optional(),
    modality: z.string().optional(),
  }).optional(),
  conditions: z.record(z.unknown()).optional(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

const McpToolExecuteSchema = z.object({
  tool: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
});

const ApiKeyToolsSchema = z.object({
  allowed_tools: z.array(z.string()),
});

const PrimitiveValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

// Defense-in-depth: blocked keys that could enable prototype pollution
const BLOCKED_SETTINGS_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

// Strict allowlist: only known settings keys accepted; unknown keys are rejected via .strict()
// Keys here MUST match exactly what the UI sends via `toServer()` in
// apps/ui/src/pages/Settings.tsx. Mismatched names are silently dropped by
// the Settings page and the values never reach the DB, which is the bug
// this allowlist was extended to fix. Use `z.union([z.string(), z.number()])`
// for numeric values because the UI sometimes ships them as strings.
const UpdateSettingsSchema = z.object({
  // Routing
  routingStrategy: z.string().optional(),
  costOptimization: z.boolean().optional(),
  latencyBudgetMs: z.union([z.string(), z.number()]).optional(),
  autoFallback: z.boolean().optional(),
  routingTimeout: z.union([z.string(), z.number()]).optional(),
  // Kept for backwards-compat with older clients
  fallbackEnabled: z.boolean().optional(),

  // Routing weights
  qualityWeight: z.union([z.string(), z.number()]).optional(),
  costWeight: z.union([z.string(), z.number()]).optional(),
  latencyWeight: z.union([z.string(), z.number()]).optional(),

  // Model defaults
  defaultModel: z.string().optional(),
  maxContextWindow: z.union([z.string(), z.number()]).optional(),
  defaultTemperature: z.union([z.string(), z.number()]).optional(),

  // Platform
  platformName: z.string().optional(),
  timezone: z.string().optional(),

  // Auth & CORS
  requireAuth: z.boolean().optional(),
  // Kept for backwards-compat with older clients
  requireApiKeyAuth: z.boolean().optional(),
  corsOrigins: z.string().optional(),
  // Kept for backwards-compat with older clients
  allowedOrigins: z.string().optional(),
  rateLimitRpm: z.union([z.string(), z.number()]).optional(),

  // API key & request limits
  autoKeyRotation: z.boolean().optional(),
  maxRequestSizeMb: z.union([z.string(), z.number()]).optional(),

  // Caching & streaming
  cacheTtlSec: z.union([z.string(), z.number()]).optional(),
  streamingChunkSize: z.union([z.string(), z.number()]).optional(),

  // Needle tool pre-filter (services/needle-router). Runtime toggle read
  // fresh per-request by needlePreFilter.ts — no gateway restart needed.
  needleRouterEnabled: z.boolean().optional(),

  // Worker / runtime
  workerConcurrency: z.union([z.string(), z.number()]).optional(),
  requestTimeout: z.union([z.string(), z.number()]).optional(),

  // Notifications
  slackWebhookUrl: z.string().optional(),
  emailRecipients: z.string().optional(),
  latencyAlertThreshold: z.union([z.string(), z.number()]).optional(),
  quotaAlertThreshold: z.union([z.string(), z.number()]).optional(),

  // Webhooks
  alertWebhook: z.string().optional(),
  routeDecisionWebhook: z.string().optional(),
  webhookMaxRetries: z.union([z.string(), z.number()]).optional(),
  webhookRetryBackoff: z.union([z.string(), z.number()]).optional(),

  // Benchmarking
  autoBenchmarkRuns: z.boolean().optional(),
  benchmarkFrequency: z.string().optional(),
  regressionThreshold: z.union([z.string(), z.number()]).optional(),

  // Retention
  requestLogRetentionDays: z.union([z.string(), z.number()]).optional(),
  memoryRetentionDays: z.union([z.string(), z.number()]).optional(),
  benchmarkHistoryDays: z.union([z.string(), z.number()]).optional(),
  logRetention: z.union([z.string(), z.number()]).optional(),

  // Agent Integration Config
  agentIntegrationClaudeCode: z.object({
    bigModelId: z.string().nullable().optional(),
    bigProviderId: z.string().nullable().optional(),
    mediumModelId: z.string().nullable().optional(),
    mediumProviderId: z.string().nullable().optional(),
    smallModelId: z.string().nullable().optional(),
    smallProviderId: z.string().nullable().optional(),
    customEnvVars: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  }).strict().optional(),
  agentIntegrationCodex: z.object({
    modelId: z.string().nullable().optional(),
    providerId: z.string().nullable().optional(),
    configFormat: z.enum(['toml', 'env']).optional(),
  }).strict().optional(),
  agentIntegrationAntigravity: z.object({
    isEnabled: z.boolean().optional(),
    preferredProviderId: z.string().nullable().optional(),
  }).strict().optional(),
  agentIntegrationOpencode: z.object({
    modelId: z.string().nullable().optional(),
    providerId: z.string().nullable().optional(),
    configFormat: z.enum(['toml', 'env']).optional(),
  }).strict().optional(),
}).refine(
  (obj) => !Object.keys(obj).some((k) => BLOCKED_SETTINGS_KEYS.has(k)),
  { message: 'Blocked key detected' }
);

// ---------------------------------------------------------------------------
// HIGH-4: Zod validation on the remaining admin routes that previously
// accepted `request.body as any` and relied on inline `if (!field)` checks.
// Each schema mirrors the shape that the admin UI / API sends; the route
// handlers now use `safeParse` and surface a 400 ValidationError with the
// zod issue list. SSRF is NOT validated here (that's the SSRF agent's
// job) — only that the URL is a syntactically valid http(s) URL.
// ---------------------------------------------------------------------------

/** POST /admin/memory */
const CreateMemoryItemSchema = z.object({
  content: z.string().min(1).max(1_000_000),
  namespace: z.string().min(1).max(128).optional(),
  source: z.string().min(1).max(128).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  metadata: z.record(z.unknown()).optional(),
  tenantId: z.string().min(1).max(128).optional(),
});

/** POST /admin/memory/search */
const SearchMemorySchema = z.object({
  query: z.string().min(1).max(10_000),
  tenantId: z.string().min(1).max(128).optional(),
  namespace: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

/** POST /admin/workers */
const RegisterWorkerSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.string().min(1).max(64).optional(),
});

/** POST /admin/federation — URL is validated for syntactic shape only */
const RegisterFederationNodeSchema = z.object({
  name: z.string().min(1).max(128),
  url: z.string().url().refine(
    (u) => {
      try {
        const proto = new URL(u).protocol;
        return proto === 'http:' || proto === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'url must be a valid http(s) URL' },
  ),
  region: z.string().min(1).max(64).optional().nullable(),
  apiKey: z.string().min(1).max(2048).optional().nullable(),
  privacyLevel: z.enum(['anonymized', 'private', 'public']).optional(),
});

/** POST /admin/benchmarks/battle */
const RunArenaBattleSchema = z.object({
  modelA: z.string().uuid(),
  modelB: z.string().uuid(),
  prompt: z.string().min(1).max(100_000).optional(),
  category: z.enum(['reasoning', 'instruction', 'creative', 'coding', 'knowledge', 'multilingual', 'multi-turn', 'safety']).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

/** POST /admin/playground/feedback */
const PlaygroundFeedbackSchema = z.object({
  modelId: z.string().uuid().optional(),
  requestId: z.string().min(1).max(256).optional(),
  competitorModelId: z.string().uuid().optional().nullable(),
  userId: z.string().min(1).max(128).optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  feedbackText: z.string().max(10_000).optional().nullable(),
  implicitSignals: z.record(z.unknown()).optional(),
  isWinner: z.boolean().optional().nullable(),
}).refine(
  (v) => v.modelId !== undefined || v.requestId !== undefined,
  { message: 'Either modelId or requestId is required' },
);

// SSRF validation is defined in `./admin-ssrf.ts` so it can be unit-tested
// in isolation (no Fastify / DB dependencies). The new implementation resolves
// the hostname via DNS, blocks the resolved IP, and returns a `lookup` that
// callers can wire into fetch's `dispatcher` to prevent DNS rebinding.

// ---------------------------------------------------------------------------
// provider_keys helpers
//
// The gateway used to store a single encrypted API key in
// `providers.config.apiKey`. After migration 015 we also keep a row in
// the new `provider_keys` table — one row per credential, with its own
// label, tier, priority, and last-used timestamp. The active row with
// the highest priority is the one the adapter uses; the rest are
// available for future round-robin or per-model overrides.
//
// These helpers keep the table in sync with the existing single-key
// columns so legacy code paths (test endpoint, runBackgroundInit) keep
// working until they're fully migrated.
// ---------------------------------------------------------------------------

type ProviderKeyRow = {
  id: string;
  provider_id: string;
  label: string | null;
  tier: 'free' | 'paid';
  api_key_encrypted: string | null;
  oauth_access_token_encrypted: string | null;
  oauth_refresh_token_encrypted: string | null;
  oauth_token_expires_at: string | null;
  auth_method: string;
  priority: number;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderKeyView = Omit<
  ProviderKeyRow,
  'api_key_encrypted' | 'oauth_access_token_encrypted' | 'oauth_refresh_token_encrypted'
> & {
  /** First 7 chars of the decrypted key (e.g. "sk-…ab"). Empty if no key. */
  masked_key_prefix: string;
  has_api_key: boolean;
  has_oauth_token: boolean;
};

function maskKeyPrefix(ciphertext: string | null | undefined): string {
  if (!ciphertext) return '';
  try {
    const plain = decrypt(ciphertext);
    if (!plain) return '';
    // Always at least 4 chars (e.g. "sk-…"). Long keys get the first 4
    // and last 2 — enough to identify a key without leaking it.
    if (plain.length <= 6) return plain.slice(0, 2) + '…';
    return plain.slice(0, 4) + '…' + plain.slice(-2);
  } catch {
    return '•••';
  }
}

function toProviderKeyView(row: ProviderKeyRow): ProviderKeyView {
  return {
    id: row.id,
    provider_id: row.provider_id,
    label: row.label,
    tier: row.tier,
    auth_method: row.auth_method,
    priority: row.priority,
    is_active: row.is_active,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    oauth_token_expires_at: row.oauth_token_expires_at,
    masked_key_prefix: maskKeyPrefix(row.api_key_encrypted),
    has_api_key: !!row.api_key_encrypted,
    has_oauth_token: !!row.oauth_access_token_encrypted,
  };
}

function listProviderKeys(db: ReturnType<typeof getDb>, providerId: string): ProviderKeyView[] {
  const rows = db
    .prepare(
      `SELECT * FROM provider_keys
       WHERE provider_id = ?
       ORDER BY priority DESC, created_at ASC`,
    )
    .all(providerId) as ProviderKeyRow[];
  return rows.map(toProviderKeyView);
}

function getActiveKey(db: ReturnType<typeof getDb>, providerId: string): ProviderKeyRow | undefined {
  return db
    .prepare(
      `SELECT * FROM provider_keys
       WHERE provider_id = ? AND is_active = 1
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`,
    )
    .get(providerId) as ProviderKeyRow | undefined;
}

/**
 * Recompute providers.tier from the active keys on that provider.
 * Called after every key mutation so the denormalised cache stays
 * accurate. The recomputation is deliberately simple:
 *
 *   no active keys   → 'inactive'
 *   all keys free    → 'free'
 *   all keys paid    → 'paid'
 *   mixed tiers      → 'mixed'
 */
function recomputeProviderTier(db: ReturnType<typeof getDb>, providerId: string): void {
  const activeKeys = db
    .prepare(
      `SELECT tier FROM provider_keys
       WHERE provider_id = ? AND is_active = 1`,
    )
    .all(providerId) as Array<{ tier: 'free' | 'paid' }>;
  let tier: 'free' | 'paid' | 'mixed' | 'inactive';
  if (activeKeys.length === 0) {
    tier = 'inactive';
  } else {
    const distinct = new Set(activeKeys.map((k) => k.tier));
    if (distinct.size > 1) tier = 'mixed';
    else if (distinct.has('free')) tier = 'free';
    else tier = 'paid';
  }
  db.prepare(`UPDATE providers SET tier = ?, updated_at = datetime('now') WHERE id = ?`).run(
    tier,
    providerId,
  );
}

/**
 * Upsert the "Default" key for a provider. The first key written for a
 * provider uses `label = 'Default'` so legacy code paths that look up
 * the primary key by name (rather than priority) still work.
 */
function upsertDefaultKey(
  db: ReturnType<typeof getDb>,
  providerId: string,
  fields: {
    apiKeyPlaintext?: string | null;
    oauthAccessTokenPlaintext?: string | null;
    oauthRefreshTokenPlaintext?: string | null;
    oauthTokenExpiresAt?: string | null;
    authMethod?: string;
    tier?: 'free' | 'paid';
    /** Custom label for the key. Defaults to 'Default' when omitted. */
    keyLabel?: string | null;
  },
): void {
  const keyLabel = fields.keyLabel || 'Default';
  const existing = db
    .prepare(`SELECT id FROM provider_keys WHERE provider_id = ? AND label = ? LIMIT 1`)
    .get(providerId, keyLabel) as { id: string } | undefined;

  const apiKeyEncrypted =
    fields.apiKeyPlaintext != null && fields.apiKeyPlaintext !== ''
      ? encrypt(fields.apiKeyPlaintext)
      : undefined;
  const oauthAccessEncrypted =
    fields.oauthAccessTokenPlaintext != null && fields.oauthAccessTokenPlaintext !== ''
      ? encrypt(fields.oauthAccessTokenPlaintext)
      : undefined;
  const oauthRefreshEncrypted =
    fields.oauthRefreshTokenPlaintext != null && fields.oauthRefreshTokenPlaintext !== ''
      ? encrypt(fields.oauthRefreshTokenPlaintext)
      : undefined;

  if (existing) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (apiKeyEncrypted !== undefined) {
      sets.push('api_key_encrypted = ?');
      params.push(apiKeyEncrypted);
    }
    if (oauthAccessEncrypted !== undefined) {
      sets.push('oauth_access_token_encrypted = ?');
      params.push(oauthAccessEncrypted);
    }
    if (oauthRefreshEncrypted !== undefined) {
      sets.push('oauth_refresh_token_encrypted = ?');
      params.push(oauthRefreshEncrypted);
    }
    if (fields.oauthTokenExpiresAt !== undefined) {
      sets.push('oauth_token_expires_at = ?');
      params.push(fields.oauthTokenExpiresAt ?? null);
    }
    if (fields.authMethod !== undefined) {
      sets.push('auth_method = ?');
      params.push(fields.authMethod);
    }
    if (fields.tier !== undefined) {
      sets.push('tier = ?');
      params.push(fields.tier);
    }
    if (sets.length === 0) return;
    sets.push(`updated_at = datetime('now')`);
    params.push(existing.id);
    db.prepare(`UPDATE provider_keys SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  } else {
    const id = `${providerId}-${keyLabel.toLowerCase().replace(/\s+/g, '-')}`;
    db.prepare(
      `INSERT INTO provider_keys (
        id, provider_id, label, tier,
        api_key_encrypted, oauth_access_token_encrypted,
        oauth_refresh_token_encrypted, oauth_token_expires_at,
        auth_method, priority, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
    ).run(
      id,
      providerId,
      keyLabel,
      fields.tier ?? 'paid',
      apiKeyEncrypted ?? null,
      oauthAccessEncrypted ?? null,
      oauthRefreshEncrypted ?? null,
      fields.oauthTokenExpiresAt ?? null,
      fields.authMethod ?? 'api_key',
    );
  }
}

/**
 * Decrypt the active key for a provider. Used by the adapter hot path
 * (see server.ts runBackgroundInit) to get plaintext credentials out
 * of the new table. Falls back to the legacy config.apiKey column for
 * providers that haven't been migrated yet.
 */
/**
 * Every active API key for a provider, highest priority first.
 *
 * `loadActiveProviderCredential` deliberately returns a single credential, so
 * adapters used to receive exactly one key no matter how many the operator had
 * stored. That made `provider_keys` a pool in name only: rotation across the
 * vault never happened, and one exhausted free-tier key failed the request
 * instead of falling through to its siblings. Adapters take the full list via
 * `setKeys()` and rotate locally.
 */
export function loadAllActiveProviderKeys(providerId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT api_key_encrypted FROM provider_keys
       WHERE provider_id = ? AND is_active = 1 AND api_key_encrypted IS NOT NULL
       ORDER BY priority DESC, created_at ASC`,
    )
    .all(providerId) as Array<{ api_key_encrypted: string | null }>;

  const keys: string[] = [];
  for (const row of rows) {
    if (!row.api_key_encrypted) continue;
    try {
      const plain = decrypt(row.api_key_encrypted);
      if (plain) keys.push(plain);
    } catch {
      // A key encrypted under a rotated DMRX_ENCRYPTION_KEY is unusable —
      // skip it rather than failing every other key on the provider.
    }
  }
  return keys;
}

export function loadActiveProviderCredential(providerId: string): {
  apiKey: string;
  accessToken: string;
  authMethod: string;
} {
  const db = getDb();
  const active = getActiveKey(db, providerId);
  if (active) {
    return {
      apiKey: active.api_key_encrypted ? decrypt(active.api_key_encrypted) : '',
      accessToken: active.oauth_access_token_encrypted
        ? decrypt(active.oauth_access_token_encrypted)
        : '',
      authMethod: active.auth_method,
    };
  }
  // Legacy single-key fallback
  const row = db
    .prepare(
      `SELECT config, oauth_access_token, auth_method FROM providers WHERE id = ?`,
    )
    .get(providerId) as
    | { config: string; oauth_access_token: string | null; auth_method: string }
    | undefined;
  if (!row) return { apiKey: '', accessToken: '', authMethod: 'api_key' };
  let apiKey = '';
  try {
    const cfg = row.config ? JSON.parse(row.config) : {};
    apiKey = typeof cfg.apiKey === 'string' && cfg.apiKey ? decrypt(cfg.apiKey) : '';
  } catch {
    apiKey = '';
  }
  const accessToken = row.oauth_access_token ? decrypt(row.oauth_access_token) : '';
  return { apiKey, accessToken, authMethod: row.auth_method || 'api_key' };
}

/**
 * Check whether a provider has at least one active key (API key or OAuth token).
 * Used by the /admin/models endpoint to filter out models from providers
 * that can't actually be routed to.
 */
function providerHasActiveKeys(db: ReturnType<typeof getDb>, providerId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM provider_keys
       WHERE provider_id = ? AND is_active = 1
         AND (api_key_encrypted IS NOT NULL OR oauth_access_token_encrypted IS NOT NULL)
       LIMIT 1`,
    )
    .get(providerId);
  if (row) return true;

  // Legacy fallback: check config.apiKey or oauth_access_token on providers table
  const legacy = db
    .prepare(
      `SELECT config, oauth_access_token FROM providers WHERE id = ?`,
    )
    .get(providerId) as { config: string; oauth_access_token: string | null } | undefined;
  if (!legacy) return false;
  try {
    const cfg = JSON.parse(legacy.config || '{}');
    if (cfg.apiKey) return true;
  } catch { /* ignore */ }
  return !!legacy.oauth_access_token;
}

/**
 * Auto-discover models for a provider after a key is added.
 * Fetches the provider's /v1/models endpoint and upserts discovered
 * models into model_profiles. Only runs for OpenAI-compatible providers.
 * Enriches discovered models with catalog data (costs, context windows,
 * capabilities) when available.
 */
async function autoDiscoverModelsOnKeyAdd(
  db: ReturnType<typeof getDb>,
  providerId: string,
  providerName: string,
  baseUrl: string | undefined,
  apiKey?: string,
): Promise<void> {
  if (!baseUrl) return;

  const template = PROVIDER_CATALOG.find(t => t.id === providerName);
  const isOpenaiCompat = template?.apiFormat === 'openai' || providerName === 'google';
  if (!isOpenaiCompat) return;

  try {
    const discovered = await discoverOpenAIModels({ baseUrl, apiKey: apiKey || '' });
    if (discovered.length === 0) {
      logger.debug({ provider: providerName }, 'Auto-discovery: /v1/models returned empty');
      return;
    }

    // Enrich discovered models with catalog data (costs, context, capabilities)
    const catalogLookup = new Map<string, any>();
    for (const t of PROVIDER_CATALOG) {
      for (const m of t.models) {
        catalogLookup.set(`${t.id}/${m.id}`, m);
      }
    }
    const enriched = discovered.map(m => {
      const key = `${providerName}/${m.modelId}`;
      const tmpl = catalogLookup.get(key);
      if (!tmpl) return m;
      return {
        ...m,
        displayName: m.displayName || tmpl.id,
        modality: m.modality || tmpl.modalities[0] || 'llm',
        contextWindow: m.contextWindow ?? tmpl.contextWindow ?? null,
        maxOutputTokens: m.maxOutputTokens ?? tmpl.maxOutputTokens ?? null,
        inputCostPer1M: m.inputCostPer1M || tmpl.inputCostPer1M || 0,
        outputCostPer1M: m.outputCostPer1M || tmpl.outputCostPer1M || 0,
        costPerImage: m.costPerImage || tmpl.costPerImage || 0,
        capabilities: m.capabilities.length > 0 ? m.capabilities : tmpl.capabilities,
        specializations: m.specializations.length > 0 ? m.specializations : tmpl.specializations,
      };
    });

    const insert = db.prepare(
      `INSERT OR IGNORE INTO model_profiles (
        id, provider_id, model_id, display_name, modality, capability_tier,
        supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
        context_window, max_output_tokens,
        input_cost_per_1k, output_cost_per_1k, cost_per_image,
        quality_score, is_active,
        task_categories, context_tier, deployment, reasoning_mode, safety_tier, agentic_level, architecture
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let inserted = 0;
    for (const m of enriched) {
      if (!m.modelId) continue;
      const caps = new Set(m.capabilities);
      const result = insert.run(
        crypto.randomUUID(),
        providerId,
        m.modelId,
        m.displayName || m.modelId,
        m.modality || 'llm',
        'balanced',
        caps.has('streaming') ? 1 : 0,
        caps.has('vision') ? 1 : 0,
        caps.has('tool_use') ? 1 : 0,
        caps.has('json_mode') ? 1 : 0,
        caps.has('function_call') ? 1 : 0,
        caps.has('reasoning') ? 1 : 0,
        m.contextWindow,
        m.maxOutputTokens,
        m.inputCostPer1M / 1000,
        m.outputCostPer1M / 1000,
        m.costPerImage,
        0.5,
        1, // is_active = 1 since we just got a valid key
        JSON.stringify(['general']),
        'medium',
        'cloud',
        'fixed',
        'standard',
        'chat',
        'unknown',
      );
      if (result.changes > 0) inserted++;
    }

    if (inserted > 0) {
      logger.info({ provider: providerName, count: inserted }, 'Auto-discovered models after key add');
    }
  } catch (err) {
    logger.warn({ err, provider: providerName }, 'Auto-discovery failed after key add');
  }
}

/**
 * Mirror the legacy single-key columns (providers.config.apiKey and
 * providers.oauth_access_token / refresh / expires_at) into the
 * Default provider_keys row. Used by the OAuth flow endpoints that
 * update the providers table directly — without this call, the new
 * table would drift from the columns the adapter still reads at
 * startup until runBackgroundInit is re-run.
 */
function syncDefaultKeyFromProvidersTable(
  db: ReturnType<typeof getDb>,
  providerId: string,
): void {
  const row = db
    .prepare(
      `SELECT config, oauth_access_token, oauth_refresh_token, oauth_token_expires_at, auth_method, tier
       FROM providers WHERE id = ?`,
    )
    .get(providerId) as
    | {
        config: string | null;
        oauth_access_token: string | null;
        oauth_refresh_token: string | null;
        oauth_token_expires_at: string | null;
        auth_method: string | null;
        tier: string | null;
      }
    | undefined;
  if (!row) return;
  let apiKeyPlaintext: string | null = null;
  try {
    const cfg = row.config ? JSON.parse(row.config) : {};
    apiKeyPlaintext =
      typeof cfg.apiKey === 'string' && cfg.apiKey ? decrypt(cfg.apiKey) : null;
  } catch {
    apiKeyPlaintext = null;
  }
  upsertDefaultKey(db, providerId, {
    apiKeyPlaintext: apiKeyPlaintext ?? undefined,
    oauthAccessTokenPlaintext: row.oauth_access_token ? decrypt(row.oauth_access_token) : undefined,
    oauthRefreshTokenPlaintext: row.oauth_refresh_token ? decrypt(row.oauth_refresh_token) : undefined,
    oauthTokenExpiresAt: row.oauth_token_expires_at,
    authMethod: row.auth_method ?? undefined,
    tier: row.tier === 'free' ? 'free' : 'paid',
  });
}

export async function adminRoutes(server: FastifyInstance): Promise<void> {
  async function createApiKeyForTenant(
    tenantId: string,
    name: string | undefined,
    expiresAt?: string,
    compression?: { enabled?: boolean; algorithm?: string; reversible?: boolean },
  ) {
    const db = getDb();

    const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
      throw new ValidationError('Tenant not found');
    }

    const { generateApiKey, hashApiKeyWithSalt, hashApiKey } = await import('@dmr-x/utils');
    const apiKey = generateApiKey();
    const keyHash = hashApiKeyWithSalt(apiKey);
    const keyLookupHash = hashApiKey(apiKey);
    const id = crypto.randomUUID();

    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash, key_lookup_hash, name, expires_at, compression_enabled, compression_algorithm, compression_reversible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, tenantId, keyHash, keyLookupHash, name, expiresAt || null,
      compression?.enabled !== undefined ? (compression.enabled ? 1 : 0) : null,
      compression?.algorithm || null,
      compression?.reversible !== undefined ? (compression.reversible ? 1 : 0) : null,
    );

    const row = db.prepare(
      'SELECT id, tenant_id, name, created_at, expires_at, compression_enabled, compression_algorithm, compression_reversible FROM api_keys WHERE id = ?'
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
      key_label,
      tier: requestedTier,
    } = parsed.data;
    const template = PROVIDER_CATALOG.find(t => t.id === template_id);
    if (!template) {
      throw new ValidationError(`Template not found: ${template_id}`);
    }

    const db = getDb();
    const providerName = custom_name || template_id;
    let provider = db.prepare('SELECT * FROM providers WHERE name = ?').get(providerName) as any;

    // SSRF validation for base URL: resolve the host and reject private/
    // loopback/link-local IPs (see admin-ssrf.ts for the full rationale,
    // including DNS-rebinding protection). The returned lookup is unused
    // here because the activate path itself doesn't issue an outbound
    // fetch — but we still await it so the validation result is captured
    // before we persist the base URL.
    if (template.baseUrl) {
      await validateBaseUrlForSSRF(template.baseUrl);
    }

    const hasApiKey = !!api_key;
    const hasOAuthToken = !!oauth_access_token;
    const requestedAuthMethod = auth_method || (hasOAuthToken ? 'oauth' : 'api_key');
    const needsNoKey = template.envKey === '';
    const shouldActivateModels = hasApiKey || hasOAuthToken || needsNoKey;
    const encryptedOAuthAccessToken = oauth_access_token ? encrypt(oauth_access_token) : null;
    const encryptedOAuthRefreshToken = oauth_refresh_token ? encrypt(oauth_refresh_token) : null;

    // Tier for the *new* key. Caller-supplied tier wins; otherwise we
    // derive from the catalog: a template is "free" if every model has
    // a freeTier block, "paid" otherwise. This is the same heuristic
    // the migration used to backfill legacy rows, so the catalog and
    // the live DB stay consistent.
    const derivedTier: 'free' | 'paid' =
      template.models.length > 0 && template.models.every((m) => !!m.freeTier)
        ? 'free'
        : 'paid';
    const keyTier: 'free' | 'paid' = requestedTier ?? derivedTier;

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

      // Mirror the new credential into provider_keys (idempotent for
      // the "Default" row). The legacy config.apiKey column above is
      // kept in sync so the existing single-key code paths (test,
      // runBackgroundInit) keep working until they're fully migrated.
      if (api_key || oauth_access_token) {
        upsertDefaultKey(db, provider.id, {
          apiKeyPlaintext: api_key,
          oauthAccessTokenPlaintext: oauth_access_token,
          oauthRefreshTokenPlaintext: oauth_refresh_token,
          oauthTokenExpiresAt: oauth_token_expires_at,
          authMethod: requestedAuthMethod,
          tier: keyTier,
          keyLabel: key_label,
        });
      }
      recomputeProviderTier(db, provider.id);

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
          oauth_access_token, oauth_refresh_token, oauth_token_expires_at, auth_method,
          tier
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        keyTier,
      );
      provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);

      // Mirror the credential into provider_keys. Without this row the
      // candidate query would still see the provider (model_profiles
      // is_active = 1) but the active-key lookup in
      // loadActiveProviderCredential would fall through to the legacy
      // config.apiKey path. We write both so the new code can be the
      // source of truth going forward.
      if (api_key || oauth_access_token) {
        upsertDefaultKey(db, id, {
          apiKeyPlaintext: api_key,
          oauthAccessTokenPlaintext: oauth_access_token,
          oauthRefreshTokenPlaintext: oauth_refresh_token,
          oauthTokenExpiresAt: oauth_token_expires_at,
          authMethod: requestedAuthMethod,
          tier: keyTier,
          keyLabel: key_label,
        });
      }
      recomputeProviderTier(db, id);

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
          model.contextWindow ?? null,
          model.maxOutputTokens ?? null,
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

    // Auto-discover models if an API key was provided
    if (api_key) {
      void autoDiscoverModelsOnKeyAdd(db, provider.id, providerName, template.baseUrl, api_key);
    }

    // Hybrid: also persist the key to .env so it survives DB corruption
    if (api_key) {
      syncApiKeyToEnvFile(providerName, api_key);
    }

    reply.status(200);
    const providerConfig = JSON.parse(provider.config || '{}');
    const refreshed = db.prepare('SELECT * FROM providers WHERE id = ?').get(provider.id) as any;
    return {
      success: true,
      provider: {
        ...refreshed,
        config: { ...providerConfig, apiKey: undefined, hasKey: !!providerConfig.apiKey },
        keys: listProviderKeys(db, provider.id),
      },
    };
  });

  // List providers
  server.get('/admin/providers', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM providers ORDER BY name').all() as any[];
    // Local providers are those that are keyless (the only kind that runs
    // on the operator's own box) or point at a loopback URL. The UI's
    // Providers.tsx filters on `p.local` to drive the "Local" badge, so
    // we surface it on the wire rather than making the client re-derive
    // it from the adapter type.
    const localAdapterTypes = new Set(['ollama', 'llamacpp', 'vllm', 'comfyui']);
    const isLocalUrl = (url: string | null | undefined): boolean => {
      if (!url) return false;
      return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url);
    };

    // Pre-fetch model counts per provider so the UI can display "N models"
    // without a separate query per card.
    const countRows = db.prepare(
      'SELECT provider_id, COUNT(*) as cnt FROM model_profiles WHERE is_active = 1 GROUP BY provider_id'
    ).all() as Array<{ provider_id: string; cnt: number }>;
    const modelCounts = new Map<string, number>();
    for (const r of countRows) modelCounts.set(r.provider_id, r.cnt);

    const providers = rows.map((row) => {
      const config = JSON.parse(row.config || '{}');
      const { apiKey: _stripped, ...safeConfig } = config;
      // Strip api_key_ref too: the column is treated as an env-var NAME
      // by the server, but the form-driven createProvider path used to
      // store the literal key there. Exposing it would leak any key
      // a user typed into the dialog. The client only needs hasKey.
      const { api_key_ref: _ref, ...rowWithoutKey } = row;
      const local = localAdapterTypes.has(row.adapter_type) || isLocalUrl(row.base_url);
      const keys = listProviderKeys(db, row.id);
      // Derive hasKey from the keys table when present so a stale
      // config.hasKey from a legacy row doesn't lie about credential
      // state. Falls back to the legacy columns for the brief window
      // between the migration running and the first key being added.
      const hasAnyKey =
        keys.some((k) => k.has_api_key || k.has_oauth_token) ||
        !!config.apiKey ||
        !!row.oauth_access_token;
      return {
        ...rowWithoutKey,
        config: safeConfig,
        status: row.is_healthy ? 'healthy' : 'unavailable',
        hasKey: hasAnyKey,
        hasOAuthToken: !!row.oauth_access_token,
        authMethod: row.auth_method || 'api_key',
        oauthTokenExpiresAt: row.oauth_token_expires_at || null,
        signupUrl: config.signupUrl || undefined,
        description: config.description || undefined,
        category: config.category || [],
        region: config.region || undefined,
        priority: typeof config.priority === 'number' ? config.priority : 0,
        enabled: typeof config.enabled === 'boolean' ? config.enabled : true,
        local,
        tier: row.tier || 'inactive',
        keys,
        modelCount: modelCounts.get(row.id) ?? 0,
      };
    });
    return { providers };
  });

  // Get single provider. Mirrors the normalization the list endpoint
  // applies so the response shape matches (hasKey, status, local, …).
  server.get('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!row) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }
    const localAdapterTypes = new Set(['ollama', 'llamacpp', 'vllm', 'comfyui']);
    const isLocalUrl = (url: string | null | undefined): boolean => {
      if (!url) return false;
      return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url);
    };
    const config = JSON.parse(row.config || '{}');
    const { apiKey: _stripped, ...safeConfig } = config;
    const { api_key_ref: _ref, ...rowWithoutKey } = row;
    const local = localAdapterTypes.has(row.adapter_type) || isLocalUrl(row.base_url);
    const keys = listProviderKeys(db, id);
    const hasAnyKey =
      keys.some((k) => k.has_api_key || k.has_oauth_token) ||
      !!config.apiKey ||
      !!row.oauth_access_token;
    return {
      ...rowWithoutKey,
      config: safeConfig,
      status: row.is_healthy ? 'healthy' : 'unavailable',
      hasKey: hasAnyKey,
      hasOAuthToken: !!row.oauth_access_token,
      authMethod: row.auth_method || 'api_key',
      oauthTokenExpiresAt: row.oauth_token_expires_at || null,
      signupUrl: config.signupUrl || undefined,
      description: config.description || undefined,
      category: config.category || [],
      region: config.region || undefined,
      priority: typeof config.priority === 'number' ? config.priority : 0,
      enabled: typeof config.enabled === 'boolean' ? config.enabled : true,
      local,
      tier: row.tier || 'inactive',
      keys,
    };
  });

  // Update provider API key
  server.put('/admin/providers/:id/api-key', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { api_key, tier: requestedTier } = parsed.data;

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

    // Mirror into provider_keys. The legacy config.apiKey column is
    // kept in sync above so the existing single-key code paths (test,
    // runBackgroundInit) keep working until they're fully migrated.
    // Tier defaults to 'paid' when not supplied — see the schema comment.
    upsertDefaultKey(db, id, {
      apiKeyPlaintext: api_key,
      authMethod: 'api_key',
      tier: requestedTier,
    });
    recomputeProviderTier(db, id);

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

    // Auto-discover models if a new key was provided
    if (api_key) {
      void autoDiscoverModelsOnKeyAdd(db, id, provider.name, provider.base_url ?? undefined, api_key);
    }

    // Hybrid: also persist the key to .env so it survives DB corruption
    if (api_key) {
      syncApiKeyToEnvFile(provider.name, api_key);
    }

    const updatedRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    const updatedConfig = JSON.parse(updatedRow.config || '{}');
    return {
      success: true,
      provider: {
        ...updatedRow,
        config: { ...updatedConfig, apiKey: undefined, hasKey: !!updatedConfig.apiKey },
        keys: listProviderKeys(db, id),
      },
    };
  });

  // ─── Multi-Key Management ────────────────────────────────────────
  //
  // A provider can carry several keys. The activate / api-key endpoints
  // always touch the "Default" key; these endpoints manage the rest.
  // The UI uses them from the provider detail drawer to attach a
  // second (or third) key without disturbing the primary.

  // List keys for a single provider
  server.get('/admin/providers/:id/keys', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const provider = db.prepare('SELECT id FROM providers WHERE id = ?').get(id);
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }
    return { keys: listProviderKeys(db, id) };
  });

  // Add a new key to a provider
  server.post('/admin/providers/:id/keys', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddProviderKeySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const db = getDb();
    const provider = db.prepare('SELECT id, name, base_url, adapter_type FROM providers WHERE id = ?').get(id) as
      | { id: string; name: string; base_url: string | null; adapter_type: string }
      | undefined;
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }

    const body = parsed.data;
    const authMethod = body.auth_method || (body.oauth_access_token ? 'oauth' : 'api_key');
    const keyId = crypto.randomUUID();

    // Auto-label keys "Key 2", "Key 3", … so the operator doesn't have
    // to think about it. The "Default" label is reserved for the
    // activate/api-key path; we never overwrite it here.
    const existingLabels = db
      .prepare(`SELECT label FROM provider_keys WHERE provider_id = ?`)
      .all(id) as Array<{ label: string | null }>;
    const numericLabels = existingLabels
      .map((l) => (l.label ?? '').match(/^Key (\d+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => Number(m[1]));
    const nextNumber = numericLabels.length > 0 ? Math.max(...numericLabels) + 1 : 2;
    const label = body.label ?? (numericLabels.length === 0 && !existingLabels.some((l) => l.label === 'Default') ? 'Default' : `Key ${nextNumber}`);

    db.prepare(
      `INSERT INTO provider_keys (
        id, provider_id, label, tier,
        api_key_encrypted, oauth_access_token_encrypted,
        oauth_refresh_token_encrypted, oauth_token_expires_at,
        auth_method, priority, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      keyId,
      id,
      label,
      body.tier,
      body.api_key ? encrypt(body.api_key) : null,
      body.oauth_access_token ? encrypt(body.oauth_access_token) : null,
      body.oauth_refresh_token ? encrypt(body.oauth_refresh_token) : null,
      body.oauth_token_expires_at ?? null,
      authMethod,
      body.priority,
    );

    // Tier may have changed (e.g. adding a free key to a paid provider
    // flips it to 'mixed'). Recompute and refresh adapter.
    recomputeProviderTier(db, id);

    // Re-initialize the adapter with the new active key (highest
    // priority active row). The user-visible "Active" badge in the
    // drawer won't change behaviour for existing routed calls — the
    // active key is still whichever has the highest priority — but
    // future calls will use the new key.
    const adapterRegistry = (server as any).adapterRegistry;
    const active = getActiveKey(db, id);
    if (adapterRegistry && active && provider.base_url) {
      try {
        await adapterRegistry.initialize(provider.name, {
          baseUrl: provider.base_url,
          apiKey: active.api_key_encrypted ? decrypt(active.api_key_encrypted) : '',
          accessToken: active.oauth_access_token_encrypted
            ? decrypt(active.oauth_access_token_encrypted)
            : undefined,
          authMethod: active.auth_method,
        });
      } catch (err) {
        logger.warn({ err, provider: provider.name }, 'Adapter re-init failed after adding key');
      }
    }

    const refreshCandidates = (server as any).refreshCandidates;
    if (refreshCandidates) await refreshCandidates();

    // Auto-discover models for this provider now that it has a valid key.
    // This populates model_profiles with models from the provider's /v1/models
    // endpoint so they appear in the Playground and Models page immediately.
    if (body.api_key) {
      void autoDiscoverModelsOnKeyAdd(db, id, provider.name, provider.base_url ?? undefined, body.api_key);
    }

    reply.status(201);
    return { success: true, key: toProviderKeyView(db.prepare('SELECT * FROM provider_keys WHERE id = ?').get(keyId) as ProviderKeyRow) };
  });

  // Update / rotate a single key. Use this for credential rotation
  // and to flip the active flag (decommission a key without deleting).
  server.put('/admin/providers/:id/keys/:keyId', async (request, reply) => {
    const { id, keyId } = request.params as { id: string; keyId: string };
    const parsed = RotateProviderKeySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const db = getDb();
    const existing = db
      .prepare(`SELECT * FROM provider_keys WHERE id = ? AND provider_id = ?`)
      .get(keyId, id) as ProviderKeyRow | undefined;
    if (!existing) {
      reply.status(404);
      return { error: { message: 'Key not found', type: 'not_found', code: 'provider_key_not_found' } };
    }

    const body = parsed.data;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.label !== undefined) { sets.push('label = ?'); params.push(body.label); }
    if (body.tier !== undefined) { sets.push('tier = ?'); params.push(body.tier); }
    if (body.api_key !== undefined) {
      sets.push('api_key_encrypted = ?');
      params.push(body.api_key ? encrypt(body.api_key) : null);
    }
    if (body.oauth_access_token !== undefined) {
      sets.push('oauth_access_token_encrypted = ?');
      params.push(body.oauth_access_token ? encrypt(body.oauth_access_token) : null);
    }
    if (body.oauth_refresh_token !== undefined) {
      sets.push('oauth_refresh_token_encrypted = ?');
      params.push(body.oauth_refresh_token ? encrypt(body.oauth_refresh_token) : null);
    }
    if (body.oauth_token_expires_at !== undefined) {
      sets.push('oauth_token_expires_at = ?');
      params.push(body.oauth_token_expires_at);
    }
    if (body.auth_method !== undefined) {
      sets.push('auth_method = ?');
      params.push(body.auth_method);
    }
    if (body.priority !== undefined) {
      sets.push('priority = ?');
      params.push(body.priority);
    }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(body.is_active ? 1 : 0);
    }
    if (sets.length === 0) {
      return { success: true, key: toProviderKeyView(existing) };
    }
    sets.push(`updated_at = datetime('now')`);
    params.push(keyId);
    db.prepare(`UPDATE provider_keys SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    recomputeProviderTier(db, id);

    // Key deactivation no longer touches model_profiles.is_active.
    // The `available_only` filter in /admin/models already hides models
    // from providers without active keys, so deactivating them here
    // would erase user-added models that should persist.

    // Re-initialize adapter if the active key changed. A change to
    // priority, is_active, or credentials of the currently-active key
    // all require this.
    const provider = db.prepare('SELECT name, base_url FROM providers WHERE id = ?').get(id) as
      | { name: string; base_url: string | null }
      | undefined;
    const adapterRegistry = (server as any).adapterRegistry;
    const active = getActiveKey(db, id);
    if (adapterRegistry && provider && active && provider.base_url) {
      try {
        await adapterRegistry.initialize(provider.name, {
          baseUrl: provider.base_url,
          apiKey: active.api_key_encrypted ? decrypt(active.api_key_encrypted) : '',
          accessToken: active.oauth_access_token_encrypted
            ? decrypt(active.oauth_access_token_encrypted)
            : undefined,
          authMethod: active.auth_method,
        });
      } catch (err) {
        logger.warn({ err, provider: provider.name }, 'Adapter re-init failed after rotating key');
      }
    }

    const refreshCandidates = (server as any).refreshCandidates;
    if (refreshCandidates) await refreshCandidates();

    const updated = db.prepare('SELECT * FROM provider_keys WHERE id = ?').get(keyId) as ProviderKeyRow;
    return { success: true, key: toProviderKeyView(updated) };
  });

  // Remove a key. Refuses to delete the last active key on the
  // provider — that's almost always a footgun (the next request would
  // fail with no credentials). The operator can deactivate first
  // (`PUT ... with is_active: false`) and then delete, or use the
  // delete-provider endpoint to remove everything at once.
  server.delete('/admin/providers/:id/keys/:keyId', async (request, reply) => {
    const { id, keyId } = request.params as { id: string; keyId: string };
    const db = getDb();
    const existing = db
      .prepare(`SELECT id, is_active FROM provider_keys WHERE id = ? AND provider_id = ?`)
      .get(keyId, id) as { id: string; is_active: number } | undefined;
    if (!existing) {
      reply.status(404);
      return { error: { message: 'Key not found', type: 'not_found', code: 'provider_key_not_found' } };
    }

    if (existing.is_active === 1) {
      const activeCount = db
        .prepare(`SELECT COUNT(*) as c FROM provider_keys WHERE provider_id = ? AND is_active = 1`)
        .get(id) as { c: number };
      if (activeCount.c <= 1) {
        reply.status(409);
        return {
          error: {
            message: 'Cannot remove the last active key — deactivate it first, or delete the provider.',
            type: 'validation',
            code: 'last_active_key',
          },
        };
      }
    }

    db.prepare(`DELETE FROM provider_keys WHERE id = ?`).run(keyId);
    recomputeProviderTier(db, id);

    // Model deactivation removed — the `available_only` filter in
    // /admin/models already hides models from providers without active keys.

    const refreshCandidates = (server as any).refreshCandidates;
    if (refreshCandidates) await refreshCandidates();

    return { success: true };
  });

  // Test a specific provider key by its ID. Unlike the provider-level
  // test endpoint (which decrypts the default key from providers.config),
  // this endpoint decrypts the specific key from the provider_keys table
  // and runs the connectivity test against it. This lets the operator
  // verify each credential independently, which is essential when a
  // provider has multiple keys (free + paid, or rotated keys).
  server.post('/admin/providers/:id/keys/:keyId/test', async (request, reply) => {
    const { id, keyId } = request.params as { id: string; keyId: string };
    const db = getDb();

    // 1. Validate the provider exists
    const provider = db.prepare('SELECT id, name, base_url FROM providers WHERE id = ?').get(id) as
      | { id: string; name: string; base_url: string | null }
      | undefined;
    if (!provider) {
      reply.status(404);
      return { error: { message: 'Provider not found', type: 'not_found', code: 'provider_not_found' } };
    }
    if (!provider.base_url) {
      reply.status(400);
      return { error: { message: 'Provider has no base_url configured', type: 'validation', code: 'no_base_url' } };
    }

    // 2b. Pick a real model to probe with: prefer the provider's first
    // active free model (so gateways that only allow specific models, e.g.
    // gitlawb OpenGateway which rejects the dummy "test" model, are probed
    // with a model they actually serve). Fall back to "test" if none found.
    // tier/is_free may be NULL for catalog-inherited rows, so also accept a
    // model_id that is explicitly a known free model.
    const probeModelRow = db
      .prepare(
        `SELECT model_id FROM model_profiles
         WHERE provider_id = ? AND is_active = 1
           AND model_id LIKE '%:free'
         LIMIT 1`,
      )
      .get(id) as { model_id: string } | undefined;
    const probeModel = probeModelRow?.model_id || 'test';

    // 2. Fetch the specific key row
    const keyRow = db.prepare('SELECT * FROM provider_keys WHERE id = ? AND provider_id = ?').get(keyId, id) as
      | ProviderKeyRow
      | undefined;
    if (!keyRow) {
      reply.status(404);
      return { error: { message: 'Key not found', type: 'not_found', code: 'provider_key_not_found' } };
    }

    // 3. Decrypt the key's credential
    let apiKey = '';
    if (keyRow.api_key_encrypted) {
      try {
        apiKey = decrypt(keyRow.api_key_encrypted);
      } catch {
        apiKey = '';
      }
    }
    if (!apiKey && keyRow.oauth_access_token_encrypted) {
      try {
        apiKey = decrypt(keyRow.oauth_access_token_encrypted);
      } catch {
        apiKey = keyRow.oauth_access_token_encrypted;
      }
    }

    const baseUrl = provider.base_url;

    // 4. SSRF validation
    let validated: ValidatedURL;
    try {
      validated = await validateBaseUrlForSSRF(baseUrl);
    } catch (err) {
      return {
        ok: false,
        latencyMs: 0,
        key_id: keyId,
        error: err instanceof Error ? err.message : 'SSRF validation failed',
      };
    }
    const ssrfDispatcher = new Agent({ connect: { lookup: validated.lookup } });

    // 5. Run connectivity test (same logic as the provider-level test)
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // Try /models first (works for most OpenAI-compatible providers)
      let response = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: controller.signal,
        redirect: 'error',
        dispatcher: ssrfDispatcher,
      });

      // If /models does not succeed (404 path-missing OR 400/403 account-level
      // errors such as insufficient_quota), fall through to a minimal
      // /chat/completions probe. Many OpenAI-compatible gateways (e.g. gitlawb
      // OpenGateway) reject GET /models with a 400 yet serve chat fine, so we
      // must not treat a non-404 /models failure as a hard failure.
      if (!response.ok) {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: probeModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
          signal: controller.signal,
          redirect: 'error',
          dispatcher: ssrfDispatcher,
        });
      }

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (response.ok) {
        return { ok: true, latencyMs, key_id: keyId };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          latencyMs,
          key_id: keyId,
          error: `Invalid API key (HTTP ${response.status})`,
        };
      }

      return {
        ok: false,
        latencyMs,
        key_id: keyId,
        error: `Provider returned HTTP ${response.status}`,
      };
    } catch (error: unknown) {
      const latencyMs = Date.now() - start;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ err: error, provider: provider.name, key_id: keyId }, 'Per-key provider test error');

      return {
        ok: false,
        latencyMs,
        key_id: keyId,
        error: msg.includes('abort') ? 'Connection timed out (10s)' : 'Connection failed',
      };
    }
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

        // Mirror OAuth tokens into the default provider_keys row.
        syncDefaultKeyFromProvidersTable(db, id);
        recomputeProviderTier(db, id);

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
        // Use the real `PORT` env var (read in main.ts:139), not the
        // phantom `DMRX_PORT` that nothing sets — non-default deployments
        // were getting silently-wrong OAuth callback URLs (CRIT-3).
        const gatewayBaseUrl = `${request.protocol}://${request.hostname}:${process.env.PORT || 3000}`;
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
      // CRIT-3: use `PORT` (the real env var, read in main.ts:139) instead
      // of the phantom `DMRX_PORT` that nothing set.
      const gatewayBaseUrl = `${request.protocol}://${request.hostname}:${process.env.PORT || 3000}`;
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

      // Mirror the OAuth tokens into the default provider_keys row.
      syncDefaultKeyFromProvidersTable(db, id);
      recomputeProviderTier(db, id);

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
      // CRIT-3: use `PORT` (the real env var, read in main.ts:139) instead
      // of the phantom `DMRX_PORT` that nothing set.
      const gatewayBaseUrl = `${request.protocol}://${request.hostname}:${process.env.PORT || 3000}`;
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

      // Mirror the OAuth tokens into the default provider_keys row.
      syncDefaultKeyFromProvidersTable(db, id);
      recomputeProviderTier(db, id);

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
            <p>${escapeHtml(provider.name)} has been connected via OAuth.</p>
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
            <p>${escapeHtml(err instanceof Error ? err.message : 'OAuth exchange failed')}</p>
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

      // Mirror the refreshed tokens into the default provider_keys row
      // so the new table stays the source of truth.
      syncDefaultKeyFromProvidersTable(db, id);
      recomputeProviderTier(db, id);

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

      // Mirror the OAuth tokens into the default provider_keys row.
      syncDefaultKeyFromProvidersTable(db, id);
      recomputeProviderTier(db, id);

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

    const { provider_id } = parsed.data;
    let { base_url, api_key } = parsed.data;
    const db = getDb();

    // When the client didn't supply explicit credentials, look them up from
    // the providers table. The API key is stored encrypted in config.apiKey
    // (see CreateProviderSchema) so we decrypt before forwarding.
    if (!base_url || !api_key) {
      const row = db.prepare('SELECT base_url, config, oauth_access_token, auth_method, api_key_ref FROM providers WHERE id = ?').get(provider_id) as any;
      if (!row) {
        throw new ValidationError(`Provider not found: ${provider_id}`);
      }
      if (!base_url) base_url = row.base_url;
      if (!api_key) {
        // A fresh env var (api_key_ref, e.g. MISTRAL_API_KEY) takes
        // precedence over a persisted/possibly-stale DB key, so an operator
        // can refresh the key in .env without overwriting the DB value.
        const envVar = row.api_key_ref ? process.env[row.api_key_ref] : undefined;
        if (envVar) {
          api_key = envVar;
        } else {
          const cfg = row.config ? JSON.parse(row.config) : {};
          const stored = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
          api_key = stored ? decrypt(stored) : '';
          // OAuth tokens are also accepted: they authenticate the same way to
          // OpenAI-compatible upstreams, so a stored bearer works as well.
          if (!api_key && row.oauth_access_token) {
            try {
              api_key = decrypt(row.oauth_access_token);
            } catch {
              api_key = row.oauth_access_token;
            }
          }
        }
      }
    }

    if (!base_url) {
      throw new ValidationError('Provider has no base_url configured');
    }
    // SSRF protection: resolve the host, reject private/loopback/link-local
    // IPs, and capture a `lookup` that pins the outbound connection to the
    // validated IP — preventing a DNS-rebinding attack where the host
    // resolves to a public IP at validation time and `127.0.0.1` at fetch
    // time. See admin-ssrf.ts for the full rationale.
    const validated: ValidatedURL = await validateBaseUrlForSSRF(base_url);
    const ssrfDispatcher = new Agent({ connect: { lookup: validated.lookup } });
    // api_key is allowed to be empty for keyless providers (e.g. local ollama).
    // The fetch below still runs to verify reachability.

    const start = Date.now();

    // Probe with a real model when falling back to chat (gitlawb OpenGateway
    // rejects the dummy "test" model). Prefer an active free model from
    // model_profiles; fall back to "test".
    const probeRow = db
      .prepare(
        `SELECT model_id FROM model_profiles
         WHERE provider_id = ? AND is_active = 1
           AND model_id LIKE '%:free'
         LIMIT 1`,
      )
      .get(provider_id) as { model_id: string } | undefined;
    const probeModel = probeRow?.model_id || 'test';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // Try /models endpoint first (works for most OpenAI-compatible providers)
      // redirect: 'error' prevents SSRF via open redirects
      let response = await fetch(`${base_url}/models`, {
        headers: api_key ? { 'Authorization': `Bearer ${api_key}` } : {},
        signal: controller.signal,
        redirect: 'error',
        dispatcher: ssrfDispatcher,
      });

      // If /models fails, try /chat/completions with a minimal request
      if (!response.ok && response.status === 404) {
        response = await fetch(`${base_url}/chat/completions`, {
          method: 'POST',
          headers: {
            ...(api_key ? { 'Authorization': `Bearer ${api_key}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: probeModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
          signal: controller.signal,
          redirect: 'error',
          dispatcher: ssrfDispatcher,
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

    // Issue #9: SSRF validation on base_url — resolve the host, reject
    // private/loopback/link-local IPs, and (if a fetch follows) pin the
    // connection to the validated IP via the returned `lookup`.
    if (body.base_url) {
      await validateBaseUrlForSSRF(body.base_url);
    }

    // The user provided an API key in the dialog. The dialog has no way to
    // know which env-var the gateway reads for this provider, so it sends
    // The user provided an API key in the dialog. The dialog has no way to
    // know which env-var the gateway reads for this provider, so it sends
    // the literal key as `api_key_ref`. The gateway, however, reads
    // `api_key_ref` as an *environment-variable name* (server.ts:793
    // does `process.env[row.api_key_ref]`), not the key itself. If we
    // store the literal key there, the adapter ends up initialized with
    // an empty bearer and every upstream call 401s.
    //
    // Fix: promote the literal key into `config.apiKey` (which IS read
    // directly) and encrypt it before storage. Leave the column null.
    // If a future caller genuinely wants to reference an env-var they
    // can pass it via config.apiKeyRef and we'll keep that path open.
    const userConfig: Record<string, unknown> = { ...(body.config || {}) };
    if (body.api_key_ref && !userConfig.apiKey) {
      userConfig.apiKey = body.api_key_ref;
      userConfig.hasKey = true;
    }
    // Merge UI form fields that have no dedicated table column into the
    // config JSON blob. The list/get routes surface them back to the UI
    // from there (Providers.tsx reads p.region, p.priority, p.enabled).
    if (body.region != null) userConfig.region = body.region;
    if (body.priority != null) userConfig.priority = body.priority;
    if (body.enabled != null) userConfig.enabled = body.enabled;
    // Issue #2: Encrypt any apiKey in config before storing
    const configToStore = encryptConfigApiKey(userConfig);

    const db = getDb();
    const id = crypto.randomUUID();

    try {
      db.prepare(
        `INSERT INTO providers (id, name, adapter_type, base_url, api_key_ref, config, tier)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        body.name,
        body.adapter_type,
        body.base_url ?? null,
        null, // see comment above — literal keys are stored encrypted in config
        JSON.stringify(configToStore),
        // Tier from the request body; defaults to 'paid' in the schema
        // for backward compat. The Free Tier page passes 'free' explicitly.
        body.tier,
      );
    } catch (err) {
      // Surface the "name already exists" case as a 409 instead of a 500.
      // The `name` column is UNIQUE; sql.js throws "SqliteError: UNIQUE
      // constraint failed: providers.name" on the second INSERT.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE constraint failed: providers.name')) {
        throw new ValidationError(`A provider named "${body.name}" already exists. Pick a different name or delete the existing one.`);
      }
      // Other DB errors (NOT NULL, FK, etc.) → re-raise so the error
      // handler logs the underlying cause. The user still sees "Request
      // failed: 500", but at least the gateway log carries the detail.
      throw err;
    }

    // Mirror the literal key into provider_keys so the new table is
    // the source of truth. The legacy config.apiKey column above is
    // kept in sync for the same back-compat reason as the activate
    // flow — until every credential lookup is migrated, both paths
    // must agree.
    if (body.api_key_ref) {
      upsertDefaultKey(db, id, {
        apiKeyPlaintext: body.api_key_ref,
        authMethod: 'api_key',
        tier: body.tier,
      });
    }
    recomputeProviderTier(db, id);

    // Hybrid: also persist the key to .env so it survives DB corruption
    if (body.api_key_ref) {
      syncApiKeyToEnvFile(body.name, body.api_key_ref);
    }

    reply.status(201);
    const created = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    const createdCfg = JSON.parse(created.config || '{}');

    // Register + initialize the adapter in the in-memory registry so the
    // new provider is routable immediately. The catalog `activateProvider`
    // path does this, but the form-driven createProvider path used to
    // skip it — leaving the row in the DB but with no live adapter, so
    // every chat request failed with "Adapter not found: <uuid>".
    const adapterRegistry = (server as any).adapterRegistry;
    if (adapterRegistry) {
      let adapter = adapterRegistry.get(body.name);
      if (!adapter && (body.adapter_type === 'openai' || body.adapter_type === 'generic-openai')) {
        try {
          const { GenericOpenAIAdapter } = await import('@dmr-x/adapters');
          adapter = new GenericOpenAIAdapter(body.name);
          adapterRegistry.register(adapter);
        } catch (err) {
          logger.warn({ err, provider: body.name }, 'Failed to register GenericOpenAIAdapter for new provider');
        }
      }
      if (adapter) {
        try {
          await adapterRegistry.initialize(body.name, {
            baseUrl: body.base_url || '',
            apiKey: createdCfg.apiKey || '',
          });
        } catch (err) {
          logger.warn({ err, provider: body.name }, 'Failed to initialize adapter for new provider');
        }
      }
    }

    // The form-driven createProvider flow has no UI for adding models.
    // Without a row in model_profiles the provider is invisible to the
    // router (candidates query joins on model_profiles). For any
    // OpenAI-compatible baseUrl, eagerly discover models from /v1/models
    // so the new provider is routable immediately. Failures here are
    // non-fatal — the user can always add models manually later.
    if (body.base_url) {
      try {
        const { discoverOpenAIModels } = await import('@dmr-x/registry');
        // Give the upstream enough time to respond. The auto-register
        // path uses the 1s default because it polls the entire catalog
        // in parallel and a slow provider would block everyone else.
        // Here we're discovering exactly one provider in response to a
        // user action, so 15s is reasonable.
        const discovered = await discoverOpenAIModels({
          baseUrl: body.base_url,
          apiKey: createdCfg.apiKey || '',
          timeoutMs: 15_000,
        });
        if (discovered.length > 0) {
          const insertModel = db.prepare(
            `INSERT OR IGNORE INTO model_profiles (
              id, provider_id, model_id, display_name, modality, capability_tier,
              supports_streaming, supports_vision, supports_tool_use, supports_json_mode,
              context_window, max_output_tokens,
              input_cost_per_1k, output_cost_per_1k, cost_per_image,
              quality_score, is_active,
              task_categories, context_tier, deployment, reasoning_mode, safety_tier, agentic_level, architecture
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          let inserted = 0;
          for (const m of discovered) {
            const caps = new Set(m.capabilities || []);
            insertModel.run(
              crypto.randomUUID(),
              id,
              m.modelId,
              m.displayName || m.modelId,
              m.modality || 'llm',
              'balanced',
              caps.has('streaming') ? 1 : 0,
              caps.has('vision') ? 1 : 0,
              caps.has('tool_use') ? 1 : 0,
              caps.has('json_mode') ? 1 : 0,
              m.contextWindow ?? null,
              m.maxOutputTokens ?? null,
              (m.inputCostPer1M || 0) / 1000,
              (m.outputCostPer1M || 0) / 1000,
              m.costPerImage || 0,
              0.5,
              1,
              JSON.stringify(['general']),
              'medium',
              'cloud',
              'fixed',
              'standard',
              'chat',
              'unknown',
            );
            inserted++;
          }
          if (inserted > 0) {
            logger.info({ provider: body.name, inserted }, 'Auto-discovered models for new provider');
            // Refresh the routing candidate set so the new models are
            // routable without a gateway restart.
            const refreshCandidates = (server as any).refreshCandidates;
            if (refreshCandidates) await refreshCandidates();
          }
        }
      } catch (err) {
        logger.warn({ err, provider: body.name }, 'Model discovery failed for new provider');
      }
    }

    // Audit log for provider creation
    logAdminAction(request, 'create', 'provider', id, {
      name: body.name,
      adapter_type: body.adapter_type,
      has_base_url: !!body.base_url,
    });

    return {
      ...created,
      config: { ...createdCfg, apiKey: undefined, hasKey: !!createdCfg.apiKey },
      keys: listProviderKeys(db, id),
    };
  });

  // List models — optionally filtered to only models from providers with
  // active keys (or keyless providers like Pollinations). The `available_only`
  // query param defaults to `true` so the UI only sees models it can actually
  // route to. Pass `available_only=false` to see the full catalogue.
  server.get('/admin/models', async (request) => {
    const { available_only } = request.query as { available_only?: string };
    const onlyAvailable = available_only !== 'false'; // default true

    const db = getDb();

    if (onlyAvailable) {
      // Only return models whose provider has at least one active key
      // OR is keyless (envKey === '' in the catalog, e.g. Pollinations).
      const rows = db.prepare(
        `SELECT mp.*, p.name as provider_name,
                CASE
                  WHEN p.tier = 'inactive' THEN 0
                  ELSE 1
                END as provider_available
         FROM model_profiles mp
         JOIN providers p ON p.id = mp.provider_id
         WHERE mp.is_active = 1
           AND (
             p.is_healthy = 1
             OR EXISTS (SELECT 1 FROM provider_keys pk WHERE pk.provider_id = p.id AND pk.is_active = 1)
           )
         ORDER BY mp.modality, mp.model_id`
      ).all();
      return { models: rows };
    }

    const rows = db.prepare(
      `SELECT mp.*, p.name as provider_name,
              CASE
                WHEN p.tier = 'inactive' THEN 0
                ELSE 1
              END as provider_available
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       ORDER BY mp.modality, mp.model_id`
    ).all();
    return { models: rows };
  });

  // Get single model. Same JOIN as the list endpoint so the response
  // shape (provider_name aliased, model_profiles.*) is identical.
  server.get('/admin/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const row = db.prepare(
      `SELECT mp.*, p.name as provider_name
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       WHERE mp.id = ?`
    ).get(id);
    if (!row) {
      reply.status(404);
      return { error: { message: 'Model not found', type: 'not_found', code: 'model_not_found' } };
    }
    return row;
  });

  // ── Model Classification Routes ──────────────────────────────────────────

  // Get all model classifications (pricing tiers)
  server.get('/admin/models/classifications', async (request) => {
    const { classifyAllModels, loadClassification } = await import('@dmr-x/registry');
    const query = request.query as any;
    const tier = query?.tier;
    const providerId = query?.provider_id;

    let classifications = Array.from(classifyAllModels().values());

    // Load persisted verification data
    classifications = classifications.map(c => {
      const persisted = loadClassification(c.providerId, c.modelId);
      if (persisted?.verifiedFree) {
        return { ...c, verifiedFree: true, lastVerification: persisted.lastVerification, source: 'verified' };
      }
      return c;
    });

    // Filter by tier
    if (tier) {
      classifications = classifications.filter(c => c.pricingTier === tier);
    }

    // Filter by provider
    if (providerId) {
      classifications = classifications.filter(c => c.providerId === providerId);
    }

    return {
      total: classifications.length,
      byTier: {
        free: classifications.filter(c => c.pricingTier === 'free').length,
        free_with_limits: classifications.filter(c => c.pricingTier === 'free_with_limits').length,
        paid: classifications.filter(c => c.pricingTier === 'paid').length,
        subscription_only: classifications.filter(c => c.pricingTier === 'subscription_only').length,
        unknown: classifications.filter(c => c.pricingTier === 'unknown').length,
      },
      classifications,
    };
  });

  // Verify a model is actually free (runtime probe)
  server.post('/admin/models/verify-free', async (request) => {
    const { verifyModelFree } = await import('@dmr-x/registry');
    const body = request.body as any;
    const { provider_id, model_id } = body;

    if (!provider_id || !model_id) {
      throw new ValidationError('provider_id and model_id are required');
    }

    const result = await verifyModelFree(provider_id, model_id);
    logAdminAction(request, 'models.verify_free', 'model', `${provider_id}/${model_id}`, { isFree: result.isActuallyFree });
    return result;
  });

  // Get free models (catalog + verified)
  server.get('/admin/models/free', async () => {
    const { getFreeModels } = await import('@dmr-x/registry');
    const freeModels = getFreeModels();
    return {
      total: freeModels.length,
      verified: freeModels.filter(m => m.verifiedFree).length,
      models: freeModels,
    };
  });

  // Discover models for a provider from its /v1/models endpoint.
  // Enriches with catalog data and upserts into model_profiles.
  server.post('/admin/providers/:id/discover', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      throw new ValidationError('Provider not found');
    }

    if (!provider.base_url) {
      throw new ValidationError('Provider has no base_url configured');
    }

    // Resolve API key: try provider_keys table first, then config
    let apiKey = '';
    const keyRow = db.prepare(
      `SELECT api_key_encrypted FROM provider_keys WHERE provider_id = ? AND is_active = 1 LIMIT 1`
    ).get(id) as { api_key_encrypted: string } | undefined;
    if (keyRow?.api_key_encrypted) {
      try {
        apiKey = decrypt(keyRow.api_key_encrypted);
      } catch { /* ignore */ }
    }
    if (!apiKey) {
      try {
        const cfg = JSON.parse(provider.config || '{}');
        if (cfg.apiKey) apiKey = decrypt(cfg.apiKey);
      } catch { /* ignore */ }
    }

    const template = PROVIDER_CATALOG.find(t => t.id === provider.name);
    const isOpenaiCompat = template?.apiFormat === 'openai' || provider.name === 'google';
    if (!isOpenaiCompat) {
      throw new ValidationError('Provider is not OpenAI-compatible — discovery only works for OpenAI-format providers');
    }

    const { discoverOpenAIModels } = await import('@dmr-x/registry');
    const discovered = await discoverOpenAIModels({ baseUrl: provider.base_url, apiKey });

    if (discovered.length === 0) {
      return { discovered: 0, inserted: 0, message: 'No models found at /v1/models' };
    }

    // Enrich with catalog data
    const catalogLookup = new Map<string, any>();
    for (const t of PROVIDER_CATALOG) {
      for (const m of t.models) {
        catalogLookup.set(`${t.id}/${m.id}`, m);
      }
    }
    const enriched = discovered.map(m => {
      const key = `${provider.name}/${m.modelId}`;
      const tmpl = catalogLookup.get(key);
      if (!tmpl) return m;
      return {
        ...m,
        displayName: m.displayName || tmpl.id,
        modality: m.modality || tmpl.modalities[0] || 'llm',
        contextWindow: m.contextWindow ?? tmpl.contextWindow ?? null,
        maxOutputTokens: m.maxOutputTokens ?? tmpl.maxOutputTokens ?? null,
        inputCostPer1M: m.inputCostPer1M || tmpl.inputCostPer1M || 0,
        outputCostPer1M: m.outputCostPer1M || tmpl.outputCostPer1M || 0,
        costPerImage: m.costPerImage || tmpl.costPerImage || 0,
        capabilities: m.capabilities.length > 0 ? m.capabilities : tmpl.capabilities,
        specializations: m.specializations.length > 0 ? m.specializations : tmpl.specializations,
      };
    });

    const insert = db.prepare(
      `INSERT OR IGNORE INTO model_profiles (
        id, provider_id, model_id, display_name, modality, capability_tier,
        supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
        context_window, max_output_tokens,
        input_cost_per_1k, output_cost_per_1k, cost_per_image,
        quality_score, is_active,
        task_categories, context_tier, deployment, reasoning_mode, safety_tier, agentic_level, architecture
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let inserted = 0;
    for (const m of enriched) {
      if (!m.modelId) continue;
      const caps = new Set(m.capabilities);
      const result = insert.run(
        crypto.randomUUID(),
        id,
        m.modelId,
        m.displayName || m.modelId,
        m.modality || 'llm',
        'balanced',
        caps.has('streaming') ? 1 : 0,
        caps.has('vision') ? 1 : 0,
        caps.has('tool_use') ? 1 : 0,
        caps.has('json_mode') ? 1 : 0,
        caps.has('function_call') ? 1 : 0,
        caps.has('reasoning') ? 1 : 0,
        m.contextWindow,
        m.maxOutputTokens,
        m.inputCostPer1M / 1000,
        m.outputCostPer1M / 1000,
        m.costPerImage,
        0.5,
        1,
        JSON.stringify(['general']),
        'medium',
        'cloud',
        'fixed',
        'standard',
        'chat',
        'unknown',
      );
      if (result.changes > 0) inserted++;
    }

    logAdminAction(request, 'providers.discover', 'provider', `${provider.name}`, { discovered: discovered.length, inserted });

    return {
      provider: provider.name,
      discovered: discovered.length,
      inserted,
      models: enriched.map(m => ({
        id: m.modelId,
        name: m.displayName,
        modality: m.modality,
        contextWindow: m.contextWindow,
        cost: { input: m.inputCostPer1M, output: m.outputCostPer1M },
      })),
    };
  });

  // Batch-verify which models are free for a provider.
  // Probes each model with a minimal chat completion to check if it's free.
  server.post('/admin/providers/:id/verify-free-batch', async (request) => {
    const { id } = request.params as { id: string };
    const { concurrency } = (request.body as any) || {};
    const db = getDb();

    const provider = db.prepare('SELECT name FROM providers WHERE id = ?').get(id) as any;
    if (!provider) {
      throw new ValidationError('Provider not found');
    }

    const { batchVerifyFree } = await import('@dmr-x/registry');
    const result = await batchVerifyFree(id, concurrency || 3);

    logAdminAction(request, 'providers.verify_free_batch', 'provider', provider.name, {
      free: result.freeCount,
      paid: result.paidCount,
      errors: result.errorCount,
    });

    return {
      provider: provider.name,
      ...result,
    };
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
        id, provider_id, model_id, display_name, modality, intelligence_layer, capability_tier,
        context_window, max_output_tokens, supports_streaming, supports_vision,
        supports_tool_use, input_cost_per_1k, output_cost_per_1k, cost_per_image
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, body.provider_id, body.model_id, body.display_name ?? null, body.modality,
      body.intelligence_layer, body.capability_tier, body.context_window ?? null, body.max_output_tokens ?? null,
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
    const { tenant_id, name, scopes, allowed_tools, role, expires_at, compression_enabled, compression_algorithm, compression_reversible } = parsed.data;

    const db = getDb();

    // Verify tenant exists
    const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenant_id);
    if (!tenant) {
      throw new ValidationError('Tenant not found');
    }

    const { generateApiKey, hashApiKeyWithSalt, hashApiKey } = await import('@dmr-x/utils');
    const apiKey = generateApiKey();
    const keyHash = hashApiKeyWithSalt(apiKey);
    const keyLookupHash = hashApiKey(apiKey);

    const id = crypto.randomUUID();

    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash, key_lookup_hash, name, scopes, allowed_tools, role, expires_at, compression_enabled, compression_algorithm, compression_reversible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, tenant_id, keyHash, keyLookupHash, name,
      scopes ? JSON.stringify(scopes) : null,
      allowed_tools ? JSON.stringify(allowed_tools) : null,
      // NOT NULL with a column default �?" pass the default explicitly rather
      // than null, which would violate the constraint.
      role ?? 'developer',
      expires_at || null,
      compression_enabled !== undefined ? (compression_enabled ? 1 : 0) : null,
      compression_algorithm || null,
      compression_reversible !== undefined ? (compression_reversible ? 1 : 0) : null,
    );

    // Audit log for API key creation
    logAdminAction(request, 'create', 'api_key', id, {
      tenant_id,
      name,
      role: role ?? 'developer',
      has_expiry: !!expires_at,
      compression_enabled: compression_enabled ?? null,
    });

    const row = db.prepare(
      'SELECT id, tenant_id, name, scopes, allowed_tools, role, created_at, expires_at, compression_enabled, compression_algorithm, compression_reversible FROM api_keys WHERE id = ?'
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

  // Get single tenant. Same subquery as the list endpoint so the
  // response includes the live `key_count`.
  server.get('/admin/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const row = db.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM api_keys WHERE tenant_id = t.id AND is_active = 1) as key_count
      FROM tenants t
      WHERE t.id = ?
    `).get(id);
    if (!row) {
      reply.status(404);
      return { error: { message: 'Tenant not found', type: 'not_found', code: 'tenant_not_found' } };
    }
    return row;
  });

  // ─── Organizations ────────────────────────────────────────────────────────

  const CreateOrganizationSchema = z.object({
    name: z.string().min(1).max(255),
    settings: z.record(z.unknown()).optional(),
  });

  // Create organization
  server.post('/admin/organizations', async (request, reply) => {
    const parsed = CreateOrganizationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { name, settings } = parsed.data;

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare('INSERT INTO organizations (id, name, settings) VALUES (?, ?, ?)').run(id, name, JSON.stringify(settings || {}));

    logAdminAction(request, 'create', 'organization', id, { name });

    reply.status(201);
    return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id);
  });

  // List organizations
  server.get('/admin/organizations', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT o.*,
        (SELECT COUNT(*) FROM tenants WHERE org_id = o.id) as tenant_count
      FROM organizations o ORDER BY name
    `).all();
    return { organizations: rows };
  });

  // Get single organization
  server.get('/admin/organizations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const row = db.prepare(`
      SELECT o.*,
        (SELECT COUNT(*) FROM tenants WHERE org_id = o.id) as tenant_count
      FROM organizations o
      WHERE o.id = ?
    `).get(id);
    if (!row) {
      reply.status(404);
      return { error: { message: 'Organization not found', type: 'not_found', code: 'org_not_found' } };
    }
    return row;
  });

  // Update organization
  server.put('/admin/organizations/:id', async (request) => {
    const { id } = request.params as { id: string };
    const parsed = CreateOrganizationSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const db = getDb();
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(id);
    if (!org) {
      throw new ValidationError('Organization not found');
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (parsed.data.name !== undefined) {
      updates.push('name = ?');
      params.push(parsed.data.name);
    }
    if (parsed.data.settings !== undefined) {
      updates.push('settings = ?');
      params.push(JSON.stringify(parsed.data.settings));
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    logAdminAction(request, 'update', 'organization', id, parsed.data);

    return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id);
  });

  // Delete organization
  server.delete('/admin/organizations/:id', async (request) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(id);
    if (!org) {
      throw new ValidationError('Organization not found');
    }

    // Unlink tenants from this org
    db.prepare('UPDATE tenants SET org_id = NULL WHERE org_id = ?').run(id);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(id);

    logAdminAction(request, 'delete', 'organization', id);

    return { deleted: true };
  });

  // List organization members
  server.get('/admin/organizations/:id/members', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(id);
    if (!org) {
      reply.status(404);
      return { error: { message: 'Organization not found', type: 'not_found', code: 'org_not_found' } };
    }

    const members = db.prepare('SELECT * FROM organization_members WHERE organization_id = ?').all(id);
    return { members };
  });

  // Add organization member
  server.post('/admin/organizations/:id/members', async (request) => {
    const { id } = request.params as { id: string };
    const { user_id, role } = request.body as { user_id: string; role?: string };

    if (!user_id) {
      throw new ValidationError('user_id is required');
    }

    const db = getDb();
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(id);
    if (!org) {
      throw new ValidationError('Organization not found');
    }

    db.prepare('INSERT OR REPLACE INTO organization_members (organization_id, user_id, role) VALUES (?, ?, ?)').run(id, user_id, role || 'member');

    logAdminAction(request, 'create', 'organization_member', id, { user_id, role });

    return { added: true };
  });

  // Remove organization member
  server.delete('/admin/organizations/:id/members/:userId', async (request) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const db = getDb();

    const result = db.prepare('DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?').run(id, userId);

    logAdminAction(request, 'delete', 'organization_member', id, { user_id: userId });

    return { deleted: result.changes > 0 };
  });

  // Link tenant to organization
  server.put('/admin/tenants/:id/organization', async (request) => {
    const { id } = request.params as { id: string };
    const { org_id } = request.body as { org_id: string | null };

    const db = getDb();
    const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(id);
    if (!tenant) {
      throw new ValidationError('Tenant not found');
    }

    if (org_id) {
      const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(org_id);
      if (!org) {
        throw new ValidationError('Organization not found');
      }
    }

    db.prepare('UPDATE tenants SET org_id = ? WHERE id = ?').run(org_id, id);

    logAdminAction(request, 'update', 'tenant', id, { org_id });

    return db.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  });

  // List API keys
  server.get('/admin/api-keys', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT ak.id, ak.tenant_id, t.name as tenant_name, ak.name, ak.scopes, ak.role, ak.is_active, ak.created_at, ak.last_used_at, ak.expires_at,
             ak.compression_enabled, ak.compression_algorithm, ak.compression_reversible
      FROM api_keys ak
      JOIN tenants t ON t.id = ak.tenant_id
      ORDER BY ak.created_at DESC
    `).all();
    return { api_keys: rows };
  });

  /**
   * Update an API key's agent RBAC role.
   *
   * Roles gate the agent platform (agent-rbac.middleware.ts). Without this a
   * key would be stuck on the migration default for its whole life.
   */
  server.patch('/admin/api-keys/:id/role', async (request) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateApiKeyRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const db = getDb();
    const key = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(id);
    if (!key) {
      throw new ValidationError('API key not found');
    }

    db.prepare('UPDATE api_keys SET role = ? WHERE id = ?').run(parsed.data.role, id);
    logAdminAction(request, 'update', 'api_key', id, { role: parsed.data.role });

    return { id, role: parsed.data.role };
  });

  // Update API key expiry
  server.patch('/admin/api-keys/:id/expiry', async (request) => {
    const { id } = request.params as { id: string };
    const { expires_at } = request.body as { expires_at?: string | null };

    const db = getDb();
    const key = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(id);
    if (!key) {
      throw new ValidationError('API key not found');
    }

    db.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(expires_at || null, id);

    return { id, expires_at: expires_at || null };
  });

  // Update API key compression settings
  server.patch('/admin/api-keys/:id/compression', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({
      compression_enabled: z.boolean().optional(),
      compression_algorithm: z.enum(['auto', 'smartcrusher', 'codecompressor', 'kompress']).optional(),
      compression_reversible: z.boolean().optional(),
    }).safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) {
      throw new ValidationError('API key not found');
    }

    await compressionService.updateApiKeyConfig(id, {
      enabled: parsed.data.compression_enabled,
      reversible: parsed.data.compression_reversible,
    });

    if (parsed.data.compression_algorithm !== undefined) {
      db.prepare('UPDATE api_keys SET compression_algorithm = ?, updated_at = datetime(\'now\') WHERE id = ?').run(parsed.data.compression_algorithm, id);
    }

    const row = db.prepare(
      'SELECT id, compression_enabled, compression_algorithm, compression_reversible FROM api_keys WHERE id = ?'
    ).get(id);

    logAdminAction(request, 'update', 'api_key', id, { compression: parsed.data });

    return row;
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
        const conditions = rules.conditions || {};
        return {
          id: row.id,
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_name,
          name: row.name,
          description: rules.description || undefined,
          type: rules.type || 'provider_allow',
          target: rules.target || [],
          action: rules.action || 'deny',
          conditions,
          // Expose `match` for the UI — derived from conditions fields
          match: {
            model: conditions.model || undefined,
            tenantId: conditions.tenantId || undefined,
            tag: conditions.tag || undefined,
            modality: conditions.modality || undefined,
          },
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

    // Convert UI's `match` shape to the DB's `conditions` shape.
    // The UI sends `{ model, tenantId, tag, modality }` while the
    // backend stores a generic `conditions` record.
    const conditions = { ...body.conditions };
    if (body.match) {
      if (body.match.model) conditions.model = body.match.model;
      if (body.match.tenantId) conditions.tenantId = body.match.tenantId;
      if (body.match.tag) conditions.tag = body.match.tag;
      if (body.match.modality) conditions.modality = body.match.modality;
    }

    const rulesBlob = JSON.stringify({
      type: body.type,
      target: body.target,
      action: body.action,
      conditions,
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
      description: body.description,
      type: body.type,
      target: body.target,
      action: body.action,
      conditions,
      priority: body.priority,
      enabled: body.enabled,
      created_at: new Date().toISOString(),
    };
  });

  // Usage history. The UI sends `?granularity=hour|day|week|month` to
  // switch between short and long time windows. The default is `hour`
  // which keeps the original 24-hour rolling view. We pick the bucketing
  // expression and time window together so the SQL can't accidentally
  // GROUP BY a format that has gaps in the requested window.
  //
  // `usage_records` and `request_logs` use different time columns
  // (created_at vs timestamp), so we carry the strftime format once and
  // pair it with each table's column explicitly rather than swapping
  // strings at runtime.
  const GRANULARITY_BUCKETS: Record<string, { bucket: string; window: string }> = {
    hour: { bucket: "strftime('%Y-%m-%d %H:00:00', created_at)", window: '-24 hours' },
    day: { bucket: "strftime('%Y-%m-%d 00:00:00', created_at)", window: '-30 days' },
    week: { bucket: "strftime('%Y-%W', created_at)", window: '-12 weeks' },
    month: { bucket: "strftime('%Y-%m-01', created_at)", window: '-12 months' },
  };
  server.get('/admin/billing/usage-history', async (request) => {
    const { granularity: rawGranularity } = request.query as { granularity?: string };
    const cfg = GRANULARITY_BUCKETS[rawGranularity ?? ''] ?? GRANULARITY_BUCKETS.hour;
    // The same strftime format, applied to the request_logs.timestamp column.
    const latencyBucket = cfg.bucket.replace(/created_at/g, 'timestamp');
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
          ${cfg.bucket} as time,
          COUNT(*) as requests,
          SUM(total_tokens) as tokens,
          CAST(SUM(cost_cents) AS REAL) / 100 as cost
        FROM usage_records
        WHERE created_at > datetime('now', '${cfg.window}')
        GROUP BY ${cfg.bucket}
      ) u
      LEFT JOIN (
        SELECT
          ${latencyBucket} as time,
          ROUND(AVG(latency_ms)) as latency
        FROM request_logs
        WHERE timestamp > datetime('now', '${cfg.window}') AND latency_ms IS NOT NULL
        GROUP BY ${latencyBucket}
      ) r ON u.time = r.time
      ORDER BY u.time
    `).all();
    const effectiveGranularity = rawGranularity && cfg === GRANULARITY_BUCKETS[rawGranularity]
      ? rawGranularity
      : 'hour';
    return { history: rows, granularity: effectiveGranularity };
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

  // ── Credit/Balance Routes ─────────────────────────────────────────────────

  // Get credit balance
  server.get('/admin/credits/balance', async (request) => {
    const { creditService } = await import('@dmr-x/billing');
    const tenantId = (request.query as any)?.tenant_id || 'default';
    const balance = creditService.getOrCreateBalance(tenantId);
    return balance;
  });

  // Top up credits
  server.post('/admin/credits/topup', async (request) => {
    const { creditService } = await import('@dmr-x/billing');
    const body = request.body as any;
    const tenantId = body?.tenant_id || 'default';
    const amountCents = body?.amount_cents;
    const description = body?.description;

    if (!amountCents || amountCents <= 0) {
      throw new ValidationError('amount_cents must be a positive integer');
    }

    const adminKeyHash = request.headers['x-api-key']
      ? crypto.createHash('sha256').update(request.headers['x-api-key'] as string).digest('hex').slice(0, 16)
      : 'unknown';

    const balance = creditService.topUp(tenantId, amountCents, description, adminKeyHash);
    logAdminAction(request, 'credits.topup', 'credit', tenantId, { amount_cents: amountCents });
    return balance;
  });

  // Credit transaction history
  server.get('/admin/credits/transactions', async (request) => {
    const { creditService } = await import('@dmr-x/billing');
    const query = request.query as any;
    const tenantId = query?.tenant_id || 'default';
    const type = query?.type;
    const limit = parseInt(query?.limit || '50', 10);
    const offset = parseInt(query?.offset || '0', 10);

    return creditService.getTransactions(tenantId, { type, limit, offset });
  });

  // Dashboard stats
  /**
   * Compute the dashboard stat block.
   *
   * Extracted from the route handler so the SSE stream can send a real initial
   * snapshot on connect. Without one, a client that subscribed between updates
   * sat on heartbeats showing nothing until the next request happened to fire.
   */
  function computeDashboardStats(): Record<string, unknown> {
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
  }

  server.get('/admin/dashboard/stats', async () => computeDashboardStats());

  // Route decisions
  server.get('/admin/routing/decisions', async (_request, reply) => {
    try {
      const db = getDb();
      let rows: Array<Record<string, unknown>> = [];
      try {
        rows = db.prepare(`
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
      } catch (err) {
        logger.debug({ err }, 'Route decisions query failed — request_logs may be missing columns');
        rows = [];
      }
      const decisions = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          out[k] = typeof v === 'bigint' ? Number(v) : v;
        }
        try {
          out.fallback_chain = typeof out.fallback_chain === 'string' ? JSON.parse(out.fallback_chain as string) : out.fallback_chain ?? [];
        } catch {
          out.fallback_chain = [];
        }
        return out;
      });
      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify({ decisions }));
    } catch (err) {
      logger.error({ err }, 'Route decisions handler failed');
      reply.code(200);
      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify({ decisions: [] }));
    }
  });

  // Performance by mode — shows how each provider/model performs across
  // different routing modes (frontier/balanced/economy) and free-tier strategies.
  server.get('/admin/routing/performance-by-mode', async (request) => {
    const db = getDb();
    const query = request.query as Record<string, string | undefined>;
    const days = Math.min(Math.max(parseInt(query.days ?? '7', 10) || 7, 1), 90);

    // Performance grouped by quality_target
    const byQualityTarget = db.prepare(`
      SELECT
        selected_provider as provider,
        selected_model as model,
        quality_target,
        COUNT(*) as requests,
        ROUND(AVG(latency_ms)) as avg_latency_ms,
        ROUND(AVG(quality_score), 3) as avg_quality,
        ROUND(AVG(estimated_cost), 6) as avg_cost,
        ROUND(SUM(CASE WHEN error_code IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as success_rate,
        SUM(tokens_input) as total_input_tokens,
        SUM(tokens_output) as total_output_tokens
      FROM request_logs
      WHERE timestamp > datetime('now', '-' || ? || ' days')
        AND quality_target IS NOT NULL
      GROUP BY selected_provider, selected_model, quality_target
      ORDER BY quality_target, requests DESC
    `).all(days);

    // Performance grouped by free_tier_strategy
    const byFreeTierStrategy = db.prepare(`
      SELECT
        selected_provider as provider,
        selected_model as model,
        free_tier_strategy,
        COUNT(*) as requests,
        ROUND(AVG(latency_ms)) as avg_latency_ms,
        ROUND(AVG(quality_score), 3) as avg_quality,
        ROUND(AVG(estimated_cost), 6) as avg_cost,
        ROUND(SUM(CASE WHEN error_code IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as success_rate,
        SUM(tokens_input) as total_input_tokens,
        SUM(tokens_output) as total_output_tokens
      FROM request_logs
      WHERE timestamp > datetime('now', '-' || ? || ' days')
        AND free_tier_strategy IS NOT NULL
      GROUP BY selected_provider, selected_model, free_tier_strategy
      ORDER BY free_tier_strategy, requests DESC
    `).all(days);

    // Summary: which mode was used most
    const modeUsage = db.prepare(`
      SELECT
        quality_target,
        free_tier_strategy,
        COUNT(*) as requests,
        ROUND(AVG(latency_ms)) as avg_latency_ms,
        ROUND(AVG(quality_score), 3) as avg_quality
      FROM request_logs
      WHERE timestamp > datetime('now', '-' || ? || ' days')
      GROUP BY quality_target, free_tier_strategy
      ORDER BY requests DESC
    `).all(days);

    return {
      period_days: days,
      by_quality_target: byQualityTarget,
      by_free_tier_strategy: byFreeTierStrategy,
      mode_usage: modeUsage,
    };
  });

  // Free-tier summary — aggregated free tokens/month across all providers
  server.get('/admin/free-tier/summary', async () => {
    const db = getDb();

    // Get all free-tier models from the catalog. intelligence_rank, speed_rank
    // and monthly_token_budget live on model_profiles (model_classifications
    // carries pricing/rate-limit/free flags but not those ranking columns), so
    // join the profile in to resolve them.
    const freeModels = db.prepare(`
      SELECT
        mc.provider_id,
        mc.model_id,
        mc.has_free_tier,
        mp.intelligence_rank,
        mp.speed_rank,
        COALESCE(mp.monthly_token_budget, mc.monthly_budget, 0) AS monthly_token_budget,
        mc.rate_limit_rpm,
        mc.rate_limit_rpd,
        mc.rate_limit_tpm,
        mc.rate_limit_tpd,
        p.name as provider_name,
        p.is_healthy
      FROM model_classifications mc
      LEFT JOIN model_profiles mp
        ON mp.provider_id = mc.provider_id AND mp.model_id = mc.model_id
      JOIN providers p ON mc.provider_id = p.id
      WHERE mc.has_free_tier = 1
      ORDER BY monthly_token_budget DESC
    `).all() as any[];

    // Aggregate totals
    let totalMonthlyBudget = 0;
    const totalModels = freeModels.length;
    const healthyProviders = new Set<string>();

    const providerBreakdown: Record<string, {
      provider_name: string;
      models: any[];
      total_monthly_budget: number;
      is_healthy: boolean;
    }> = {};

    for (const model of freeModels) {
      totalMonthlyBudget += model.monthly_token_budget || 0;

      if (model.is_healthy) {
        healthyProviders.add(model.provider_id);
      }

      if (!providerBreakdown[model.provider_id]) {
        providerBreakdown[model.provider_id] = {
          provider_name: model.provider_name,
          models: [],
          total_monthly_budget: 0,
          is_healthy: model.is_healthy === 1,
        };
      }

      providerBreakdown[model.provider_id].models.push({
        model_id: model.model_id,
        monthly_token_budget: model.monthly_token_budget,
        intelligence_rank: model.intelligence_rank,
        speed_rank: model.speed_rank,
        rate_limits: {
          rpm: model.rate_limit_rpm,
          rpd: model.rate_limit_rpd,
          tpm: model.rate_limit_tpm,
          tpd: model.rate_limit_tpd,
        },
      });

      providerBreakdown[model.provider_id].total_monthly_budget += model.monthly_token_budget || 0;
    }

    // Get actual usage from request logs
    const usage = db.prepare(`
      SELECT
        selected_provider,
        selected_model,
        SUM(tokens_input + tokens_output) as total_tokens,
        COUNT(*) as total_requests
      FROM request_logs
      WHERE timestamp > datetime('now', '-30 days')
        AND (estimated_cost = 0 OR estimated_cost IS NULL)
      GROUP BY selected_provider, selected_model
      ORDER BY total_tokens DESC
      LIMIT 50
    `).all() as any[];

    // `estimated_tokens_saved` is a token count, which cannot answer "how much
    // money did this save". Carry the priced counterfactual alongside it so
    // callers have both, and keep the original key for compatibility.
    const savings = computeSavings(30);

    return {
      summary: {
        total_monthly_budget: totalMonthlyBudget,
        total_free_models: totalModels,
        healthy_free_providers: healthyProviders.size,
        estimated_tokens_saved: usage.reduce((sum: number, u: any) => sum + (u.total_tokens || 0), 0),
        cost_avoided_usd: savings.costAvoidedUsd,
        savings_basis: savings.basis,
      },
      providers: Object.values(providerBreakdown),
      recent_usage: usage,
    };
  });

  /**
   * Counterfactual free-tier savings — the priced version of
   * `free-tier/summary`'s token count.
   */
  server.get('/admin/free-tier/savings', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const days = Math.min(Math.max(parseInt(query.days ?? '30', 10) || 30, 1), 365);
    return computeSavings(days);
  });

  /**
   * Seed for the live token counters on the Free Tier and Models pages.
   *
   * Split free vs paid so each page shows its own side, and returns the window
   * boundaries so the client can increment from `usage_delta` telemetry frames
   * without re-polling. Free-ness is decided by classification, not by a zero
   * cost, for the same reason as the savings query.
   */
  server.get('/admin/usage/live', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const windows: Record<string, string> = {
      '1h': '-1 hour',
      '24h': '-1 day',
      '7d': '-7 days',
      '30d': '-30 days',
    };
    const windowKey = query.window && windows[query.window] ? query.window : '24h';
    const offset = windows[windowKey];

    const db = getDb();
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN is_free THEN tokens_input + tokens_output ELSE 0 END), 0) AS free_tokens,
        COALESCE(SUM(CASE WHEN is_free THEN 1 ELSE 0 END), 0)                            AS free_requests,
        COALESCE(SUM(CASE WHEN NOT is_free THEN tokens_input + tokens_output ELSE 0 END), 0) AS paid_tokens,
        COALESCE(SUM(CASE WHEN NOT is_free THEN 1 ELSE 0 END), 0)                         AS paid_requests,
        COALESCE(SUM(CASE WHEN NOT is_free THEN estimated_cost ELSE 0 END), 0)            AS paid_cost
      FROM (
        SELECT
          rl.tokens_input,
          rl.tokens_output,
          rl.estimated_cost,
          CASE WHEN mc.has_free_tier = 1 OR mc.verified_free = 1
                    OR mc.pricingTier IN ('free', 'free_with_limits')
               THEN 1 ELSE 0 END AS is_free
        FROM request_logs rl
        LEFT JOIN model_classifications mc
          ON mc.provider_id = rl.selected_provider
         AND mc.model_id   = rl.selected_model
        WHERE rl.timestamp > datetime('now', ?)
      )
    `).get(offset) as any;

    const days = windowKey === '1h' ? 1 : windowKey === '24h' ? 1 : windowKey === '7d' ? 7 : 30;
    const savings = computeSavings(days);

    return {
      window: windowKey,
      windowStart: new Date(Date.now() - (windowKey === '1h' ? 3600e3 : days * 86400e3)).toISOString(),
      free: {
        tokens: Number(row?.free_tokens ?? 0),
        requests: Number(row?.free_requests ?? 0),
      },
      paid: {
        tokens: Number(row?.paid_tokens ?? 0),
        requests: Number(row?.paid_requests ?? 0),
        costUsd: Number(row?.paid_cost ?? 0),
      },
      costAvoidedUsd: savings.costAvoidedUsd,
      savingsBasis: savings.basis,
    };
  });

  // Cost dashboard — aggregated cost data across tenants and providers
  server.get('/admin/cost/dashboard', async (request) => {
    const db = getDb();
    const query = request.query as Record<string, string | undefined>;
    const days = Math.min(Math.max(parseInt(query.days ?? '30', 10) || 30, 1), 365);
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Free-ness is decided by classification (model_classifications), not by
    // cost being zero — an unpriced paid model also logs estimated_cost = 0,
    // and `SUM(CASE WHEN cost = 0 THEN cost ...)` is identically zero anyway.
    // Same classifier as /admin/usage/live above.
    const IS_FREE_CASE = `
      CASE WHEN mc.has_free_tier = 1 OR mc.verified_free = 1
                OR mc.pricingTier IN ('free', 'free_with_limits')
           THEN 1 ELSE 0 END`;

    // Total costs, split into free/paid by classification.
    const totals = db.prepare(`
      SELECT
        SUM(estimated_cost) as total_cost,
        COUNT(*) as requests,
        SUM(tokens_input + tokens_output) as tokens,
        SUM(CASE WHEN is_free THEN 1 ELSE 0 END) as free_requests,
        SUM(CASE WHEN is_free THEN tokens_input + tokens_output ELSE 0 END) as free_tokens,
        SUM(CASE WHEN NOT is_free THEN estimated_cost ELSE 0 END) as paid_cost,
        SUM(CASE WHEN NOT is_free THEN 1 ELSE 0 END) as paid_requests,
        SUM(CASE WHEN NOT is_free THEN tokens_input + tokens_output ELSE 0 END) as paid_tokens
      FROM (
        SELECT
          rl.estimated_cost,
          rl.tokens_input,
          rl.tokens_output,
          ${IS_FREE_CASE} AS is_free
        FROM request_logs rl
        LEFT JOIN model_classifications mc
          ON mc.provider_id = rl.selected_provider
         AND mc.model_id   = rl.selected_model
        WHERE rl.timestamp > ?
      )
    `).get(start) as any;

    // Costs by provider
    const byProvider = db.prepare(`
      SELECT
        rl.selected_provider as provider,
        SUM(rl.estimated_cost) as cost,
        COUNT(*) as requests,
        SUM(rl.tokens_input + rl.tokens_output) as tokens,
        SUM(${IS_FREE_CASE}) * 100.0 / COUNT(*) as free_percent
      FROM request_logs rl
      LEFT JOIN model_classifications mc
        ON mc.provider_id = rl.selected_provider
       AND mc.model_id   = rl.selected_model
      WHERE rl.timestamp > ?
      GROUP BY rl.selected_provider
      ORDER BY cost DESC
    `).all(start) as any[];

    // Costs by tenant, same classification split as totals.
    const byTenant = db.prepare(`
      SELECT
        rl.tenant_id,
        SUM(rl.estimated_cost) as total_cost,
        COUNT(*) as requests,
        SUM(rl.tokens_input) as input_tokens,
        SUM(rl.tokens_output) as output_tokens,
        SUM(${IS_FREE_CASE}) as free_requests,
        SUM(CASE WHEN NOT (${IS_FREE_CASE}) THEN rl.estimated_cost ELSE 0 END) as paid_cost
      FROM request_logs rl
      LEFT JOIN model_classifications mc
        ON mc.provider_id = rl.selected_provider
       AND mc.model_id   = rl.selected_model
      WHERE rl.timestamp > ?
      GROUP BY rl.tenant_id
      ORDER BY total_cost DESC
      LIMIT 20
    `).all(start) as any[];

    // Enrich tenant data with names
    const enrichedByTenant = byTenant.map((t: any) => {
      const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(t.tenant_id) as any;
      return {
        tenantId: t.tenant_id,
        tenantName: tenant?.name ?? 'Unknown',
        totalCost: t.total_cost,
        freeRequests: t.free_requests ?? 0,
        paidCost: t.paid_cost ?? 0,
        totalRequests: t.requests,
        totalInputTokens: t.input_tokens ?? 0,
        totalOutputTokens: t.output_tokens ?? 0,
        byProvider: {},
      };
    });

    // Daily costs — real spend (`cost`) and real paid spend (`paid_cost`).
    // The counterfactual `avoided_cost` isn't derivable from this table (it
    // needs reference pricing) and is joined in below from computeSavings.
    const dailyCosts = db.prepare(`
      SELECT
        DATE(rl.timestamp) as date,
        SUM(rl.estimated_cost) as cost,
        SUM(CASE WHEN NOT (${IS_FREE_CASE}) THEN rl.estimated_cost ELSE 0 END) as paid_cost
      FROM request_logs rl
      LEFT JOIN model_classifications mc
        ON mc.provider_id = rl.selected_provider
       AND mc.model_id   = rl.selected_model
      WHERE rl.timestamp > ?
      GROUP BY DATE(rl.timestamp)
      ORDER BY date ASC
    `).all(start) as any[];

    // `costSavings` used to be SUM(CASE WHEN cost = 0 THEN cost ELSE 0 END),
    // which is identically zero. It now comes from the counterfactual in
    // services/savings.ts, which prices free-served tokens against the
    // cheapest comparable paid model. Reused here for `avoided_cost` per day.
    const savings = computeSavings(days);
    const avoidedByDate = new Map(savings.daily.map((d) => [d.date, d.costAvoidedUsd]));

    return {
      period: { start: new Date(start), end: new Date() },
      totalCost: totals?.total_cost ?? 0,
      freeRequests: totals?.free_requests ?? 0,
      freeTokens: totals?.free_tokens ?? 0,
      paidCost: totals?.paid_cost ?? 0,
      paidRequests: totals?.paid_requests ?? 0,
      paidTokens: totals?.paid_tokens ?? 0,
      costSavings: savings.costAvoidedUsd,
      savingsBasis: savings.basis,
      byTenant: enrichedByTenant,
      byProvider: Object.fromEntries(byProvider.map((p: any) => [p.provider, {
        cost: p.cost,
        requests: p.requests,
        tokens: p.tokens,
        freePercent: p.free_percent ?? 0,
      }])),
      dailyCosts: dailyCosts.map((d: any) => ({
        date: d.date,
        cost: d.cost ?? 0,
        paid_cost: d.paid_cost ?? 0,
        avoided_cost: avoidedByDate.get(d.date) ?? 0,
      })),
    };
  });

  // Quota states
  /**
   * Per-key rotation distribution for every provider holding a key pool.
   *
   * Answers "are all my keys actually being used?" — a key with a count of 0
   * is stored but carrying no traffic, which is the failure mode multi-key
   * setups hit silently.
   */
  server.get('/admin/key-rotation', async () => {
    const { keyRotationService } = await import('@dmr-x/quota');
    const stats = keyRotationService.getRotationStats();
    return {
      pools: stats.map((s) => {
        const counts = s.selections.map((x) => x.count);
        const total = counts.reduce((a, b) => a + b, 0);
        const used = counts.filter((c) => c > 0).length;
        return {
          ...s,
          totalSelections: total,
          keysUsed: used,
          // 1.0 = perfectly even. Computed as (min/max) so a single hot key
          // in a pool of five reads as ~0, not as a flattering average.
          balance: total === 0 ? null : Math.min(...counts) / Math.max(...counts),
        };
      }),
    };
  });

  server.get('/admin/quota', async (request) => {
    const db = getDb();
    const query = request.query as Record<string, string | undefined>;
    // Accept both camelCase and snake_case for back-compat.
    const tenantId = query.tenantId ?? query.tenant_id;
    const providerId = query.providerId ?? query.provider_id;
    // Cap result size to avoid pulling thousands of rows for large tenants.
    const limit = Math.min(Math.max(parseInt(query.limit ?? '100', 10) || 100, 1), 500);

    // `tenantId` is bound twice — once per subquery (used_quota and
    // remaining_quota both compute the same monthly request count).
    const params: unknown[] = [];
    const tenantSubquery = tenantId ? `AND rl.tenant_id = ?` : '';
    if (tenantId) {
      params.push(tenantId, tenantId);
    }

    let sql = `
      SELECT
        qa.id,
        qa.tenant_id,
        qa.provider_id,
        p.name as provider_name,
        qa.max_requests as total_quota,
        COALESCE(
          (SELECT COUNT(*) FROM request_logs rl
           WHERE (qa.provider_id IS NULL OR rl.selected_provider = qa.provider_id)
           ${tenantSubquery}
           AND rl.timestamp >= date('now', 'start of month')),
          0
        ) as used_quota,
        qa.max_requests - COALESCE(
          (SELECT COUNT(*) FROM request_logs rl
           WHERE (qa.provider_id IS NULL OR rl.selected_provider = qa.provider_id)
           ${tenantSubquery}
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
      WHERE 1=1
    `;
    if (tenantId) {
      sql += ` AND qa.tenant_id = ?`;
      params.push(tenantId);
    }
    if (providerId) {
      sql += ` AND qa.provider_id = ?`;
      params.push(providerId);
    }
    sql += ` ORDER BY p.name LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
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

  // Acknowledge an alert. Alerts are derived live from provider/quota state
  // (see GET /admin/alerts above), so there is no row to update — the UI
  // can mark the row as acknowledged and the next list call will reflect it
  // once we wire in-memory ack state. For now this is a no-op acknowledgement
  // endpoint so the UI buttons no longer 404.
  server.post('/admin/alerts/:id/ack', async (request, reply) => {
    const { id } = request.params as { id: string };
    return { id, acknowledged: true, acknowledgedAt: new Date().toISOString() };
  });

  // Resolve an alert. Same model as /ack above: alerts are derived, so this
  // is a no-op acknowledgement that returns a resolved timestamp. The UI
  // optimistically marks the row resolved on a successful response.
  server.post('/admin/alerts/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    return { id, resolved: true, resolvedAt: new Date().toISOString() };
  });

  // Telemetry events (in-memory ring buffer + push-based SSE)
  const telemetryEvents = new EventEmitter();
  telemetryEvents.setMaxListeners(100); // up to 100 concurrent SSE subscribers

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

  function trimTelemetryBuffer(): void {
    while (telemetryBuffer.length > MAX_TELEMETRY_EVENTS) {
      telemetryBuffer.shift();
    }
  }

  /**
   * Publish a telemetry event. Appends to the in-memory buffer (trimmed to
   * MAX_TELEMETRY_EVENTS) and emits to all live SSE subscribers.
   *
   * Call sites: any code that wants to surface a real-time event in the
   * admin dashboard (e.g. request failures, auth failures, provider
   * health changes, etc.).
   */
  function recordTelemetryEvent(event: {
    id?: string;
    level?: string;
    service?: string;
    message: string;
    trace_id?: string | null;
    span_id?: string | null;
    duration?: number | null;
    metadata?: Record<string, unknown>;
  }): void {
    // HIGH-3: the `trace_id` / `span_id` fields used to be hard-coded to
    // `null` placeholders, which meant the live telemetry SSE stream could
    // never link an event back to its source span. Now we resolve the
    // active OTel span context at publish time. Callers can still pass
    // explicit values (e.g. when emitting a "child" event for a span that
    // has already been closed) and those values win.
    const explicitTraceId = event.trace_id;
    const explicitSpanId = event.span_id;
    let activeTraceId: string | null = null;
    let activeSpanId: string | null = null;
    if (explicitTraceId === null || explicitTraceId === undefined ||
        explicitSpanId === null || explicitSpanId === undefined) {
      const active = getActiveTraceContext();
      activeTraceId = active.traceId;
      activeSpanId = active.spanId;
    }
    const enriched = {
      id: event.id ?? crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: event.level ?? 'info',
      service: event.service ?? 'gateway',
      message: event.message,
      trace_id: explicitTraceId ?? activeTraceId,
      span_id: explicitSpanId ?? activeSpanId,
      duration: event.duration ?? null,
      metadata: event.metadata ?? {},
    };
    telemetryBuffer.push(enriched);
    trimTelemetryBuffer();
    telemetryEvents.emit('event', enriched);
  }

  /**
   * Backfill telemetry events from `request_logs` for the initial page load.
   *
   * `telemetryBuffer` is process-memory only (see above) and — separately —
   * `recordTelemetryEvent` is only ever called from error/warning code paths
   * (auth failures, routing failures, rate limits), never for an ordinary
   * completed request. So on a fresh gateway process the Requests page's
   * "Live stream of all requests" read an empty buffer and showed "No
   * requests yet" / all-zero kind counters even though `request_logs` (the
   * durable, DB-backed history CRIT-6 writes on every completed request —
   * see telemetry-hooks.ts) had rows and the Dashboard's stat tiles
   * (computeDashboardStats, also reading `request_logs`) showed a nonzero
   * count. Synthesize one event per row so the two views agree, then merge
   * with whatever the live buffer already holds.
   */
  function loadTelemetryHistory(limit: number): Array<Record<string, unknown>> {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT
          rl.id as id,
          rl.timestamp as timestamp,
          rl.tenant_id as tenant_id,
          rl.selected_model as model,
          p.name as provider,
          rl.latency_ms as latency_ms,
          rl.error_code as error_code,
          rl.fallback_used as fallback_used
        FROM request_logs rl
        LEFT JOIN providers p ON p.id = rl.selected_provider
        ORDER BY rl.timestamp DESC
        LIMIT ?
      `).all(limit) as Array<{
        id: string;
        timestamp: string;
        tenant_id: string | null;
        model: string | null;
        provider: string | null;
        latency_ms: number | null;
        error_code: string | null;
        fallback_used: number | null;
      }>;

      return rows.map((row) => ({
        id: `reqlog-${row.id}`,
        timestamp: row.timestamp,
        level: row.error_code ? 'error' : row.fallback_used ? 'warning' : 'info',
        service: 'gateway',
        message: row.error_code
          ? `Request to ${row.model ?? 'unknown model'} failed: ${row.error_code}`
          : `Request routed to ${row.model ?? 'unknown model'}${row.provider ? ` via ${row.provider}` : ''}`,
        trace_id: null,
        span_id: null,
        duration: row.latency_ms,
        metadata: {
          kind: 'request',
          tenant: row.tenant_id,
          model: row.model,
          provider: row.provider,
        },
        // Non-schema fields the UI's `ApiTelemetryEvent`/`normalizeTelemetryEvent`
        // read directly (see apps/ui/src/lib/admin.ts, apps/ui/src/pages/Requests.tsx)
        // — additive on top of the shape live `recordTelemetryEvent` rows use.
        kind: 'request',
        status: row.error_code ? 'error' : 'ok',
        tenant: row.tenant_id,
        model: row.model,
      }));
    } catch (err) {
      logger.debug({ err }, 'Telemetry history backfill from request_logs failed');
      return [];
    }
  }

  server.get('/admin/telemetry/events', async () => {
    trimTelemetryBuffer();
    // De-dupe by id (a live buffer event and a request_logs row never share
    // one — buffer ids are `crypto.randomUUID()`, history ids are prefixed
    // `reqlog-`) and sort newest-first so history and live events interleave
    // correctly instead of history always trailing after live events.
    const merged = new Map<string, Record<string, unknown>>();
    for (const e of loadTelemetryHistory(200)) merged.set(e.id as string, e);
    for (const e of telemetryBuffer) merged.set(e.id, e);
    const events = Array.from(merged.values()).sort(
      (a, b) => new Date(b.timestamp as string).getTime() - new Date(a.timestamp as string).getTime(),
    );
    return { events: events.slice(0, 200) };
  });

  // SSE stream of telemetry events. The UI's `EventSource('/admin/telemetry/stream')`
  // (apps/ui/src/lib/admin.ts) opens this to live-update the observability
  // dashboards. Subscribers receive events via the `telemetryEvents`
  // emitter that `recordTelemetryEvent` publishes to — no polling.
  //
  // The connection is closed automatically when the client disconnects
  // (the `close` listener removes the listener and clears the heartbeat).
  // We send an initial snapshot of the most recent 50 events so the
  // dashboard isn't blank when a client connects mid-stream. A 15s
  // heartbeat keeps the connection alive through proxies.
  server.get('/admin/telemetry/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Initial snapshot — last 50 events
    const initial = telemetryBuffer.slice(-50);
    for (const e of initial) {
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    }

    // Subscribe to live events
    const onEvent = (e: typeof telemetryBuffer[number]) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        // socket may have closed
      }
    };
    telemetryEvents.on('event', onEvent);

    // Heartbeat every 15s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`:heartbeat\n\n`);
      } catch {
        // ignore
      }
    }, 15_000);
    if (heartbeat.unref) heartbeat.unref();

    request.raw.on('close', () => {
      telemetryEvents.off('event', onEvent);
      clearInterval(heartbeat);
    });
  });

  // SSE stream of dashboard stats updates. Pushes live metrics to the UI
  // so it doesn't have to poll every 5 seconds.
  const dashboardStatsEvents = new EventEmitter();
  dashboardStatsEvents.setMaxListeners(50);

  // Publish dashboard stats update (called after significant events)
  function publishDashboardStatsUpdate(stats: Record<string, unknown>): void {
    dashboardStatsEvents.emit('stats', stats);
  }

  /**
   * Recompute and broadcast dashboard stats, at most once a second.
   *
   * `publishDashboardStatsUpdate` was exposed on the server object but nothing
   * ever called it, so the stream only ever emitted heartbeats. This is the
   * missing producer: the request lifecycle hook calls it on every completed
   * request.
   *
   * Two guards keep it off the hot path — it no-ops when nobody is listening,
   * and it coalesces bursts into one recompute per second. The stat block is
   * six aggregate queries, which is fine once a second and not fine per
   * request under load.
   */
  let lastStatsPublish = 0;
  function publishDashboardStatsThrottled(): void {
    if (dashboardStatsEvents.listenerCount('stats') === 0) return;

    const now = Date.now();
    if (now - lastStatsPublish < 1000) return;
    lastStatsPublish = now;

    try {
      publishDashboardStatsUpdate(computeDashboardStats());
    } catch (err) {
      // Telemetry must never break a request.
      logger.warn({ err }, 'Dashboard stats publish failed');
    }
  }

  server.get('/admin/dashboard/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Subscribe to live stats updates
    const onStats = (stats: Record<string, unknown>) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(stats)}\n\n`);
      } catch {
        // socket may have closed
      }
    };
    dashboardStatsEvents.on('stats', onStats);

    // Initial snapshot. The telemetry stream already replays its buffer on
    // connect; this stream did not, so a client that subscribed while the
    // system was idle rendered an empty dashboard indefinitely.
    try {
      onStats(computeDashboardStats());
    } catch (err) {
      logger.warn({ err }, 'Failed to send initial dashboard stats snapshot');
    }

    // Heartbeat every 15s to keep the connection alive
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`:heartbeat\n\n`);
      } catch {
        // ignore
      }
    }, 15_000);
    if (heartbeat.unref) heartbeat.unref();

    request.raw.on('close', () => {
      dashboardStatsEvents.off('stats', onStats);
      clearInterval(heartbeat);
    });
  });

  // Expose publisher for dashboard stats updates
  (server as unknown as Record<string, unknown>).publishDashboardStatsUpdate = publishDashboardStatsUpdate;
  (server as unknown as Record<string, unknown>).publishDashboardStatsThrottled = publishDashboardStatsThrottled;

  // Expose buffer + publisher for adding events from other routes
  (server as unknown as Record<string, unknown>).telemetryBuffer = telemetryBuffer;
  (server as unknown as Record<string, unknown>).trimTelemetryBuffer = trimTelemetryBuffer;
  (server as unknown as Record<string, unknown>).recordTelemetryEvent = recordTelemetryEvent;

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
    const parsed = CreateMemoryItemSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { tenantId, content, namespace, source, retentionDays, metadata } = parsed.data;
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
    const parsed = SearchMemorySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { tenantId, query, namespace, limit, minScore } = parsed.data;
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
  const SubmitSandboxSchema = z.object({
    tenantId: z.string().optional(),
    language: z.enum(['python', 'python3', 'node', 'javascript', 'js', 'deno', 'bun']).default('python'),
    code: z.string().min(1).max(100_000),
    timeoutMs: z.number().int().min(1000).max(30_000).optional().default(5000),
    maxRetries: z.number().int().min(0).max(3).optional().default(2),
  });

  server.get('/admin/sandbox/jobs', async (request) => {
    const { limit: rawLimit } = request.query as { limit?: number };
    const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 200);
    const jobs = sandboxService.list(limit);
    return { jobs };
  });

  server.post('/admin/sandbox/jobs', async (request, reply) => {
    const parsed = SubmitSandboxSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const job = await sandboxService.submit(parsed.data);
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
    const parsed = RegisterWorkerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { name, type } = parsed.data;
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

  server.post('/admin/workers/cleanup', async (request) => {
    const parsed = z.object({
      daysToKeep: z.number().min(1).default(30)
    }).safeParse(request.body);
    
    const daysToKeep = parsed.success ? parsed.data.daysToKeep : 30;
    workersService.cleanup(daysToKeep);
    return { ok: true };
  });

  server.get('/admin/workers/:id/jobs', async (request) => {
    const { id } = request.params as { id: string };
    const jobs = workersService.listJobs(id);
    return { jobs };
  });

  server.get('/admin/jobs', async () => {
    const jobs = workersService.listJobs();
    return { jobs };
  });

  // Federation endpoints
  server.get('/admin/federation', async () => {
    const nodes = federationService.list();
    return { nodes };
  });

  server.post('/admin/federation', async (request, reply) => {
    const parsed = RegisterFederationNodeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { name, url, region, apiKey, privacyLevel } = parsed.data;
    // SSRF protection: the federation prober and PeerClient both issue
    // outbound fetches against this URL, so validate it here too. This
    // resolves the host, rejects private/loopback/link-local IPs, and
    // hands back a `lookup` the caller could use to pin a follow-up
    // fetch (the prober does its own dispatching, so we just need the
    // guard at registration time).
    await validateBaseUrlForSSRF(url);
    const node = federationService.register({ name, url, region: region ?? undefined, apiKey: apiKey ?? undefined, privacyLevel });
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

    // Get provider name before deletion for audit log
    const provider = db.prepare('SELECT name FROM providers WHERE id = ?').get(id) as { name: string } | undefined;

    db.prepare('DELETE FROM providers WHERE id = ?').run(id);

    // Hybrid: clear the API key from .env when provider is deleted
    if (provider?.name) {
      removeApiKeyFromEnvFile(provider.name);
    }

    // Audit log for provider deletion
    logAdminAction(request, 'delete', 'provider', id, { name: provider?.name });

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

    // Audit log for tenant deletion
    logAdminAction(request, 'delete', 'tenant', id, { name: tenant.name });

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
      region,
      priority,
      enabled,
    } = parsed.data;

    // Issue #9: SSRF validation on base_url — resolve the host and reject
    // private/loopback/link-local IPs (see admin-ssrf.ts).
    if (base_url) {
      await validateBaseUrlForSSRF(base_url);
    }

    // Merge the form-only fields (region/priority/enabled) and any caller-
    // supplied config into a single config blob. The `providers` table has
    // no dedicated columns for these, but the UI's Providers.tsx and
    // ProviderDetailDrawer read them back from config on every render.
    // The route returns the merged config to the caller below, so the
    // round-trip is symmetrical.
    //
    // `configProvided` is only true when the caller actually sent something —
    // either the `config` blob itself or one of the form-only fields. When
    // the request body carries none of them, we leave the existing config
    // column untouched (COALESCE handles that in the SQL).
    const configProvided =
      config !== undefined ||
      region !== undefined ||
      priority !== undefined ||
      enabled !== undefined;
    const mergedConfig: Record<string, unknown> = configProvided
      ? { ...(config || {}) }
      : {};
    if (region != null) mergedConfig.region = region;
    if (priority != null) mergedConfig.priority = priority;
    if (enabled != null) mergedConfig.enabled = enabled;

    // Issue #2: Encrypt any apiKey in config before storing
    const configToStore = configProvided ? encryptConfigApiKey(mergedConfig) : null;
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
    const { model_id, display_name, modality, context_window, max_output_tokens, is_active } = parsed.data;
    // Normalize a space-separated "provider model" id into the slash form
    // (e.g. "tencent hy3" -> "tencent/hy3") so a manual edit can't recreate
    // the upstream 400 that the router's alias layer also guards against.
    const normalizedModelId = model_id?.includes(' ') && !model_id.includes('/')
      ? model_id.replace(/\s+/g, '/')
      : model_id;
    const db = getDb();
    db.prepare(
      `UPDATE model_profiles SET
        model_id = COALESCE(?, model_id),
        display_name = COALESCE(?, display_name),
        modality = COALESCE(?, modality),
        context_window = COALESCE(?, context_window),
        max_output_tokens = COALESCE(?, max_output_tokens),
        is_active = COALESCE(?, is_active),
        -- Toggling is_active through this endpoint is a human decision, so
        -- record it. Live discovery re-activates anything the provider still
        -- lists, which silently undid every manual disable on the next
        -- restart; operator_disabled is what makes the choice stick.
        operator_disabled = CASE WHEN ? IS NULL THEN operator_disabled
                                 WHEN ? = 0 THEN 1 ELSE 0 END,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      normalizedModelId ?? null,
      display_name ?? null,
      modality ?? null,
      context_window ?? null,
      max_output_tokens ?? null,
      is_active != null ? (is_active ? 1 : 0) : null,
      is_active != null ? (is_active ? 1 : 0) : null,
      is_active != null ? (is_active ? 1 : 0) : null,
      id,
    );
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
    const { name, type, target, action, match, conditions, priority, enabled } = parsed.data;
    const db = getDb();
    const existing = db.prepare('SELECT rules FROM policies WHERE id = ?').get(id) as { rules: string } | undefined;
    if (!existing) {
      throw new ValidationError('Policy not found');
    }
    const currentRules = JSON.parse(existing.rules || '{}');

    // Convert UI's `match` shape to `conditions` if provided
    const mergedConditions = { ...(conditions ?? currentRules.conditions) };
    if (match) {
      if (match.model) mergedConditions.model = match.model;
      if (match.tenantId) mergedConditions.tenantId = match.tenantId;
      if (match.tag) mergedConditions.tag = match.tag;
      if (match.modality) mergedConditions.modality = match.modality;
    }

    const updatedRules = {
      type: type ?? currentRules.type,
      target: target ?? currentRules.target,
      action: action ?? currentRules.action,
      conditions: mergedConditions,
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

  // --- Needle tool pre-filter status -----------------------------------
  //
  // services/needle-router is a local CPU model that trims the tool list
  // before the real model sees it (apps/gateway/src/lib/needlePreFilter.ts).
  // Measured on this class of hardware, single-request CPU inference runs
  // 50-90+ seconds regardless of tool count — far past anything viable as
  // a synchronous pre-request hop — so the filter is a settings-backed
  // opt-in (default off) rather than always-on. This route gives the UI
  // toggle honest, live feedback: is the sidecar even reachable, is the
  // toggle currently on, and what happened the last time the filter
  // actually ran (matched / timed out / errored, and how long it took).
  server.get('/admin/needle/status', async () => {
    const enabled = isNeedleEnabled();
    const telemetry = getNeedleTelemetry();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const probeStart = Date.now();
    let reachable = false;
    let modelLoaded: boolean | null = null;
    try {
      const res = await fetch(needleHealthUrl(), { signal: controller.signal });
      if (res.ok) {
        reachable = true;
        const body = (await res.json().catch(() => null)) as { model_loaded?: boolean } | null;
        modelLoaded = typeof body?.model_loaded === 'boolean' ? body.model_loaded : null;
      }
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timer);
    }
    const probeLatencyMs = Date.now() - probeStart;

    return {
      enabled,
      reachable,
      modelLoaded,
      probeLatencyMs,
      timeoutBudgetMs: (() => {
        const raw = process.env.DMRX_NEEDLE_TIMEOUT_MS;
        const parsed = raw === undefined ? 1500 : Number(raw);
        return Number.isFinite(parsed) ? parsed : 1500;
      })(),
      lastAttempt: telemetry.lastAttemptAt
        ? {
            at: telemetry.lastAttemptAt,
            outcome: telemetry.lastOutcome,
            latencyMs: telemetry.lastLatencyMs,
            error: telemetry.lastError,
            matchedCount: telemetry.lastMatchedCount,
            toolCount: telemetry.lastToolCount,
          }
        : null,
    };
  });

  // Test agent integration connectivity
  server.post('/admin/integrations/test', async (request) => {
    const { tool } = request.body as { tool: string };
    if (!tool || !['claude-code', 'codex', 'antigravity', 'opencode'].includes(tool)) {
      throw new ValidationError('Invalid tool', { errors: [{ message: 'tool must be one of: claude-code, codex, antigravity, opencode' }] });
    }

    const port = process.env.PORT || 3000;
    const gatewayUrl = `http://localhost:${port}`;
    const startTime = Date.now();

    try {
      let testUrl: string;
      let testBody: Record<string, unknown>;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      if (tool === 'claude-code') {
        testUrl = `${gatewayUrl}/v1/messages`;
        testBody = {
          model: 'auto',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        };
        headers['anthropic-version'] = '2023-06-01';
      } else if (tool === 'codex') {
        testUrl = `${gatewayUrl}/v1/chat/completions`;
        testBody = {
          model: 'auto-coding',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        };
      } else if (tool === 'opencode') {
        testUrl = `${gatewayUrl}/v1/chat/completions`;
        testBody = {
          model: 'auto-coding',
          messages: [{ role: 'user', content: 'ping' }],
        };
      } else {
        // Antigravity (Cloud Code protocol). Antigravity itself pings
        // :loadCodeAssist on startup to verify connectivity, so we use that
        // as the connectivity check — it exercises the Cloud Code endpoint
        // without requiring a live model call (which needs a real Google key).
        testUrl = `${gatewayUrl}/v1internal:loadCodeAssist`;
        testBody = {};
      }

      const response = await fetch(testUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(testBody),
        signal: AbortSignal.timeout(10000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        return { success: true, latencyMs };
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        return { success: false, latencyMs, error: `HTTP ${response.status}: ${errorText.slice(0, 200)}` };
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        latencyMs,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

// --- Benchmarks 2.0 ---

  // Get leaderboard
  server.get('/admin/benchmarks/leaderboard', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT mp.id, mp.model_id, mp.display_name, p.name as provider_name, 
             mp.elo_rating, mp.quality_score, mp.avg_latency_ms, mp.capability_tier,
             (SELECT COUNT(*) FROM benchmark_results br 
              WHERE br.model_id = mp.id 
              AND br.benchmark_type LIKE 'battle:%') as battle_count
      FROM model_profiles mp
      JOIN providers p ON p.id = mp.provider_id
      WHERE mp.is_active = 1
      ORDER BY mp.elo_rating DESC
    `).all() as any[];

    // Compute confidence intervals for each model
    const { getEloConfidenceInterval } = await import('@dmr-x/benchmark');
    const leaderboard = rows.map(row => ({
      ...row,
      confidenceInterval: getEloConfidenceInterval(row.elo_rating, row.battle_count || 0, 95),
    }));

    return { leaderboard };
  });

  // Get battle history
  server.get('/admin/benchmarks/battles', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT br.*, mp.display_name as model_name
      FROM benchmark_results br
      JOIN model_profiles mp ON mp.id = br.model_id
      WHERE br.benchmark_type LIKE 'battle:%'
      ORDER BY br.run_at DESC
      LIMIT 50
    `).all() as any[];
    return { 
      battles: rows.map(r => ({
        ...r,
        details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details
      })) 
    };
  });

  // Run manual benchmark
  server.post('/admin/benchmarks/run', async (request) => {
    const { benchmarkService } = server as any;
    if (!benchmarkService) {
      throw new ValidationError('Benchmark service not initialized');
    }
    
    // Trigger in background
    benchmarkService.runBenchmarks().catch((err: any) => {
      logger.error({ err }, 'Manual benchmark run failed');
    });

    return { status: 'started', message: 'Benchmark run started in background' };
  });

  // Run manual arena battle
  server.post('/admin/benchmarks/battle', async (request) => {
    const parsed = RunArenaBattleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { modelA, modelB, prompt, category, difficulty } = parsed.data;
    const { benchmarkService } = server as any;

    if (!benchmarkService) {
      throw new ValidationError('Benchmark service not initialized');
    }

    // Trigger in background. If the caller passed a custom `prompt`, wrap it;
    // otherwise pick a random prompt from LLM_BENCHMARKS.
    const benchmarkModule = await import('@dmr-x/benchmark');
    const availablePrompts = benchmarkModule.LLM_BENCHMARKS.filter((p: any) => {
      if (category && p.category !== category) return false;
      if (difficulty && p.difficulty !== difficulty) return false;
      return true;
    });
    const chosenPrompt = prompt
      ? {
          id: 'custom-battle',
          category: (category ?? 'instruction') as any,
          modality: 'llm',
          difficulty: (difficulty ?? 'medium') as any,
          tags: ['custom'],
          request: {
            modality: 'llm',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            stream: false,
            metadata: {} as Record<string, unknown>,
          },
        }
      : availablePrompts[Math.floor(Math.random() * availablePrompts.length)]
        ?? benchmarkModule.LLM_BENCHMARKS[Math.floor(Math.random() * benchmarkModule.LLM_BENCHMARKS.length)];

    benchmarkService.runArenaBattle(modelA, modelB, chosenPrompt).catch((err: any) => {
      logger.error({ err }, 'Manual arena battle failed');
    });

    return { status: 'started' };
  });

  // Run a round-robin tournament between multiple models
  server.post('/admin/benchmarks/tournament', async (request) => {
    const parsed = z.object({
      modelIds: z.array(z.string().uuid()).min(2).max(10),
      prompt: z.string().min(1).max(100_000).optional(),
      category: z.enum(['reasoning', 'instruction', 'creative', 'coding', 'knowledge', 'multilingual', 'multi-turn', 'safety']).optional(),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    }).safeParse(request.body);

    if (!parsed.success) {
      throw new ValidationError('Invalid tournament request', { errors: parsed.error.errors });
    }

    const { modelIds, prompt, category, difficulty } = parsed.data;
    const { benchmarkService } = server as any;
    if (!benchmarkService) {
      throw new ValidationError('Benchmark service not initialized');
    }

    const benchmarkModule = await import('@dmr-x/benchmark');

    // Pick a prompt (custom, filtered, or random)
    let chosenPrompt;
    if (prompt) {
      chosenPrompt = {
        id: 'custom-tournament',
        category: (category ?? 'instruction') as any,
        modality: 'llm',
        difficulty: (difficulty ?? 'medium') as any,
        tags: ['custom', 'tournament'],
        request: {
          modality: 'llm',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          stream: false,
          metadata: {} as Record<string, unknown>,
        },
      };
    } else {
      const available = benchmarkModule.LLM_BENCHMARKS.filter((p: any) => {
        if (category && p.category !== category) return false;
        if (difficulty && p.difficulty !== difficulty) return false;
        return true;
      });
      chosenPrompt = available.length > 0
        ? available[Math.floor(Math.random() * available.length)]
        : benchmarkModule.LLM_BENCHMARKS[Math.floor(Math.random() * benchmarkModule.LLM_BENCHMARKS.length)];
    }

    // Generate all unique pairs (round-robin)
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < modelIds.length; i++) {
      for (let j = i + 1; j < modelIds.length; j++) {
        pairs.push([modelIds[i]!, modelIds[j]!]);
      }
    }

    const totalBattles = pairs.length;
    logger.info({ modelCount: modelIds.length, totalBattles }, 'Starting round-robin tournament');

    // Fire all battles in background (sequential to avoid rate limits)
    let completed = 0;
    let errors = 0;
    for (const [a, b] of pairs) {
      try {
        await benchmarkService.runArenaBattle(a, b, chosenPrompt);
        completed++;
      } catch (err) {
        errors++;
        logger.error({ err, modelA: a, modelB: b }, 'Tournament battle failed');
      }
    }

    logger.info({ totalBattles, completed, errors }, 'Tournament complete');

    return {
      status: 'completed',
      totalBattles,
      completed,
      errors,
      promptId: chosenPrompt.id,
      promptCategory: chosenPrompt.category,
    };
  });

  // Get per-category benchmark stats for a model
  server.get('/admin/benchmarks/models/:id/stats', async (request) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    // Verify model exists
    const model = db.prepare('SELECT id, model_id, display_name FROM model_profiles WHERE id = ?').get(id);
    if (!model) {
      return { error: 'Model not found' };
    }

    // Get per-category scores (non-battle benchmarks)
    const categoryScores = db.prepare(`
      SELECT 
        br.benchmark_type,
        COUNT(*) as count,
        ROUND(AVG(br.score), 3) as avg_score,
        ROUND(MIN(br.score), 3) as min_score,
        ROUND(MAX(br.score), 3) as max_score,
        ROUND(AVG(CASE 
          WHEN json_extract(br.details, '$.latencyMs') IS NOT NULL 
          THEN CAST(json_extract(br.details, '$.latencyMs') AS REAL) 
          ELSE NULL 
        END), 0) as avg_latency_ms
      FROM benchmark_results br
      WHERE br.model_id = ? 
        AND br.benchmark_type NOT LIKE 'battle:%'
      GROUP BY br.benchmark_type
      ORDER BY avg_score DESC
    `).all(id);

    return {
      model,
      categoryScores,
      totalBenchmarks: (categoryScores as any[]).reduce((sum: number, r: any) => sum + r.count, 0),
    };
  });

  // Get Elo rating history for a model
  server.get('/admin/benchmarks/models/:id/history', async (request) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const model = db.prepare('SELECT id, display_name FROM model_profiles WHERE id = ?').get(id);
    if (!model) {
      return { error: 'Model not found' };
    }

    // Get battle history with Elo changes
    const history = db.prepare(`
      SELECT 
        br.run_at,
        br.score,
        br.benchmark_type,
        json_extract(br.details, '$.elo_change') as elo_change,
        json_extract(br.details, '$.competitor_id') as competitor_id
      FROM benchmark_results br
      WHERE br.model_id = ? 
        AND br.benchmark_type LIKE 'battle:%'
      ORDER BY br.run_at ASC
    `).all(id) as any[];

    // Build cumulative Elo trace starting from current minus changes
    const currentElo = (db.prepare('SELECT elo_rating FROM model_profiles WHERE id = ?').get(id) as any)?.elo_rating ?? 1200;

    // Reconstruct Elo at each point
    let runningElo = currentElo;
    const eloTrace: Array<{ date: string; elo: number; type: string }> = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      const change = h.elo_change ? parseFloat(h.elo_change) : 0;
      eloTrace.unshift({
        date: h.run_at,
        elo: Math.round(runningElo * 10) / 10,
        type: h.benchmark_type,
      });
      runningElo -= change;
    }

    return {
      model,
      eloTrace,
      totalBattles: history.length,
      currentElo,
    };
  });

  // Submit human validation of a judge decision
  server.post('/admin/benchmarks/validate', async (request) => {
    const parsed = z.object({
      battleId: z.string().uuid(),
      humanWinner: z.enum(['A', 'B', 'Tie']),
      reviewerId: z.string().optional(),
      notes: z.string().max(2000).optional(),
    }).safeParse(request.body);

    if (!parsed.success) {
      throw new ValidationError('Invalid validation request', { errors: parsed.error.errors });
    }

    const { battleId, humanWinner, reviewerId, notes } = parsed.data;
    const db = getDb();

    // Get the battle's judge decision
    const battle = db.prepare(`
      SELECT br.*, mp.display_name as model_name
      FROM benchmark_results br
      JOIN model_profiles mp ON mp.id = br.model_id
      WHERE br.id = ?
    `).get(battleId) as any;

    if (!battle) {
      throw new ValidationError('Battle not found');
    }

    const details = typeof battle.details === 'string' ? JSON.parse(battle.details) : battle.details;
    const judgeWinner = details?.winner ?? 'unknown';

    // For battles, the score field encodes outcome (1.0 = A wins, 0.5 = tie, 0.0 = B wins)
    let judgeWinnerLabel: 'A' | 'B' | 'Tie' = 'Tie';
    if (battle.score === 1.0) judgeWinnerLabel = 'A';
    else if (battle.score === 0.0) judgeWinnerLabel = 'B';

    const agreed = judgeWinnerLabel === humanWinner ? 1 : 0;

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO benchmark_validations (id, battle_id, judge_winner, human_winner, agreed, reviewer_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, battleId, judgeWinnerLabel, humanWinner, agreed, reviewerId ?? null, notes ?? null);

    // Emit event
    const { eventBus, SystemEvents } = await import('@dmr-x/utils');
    eventBus.emit(SystemEvents.BENCHMARK_VALIDATED, { battleId, agreed, judgeWinner: judgeWinnerLabel, humanWinner });

    // Update running agreement stats
    const stats = db.prepare(`
      SELECT COUNT(*) as total, SUM(agreed) as agreed_count FROM benchmark_validations
    `).get() as { total: number; agreed_count: number };

    logger.info({
      battleId, agreed: agreed === 1,
      totalValidations: stats.total,
      agreementRate: stats.total > 0 ? Math.round((stats.agreed_count / stats.total) * 1000) / 10 : 0
    }, 'Human validation recorded');

    return { success: true, id, agreed: agreed === 1, totalValidations: stats.total, agreementRate: stats.total > 0 ? Math.round((stats.agreed_count / stats.total) * 1000) / 10 : 0 };
  });

  // Get validation history and stats
  server.get('/admin/benchmarks/validations', async () => {
    const db = getDb();

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(agreed) as agreed_count,
        CASE WHEN COUNT(*) > 0 THEN ROUND(CAST(SUM(agreed) AS REAL) / COUNT(*) * 100, 1) ELSE 0 END as agreement_rate
      FROM benchmark_validations
    `).get() as any;

    const history = db.prepare(`
      SELECT bv.*,
             mp.display_name as model_a_name,
             (SELECT mp2.display_name FROM model_profiles mp2
              WHERE mp2.id = json_extract(br.details, '$.competitor_id')) as model_b_name
      FROM benchmark_validations bv
      LEFT JOIN benchmark_results br ON br.id = bv.battle_id
      LEFT JOIN model_profiles mp ON mp.id = br.model_id
      ORDER BY bv.created_at DESC
      LIMIT 100
    `).all();

    return {
      stats: { total: stats?.total ?? 0, agreedCount: stats?.agreed_count ?? 0, agreementRate: stats?.agreement_rate ?? 0 },
      validations: history,
    };
  });

  // Get next unvalidated battle for human review
  server.get('/admin/benchmarks/validate/next', async () => {
    const db = getDb();

    const battle = db.prepare(`
      SELECT br.id, br.score, br.benchmark_type, br.run_at,
             br.details, br.model_id,
             mp.display_name as model_name,
             mp.model_id as model_internal_id,
             p.name as provider_name
      FROM benchmark_results br
      JOIN model_profiles mp ON mp.id = br.model_id
      JOIN providers p ON p.id = mp.provider_id
      WHERE br.benchmark_type LIKE 'battle:%'
      AND br.id NOT IN (SELECT battle_id FROM benchmark_validations)
      ORDER BY br.run_at DESC
      LIMIT 1
    `).get() as any;

    if (!battle) {
      return { battle: null, message: 'No unvalidated battles' };
    }

    const details = typeof battle.details === 'string' ? JSON.parse(battle.details) : battle.details;

    // Get competitor model info
    const competitorId = details?.competitor_id;
    let competitorName = 'Unknown';
    if (competitorId) {
      const comp = db.prepare('SELECT display_name FROM model_profiles WHERE id = ?').get(competitorId) as any;
      if (comp) competitorName = comp.display_name;
    }

    // Get the judge reasoning
    const judgeReasoning = details?.reasoning || null;
    const judgeScores = details?.scores || null;

    return {
      battle: {
        id: battle.id,
        modelA: { name: battle.model_name, provider: battle.provider_name, id: battle.model_id },
        modelB: { name: competitorName, provider: 'competitor', id: competitorId },
        judgeWinner: battle.score === 1.0 ? 'A' : battle.score === 0.0 ? 'B' : 'Tie',
        judgeReasoning,
        judgeScores,
        benchmarkType: battle.benchmark_type,
        runAt: battle.run_at,
      },
    };
  });

  // Playground feedback capture
  server.post('/admin/playground/feedback', async (request) => {
    const parsed = PlaygroundFeedbackSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const body = parsed.data;
    const db = getDb();

    let modelId = body.modelId ?? null;
    const competitorModelId = body.competitorModelId ?? null;

    // If modelId is missing, look it up from request logs
    if (!modelId && body.requestId) {
      const log = db.prepare(`
        SELECT mp.id
        FROM request_logs rl
        JOIN model_profiles mp ON mp.provider_id = rl.selected_provider AND mp.model_id = rl.selected_model
        WHERE rl.request_id = ?
      `).get(body.requestId) as any;
      if (log) {
        modelId = log.id;
      }
    }

    if (!modelId) {
      throw new ValidationError('modelId or a valid requestId is required');
    }

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO playground_feedback (
        id, request_id, model_id, user_id, rating, feedback_text, implicit_signals, is_winner, competitor_model_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.requestId ?? null,
      modelId,
      body.userId ?? null,
      body.rating ?? null,
      body.feedbackText ?? null,
      JSON.stringify(body.implicitSignals ?? {}),
      body.isWinner === undefined ? null : (body.isWinner ? 1 : 0),
      competitorModelId ?? null
    );

    // If it was a comparison winner, trigger an Elo update event
    if (body.isWinner && competitorModelId) {
      const modelA = db.prepare('SELECT elo_rating FROM model_profiles WHERE id = ?').get(modelId) as any;
      const modelB = db.prepare('SELECT elo_rating FROM model_profiles WHERE id = ?').get(competitorModelId) as any;

      if (modelA && modelB) {
        const benchmark = await import('@dmr-x/benchmark');
        const update = benchmark.calculateEloUpdate(modelA.elo_rating, modelB.elo_rating, 1.0, 16); // High K for human feedback

        db.transaction(() => {
          db.prepare('UPDATE model_profiles SET elo_rating = ? WHERE id = ?').run(update.newRatingA, modelId);
          db.prepare('UPDATE model_profiles SET elo_rating = ? WHERE id = ?').run(update.newRatingB, competitorModelId);
        });

        eventBus.emit(SystemEvents.ELO_UPDATED, {
          modelA: { id: modelId, oldElo: modelA.elo_rating, newElo: update.newRatingA },
          modelB: { id: competitorModelId, oldElo: modelB.elo_rating, newElo: update.newRatingB },
          winner: 'A',
          source: 'playground'
        });
      }
    }

    return { success: true, id };
  });

  // --- Runtime admin key rotation ---

  /**
   * Rotate the admin API key at runtime.
   *
   * Generates a new key, stores it in process.env.DMRX_ADMIN_API_KEY (which
   * the auth middleware re-reads on every request — see auth.middleware.ts),
   * and returns the new key to the caller. The caller MUST save it — it
   * will not be shown again.
   *
   * For persistence across restarts, the operator must also update the
   * deployment environment (DMRX_ADMIN_API_KEY).
   */
  server.post('/admin/security/rotate-admin-key', async (request, reply) => {
    // The auth middleware already validated the current admin key, so
    // we're authorized to rotate. Generate a new key with a recognizable
    // prefix.
    const newKey = `dmrax_${crypto.randomBytes(32).toString('hex')}`;
    process.env.DMRX_ADMIN_API_KEY = newKey;
    refreshAdminKey();
    logger.warn('Admin API key rotated at runtime. Operator must also update DMRX_ADMIN_API_KEY in deployment for persistence.');
    return {
      new_key: newKey,
      message: 'Key rotated. Save it now — it will not be shown again. Update DMRX_ADMIN_API_KEY in your deployment environment to persist across restarts.',
    };
  });

  // --- MCP server status ----------------------------------------------------
  //
  // services/mcp-server runs as a companion process. Two ways that can
  // happen:
  //   * gateway-autostarted (apps/gateway/src/lib/sidecar-boot.ts,
  //     `DMRX_MCP_AUTOSTART`, default true) — the common case. Its spawn env
  //     unconditionally sets `DMRX_MCP_TRANSPORT=http` for the CHILD process,
  //     regardless of what (if anything) is set in this process's own env.
  //   * externally managed (operator runs `bun services/mcp-server` by hand,
  //     any transport).
  //
  // This route used to gate its probe on *this* process's own
  // `process.env.DMRX_MCP_TRANSPORT`, which defaults to 'stdio' and is
  // normally left unset in .env. That meant it never probed even when the
  // autostarted sidecar was live and serving real tool data on
  // DMRX_MCP_PORT — operators always got the hardcoded fallback list below
  // silently missing every filesystem/bash/template/preset/subagent tool
  // added since it was written. Fixed: always attempt the probe (bounded by
  // a short timeout) regardless of the declared transport, and report
  // whether the returned data is live or fabricated via `source`.
  server.get('/admin/mcp/status', async (request, reply) => {
    const transport = (process.env.DMRX_MCP_TRANSPORT || 'stdio').toLowerCase();
    const host = process.env.DMRX_MCP_HOST || '127.0.0.1';
    const port = parseInt(process.env.DMRX_MCP_PORT || '3100', 10);
    const hasApiKey = !!process.env.DMRX_MCP_API_KEY;

    // Always attempt the reachability probe — capped so a slow/unreachable
    // server can't hold up the admin response. See comment above for why we
    // no longer gate this on the declared transport.
    let available: boolean | null = null;
    {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const res = await fetch(`http://${host}:${port}/health`, {
          signal: controller.signal,
        });
        available = res.ok;
      } catch {
        available = false;
      } finally {
        clearTimeout(timer);
      }
    }

    const fallbackTools = [
      { name: 'dmrx_chat', description: 'Chat completions with full routing across all configured LLMs.' },
      { name: 'dmrx_chat_stream', description: 'Streaming chat completion with token-by-token output.' },
      { name: 'dmrx_generate_image', description: 'Image generation routed across diffusion providers.' },
      { name: 'dmrx_generate_image_stream', description: 'Streaming image generation with progressive updates.' },
      { name: 'dmrx_generate_video', description: 'Video generation across Replicate, Runway, Pika, etc.' },
      { name: 'dmrx_generate_music', description: 'Music generation across supported providers.' },
      { name: 'dmrx_generate_3d', description: '3D model generation (text-to-3d / image-to-3d).' },
      { name: 'dmrx_embed', description: 'Text embeddings across embedding providers.' },
      { name: 'dmrx_rerank', description: 'Document reranking for RAG pipelines.' },
      { name: 'dmrx_transcribe', description: 'Speech-to-text across STT providers.' },
      { name: 'dmrx_speak', description: 'Text-to-speech across TTS providers.' },
      { name: 'dmrx_models', description: 'List available models with capabilities and health.' },
      { name: 'dmrx_status', description: 'System status, router health, and provider availability.' },
      { name: 'dmrx_batch', description: 'Execute multiple tool calls atomically with partial-failure support.' },
      { name: 'dmrx_workflow', description: 'Define and execute multi-step workflows with branching, looping, and retries.' },
      { name: 'dmrx_context_save', description: 'Persist conversation context for stateful agent interactions.' },
      { name: 'dmrx_context_load', description: 'Load a previously saved conversation context by ID.' },
      { name: 'dmrx_context_list', description: 'List saved conversation contexts with pagination.' },
      { name: 'dmrx_context_summarize', description: 'Summarize a saved conversation to reduce token cost.' },
      { name: 'dmrx_context_compress', description: 'Compress a saved conversation while preserving meaning.' },
    ];

    let tools = fallbackTools;
    let source: 'live' | 'fallback' = 'fallback';

    {
      const toolsController = new AbortController();
      const toolsTimer = setTimeout(() => toolsController.abort(), 2000);
      try {
        const headers: Record<string, string> = {};
        if (process.env.DMRX_MCP_API_KEY) {
          headers.Authorization = `Bearer ${process.env.DMRX_MCP_API_KEY}`;
        }
        const toolsRes = await fetch(`http://${host}:${port}/tools`, {
          signal: toolsController.signal,
          headers,
        });
        if (toolsRes.ok) {
          const toolsData: any = await toolsRes.json();
          if (toolsData.tools) {
            tools = toolsData.tools;
            source = 'live';
          }
        }
      } catch {
        // Fall back to hardcoded tools if fetch fails
      } finally {
        clearTimeout(toolsTimer);
      }
    }

    return {
      available,
      transport,
      host,
      port,
      hasApiKey,
      uptime: Math.round(process.uptime()),
      tools,
      /** 'live' when `tools` came from the running MCP server; 'fallback' when it's the hardcoded catalogue below (stale — will not reflect newly added tools). */
      source,
    };
  });

  // MCP tools list endpoint that fetches from MCP server if possible
  server.get('/admin/mcp/tools', async () => {
    const host = process.env.DMRX_MCP_HOST || '127.0.0.1';
    const port = parseInt(process.env.DMRX_MCP_PORT || '3100', 10);

    const fallbackTools = [
      { name: 'dmrx_chat', description: 'Send a chat completion request through DMR-X. Automatically routes to the best available LLM based on quality, cost, and latency targets.' },
      { name: 'dmrx_chat_stream', description: 'Streaming chat completion with token-by-token output via streaming response.' },
      { name: 'dmrx_generate_image', description: 'Generate images through DMR-X. Automatically routes to the best available diffusion model.' },
      { name: 'dmrx_generate_image_stream', description: 'Streaming image generation with progressive updates.' },
      { name: 'dmrx_generate_video', description: 'Generate videos through DMR-X. Routes to the best video model (Runway, Pika, Replicate, etc.).' },
      { name: 'dmrx_generate_music', description: 'Generate music through DMR-X. Routes to music generation providers (Suno, Udio, Replicate/MusicGen).' },
      { name: 'dmrx_embed', description: 'Get text embeddings through DMR-X. Routes to the best embedding model for the given input.' },
      { name: 'dmrx_rerank', description: 'Rerank documents by relevance to a query through DMR-X. Routes to the best reranking model.' },
      { name: 'dmrx_transcribe', description: 'Transcribe audio to text through DMR-X. Routes to the best STT model.' },
      { name: 'dmrx_speak', description: 'Convert text to speech through DMR-X. Routes to the best TTS model.' },
      { name: 'dmrx_models', description: 'List available models in DMR-X, optionally filtered by modality or provider.' },
      { name: 'dmrx_status', description: 'Get DMR-X system status including router health, provider availability, and configuration.' },
      { name: 'dmrx_batch', description: 'Execute multiple MCP tool calls atomically. Returns aggregated results with individual outcomes.' },
      { name: 'dmrx_workflow', description: 'Define and execute multi-step workflows with branching, looping, and retry policies.' },
      { name: 'dmrx_context_save', description: 'Persist conversation context for stateful agent interactions across sessions.' },
      { name: 'dmrx_context_load', description: 'Load a previously saved conversation context by ID.' },
      { name: 'dmrx_context_list', description: 'List saved conversation contexts with pagination.' },
      { name: 'dmrx_context_summarize', description: 'Generate a contextual summary of a saved conversation to reduce token cost.' },
      { name: 'dmrx_context_compress', description: 'Compress a saved conversation while preserving meaning.' },
      { name: 'dmrx_generate_3d', description: 'Generate 3D models through DMR-X. Routes to text-to-3d or image-to-3d models.' },
    ];

    // Always attempt to fetch the live tool list from the MCP server — do
    // not gate on this process's own DMRX_MCP_TRANSPORT (see the comment on
    // /admin/mcp/status above; the same staleness bug applied here and is
    // the more severe of the two since this is the endpoint the UI's tool
    // tester (`listMcpTools` / `executeMcpTool`) reads).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const headers: Record<string, string> = {};
      if (process.env.DMRX_MCP_API_KEY) {
        headers.Authorization = `Bearer ${process.env.DMRX_MCP_API_KEY}`;
      }
      const res = await fetch(`http://${host}:${port}/tools`, {
        signal: controller.signal,
        headers,
      });
      if (!res.ok) throw new Error('MCP server not reachable');
      const data: any = await res.json();
      if (data.tools) return { tools: data.tools, source: 'live' as const };
      return { tools: fallbackTools, source: 'fallback' as const };
    } catch {
      // Fallback to hardcoded — stale, will not reflect newly added tools.
      return { tools: fallbackTools, source: 'fallback' as const };
    } finally {
      clearTimeout(timer);
    }
  });

  // Execute an MCP tool directly (for testing)
  server.post('/admin/mcp/tools/execute', async (request, reply) => {
    const parsed = McpToolExecuteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const { tool, parameters } = parsed.data;
    const router = (server as any).router;

    try {
      const requestId = crypto.randomUUID();
      const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);
      // Same X-Provider-Preferences carrier the public wire routes read (see
      // ../utils/provider-preferences.ts). `parameters` below is spread onto
      // the UnifiedRequest at its top level (matching each modality's field
      // names), which is NOT where the router looks for routing constraints
      // — it reads `metadata.providerPreferences` — so a raw
      // `provider_blacklist`/`require_privacy` key inside `parameters` would
      // land as inert clutter, not a constraint. Building it from the header
      // instead of trusting `parameters` keeps this dispatcher's enforcement
      // identical to the public routes'.
      const providerPreferences = parseProviderPreferencesHeader(request.headers['x-provider-preferences'] as string | undefined);
      const metadata = { requestId, ...(providerPreferences ? { providerPreferences } : {}) };

      // Map MCP tool names to their respective routing
      if (tool === 'dmrx_chat') {
        const request = {
          ...parameters,
          modality: 'llm' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/chat/completions',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_embed') {
        const request = {
          ...parameters,
          modality: 'embedding' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/embeddings',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_rerank') {
        const request = {
          ...parameters,
          modality: 'reranking' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/rerank',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_generate_image') {
        const request = {
          ...parameters,
          modality: 'diffusion' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/images/generations',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_transcribe') {
        const request = {
          ...parameters,
          modality: 'audio_stt' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/audio/transcriptions',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_speak') {
        const request = {
          ...parameters,
          modality: 'audio_tts' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/audio/speech',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_generate_video') {
        const request = {
          ...parameters,
          modality: 'video' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/video/generations',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_generate_music') {
        const request = {
          ...parameters,
          modality: 'music' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/music/generations',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_generate_3d') {
        const request = {
          ...parameters,
          modality: '3d' as const,
          stream: false,
          metadata,
        };
        const { response } = await router.route(request, {
          path: '/v1/3d/generate',
          qualityTarget,
        });
        return { success: true, result: response };
      }

      if (tool === 'dmrx_models') {
        const allCandidates = [...registryService.getCandidates()];
        const modality = parameters?.modality;
        const provider = parameters?.provider;
        let models = allCandidates;
        if (modality) {
          models = models.filter((m: any) => m.modality === modality);
        }
        if (provider) {
          models = models.filter((m: any) =>
            m.providerId.toLowerCase().includes(String(provider).toLowerCase())
          );
        }
        return { success: true, result: { models } };
      }

      if (tool === 'dmrx_status') {
        const candidates = registryService.getCandidates();
        return {
          success: true,
          result: {
            status: 'ok',
            version: process.env.npm_package_version || '0.4.0',
            uptime: Math.round(process.uptime()),
            candidates: candidates.length,
          },
        };
      }

      // Batch and context tools require more complex handling - return not implemented
      if (tool.startsWith('dmrx_context_') || tool === 'dmrx_batch' || tool === 'dmrx_workflow') {
        reply.status(501);
        return {
          success: false,
          error: `Tool "${tool}" requires streaming context management - use the MCP server directly or /v1/tools/execute endpoint`,
        };
      }

      reply.status(404);
      return { success: false, error: `Tool "${tool}" not implemented in admin API` };
    } catch (error: any) {
      logger.error({ err: error, tool }, 'MCP tool execution failed');
      (server as any).recordTelemetryEvent?.({
        level: 'error',
        service: 'gateway',
        message: error.message,
        metadata: { path: request.url, tool },
      });
      reply.status(500);
      return { success: false, error: error.message };
    }
  });

  // Get allowed tools for an API key
  server.get('/admin/api-keys/:id/tools', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const db = getDb();
    const row = db.prepare(
      'SELECT id, name, allowed_tools FROM api_keys WHERE id = ?'
    ).get(id) as { id: string; name: string; allowed_tools: string | null } | undefined;

    if (!row) {
      reply.status(404);
      return { error: { message: 'API key not found' } };
    }

    const allowedTools = row.allowed_tools
      ? JSON.parse(row.allowed_tools) as string[]
      : [];

    return { allowed_tools: allowedTools };
  });

  // Set allowed tools for an API key
  server.put('/admin/api-keys/:id/tools', async (request, reply) => {
    const parsed = ApiKeyToolsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const id = (request.params as { id: string }).id;
    const { allowed_tools } = parsed.data;

    const db = getDb();
    const existing = db.prepare(
      'SELECT id FROM api_keys WHERE id = ?'
    ).get(id) as { id: string } | undefined;

    if (!existing) {
      reply.status(404);
      return { error: { message: 'API key not found' } };
    }

    db.prepare(
      'UPDATE api_keys SET allowed_tools = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(JSON.stringify(allowed_tools), id);

    const row = db.prepare(
      'SELECT id, name, allowed_tools FROM api_keys WHERE id = ?'
    ).get(id);

    return { ...row, allowed_tools };
  });

  // --- MCP Configuration Endpoints ------------------------------------------

  // Helper: Read MCP config file
   
  function readMcpConfig(): any {
    try {
      const configPath = process.env.DMRX_MCP_CONFIG_PATH || 'dmrx-mcp.config.json';
      const fs = require('fs');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch {
      // Config file missing or invalid — return empty config
    }
    return {};
  }

  // Helper: Write MCP config file
  function writeMcpConfig(config: Record<string, unknown>): void {
    const fs = require('fs');
    const configPath = process.env.DMRX_MCP_CONFIG_PATH || 'dmrx-mcp.config.json';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  // GET /admin/mcp/config — Get full MCP configuration
  server.get('/admin/mcp/config', async () => {
    const fileConfig = readMcpConfig();
    return {
      transport: process.env.DMRX_MCP_TRANSPORT || fileConfig.transport || 'stdio',
      host: process.env.DMRX_MCP_HOST || fileConfig.host || '127.0.0.1',
      port: parseInt(process.env.DMRX_MCP_PORT || String(fileConfig.port || 3100), 10),
      hasApiKey: !!process.env.DMRX_MCP_API_KEY,
      toolSearch: {
        enabled: fileConfig.toolSearch?.enabled ?? true,
        bm25: {
          enabled: fileConfig.toolSearch?.bm25?.enabled ?? true,
          k1: fileConfig.toolSearch?.bm25?.k1 ?? 1.2,
          b: fileConfig.toolSearch?.bm25?.b ?? 0.75,
        },
        semantic: {
          enabled: fileConfig.toolSearch?.semantic?.enabled ?? true,
          remoteUrl: fileConfig.toolSearch?.semantic?.remoteUrl ?? '',
        },
        hybrid: {
          enabled: fileConfig.toolSearch?.hybrid?.enabled ?? true,
          rrfConstant: fileConfig.toolSearch?.hybrid?.rrfConstant ?? 60,
        },
      },
      guardrails: {
        enabled: fileConfig.guardrails?.enabled ?? false,
        pii: {
          enabled: fileConfig.guardrails?.pii?.enabled ?? true,
          maskChar: fileConfig.guardrails?.pii?.maskChar ?? '*',
        },
        contentFilter: {
          enabled: fileConfig.guardrails?.contentFilter?.enabled ?? true,
          blockedPatterns: fileConfig.guardrails?.contentFilter?.blockedPatterns ?? [],
        },
      },
      audit: {
        enabled: fileConfig.audit?.enabled ?? false,
        backend: fileConfig.audit?.backend ?? 'sqlite',
        retentionDays: fileConfig.audit?.retentionDays ?? 30,
        logBodies: fileConfig.audit?.logBodies ?? false,
      },
      rbac: {
        enabled: fileConfig.rbac?.enabled ?? false,
        policies: fileConfig.rbac?.policies ?? [],
      },
      federation: {
        enabled: fileConfig.federation?.enabled ?? false,
        peers: fileConfig.federation?.peers ?? [],
        discovery: {
          mdns: fileConfig.federation?.discovery?.mdns ?? false,
          dns: {
            domain: fileConfig.federation?.discovery?.dns?.domain ?? '',
          },
        },
        syncInterval: fileConfig.federation?.syncInterval ?? '5m',
      },
      a2a: {
        enabled: fileConfig.a2a?.enabled ?? false,
        agentCard: {
          name: fileConfig.a2a?.agentCard?.name ?? 'DMR-X Agent',
          description: fileConfig.a2a?.agentCard?.description ?? 'DMR-X MCP Server Agent',
          url: fileConfig.a2a?.agentCard?.url ?? '',
        },
        taskTimeout: fileConfig.a2a?.taskTimeout ?? 60000,
      },
      aggregation: {
        servers: fileConfig.aggregation?.servers ?? [],
      },
    };
  });

  // PUT /admin/mcp/config — Update MCP configuration
  server.put('/admin/mcp/config', async (request) => {
    const body = request.body as Record<string, unknown>;
    const current = readMcpConfig();
    const updated = { ...current, ...body };
    writeMcpConfig(updated);
    return { success: true };
  });

  // GET /admin/mcp/tool-search/config
  server.get('/admin/mcp/tool-search/config', async () => {
    const config = readMcpConfig();
    return config.toolSearch ?? { enabled: true, bm25: { enabled: true, k1: 1.2, b: 0.75 }, semantic: { enabled: true, remoteUrl: '' }, hybrid: { enabled: true, rrfConstant: 60 } };
  });

  // PUT /admin/mcp/tool-search/config
  server.put('/admin/mcp/tool-search/config', async (request) => {
    const body = request.body as Record<string, unknown>;
    const config = readMcpConfig();
    config.toolSearch = { ...(config.toolSearch as Record<string, unknown>), ...body };
    writeMcpConfig(config);
    return { success: true };
  });

  // GET /admin/mcp/guardrails/config
  server.get('/admin/mcp/guardrails/config', async () => {
    const config = readMcpConfig();
    return config.guardrails ?? { enabled: false, pii: { enabled: true, maskChar: '*' }, contentFilter: { enabled: true, blockedPatterns: [] } };
  });

  // PUT /admin/mcp/guardrails/config
  server.put('/admin/mcp/guardrails/config', async (request) => {
    const body = request.body as Record<string, unknown>;
    const config = readMcpConfig();
    config.guardrails = { ...(config.guardrails as Record<string, unknown>), ...body };
    writeMcpConfig(config);
    return { success: true };
  });

  // GET /admin/mcp/audit/config
  server.get('/admin/mcp/audit/config', async () => {
    const config = readMcpConfig();
    return config.audit ?? { enabled: false, backend: 'sqlite', retentionDays: 30, logBodies: false };
  });

  // PUT /admin/mcp/audit/config
  server.put('/admin/mcp/audit/config', async (request) => {
    const body = request.body as Record<string, unknown>;
    const config = readMcpConfig();
    config.audit = { ...(config.audit as Record<string, unknown>), ...body };
    writeMcpConfig(config);
    return { success: true };
  });

  // GET /admin/mcp/rbac/policies
  server.get('/admin/mcp/rbac/policies', async () => {
    const config = readMcpConfig();
    return { policies: config.rbac?.policies ?? [] };
  });

  // POST /admin/mcp/rbac/policies
  server.post('/admin/mcp/rbac/policies', async (request) => {
    const body = request.body as { id?: string; name: string; effect: string; principals: string[]; actions: string[]; resources: string[] };
    const config = readMcpConfig();
    const policies = (config.rbac as Record<string, unknown>)?.policies as Array<Record<string, unknown>> ?? [];
    const newPolicy = { id: body.id || crypto.randomUUID(), ...body };
    policies.push(newPolicy);
    if (!config.rbac) config.rbac = {} as Record<string, unknown>;
    (config.rbac as Record<string, unknown>).policies = policies;
    writeMcpConfig(config);
    return newPolicy;
  });

  // DELETE /admin/mcp/rbac/policies/:id
  server.delete('/admin/mcp/rbac/policies/:id', async (request) => {
    const { id } = request.params as { id: string };
    const config = readMcpConfig();
    const policies = (config.rbac as Record<string, unknown>)?.policies as Array<Record<string, unknown>> ?? [];
    const filtered = policies.filter((p) => p.id !== id);
    if (!config.rbac) config.rbac = {} as Record<string, unknown>;
    (config.rbac as Record<string, unknown>).policies = filtered;
    writeMcpConfig(config);
    return { success: true };
  });

  // GET /admin/mcp/federation/config
  server.get('/admin/mcp/federation/config', async () => {
    const config = readMcpConfig();
    return config.federation ?? { enabled: false, peers: [], discovery: { mdns: false, dns: { domain: '' } }, syncInterval: '5m' };
  });

  // PUT /admin/mcp/federation/config
  server.put('/admin/mcp/federation/config', async (request) => {
    const body = request.body as Record<string, unknown>;
    const config = readMcpConfig();
    config.federation = { ...(config.federation as Record<string, unknown>), ...body };
    writeMcpConfig(config);
    return { success: true };
  });

  // GET /admin/mcp/federation/peers
  server.get('/admin/mcp/federation/peers', async () => {
    const config = readMcpConfig();
    return { peers: config.federation?.peers ?? [] };
  });

  // POST /admin/mcp/federation/peers
  server.post('/admin/mcp/federation/peers', async (request) => {
    const body = request.body as { id?: string; name: string; endpoint: string; secretRef?: string };
    const config = readMcpConfig();
    const peers = (config.federation as Record<string, unknown>)?.peers as Array<Record<string, unknown>> ?? [];
    const newPeer = { id: body.id || crypto.randomUUID(), ...body, status: 'pending', lastSync: null };
    peers.push(newPeer);
    if (!config.federation) config.federation = {} as Record<string, unknown>;
    (config.federation as Record<string, unknown>).peers = peers;
    writeMcpConfig(config);
    return newPeer;
  });

  // DELETE /admin/mcp/federation/peers/:id
  server.delete('/admin/mcp/federation/peers/:id', async (request) => {
    const { id } = request.params as { id: string };
    const config = readMcpConfig();
    const peers = (config.federation as Record<string, unknown>)?.peers as Array<Record<string, unknown>> ?? [];
    const filtered = peers.filter((p) => p.id !== id);
    if (!config.federation) config.federation = {} as Record<string, unknown>;
    (config.federation as Record<string, unknown>).peers = filtered;
    writeMcpConfig(config);
    return { success: true };
  });

  // GET /admin/mcp/a2a/config
  server.get('/admin/mcp/a2a/config', async () => {
    const config = readMcpConfig();
    return config.a2a ?? { enabled: false, agentCard: { name: 'DMR-X Agent', description: 'DMR-X MCP Server Agent', url: '' }, taskTimeout: 60000 };
  });

  // PUT /admin/mcp/a2a/config
  server.put('/admin/mcp/a2a/config', async (request) => {
    const body = request.body as Record<string, unknown>;
    const config = readMcpConfig();
    config.a2a = { ...(config.a2a as Record<string, unknown>), ...body };
    writeMcpConfig(config);
    return { success: true };
  });

  // GET /admin/mcp/aggregation/servers
  server.get('/admin/mcp/aggregation/servers', async () => {
    const config = readMcpConfig();
    return { servers: config.aggregation?.servers ?? [] };
  });

  // POST /admin/mcp/aggregation/servers
  server.post('/admin/mcp/aggregation/servers', async (request) => {
    const body = request.body as { id: string; name: string; transport: string; url?: string; command?: string; args?: string[] };
    const config = readMcpConfig();
    const servers = (config.aggregation as Record<string, unknown>)?.servers as Array<Record<string, unknown>> ?? [];
    const newServer = { ...body, status: 'disconnected', toolCount: 0 };
    servers.push(newServer);
    if (!config.aggregation) config.aggregation = {} as Record<string, unknown>;
    (config.aggregation as Record<string, unknown>).servers = servers;
    writeMcpConfig(config);
    return newServer;
  });

  // DELETE /admin/mcp/aggregation/servers/:id
  server.delete('/admin/mcp/aggregation/servers/:id', async (request) => {
    const { id } = request.params as { id: string };
    const config = readMcpConfig();
    const servers = (config.aggregation as Record<string, unknown>)?.servers as Array<Record<string, unknown>> ?? [];
    const filtered = servers.filter((s) => s.id !== id);
    if (!config.aggregation) config.aggregation = {} as Record<string, unknown>;
    (config.aggregation as Record<string, unknown>).servers = filtered;
    writeMcpConfig(config);
    return { success: true };
  });

  // ─── Fusion Panel ────────────────────────────────────────────────────────

  // GET /admin/fusion-panels — list all panels with their slots
  server.get('/admin/fusion-panels', async () => {
    const db = getDb();
    const panels = db.prepare('SELECT * FROM fusion_panels ORDER BY created_at DESC').all() as any[];
    const slots = db.prepare('SELECT * FROM fusion_panel_slots ORDER BY slot_order').all() as any[];
    const slotsByPanel = new Map<string, any[]>();
    for (const slot of slots) {
      const list = slotsByPanel.get(slot.panel_id) ?? [];
      list.push(slot);
      slotsByPanel.set(slot.panel_id, list);
    }
    return panels.map(p => ({ ...p, slots: slotsByPanel.get(p.id) ?? [] }));
  });

  // GET /admin/fusion-panels/:id — get single panel with slots
  server.get('/admin/fusion-panels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const panel = db.prepare('SELECT * FROM fusion_panels WHERE id = ?').get(id) as any;
    if (!panel) return reply.code(404).send({ error: 'Fusion panel not found' });
    const slots = db.prepare('SELECT * FROM fusion_panel_slots WHERE panel_id = ? ORDER BY slot_order').all(id);
    return { ...panel, slots };
  });

  // POST /admin/fusion-panels — create a new panel with slots
  server.post('/admin/fusion-panels', async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      slots?: Array<{ provider_id: string; model_id: string; display_name: string; slot_order?: number; is_enabled?: number }>;
    };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(
      'INSERT INTO fusion_panels (id, name, description) VALUES (?, ?, ?)'
    ).run(id, body.name, body.description ?? null);

    // Insert slots if provided
    if (body.slots && body.slots.length > 0) {
      const slotStmt = db.prepare(
        'INSERT INTO fusion_panel_slots (id, panel_id, provider_id, model_id, display_name, slot_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (let i = 0; i < body.slots.length; i++) {
        const s = body.slots[i]!;
        slotStmt.run(
          crypto.randomUUID(), id, s.provider_id, s.model_id, s.display_name,
          s.slot_order ?? i, s.is_enabled ?? 1
        );
      }
    }

    const panel = db.prepare('SELECT * FROM fusion_panels WHERE id = ?').get(id) as any;
    const slots = db.prepare('SELECT * FROM fusion_panel_slots WHERE panel_id = ? ORDER BY slot_order').all(id);
    return reply.code(201).send({ ...panel, slots });
  });

  // PUT /admin/fusion-panels/:id — update panel metadata and/or replace slots
  server.put('/admin/fusion-panels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      description?: string;
      is_active?: number;
      slots?: Array<{ id?: string; provider_id: string; model_id: string; display_name: string; slot_order?: number; is_enabled?: number }>;
    };
    const db = getDb();
    const panel = db.prepare('SELECT * FROM fusion_panels WHERE id = ?').get(id) as any;
    if (!panel) return reply.code(404).send({ error: 'Fusion panel not found' });

    // Update panel metadata if provided
    if (body.name !== undefined || body.description !== undefined || body.is_active !== undefined) {
      db.prepare(
        `UPDATE fusion_panels SET name = ?, description = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        body.name ?? panel.name,
        body.description ?? panel.description,
        body.is_active ?? panel.is_active,
        id
      );
    }

    // Replace slots if provided (full replacement)
    if (body.slots !== undefined) {
      db.prepare('DELETE FROM fusion_panel_slots WHERE panel_id = ?').run(id);
      if (body.slots.length > 0) {
        const slotStmt = db.prepare(
          'INSERT INTO fusion_panel_slots (id, panel_id, provider_id, model_id, display_name, slot_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        for (let i = 0; i < body.slots.length; i++) {
          const s = body.slots[i]!;
          slotStmt.run(
            s.id ?? crypto.randomUUID(), id, s.provider_id, s.model_id, s.display_name,
            s.slot_order ?? i, s.is_enabled ?? 1
          );
        }
      }
    }

    const updated = db.prepare('SELECT * FROM fusion_panels WHERE id = ?').get(id) as any;
    const slots = db.prepare('SELECT * FROM fusion_panel_slots WHERE panel_id = ? ORDER BY slot_order').all(id);
    return { ...updated, slots };
  });

  // DELETE /admin/fusion-panels/:id — delete panel and its slots (cascade)
  server.delete('/admin/fusion-panels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const panel = db.prepare('SELECT * FROM fusion_panels WHERE id = ?').get(id) as any;
    if (!panel) return reply.code(404).send({ error: 'Fusion panel not found' });
    db.prepare('DELETE FROM fusion_panel_slots WHERE panel_id = ?').run(id);
    db.prepare('DELETE FROM fusion_panels WHERE id = ?').run(id);
    return { success: true };
  });

  // POST /admin/fusion-panels/:id/slots — add a slot to an existing panel
  server.post('/admin/fusion-panels/:id/slots', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { provider_id: string; model_id: string; display_name: string; slot_order?: number; is_enabled?: number };
    const db = getDb();
    const panel = db.prepare('SELECT * FROM fusion_panels WHERE id = ?').get(id) as any;
    if (!panel) return reply.code(404).send({ error: 'Fusion panel not found' });
    if (!body.provider_id || !body.model_id || !body.display_name) {
      return reply.code(400).send({ error: 'provider_id, model_id, and display_name are required' });
    }

    // Get next slot_order
    const maxOrder = db.prepare('SELECT MAX(slot_order) as max_order FROM fusion_panel_slots WHERE panel_id = ?').get(id) as { max_order: number | null };
    const nextOrder = (maxOrder.max_order ?? -1) + 1;

    const slotId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO fusion_panel_slots (id, panel_id, provider_id, model_id, display_name, slot_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(slotId, id, body.provider_id, body.model_id, body.display_name, body.slot_order ?? nextOrder, body.is_enabled ?? 1);

    const slot = db.prepare('SELECT * FROM fusion_panel_slots WHERE id = ?').get(slotId);
    return reply.code(201).send(slot);
  });

  // DELETE /admin/fusion-panels/:panelId/slots/:slotId — remove a slot
  server.delete('/admin/fusion-panels/:panelId/slots/:slotId', async (request, reply) => {
    const { panelId, slotId } = request.params as { panelId: string; slotId: string };
    const db = getDb();
    const slot = db.prepare('SELECT * FROM fusion_panel_slots WHERE id = ? AND panel_id = ?').get(slotId, panelId) as any;
    if (!slot) return reply.code(404).send({ error: 'Slot not found' });
    db.prepare('DELETE FROM fusion_panel_slots WHERE id = ?').run(slotId);
    return { success: true };
  });

  // PUT /admin/fusion-panels/:panelId/slots/reorder — reorder all slots
  server.put('/admin/fusion-panels/:panelId/slots/reorder', async (request, reply) => {
    const { panelId } = request.params as { panelId: string };
    const body = request.body as { slot_ids: string[] };
    const db = getDb();
    const panel = db.prepare('SELECT * FROM fusion_panels WHERE id = ?').get(panelId) as any;
    if (!panel) return reply.code(404).send({ error: 'Fusion panel not found' });
    if (!body.slot_ids || !Array.isArray(body.slot_ids)) {
      return reply.code(400).send({ error: 'slot_ids array is required' });
    }

    const stmt = db.prepare("UPDATE fusion_panel_slots SET slot_order = ?, updated_at = datetime('now') WHERE id = ? AND panel_id = ?");
    db.transaction(() => {
      for (let i = 0; i < body.slot_ids.length; i++) {
        stmt.run(i, body.slot_ids[i], panelId);
      }
    });

    const slots = db.prepare('SELECT * FROM fusion_panel_slots WHERE panel_id = ? ORDER BY slot_order').all(panelId);
    return { slots };
  });
}
