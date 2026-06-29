import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * Prompt Template management service.
 *
 * Store and apply per-model prompt templates.
 * Templates support variable interpolation:
 *   {{system_prompt}} — system message content
 *   {{user_message}} — user message content
 *   {{conversation}} — full conversation history
 *   {{tools}} — tool definitions
 */

export interface PromptTemplate {
  id: string;
  name: string;
  modelId: string | null;  // null = apply to all models
  tenantId: string | null;
  template: string;
  variables: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export class PromptTemplateService {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS prompt_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          model_id TEXT,
          tenant_id TEXT,
          template TEXT NOT NULL,
          variables TEXT DEFAULT '[]',
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_pt_model ON prompt_templates(model_id);
        CREATE INDEX IF NOT EXISTS idx_pt_tenant ON prompt_templates(tenant_id);
      `);
      this.initialized = true;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to initialize prompt_templates table');
    }
  }

  create(input: {
    name: string;
    modelId?: string;
    tenantId?: string;
    template: string;
  }): PromptTemplate {
    this.init();
    const db = getDb();
    const id = crypto.randomUUID();
    const variables = this.extractVariables(input.template);

    db.prepare(`
      INSERT INTO prompt_templates (id, name, model_id, tenant_id, template, variables)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.modelId || null, input.tenantId || null, input.template, JSON.stringify(variables));

    return this.getById(id)!;
  }

  getById(id: string): PromptTemplate | null {
    this.init();
    const db = getDb();
    const row = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as any;
    return row ? this.rowToTemplate(row) : null;
  }

  list(tenantId?: string): PromptTemplate[] {
    this.init();
    const db = getDb();
    if (tenantId) {
      const rows = db.prepare('SELECT * FROM prompt_templates WHERE tenant_id = ? OR tenant_id IS NULL ORDER BY created_at DESC').all(tenantId) as any[];
      return rows.map(r => this.rowToTemplate(r));
    }
    const rows = db.prepare('SELECT * FROM prompt_templates ORDER BY created_at DESC').all() as any[];
    return rows.map(r => this.rowToTemplate(r));
  }

  update(id: string, updates: Partial<Pick<PromptTemplate, 'name' | 'template' | 'modelId' | 'isActive'>>): void {
    this.init();
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.template !== undefined) {
      fields.push('template = ?');
      values.push(updates.template);
      fields.push('variables = ?');
      values.push(JSON.stringify(this.extractVariables(updates.template)));
    }
    if (updates.modelId !== undefined) { fields.push('model_id = ?'); values.push(updates.modelId); }
    if (updates.isActive !== undefined) { fields.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }

    if (fields.length > 0) {
      fields.push('updated_at = datetime(\'now\')');
      values.push(id);
      db.prepare(`UPDATE prompt_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  delete(id: string): void {
    this.init();
    const db = getDb();
    db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
  }

  /**
   * Apply a template to a request body.
   * Replaces {{variable}} placeholders with actual values.
   */
  applyTemplate(templateId: string, variables: Record<string, string>): string | null {
    const template = this.getById(templateId);
    if (!template) return null;

    let result = template.template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Find the best template for a model and tenant.
   */
  findForModel(modelId: string, tenantId?: string): PromptTemplate | null {
    this.init();
    const db = getDb();

    // Try exact model match first, then fallback to wildcard
    let row = db.prepare(
      'SELECT * FROM prompt_templates WHERE model_id = ? AND is_active = 1 AND (tenant_id = ? OR tenant_id IS NULL) ORDER BY tenant_id DESC LIMIT 1'
    ).get(modelId, tenantId || null) as any;

    if (!row) {
      row = db.prepare(
        'SELECT * FROM prompt_templates WHERE model_id IS NULL AND is_active = 1 AND (tenant_id = ? OR tenant_id IS NULL) ORDER BY tenant_id DESC LIMIT 1'
      ).get(tenantId || null) as any;
    }

    return row ? this.rowToTemplate(row) : null;
  }

  private extractVariables(template: string): string[] {
    const matches = template.match(/\{\{(\w+)\}\}/g) || [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
  }

  private rowToTemplate(row: any): PromptTemplate {
    return {
      id: row.id,
      name: row.name,
      modelId: row.model_id,
      tenantId: row.tenant_id,
      template: row.template,
      variables: JSON.parse(row.variables || '[]'),
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const promptTemplateService = new PromptTemplateService();
