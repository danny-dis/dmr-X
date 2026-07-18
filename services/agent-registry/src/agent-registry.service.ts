import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

import type {
  AgentDefinitionCreate,
  AgentDefinitionUpdate,
  AgentInstanceCreate,
  AgentListingCreate,
  AgentRatingCreate,
  AgentListQuery,
  MarketplaceQuery,
  AgentImportResult,
} from './agent-schema.js';

import {
  parseAgentMdBatch,
  fetchGitHubRepoMdFiles,
  extractZipMdFiles,
} from './agent-config-loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  humanName?: string | null;
  version: string;
  systemPrompt: string | null;
  personality: string | null;
  preferredModel: string | null;
  modelTier: string;
  allowedTools: string[];
  customTools: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>;
  workflow: Record<string, unknown> | null;
  triggers: Array<Record<string, unknown>>;
  visibility: string;
  tags: string[];
  category: string | null;
  icon: string | null;
  skills?: string[];
  skillNudgeInterval?: number;
  verifyOnStop?: boolean;
  planMode?: boolean;
  historyCompaction?: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInstance {
  id: string;
  agentDefinitionId: string;
  tenantId: string;
  status: string;
  configOverride: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentExecution {
  id: string;
  agentInstanceId: string;
  tenantId: string;
  input: string | null;
  output: string | null;
  toolsUsed: string[];
  modelUsed: string | null;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface AgentEvaluation {
  id: string;
  agentInstanceId: string;
  tenantId: string;
  executionId: string;
  status: string;
  toolSuccessRate: number;
  budgetAdherence: number;
  turnEfficiency: number;
  score: number;
  breakdown: Record<string, unknown>;
  createdAt: string;
}

export interface AgentListing {
  id: string;
  agentDefinitionId: string;
  publisherTenantId: string;
  title: string;
  description: string | null;
  longDescription: string | null;
  category: string | null;
  tags: string[];
  icon: string | null;
  screenshots: string[];
  rating: number;
  ratingCount: number;
  installCount: number;
  priceCents: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInstall {
  id: string;
  listingId: string;
  tenantId: string;
  agentInstanceId: string;
  installedAt: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AgentRegistryService {
  // ── Agent Definitions ─────────────────────────────────────────────────────

  async createDefinition(tenantId: string, input: AgentDefinitionCreate): Promise<AgentDefinition> {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO agent_definitions (
        id, tenant_id, name, description, version, system_prompt,
        personality, preferred_model, model_tier, allowed_tools, custom_tools,
        workflow, triggers, visibility, tags, category, icon, skills, human_name,
        skill_nudge_interval, verify_on_stop, plan_mode, history_compaction,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tenantId,
      input.name,
      input.description ?? null,
      input.version ?? '1.0.0',
      input.systemPrompt ?? null,
      input.personality ?? null,
      input.preferredModel ?? null,
      input.modelTier ?? 'auto',
      JSON.stringify(input.allowedTools ?? []),
      JSON.stringify(input.customTools ?? []),
      input.workflow ? JSON.stringify(input.workflow) : null,
      JSON.stringify(input.triggers ?? []),
      input.visibility ?? 'private',
      JSON.stringify(input.tags ?? []),
      input.category ?? null,
      input.icon ?? null,
      JSON.stringify(input.skills ?? []),
      input.humanName ?? null,
      input.skillNudgeInterval ?? 8,
      input.verifyOnStop ? 1 : 0,
      input.planMode ? 1 : 0,
      input.historyCompaction ? 1 : 0,
      now,
      now,
    );

    logger.info({ id, tenantId, name: input.name }, 'Agent definition created');
    const created = await this.getDefinition(id);
    if (!created) throw new Error('Failed to retrieve created agent definition');
    return created;
  }

  async getDefinition(id: string): Promise<AgentDefinition | null> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agent_definitions WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToDefinition(row);
  }

  async listDefinitions(tenantId: string, query: AgentListQuery): Promise<{ items: AgentDefinition[]; total: number }> {
    const db = getDb();
    const conditions = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    if (query.visibility) {
      conditions.push('visibility = ?');
      params.push(query.visibility);
    }
    if (query.category) {
      conditions.push('category = ?');
      params.push(query.category);
    }
    if (query.tag) {
      // SQLite JSON: use LIKE for tag search
      conditions.push("tags LIKE ?");
      params.push(`%${query.tag}%`);
    }
    if (query.search) {
      conditions.push("(name LIKE ? OR description LIKE ?)");
      params.push(`%${query.search}%`, `%${query.search}%`);
    }

    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;

    const where = conditions.join(' AND ');

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM agent_definitions WHERE ${where}`).get(...params) as any;
    const total = countRow?.total ?? 0;

    const rows = db.prepare(
      `SELECT * FROM agent_definitions WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    return {
      items: rows.map((r) => this.rowToDefinition(r)),
      total,
    };
  }

  async updateDefinition(id: string, tenantId: string, input: AgentDefinitionUpdate): Promise<AgentDefinition | null> {
    const db = getDb();
    const existing = await this.getDefinition(id);
    if (!existing || existing.tenantId !== tenantId) return null;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) { updates.push('name = ?'); params.push(input.name); }
    if (input.description !== undefined) { updates.push('description = ?'); params.push(input.description); }
    if (input.version !== undefined) { updates.push('version = ?'); params.push(input.version); }
    if (input.systemPrompt !== undefined) { updates.push('system_prompt = ?'); params.push(input.systemPrompt); }
    if (input.personality !== undefined) { updates.push('personality = ?'); params.push(input.personality); }
    if (input.preferredModel !== undefined) { updates.push('preferred_model = ?'); params.push(input.preferredModel); }
    if (input.modelTier !== undefined) { updates.push('model_tier = ?'); params.push(input.modelTier); }
    if (input.allowedTools !== undefined) { updates.push('allowed_tools = ?'); params.push(JSON.stringify(input.allowedTools)); }
    if (input.customTools !== undefined) { updates.push('custom_tools = ?'); params.push(JSON.stringify(input.customTools)); }
    if (input.workflow !== undefined) { updates.push('workflow = ?'); params.push(input.workflow ? JSON.stringify(input.workflow) : null); }
    if (input.triggers !== undefined) { updates.push('triggers = ?'); params.push(JSON.stringify(input.triggers)); }
    if (input.visibility !== undefined) { updates.push('visibility = ?'); params.push(input.visibility); }
    if (input.tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(input.tags)); }
    if (input.category !== undefined) { updates.push('category = ?'); params.push(input.category); }
    if (input.icon !== undefined) { updates.push('icon = ?'); params.push(input.icon); }
    if (input.humanName !== undefined) { updates.push('human_name = ?'); params.push(input.humanName); }
    if (input.skills !== undefined) { updates.push('skills = ?'); params.push(JSON.stringify(input.skills)); }
    if (input.skillNudgeInterval !== undefined) { updates.push('skill_nudge_interval = ?'); params.push(input.skillNudgeInterval); }
    if (input.verifyOnStop !== undefined) { updates.push('verify_on_stop = ?'); params.push(input.verifyOnStop ? 1 : 0); }
    if (input.planMode !== undefined) { updates.push('plan_mode = ?'); params.push(input.planMode ? 1 : 0); }
    if (input.historyCompaction !== undefined) { updates.push('history_compaction = ?'); params.push(input.historyCompaction ? 1 : 0); }

    if (updates.length === 0) return existing;

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    db.prepare(`UPDATE agent_definitions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    logger.info({ id, tenantId }, 'Agent definition updated');
    return this.getDefinition(id);
  }

  async deleteDefinition(id: string, tenantId: string): Promise<boolean> {
    const db = getDb();
    const existing = await this.getDefinition(id);
    if (!existing || existing.tenantId !== tenantId) return false;

    db.prepare('DELETE FROM agent_definitions WHERE id = ?').run(id);
    logger.info({ id, tenantId }, 'Agent definition deleted');
    return true;
  }

  /**
   * Bulk-import agent definitions and automatically deploy an instance for
   * each so they are ready to call immediately. On name collision the
   * duplicate is created with an incrementing numeric suffix
   * (e.g. "Frontend Developer", "Frontend Developer (1)"). Visibility is
   * forced to 'public' regardless of per-definition value.
   */
  async importAgents(
    tenantId: string,
    definitions: AgentDefinitionCreate[],
    options: { modelTier?: string } = {},
  ): Promise<AgentImportResult> {
    const visibility = 'public'; // forced per import policy
    const modelTier = options.modelTier ?? 'auto';
    const imported: AgentImportResult['agents'] = [];
    const errors: AgentImportResult['errors'] = [];
    let skipped = 0;

    const existingNames = await this.getExistingDefinitionNames(tenantId);

    for (const def of definitions) {
      try {
        if (!def.name) {
          errors.push({ file: '(unnamed)', error: 'Missing agent name' });
          continue;
        }

        // Duplicate handling: create with incrementing suffix
        let finalName = def.name;
        if (existingNames.has(finalName.toLowerCase())) {
          let suffix = 1;
          while (existingNames.has(`${finalName} (${suffix})`.toLowerCase())) suffix++;
          finalName = `${finalName} (${suffix})`;
          skipped++;
        }
        existingNames.add(finalName.toLowerCase());

        const definition = await this.createDefinition(tenantId, {
          ...def,
          name: finalName,
          visibility,
          modelTier: (def.modelTier ?? modelTier) as AgentDefinitionCreate['modelTier'],
        });

        // Auto-deploy so the agent is ready to call downstream immediately
        const instance = await this.createInstance(tenantId, {
          agentDefinitionId: definition.id,
          configOverride: {},
        });
        if (!instance) throw new Error('Failed to create agent instance');

        imported.push({
          id: definition.id,
          name: finalName,
          instanceId: instance.id,
          category: definition.category ?? null,
        });
      } catch (error) {
        errors.push({
          file: def.name ?? '(unnamed)',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { imported: imported.length, skipped, errors, agents: imported };
  }

  private async getExistingDefinitionNames(tenantId: string): Promise<Set<string>> {
    const db = getDb();
    const rows = db
      .prepare('SELECT name FROM agent_definitions WHERE tenant_id = ?')
      .all(tenantId) as Array<{ name: string }>;
    return new Set((rows ?? []).map((r) => String(r.name).toLowerCase()));
  }

  // ── Agent Instances ───────────────────────────────────────────────────────

  async createInstance(tenantId: string, input: AgentInstanceCreate): Promise<AgentInstance | null> {
    const db = getDb();
    const definition = await this.getDefinition(input.agentDefinitionId);
    if (!definition) return null;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO agent_instances (id, agent_definition_id, tenant_id, status, config_override, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)
    `).run(id, input.agentDefinitionId, tenantId, JSON.stringify(input.configOverride ?? {}), now, now);

    logger.info({ id, tenantId, definitionId: input.agentDefinitionId }, 'Agent instance created');
    return this.getInstance(id);
  }

  async getInstance(id: string): Promise<AgentInstance | null> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agent_instances WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToInstance(row);
  }

  async listInstances(tenantId: string): Promise<AgentInstance[]> {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM agent_instances WHERE tenant_id = ? ORDER BY created_at DESC'
    ).all(tenantId) as any[];
    return rows.map((r) => this.rowToInstance(r));
  }

  async deleteInstance(id: string, tenantId: string): Promise<boolean> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agent_instances WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!row) return false;
    db.prepare('DELETE FROM agent_instances WHERE id = ?').run(id);
    logger.info({ id, tenantId }, 'Agent instance deleted');
    return true;
  }

  // ── Agent Executions ──────────────────────────────────────────────────────

  async recordExecution(input: {
    agentInstanceId: string;
    tenantId: string;
    input?: string;
    output?: string;
    toolsUsed?: string[];
    modelUsed?: string;
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
    durationMs?: number;
    status?: string;
    error?: string;
  }): Promise<AgentExecution> {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO agent_executions (
        id, agent_instance_id, tenant_id, input, output, tools_used,
        model_used, input_tokens, output_tokens, cost_cents,
        duration_ms, status, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.agentInstanceId,
      input.tenantId,
      input.input ?? null,
      input.output ?? null,
      JSON.stringify(input.toolsUsed ?? []),
      input.modelUsed ?? null,
      input.inputTokens ?? 0,
      input.outputTokens ?? 0,
      input.costCents ?? 0,
      input.durationMs ?? 0,
      input.status ?? 'success',
      input.error ?? null,
      now,
    );

    return {
      id,
      agentInstanceId: input.agentInstanceId,
      tenantId: input.tenantId,
      input: input.input ?? null,
      output: input.output ?? null,
      toolsUsed: input.toolsUsed ?? [],
      modelUsed: input.modelUsed ?? null,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      costCents: input.costCents ?? 0,
      durationMs: input.durationMs ?? 0,
      status: input.status ?? 'success',
      error: input.error ?? null,
      createdAt: now,
    };
  }

  async listExecutions(agentInstanceId: string, tenantId: string, limit = 50): Promise<AgentExecution[]> {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM agent_executions WHERE agent_instance_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(agentInstanceId, tenantId, limit) as any[];
    return rows.map((r) => this.rowToExecution(r));
  }

  async getExecutionStats(agentInstanceId: string, tenantId: string): Promise<{
    totalExecutions: number;
    successCount: number;
    errorCount: number;
    totalTokens: number;
    totalCostCents: number;
    avgDurationMs: number;
  }> {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(*) as totalExecutions,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCount,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errorCount,
        SUM(input_tokens + output_tokens) as totalTokens,
        SUM(cost_cents) as totalCostCents,
        AVG(duration_ms) as avgDurationMs
      FROM agent_executions
      WHERE agent_instance_id = ? AND tenant_id = ?
    `).get(agentInstanceId, tenantId) as any;

    return {
      totalExecutions: row?.totalExecutions ?? 0,
      successCount: row?.successCount ?? 0,
      errorCount: row?.errorCount ?? 0,
      totalTokens: row?.totalTokens ?? 0,
      totalCostCents: row?.totalCostCents ?? 0,
      avgDurationMs: Math.round(row?.avgDurationMs ?? 0),
    };
  }

  // ── Marketplace ───────────────────────────────────────────────────────────

  async createListing(tenantId: string, input: AgentListingCreate): Promise<AgentListing | null> {
    const db = getDb();
    const definition = await this.getDefinition(input.agentDefinitionId);
    if (!definition || definition.tenantId !== tenantId) return null;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO agent_listings (
        id, agent_definition_id, publisher_tenant_id, title, description,
        long_description, category, tags, icon, screenshots,
        rating, rating_count, install_count, price_cents, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'draft', ?, ?)
    `).run(
      id,
      input.agentDefinitionId,
      tenantId,
      input.title,
      input.description ?? null,
      input.longDescription ?? null,
      input.category ?? null,
      JSON.stringify(input.tags ?? []),
      input.icon ?? null,
      JSON.stringify(input.screenshots ?? []),
      input.priceCents ?? 0,
      now,
      now,
    );

    logger.info({ id, tenantId, title: input.title }, 'Agent listing created');
    return this.getListing(id);
  }

  async getListing(id: string): Promise<AgentListing | null> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agent_listings WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToListing(row);
  }

  async publishListing(id: string, tenantId: string): Promise<AgentListing | null> {
    const db = getDb();
    const existing = await this.getListing(id);
    if (!existing || existing.publisherTenantId !== tenantId) return null;

    const now = new Date().toISOString();
    db.prepare("UPDATE agent_listings SET status = 'published', updated_at = ? WHERE id = ?").run(now, id);

    // Also publish the underlying definition
    db.prepare("UPDATE agent_definitions SET visibility = 'public', published_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, existing.agentDefinitionId);

    logger.info({ id, tenantId }, 'Agent listing published');
    return this.getListing(id);
  }

  async deprecateListing(id: string, tenantId: string): Promise<AgentListing | null> {
    const db = getDb();
    const existing = await this.getListing(id);
    if (!existing || existing.publisherTenantId !== tenantId) return null;

    const now = new Date().toISOString();
    db.prepare("UPDATE agent_listings SET status = 'deprecated', updated_at = ? WHERE id = ?").run(now, id);
    logger.info({ id, tenantId }, 'Agent listing deprecated');
    return this.getListing(id);
  }

  async deleteListing(id: string, tenantId: string): Promise<boolean> {
    const db = getDb();
    const existing = await this.getListing(id);
    if (!existing || existing.publisherTenantId !== tenantId) return false;
    db.prepare('DELETE FROM agent_listings WHERE id = ?').run(id);
    logger.info({ id, tenantId }, 'Agent listing deleted');
    return true;
  }

  async browseMarketplace(query: MarketplaceQuery): Promise<{ items: AgentListing[]; total: number }> {
    const db = getDb();
    const conditions = ["status = 'published'"];
    const params: unknown[] = [];

    if (query.category) {
      conditions.push('category = ?');
      params.push(query.category);
    }
    if (query.tag) {
      conditions.push("tags LIKE ?");
      params.push(`%${query.tag}%`);
    }
    if (query.search) {
      conditions.push("(title LIKE ? OR description LIKE ?)");
      params.push(`%${query.search}%`, `%${query.search}%`);
    }

    const where = conditions.join(' AND ');
    const offset = (query.page - 1) * query.limit;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM agent_listings WHERE ${where}`).get(...params) as any;
    const total = countRow?.total ?? 0;

    let orderBy = 'rating DESC, install_count DESC';
    if (query.sort === 'installs') orderBy = 'install_count DESC';
    if (query.sort === 'newest') orderBy = 'created_at DESC';
    if (query.sort === 'price') orderBy = 'price_cents ASC, rating DESC';

    const rows = db.prepare(
      `SELECT * FROM agent_listings WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, query.limit, offset) as any[];

    return {
      items: rows.map((r) => this.rowToListing(r)),
      total,
    };
  }

  async installFromMarketplace(listingId: string, tenantId: string): Promise<{ instance: AgentInstance; listing: AgentListing } | null> {
    const db = getDb();
    const listing = await this.getListing(listingId);
    if (!listing || listing.status !== 'published') return null;

    // Check if already installed
    const existing = db.prepare(
      'SELECT * FROM agent_installs WHERE listing_id = ? AND tenant_id = ?'
    ).get(listingId, tenantId) as any;
    if (existing) {
      const instance = await this.getInstance(existing.agent_instance_id);
      if (instance) return { instance, listing };
    }

    // Create instance from the listing's definition
    const instance = await this.createInstance(tenantId, {
      agentDefinitionId: listing.agentDefinitionId,
      configOverride: {},
    });
    if (!instance) return null;

    // Record install
    const installId = crypto.randomUUID();
    const installDb = getDb();
    installDb.prepare(`
      INSERT INTO agent_installs (id, listing_id, tenant_id, agent_instance_id, installed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(installId, listingId, tenantId, instance.id, new Date().toISOString());

    // Increment install count
    const installCountDb = getDb();
    installCountDb.prepare('UPDATE agent_listings SET install_count = install_count + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), listingId);

    logger.info({ listingId, tenantId, instanceId: instance.id }, 'Agent installed from marketplace');
    const updatedListing = await this.getListing(listingId);
    return { instance, listing: updatedListing! };
  }

  async rateListing(listingId: string, tenantId: string, input: AgentRatingCreate): Promise<void> {
    const listing = await this.getListing(listingId);
    if (!listing) return;

    const db = getDb();

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO agent_ratings (id, listing_id, tenant_id, rating, review, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id, tenant_id) DO UPDATE SET rating = ?, review = ?, created_at = ?
    `).run(id, listingId, tenantId, input.rating, input.review ?? null, new Date().toISOString(),
      input.rating, input.review ?? null, new Date().toISOString());

    const avgRow = db.prepare(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM agent_ratings WHERE listing_id = ?'
    ).get(listingId) as any;

    db.prepare('UPDATE agent_listings SET rating = ?, rating_count = ?, updated_at = ? WHERE listing_id = ?')
      .run(Math.round((avgRow?.avg_rating ?? 0) * 10) / 10, avgRow?.count ?? 0, new Date().toISOString(), listingId);
  }

  // ── Agent Evaluations ─────────────────────────────────────────────────────

  async createEvaluation(tenantId: string, input: {
    agentInstanceId: string;
    executionId: string;
    toolSuccessRate?: number;
    budgetAdherence?: number;
    turnEfficiency?: number;
    score?: number;
    breakdown?: Record<string, unknown>;
    status?: string;
  }): Promise<AgentEvaluation> {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO agent_evaluations (
        id, agent_instance_id, tenant_id, execution_id, status,
        tool_success_rate, budget_adherence, turn_efficiency, score,
        breakdown, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.agentInstanceId,
      tenantId,
      input.executionId,
      input.status ?? 'completed',
      input.toolSuccessRate ?? 0,
      input.budgetAdherence ?? 0,
      input.turnEfficiency ?? 0,
      input.score ?? 0,
      JSON.stringify(input.breakdown ?? {}),
      now,
    );

    const row = db.prepare('SELECT * FROM agent_evaluations WHERE id = ?').get(id) as any;
    return this.rowToEvaluation(row);
  }

  async listEvaluations(agentInstanceId: string, tenantId: string, limit = 50): Promise<AgentEvaluation[]> {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM agent_evaluations WHERE agent_instance_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(agentInstanceId, tenantId, limit) as any[];
    return rows.map((r) => this.rowToEvaluation(r));
  }

  async getEvaluation(id: string, tenantId: string): Promise<AgentEvaluation | null> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agent_evaluations WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!row) return null;
    return this.rowToEvaluation(row);
  }

  async deleteEvaluation(id: string, tenantId: string): Promise<boolean> {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM agent_evaluations WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) return false;
    db.prepare('DELETE FROM agent_evaluations WHERE id = ?').run(id);
    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private rowToDefinition(row: any): AgentDefinition {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description,
      humanName: row.human_name ?? null,
      version: row.version,
      systemPrompt: row.system_prompt,
      personality: row.personality,
      preferredModel: row.preferred_model,
      modelTier: row.model_tier,
      allowedTools: JSON.parse(row.allowed_tools || '[]'),
      customTools: JSON.parse(row.custom_tools || '[]'),
      workflow: row.workflow ? JSON.parse(row.workflow) : null,
      triggers: JSON.parse(row.triggers || '[]'),
      visibility: row.visibility,
      tags: JSON.parse(row.tags || '[]'),
      category: row.category,
      icon: row.icon,
      skills: row.skills ? JSON.parse(row.skills) : [],
      skillNudgeInterval: row.skill_nudge_interval ?? undefined,
      verifyOnStop: row.verify_on_stop ? true : false,
      planMode: row.plan_mode ? true : false,
      historyCompaction: row.history_compaction ? true : false,
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToInstance(row: any): AgentInstance {
    return {
      id: row.id,
      agentDefinitionId: row.agent_definition_id,
      tenantId: row.tenant_id,
      status: row.status,
      configOverride: JSON.parse(row.config_override || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToExecution(row: any): AgentExecution {
    return {
      id: row.id,
      agentInstanceId: row.agent_instance_id,
      tenantId: row.tenant_id,
      input: row.input,
      output: row.output,
      toolsUsed: JSON.parse(row.tools_used || '[]'),
      modelUsed: row.model_used,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costCents: row.cost_cents,
      durationMs: row.duration_ms,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
    };
  }

  private rowToEvaluation(row: any): AgentEvaluation {
    return {
      id: row.id,
      agentInstanceId: row.agent_instance_id,
      tenantId: row.tenant_id,
      executionId: row.execution_id,
      status: row.status,
      toolSuccessRate: Number(row.tool_success_rate ?? 0),
      budgetAdherence: Number(row.budget_adherence ?? 0),
      turnEfficiency: Number(row.turn_efficiency ?? 0),
      score: Number(row.score ?? 0),
      breakdown: row.breakdown ? JSON.parse(row.breakdown) : {},
      createdAt: row.created_at,
    };
  }

  private rowToListing(row: any): AgentListing {
    return {
      id: row.id,
      agentDefinitionId: row.agent_definition_id,
      publisherTenantId: row.publisher_tenant_id,
      title: row.title,
      description: row.description,
      longDescription: row.long_description,
      category: row.category,
      tags: JSON.parse(row.tags || '[]'),
      icon: row.icon,
      screenshots: JSON.parse(row.screenshots || '[]'),
      rating: row.rating,
      ratingCount: row.rating_count,
      installCount: row.install_count,
      priceCents: row.price_cents,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const agentRegistryService = new AgentRegistryService();
