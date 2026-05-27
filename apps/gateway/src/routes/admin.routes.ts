import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '@dmr-x/db';
import { ValidationError } from '@dmr-x/core';

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
  modality: z.enum(['llm', 'diffusion', 'embedding', 'audio_speech', 'audio_transcription', 'video', 'music']),
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

export async function adminRoutes(server: FastifyInstance): Promise<void> {
  // List providers
  server.get('/admin/providers', async () => {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM providers ORDER BY name'
    );
    return { providers: result.rows };
  });

  // Test provider connection with a given API key
  server.post('/admin/providers/test', async (request) => {
    const parsed = TestProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const { provider_id, base_url, api_key } = parsed.data;
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // Try /models endpoint first (works for most OpenAI-compatible providers)
      let response = await fetch(`${base_url}/models`, {
        headers: { 'Authorization': `Bearer ${api_key}` },
        signal: controller.signal,
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
        message: `Connection error: ${msg}`,
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
    const pool = getPool();

    const result = await pool.query(
      `INSERT INTO providers (name, adapter_type, base_url, api_key_ref, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [body.name, body.adapter_type, body.base_url, body.api_key_ref, JSON.stringify(body.config)]
    );

    reply.status(201);
    return result.rows[0];
  });

  // List models
  server.get('/admin/models', async () => {
    const pool = getPool();
    const result = await pool.query(
      `SELECT mp.*, p.name as provider_name
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       ORDER BY mp.modality, mp.model_id`
    );
    return { models: result.rows };
  });

  // Create model
  server.post('/admin/models', async (request, reply) => {
    const parsed = CreateModelSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const pool = getPool();

    const result = await pool.query(
      `INSERT INTO model_profiles (
        provider_id, model_id, display_name, modality, intelligence_layer,
        context_window, max_output_tokens, supports_streaming, supports_vision,
        supports_tool_use, input_cost_per_1k, output_cost_per_1k, cost_per_image
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        body.provider_id, body.model_id, body.display_name, body.modality,
        body.intelligence_layer, body.context_window, body.max_output_tokens,
        body.supports_streaming, body.supports_vision, body.supports_tool_use,
        body.input_cost_per_1k, body.output_cost_per_1k, body.cost_per_image,
      ]
    );

    reply.status(201);
    return result.rows[0];
  });

  // Create tenant
  server.post('/admin/tenants', async (request, reply) => {
    const { name } = request.body as { name: string };
    if (!name) {
      throw new ValidationError('Name is required');
    }

    const pool = getPool();
    const result = await pool.query(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING *',
      [name]
    );

    reply.status(201);
    return result.rows[0];
  });

  // Create API key
  server.post('/admin/api-keys', async (request, reply) => {
    const { tenant_id, name } = request.body as { tenant_id: string; name?: string };
    if (!tenant_id) {
      throw new ValidationError('tenant_id is required');
    }

    const { generateApiKey, hashApiKey } = await import('@dmr-x/utils');
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);

    const pool = getPool();
    const result = await pool.query(
      'INSERT INTO api_keys (tenant_id, key_hash, name) VALUES ($1, $2, $3) RETURNING id, tenant_id, name, created_at',
      [tenant_id, keyHash, name]
    );

    reply.status(201);
    return {
      ...result.rows[0],
      key: apiKey, // Only shown once
    };
  });

  // List tenants
  server.get('/admin/tenants', async () => {
    const pool = getPool();
    const result = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM api_keys WHERE tenant_id = t.id AND is_active = true) as key_count
      FROM tenants t ORDER BY name
    `);
    return { tenants: result.rows };
  });

  // List API keys
  server.get('/admin/api-keys', async () => {
    const pool = getPool();
    const result = await pool.query(`
      SELECT ak.id, ak.tenant_id, t.name as tenant_name, ak.name, ak.is_active, ak.created_at, ak.last_used_at
      FROM api_keys ak
      JOIN tenants t ON t.id = ak.tenant_id
      ORDER BY ak.created_at DESC
    `);
    return { api_keys: result.rows };
  });

  // List benchmark results
  server.get('/admin/benchmarks', async () => {
    const pool = getPool();
    const result = await pool.query(`
      SELECT br.*, mp.display_name as model_name, mp.model_id as model_identifier
      FROM benchmark_results br
      JOIN model_profiles mp ON mp.id = br.model_id
      ORDER BY br.run_at DESC
      LIMIT 100
    `);
    return { benchmarks: result.rows };
  });

  // List policies
  server.get('/admin/policies', async () => {
    const pool = getPool();
    const result = await pool.query(`
      SELECT p.*, t.name as tenant_name
      FROM policies p
      JOIN tenants t ON t.id = p.tenant_id
      ORDER BY p.created_at DESC
    `);
    return { policies: result.rows };
  });

  // Usage history (hourly for last 24h)
  server.get('/admin/billing/usage-history', async () => {
    const pool = getPool();
    const result = await pool.query(`
      SELECT
        date_trunc('hour', created_at) as time,
        COUNT(*) as requests,
        SUM(total_tokens) as tokens,
        SUM(cost_cents)::float / 100 as cost
      FROM usage_records
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY date_trunc('hour', created_at)
      ORDER BY time
    `);
    return { history: result.rows };
  });

  // Billing summary
  server.get('/admin/billing/summary', async () => {
    const pool = getPool();

    // Current month spend
    const currentMonth = await pool.query(`
      SELECT COALESCE(SUM(cost_cents)::float / 100, 0) as spend
      FROM usage_records
      WHERE created_at >= date_trunc('month', NOW())
    `);

    // Previous month spend
    const previousMonth = await pool.query(`
      SELECT COALESCE(SUM(cost_cents)::float / 100, 0) as spend
      FROM usage_records
      WHERE created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
        AND created_at < date_trunc('month', NOW())
    `);

    // Cost by provider
    const costByProvider = await pool.query(`
      SELECT p.name as provider, COALESCE(SUM(ur.cost_cents)::float / 100, 0) as cost
      FROM usage_records ur
      JOIN providers p ON p.id::text = ur.provider_id
      WHERE ur.created_at >= date_trunc('month', NOW())
      GROUP BY p.name
      ORDER BY cost DESC
    `);

    // Cost by model
    const costByModel = await pool.query(`
      SELECT ur.model_id as model, COALESCE(SUM(ur.cost_cents)::float / 100, 0) as cost
      FROM usage_records ur
      WHERE ur.created_at >= date_trunc('month', NOW())
      GROUP BY ur.model_id
      ORDER BY cost DESC
      LIMIT 10
    `);

    // Cost by modality
    const costByModality = await pool.query(`
      SELECT mp.modality, COALESCE(SUM(ur.cost_cents)::float / 100, 0) as cost
      FROM usage_records ur
      JOIN model_profiles mp ON mp.model_id = ur.model_id
      WHERE ur.created_at >= date_trunc('month', NOW())
      GROUP BY mp.modality
      ORDER BY cost DESC
    `);

    const currentSpend = currentMonth.rows[0]?.spend || 0;
    const daysInMonth = 30;
    const dayOfMonth = new Date().getDate();
    const estimatedEndOfMonth = dayOfMonth > 0 ? (currentSpend / dayOfMonth) * daysInMonth : 0;

    return {
      id: 'billing-current',
      tenant_id: null,
      tenant_name: 'All Tenants',
      current_month_spend: currentSpend,
      estimated_end_of_month: estimatedEndOfMonth,
      previous_month_spend: previousMonth.rows[0]?.spend || 0,
      cost_by_provider: costByProvider.rows,
      cost_by_model: costByModel.rows,
      cost_by_modality: costByModality.rows,
      invoices: [],
      plan_limits: { requests: null, tokens: null, spend: null },
      overage_flags: [],
    };
  });

  // Dashboard stats
  server.get('/admin/dashboard/stats', async () => {
    const pool = getPool();

    // Total requests today
    const requestsResult = await pool.query(`
      SELECT COUNT(*) as total,
        COUNT(*) FILTER (WHERE error_code IS NULL) as success,
        AVG(latency_ms) as avg_latency
      FROM request_logs
      WHERE timestamp >= date_trunc('day', NOW())
    `);

    // Token usage today
    const tokenResult = await pool.query(`
      SELECT COALESCE(SUM(total_tokens), 0) as tokens,
        COALESCE(SUM(cost_cents)::float / 100, 0) as spend
      FROM usage_records
      WHERE created_at >= date_trunc('day', NOW())
    `);

    // Active models
    const modelsResult = await pool.query(`
      SELECT COUNT(*) as count FROM model_profiles WHERE is_active = true
    `);

    // Provider health
    const providersResult = await pool.query(`
      SELECT COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_healthy = true) as healthy
      FROM providers
    `);

    // Fallback rate
    const fallbackResult = await pool.query(`
      SELECT COUNT(*) as total,
        COUNT(*) FILTER (WHERE fallback_used = true) as fallbacks
      FROM request_logs
      WHERE timestamp >= date_trunc('day', NOW())
    `);

    const req = requestsResult.rows[0];
    const total = parseInt(req.total) || 0;
    const success = parseInt(req.success) || 0;
    const fallbackTotal = parseInt(fallbackResult.rows[0]?.total) || 0;
    const fallbacks = parseInt(fallbackResult.rows[0]?.fallbacks) || 0;
    const providerTotal = parseInt(providersResult.rows[0]?.total) || 0;
    const providerHealthy = parseInt(providersResult.rows[0]?.healthy) || 0;

    return {
      total_requests: total,
      success_rate: total > 0 ? Math.round((success / total) * 100 * 10) / 10 : 100,
      avg_latency: Math.round(req.avg_latency || 0),
      token_usage: parseInt(tokenResult.rows[0]?.tokens) || 0,
      daily_spend: tokenResult.rows[0]?.spend || 0,
      quota_remaining: 1000000,
      active_models: parseInt(modelsResult.rows[0]?.count) || 0,
      provider_health: providerTotal > 0 ? Math.round((providerHealthy / providerTotal) * 100) : 100,
      fallback_rate: fallbackTotal > 0 ? Math.round((fallbacks / fallbackTotal) * 100 * 10) / 10 : 0,
      worker_utilization: 0,
      system_status: 'operational',
    };
  });

  // Route decisions
  server.get('/admin/routing/decisions', async () => {
    const pool = getPool();
    const result = await pool.query(`
      SELECT
        rl.id,
        rl.timestamp,
        rl.task_profile->>'taskType' as task_type,
        rl.selected_model,
        p.name as selected_provider,
        rl.routing_plan->>'executionMode' as execution_mode,
        rl.routing_plan->>'decisionReason' as decision_reason,
        COALESCE(rl.routing_plan->'fallbackChain', '[]') as fallback_chain,
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
    `);
    return { decisions: result.rows };
  });

  // Quota states
  server.get('/admin/quota', async () => {
    const pool = getPool();
    const result = await pool.query(`
      SELECT
        qa.id,
        qa.provider_id,
        p.name as provider_name,
        qa.max_requests as total_quota,
        COALESCE(
          (SELECT COUNT(*) FROM request_logs rl
           WHERE rl.selected_provider = qa.provider_id
           AND rl.timestamp >= date_trunc('month', NOW())),
          0
        ) as used_quota,
        qa.max_requests - COALESCE(
          (SELECT COUNT(*) FROM request_logs rl
           WHERE rl.selected_provider = qa.provider_id
           AND rl.timestamp >= date_trunc('month', NOW())),
          0
        ) as remaining_quota,
        qa.period as window,
        date_trunc('month', NOW() + INTERVAL '1 month')::text as reset_time,
        0 as burn_rate,
        null as predicted_exhaustion,
        '[]'::jsonb as alerts,
        '[]'::jsonb as rerouting_suggestions
      FROM quota_allocations qa
      LEFT JOIN providers p ON p.id = qa.provider_id
      ORDER BY p.name
    `);
    return { quotas: result.rows };
  });

  // Alerts (derived from system state)
  server.get('/admin/alerts', async () => {
    const pool = getPool();
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
    const unhealthyProviders = await pool.query(`
      SELECT name, consecutive_failures, last_health_check
      FROM providers
      WHERE is_healthy = false OR consecutive_failures > 0
    `);

    for (const p of unhealthyProviders.rows) {
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
    const quotaUsage = await pool.query(`
      SELECT
        p.name as provider_name,
        qa.max_requests,
        COALESCE(
          (SELECT COUNT(*) FROM request_logs rl
           WHERE rl.selected_provider = qa.provider_id
           AND rl.timestamp >= date_trunc('month', NOW())),
          0
        ) as used
      FROM quota_allocations qa
      JOIN providers p ON p.id = qa.provider_id
      WHERE qa.max_requests IS NOT NULL
    `);

    for (const q of quotaUsage.rows) {
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

  server.get('/admin/telemetry/events', async () => {
    return { events: telemetryBuffer.slice(-100) };
  });

  // Expose buffer for adding events from other routes
  (server as unknown as Record<string, unknown>).telemetryBuffer = telemetryBuffer;

  // Audit events
  server.get('/admin/audit/events', async () => {
    const pool = getPool();

    // Get recent request logs as audit events
    const result = await pool.query(`
      SELECT
        rl.id::text,
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
        rl.tenant_id::text,
        CONCAT('Request to ', rl.selected_model, ' via provider') as description,
        jsonb_build_object(
          'model', rl.selected_model,
          'latency_ms', rl.latency_ms,
          'tokens', rl.tokens_input + rl.tokens_output,
          'fallback', rl.fallback_used
        ) as metadata,
        null as ip_address
      FROM request_logs rl
      ORDER BY rl.timestamp DESC
      LIMIT 100
    `);

    return { events: result.rows };
  });

  // Stub endpoints for "Coming Soon" features
  // These return empty arrays so hooks fall back to mock data gracefully

  server.get('/admin/memory/items', async () => {
    return { items: [] };
  });

  server.get('/admin/sandbox/jobs', async () => {
    return { jobs: [] };
  });

  server.get('/admin/scheduler/workers', async () => {
    return { workers: [] };
  });

  server.get('/admin/federation/nodes', async () => {
    return { nodes: [] };
  });

  // --- DELETE endpoints ---

  // Delete provider
  server.delete('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pool = getPool();
    await pool.query('DELETE FROM providers WHERE id = $1', [id]);
    reply.status(204);
    return null;
  });

  // Delete model
  server.delete('/admin/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pool = getPool();
    await pool.query('DELETE FROM model_profiles WHERE id = $1', [id]);
    reply.status(204);
    return null;
  });

  // Delete tenant
  server.delete('/admin/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pool = getPool();
    await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
    reply.status(204);
    return null;
  });

  // Delete API key
  server.delete('/admin/api-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pool = getPool();
    await pool.query('DELETE FROM api_keys WHERE id = $1', [id]);
    reply.status(204);
    return null;
  });

  // Delete policy
  server.delete('/admin/policies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pool = getPool();
    await pool.query('DELETE FROM policies WHERE id = $1', [id]);
    reply.status(204);
    return null;
  });

  // --- UPDATE endpoints ---

  // Update provider
  server.put('/admin/providers/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { name, adapter_type, base_url, api_key_ref, config } = request.body as {
      name?: string;
      adapter_type?: string;
      base_url?: string;
      api_key_ref?: string;
      config?: Record<string, unknown>;
    };
    const pool = getPool();
    const result = await pool.query(
      `UPDATE providers SET
        name = COALESCE($2, name),
        adapter_type = COALESCE($3, adapter_type),
        base_url = COALESCE($4, base_url),
        api_key_ref = COALESCE($5, api_key_ref),
        config = COALESCE($6, config),
        updated_at = NOW()
      WHERE id = $1 RETURNING *`,
      [id, name, adapter_type, base_url, api_key_ref, config ? JSON.stringify(config) : null]
    );
    return result.rows[0];
  });

  // Update model
  server.put('/admin/models/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { display_name, modality, context_window, max_output_tokens, is_active } = request.body as {
      display_name?: string;
      modality?: string;
      context_window?: number;
      max_output_tokens?: number;
      is_active?: boolean;
    };
    const pool = getPool();
    const result = await pool.query(
      `UPDATE model_profiles SET
        display_name = COALESCE($2, display_name),
        modality = COALESCE($3, modality),
        context_window = COALESCE($4, context_window),
        max_output_tokens = COALESCE($5, max_output_tokens),
        is_active = COALESCE($6, is_active),
        updated_at = NOW()
      WHERE id = $1 RETURNING *`,
      [id, display_name, modality, context_window, max_output_tokens, is_active]
    );
    return result.rows[0];
  });

  // Update policy
  server.put('/admin/policies/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { name, rules, is_active } = request.body as {
      name?: string;
      rules?: Record<string, unknown>[];
      is_active?: boolean;
    };
    const pool = getPool();
    const result = await pool.query(
      `UPDATE policies SET
        name = COALESCE($2, name),
        rules = COALESCE($3, rules),
        is_active = COALESCE($4, is_active),
        updated_at = NOW()
      WHERE id = $1 RETURNING *`,
      [id, name, rules ? JSON.stringify(rules) : null, is_active]
    );
    return result.rows[0];
  });

  // --- Settings backend ---

  // Get settings
  server.get('/admin/settings', async () => {
    const pool = getPool();
    // Create settings table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const result = await pool.query('SELECT key, value FROM settings');
    const settings: Record<string, unknown> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });

  // Update settings
  server.put('/admin/settings', async (request) => {
    const settings = request.body as Record<string, unknown>;
    const pool = getPool();
    // Create settings table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }
    return { success: true };
  });
}
