/**
 * Tool Templates & Presets Service for DMR-X
 *
 * Manages pre-configured tool call patterns and default parameters.
 * Templates allow users to save and reuse common tool sequences.
 * Presets provide default/fixed parameters per tenant/tool.
 */

import { getDb } from '@dmr-x/db';
import { createLogger } from '@dmr-x/utils';
import crypto from 'node:crypto';

const logger = createLogger('mcp-server:tool-templates');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolTemplateStep {
  /** Step ID for input mapping */
  id: string;
  /** Tool name to execute */
  tool_name: string;
  /** Default parameters for this step */
  parameters: Record<string, unknown>;
  /** Map outputs from previous steps to inputs */
  input_mapping?: Record<string, string>;
  /** Optional condition (JSON expression) */
  condition?: string;
  /** Step description for documentation */
  description?: string;
}

export interface ToolTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  steps: ToolTemplateStep[];
  tags: string[];
  version: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface ToolPreset {
  id: string;
  tenant_id: string;
  tool_name: string;
  defaults: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  priority: number;
  description?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface TemplateExecutionResult {
  id: string;
  template_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  steps_completed: number;
  steps_total: number;
  output?: unknown;
  error?: string;
  duration_ms?: number;
  cost_usd?: number;
}

// ---------------------------------------------------------------------------
// Tool Templates Service
// ---------------------------------------------------------------------------

export class ToolTemplatesService {
  // -------------------------------------------------------------------------
  // Template CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new template
   */
  createTemplate(template: Omit<ToolTemplate, 'id' | 'created_at' | 'updated_at'>): ToolTemplate {
    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO tool_templates
      (id, tenant_id, name, description, steps, tags, version, created_by, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      template.tenant_id,
      template.name,
      template.description || null,
      JSON.stringify(template.steps),
      JSON.stringify(template.tags),
      template.version,
      template.created_by || null,
      template.is_active ? 1 : 0
    );

    return this.getTemplate(id)!;
  }

  /**
   * Get a template by ID
   */
  getTemplate(id: string): ToolTemplate | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM tool_templates WHERE id = ?
    `).get(id) as any;

    return row ? this.mapTemplateRow(row) : null;
  }

  /**
   * Update a template
   */
  updateTemplate(id: string, updates: Partial<ToolTemplate>): boolean {
    const db = getDb();
    const existing = this.getTemplate(id);
    if (!existing) return false;

    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };

    db.prepare(`
      UPDATE tool_templates
      SET name = ?, description = ?, steps = ?, tags = ?, version = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.description || null,
      JSON.stringify(updated.steps),
      JSON.stringify(updated.tags),
      updated.version,
      updated.is_active ? 1 : 0,
      updated.updated_at,
      id
    );

    return true;
  }

  /**
   * Delete a template (soft delete)
   */
  deleteTemplate(id: string): boolean {
    const db = getDb();
    const result = db.prepare(`
      UPDATE tool_templates SET is_active = 0 WHERE id = ?
    `).run(id);
    return result.changes > 0;
  }

  /**
   * List templates for a tenant
   */
  listTemplates(tenantId: string, options?: { tag?: string; search?: string }): ToolTemplate[] {
    const db = getDb();
    let query = `
      SELECT * FROM tool_templates
      WHERE tenant_id = ? AND is_active = 1
    `;
    const params: unknown[] = [tenantId];

    if (options?.search) {
      query += ` AND (name LIKE ? OR description LIKE ?)`;
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    query += ` ORDER BY name`;

    const rows = db.prepare(query).all(...params) as any[];
    let templates = rows.map(this.mapTemplateRow);

    // Filter by tag if specified
    if (options?.tag) {
      templates = templates.filter(t => t.tags.includes(options.tag!));
    }

    return templates;
  }

  // -------------------------------------------------------------------------
  // Preset CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new preset
   */
  createPreset(preset: Omit<ToolPreset, 'id' | 'created_at' | 'updated_at'>): ToolPreset {
    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO tool_presets
      (id, tenant_id, tool_name, defaults, overrides, priority, description, created_by, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      preset.tenant_id,
      preset.tool_name,
      JSON.stringify(preset.defaults),
      preset.overrides ? JSON.stringify(preset.overrides) : null,
      preset.priority,
      preset.description || null,
      preset.created_by || null,
      preset.is_active ? 1 : 0
    );

    return this.getPreset(id)!;
  }

  /**
   * Get a preset by ID
   */
  getPreset(id: string): ToolPreset | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM tool_presets WHERE id = ?
    `).get(id) as any;

    return row ? this.mapPresetRow(row) : null;
  }

  /**
   * Update a preset
   */
  updatePreset(id: string, updates: Partial<ToolPreset>): boolean {
    const db = getDb();
    const existing = this.getPreset(id);
    if (!existing) return false;

    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };

    db.prepare(`
      UPDATE tool_presets
      SET defaults = ?, overrides = ?, priority = ?, description = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(updated.defaults),
      updated.overrides ? JSON.stringify(updated.overrides) : null,
      updated.priority,
      updated.description || null,
      updated.is_active ? 1 : 0,
      updated.updated_at,
      id
    );

    return true;
  }

  /**
   * Delete a preset (soft delete)
   */
  deletePreset(id: string): boolean {
    const db = getDb();
    const result = db.prepare(`
      UPDATE tool_presets SET is_active = 0 WHERE id = ?
    `).run(id);
    return result.changes > 0;
  }

  /**
   * List presets for a tenant
   */
  listPresets(tenantId: string, toolName?: string): ToolPreset[] {
    const db = getDb();
    let query = `
      SELECT * FROM tool_presets
      WHERE tenant_id = ? AND is_active = 1
    `;
    const params: unknown[] = [tenantId];

    if (toolName) {
      query += ` AND tool_name = ?`;
      params.push(toolName);
    }

    query += ` ORDER BY priority DESC, tool_name`;

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(this.mapPresetRow);
  }

  /**
   * Get preset for a specific tool (with priority ordering)
   */
  getPresetForTool(tenantId: string, toolName: string): ToolPreset | null {
    const db = getDb();

    // Try tenant-specific first
    const tenantPreset = db.prepare(`
      SELECT * FROM tool_presets
      WHERE tenant_id = ? AND tool_name = ? AND is_active = 1
      ORDER BY priority DESC
      LIMIT 1
    `).get(tenantId, toolName) as any;

    if (tenantPreset) return this.mapPresetRow(tenantPreset);

    // Fallback to global preset (tenant_id = '*')
    const globalPreset = db.prepare(`
      SELECT * FROM tool_presets
      WHERE tenant_id = '*' AND tool_name = ? AND is_active = 1
      ORDER BY priority DESC
      LIMIT 1
    `).get(toolName) as any;

    return globalPreset ? this.mapPresetRow(globalPreset) : null;
  }

  // -------------------------------------------------------------------------
  // Parameter Merging
  // -------------------------------------------------------------------------

  /**
   * Merge user parameters with preset defaults and overrides
   * Priority: overrides > user params > defaults
   */
  mergeParameters(
    userParams: Record<string, unknown>,
    preset: ToolPreset | null
  ): Record<string, unknown> {
    if (!preset) return userParams;

    const merged = { ...preset.defaults, ...userParams };

    // Apply forced overrides (cannot be changed by user)
    if (preset.overrides) {
      Object.assign(merged, preset.overrides);
    }

    return merged;
  }

  // -------------------------------------------------------------------------
  // Execution Logging
  // -------------------------------------------------------------------------

  /**
   * Log template execution
   */
  logExecution(params: {
    template_id: string;
    tenant_id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    steps_completed?: number;
    steps_total?: number;
    output?: unknown;
    error?: string;
    duration_ms?: number;
    cost_usd?: number;
    request_id?: string;
    user_id?: string;
  }): string {
    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO tool_template_executions
      (id, template_id, tenant_id, status, steps_completed, steps_total, output, error, duration_ms, cost_usd, request_id, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.template_id,
      params.tenant_id,
      params.status,
      params.steps_completed || 0,
      params.steps_total || 0,
      params.output ? JSON.stringify(params.output) : null,
      params.error || null,
      params.duration_ms || null,
      params.cost_usd || null,
      params.request_id || null,
      params.user_id || null
    );

    return id;
  }

  /**
   * Get execution history for a template
   */
  getExecutionHistory(templateId: string, limit: number = 50): TemplateExecutionResult[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM tool_template_executions
      WHERE template_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(templateId, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      template_id: row.template_id,
      status: row.status,
      steps_completed: row.steps_completed,
      steps_total: row.steps_total,
      output: row.output ? JSON.parse(row.output) : undefined,
      error: row.error,
      duration_ms: row.duration_ms,
      cost_usd: row.cost_usd,
    }));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private mapTemplateRow(row: any): ToolTemplate {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      description: row.description,
      steps: JSON.parse(row.steps),
      tags: row.tags ? JSON.parse(row.tags) : [],
      version: row.version,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_active: row.is_active === 1,
    };
  }

  private mapPresetRow(row: any): ToolPreset {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      tool_name: row.tool_name,
      defaults: JSON.parse(row.defaults),
      overrides: row.overrides ? JSON.parse(row.overrides) : undefined,
      priority: row.priority,
      description: row.description,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_active: row.is_active === 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ToolTemplatesService | null = null;

export function getToolTemplatesService(): ToolTemplatesService {
  if (!instance) {
    instance = new ToolTemplatesService();
  }
  return instance;
}
