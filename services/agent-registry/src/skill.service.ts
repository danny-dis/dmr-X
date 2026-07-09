import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

import {
  SkillCreateSchema,
  SkillUpdateSchema,
  SkillPatchSchema,
  SkillCreateFromAgentSchema,
} from './skill-schema.js';
import type { SkillCreate, SkillUpdate, SkillListQuery, SkillSource, SkillPatch, SkillCreateFromAgent } from './skill-schema.js';
import { parseAgentMdFromString } from './agent-config-loader.js';
import type { AgentConfigFile } from './agent-config-loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Skill {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  content: string;
  tags: string[];
  source: SkillSource;
  externalId: string | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SkillListResult {
  items: Skill[];
  total: number;
}

export interface SkillImportItem {
  markdown: string;
  source: SkillSource;
  externalId?: string;
}

export interface BulkImportSkillResult {
  imported: number;
  errors: Array<{ file: string; error: string }>;
  skills: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SkillService {
  async createSkill(tenantId: string, input: SkillCreate): Promise<Skill> {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const parsed = SkillCreateSchema.parse(input);

    db.prepare(`
      INSERT INTO skills (
        id, tenant_id, name, description, content, tags, source, external_id,
        pinned, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tenantId,
      parsed.name,
      parsed.description ?? null,
      parsed.content,
      JSON.stringify(parsed.tags ?? []),
      parsed.source,
      parsed.externalId ?? null,
      parsed.pinned ? 1 : 0,
      now,
      now,
    );

    logger.info({ id, tenantId, name: parsed.name }, 'Skill created');
    const created = await this.getSkill(id);
    if (!created) throw new Error('Failed to retrieve created skill');
    return created;
  }

  async getSkill(id: string): Promise<Skill | null> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToSkill(row);
  }

  async listSkills(tenantId: string, query: SkillListQuery = {}): Promise<SkillListResult> {
    const db = getDb();
    const conditions = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    if (query.search) {
      conditions.push('(name LIKE ? OR description LIKE ? OR content LIKE ?)');
      params.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`);
    }
    if (query.tag) {
      conditions.push('tags LIKE ?');
      params.push(`%${query.tag}%`);
    }

    const where = conditions.join(' AND ');
    const limit = query.limit ?? 20;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM skills WHERE ${where}`).get(...params) as any;
    const total = countRow?.total ?? 0;

    const rows = db.prepare(
      `SELECT * FROM skills WHERE ${where} ORDER BY updated_at DESC LIMIT ?`
    ).all(...params, limit) as any[];

    return {
      items: rows.map((r) => this.rowToSkill(r)),
      total,
    };
  }

  async updateSkill(id: string, tenantId: string, input: SkillUpdate): Promise<Skill | null> {
    const db = getDb();
    const existing = await this.getSkill(id);
    if (!existing || existing.tenantId !== tenantId) return null;

    const parsed = SkillUpdateSchema.parse(input);

    const updates: string[] = [];
    const params: unknown[] = [];

    if (parsed.name !== undefined) { updates.push('name = ?'); params.push(parsed.name); }
    if (parsed.description !== undefined) { updates.push('description = ?'); params.push(parsed.description); }
    if (parsed.content !== undefined) { updates.push('content = ?'); params.push(parsed.content); }
    if (parsed.tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(parsed.tags)); }
    if (parsed.source !== undefined) { updates.push('source = ?'); params.push(parsed.source); }
    if (parsed.externalId !== undefined) { updates.push('external_id = ?'); params.push(parsed.externalId); }

    if (updates.length === 0) return existing;

    updates.push('updated_at = ?');
    params.push(Math.floor(Date.now() / 1000));
    params.push(id);

    db.prepare(`UPDATE skills SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    logger.info({ id, tenantId }, 'Skill updated');
    return this.getSkill(id);
  }

  async deleteSkill(id: string, tenantId: string): Promise<boolean> {
    const db = getDb();
    const existing = await this.getSkill(id);
    if (!existing || existing.tenantId !== tenantId) return false;

    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    logger.info({ id, tenantId }, 'Skill deleted');
    return true;
  }

  /**
   * Import a single skill from markdown. Reuses the agent .md frontmatter
   * parser to extract name/description; the markdown body becomes `content`.
   */
  async importSkillFromMd(
    tenantId: string,
    markdown: string,
    options: { source: SkillSource; externalId?: string },
  ): Promise<Skill | null> {
    const parsed = parseAgentMdFromString(markdown, { filePath: 'imported-skill.md' });
    if (!parsed) {
      logger.warn({ tenantId }, 'Failed to parse skill markdown (missing frontmatter/name)');
      return null;
    }

    return this.createSkill(tenantId, {
      name: parsed.definition.name,
      description: parsed.definition.description,
      content: parsed.definition.systemPrompt || markdown,
      tags: parsed.definition.tags,
      source: options.source,
      externalId: options.externalId,
    });
  }

  /**
   * Bulk-import a set of markdown skills for a tenant. Failures are collected
   * and reported but do not abort the batch.
   */
  async bulkImportSkills(tenantId: string, items: SkillImportItem[]): Promise<BulkImportSkillResult> {
    const imported: BulkImportSkillResult['skills'] = [];
    const errors: BulkImportSkillResult['errors'] = [];

    for (const item of items) {
      try {
        const parsed = this.markdownToSkillInput(tenantId, item.markdown, item.source, item.externalId);
        if (!parsed) {
          errors.push({ file: item.externalId ?? 'inline', error: 'Failed to parse skill markdown' });
          continue;
        }
        const skill = await this.createSkill(tenantId, parsed);
        imported.push({ id: skill.id, name: skill.name });
      } catch (error) {
        errors.push({
          file: item.externalId ?? 'inline',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { imported: imported.length, errors, skills: imported };
  }

  /**
   * Patch an existing skill's content by replacing the FIRST occurrence of
   * `oldString` with `newString`. Pinned skills cannot be patched; the result
   * is validated and security-scanned before persisting.
   */
  async patchSkillContent(id: string, tenantId: string, patch: SkillPatch): Promise<Skill | null> {
    const parsed = SkillPatchSchema.parse(patch);
    const existing = await this.getSkill(id);
    if (!existing || existing.tenantId !== tenantId) return null;

    if (existing.pinned) {
      throw new Error('Cannot patch a pinned skill');
    }

    const idx = existing.content.indexOf(parsed.oldString);
    if (idx === -1) {
      throw new Error('oldString not found in skill content');
    }

    const newContent =
      existing.content.slice(0, idx) +
      parsed.newString +
      existing.content.slice(idx + parsed.oldString.length);

    const validationError = this.validateSkillContent(newContent);
    if (validationError) throw new Error(validationError);

    const scanError = this.securityScanSkill(newContent);
    if (scanError) throw new Error(scanError);

    return this.updateSkill(id, tenantId, { content: newContent });
  }

  /**
   * Create a skill from agent input. Validates, security-scans, then stores
   * with `source: 'agent'`.
   */
  async createSkillFromAgent(tenantId: string, input: SkillCreateFromAgent): Promise<Skill> {
    const parsed = SkillCreateFromAgentSchema.parse(input);

    const validationError = this.validateSkillContent(parsed.content);
    if (validationError) throw new Error(validationError);

    const scanError = this.securityScanSkill(parsed.content);
    if (scanError) throw new Error(scanError);

    return this.createSkill(tenantId, {
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      tags: parsed.tags,
      source: 'agent',
      pinned: parsed.pinned,
    } as SkillCreate);
  }

  private markdownToSkillInput(
    tenantId: string,
    markdown: string,
    source: SkillSource,
    externalId?: string,
  ): SkillCreate | null {
    const parsed: AgentConfigFile | null = parseAgentMdFromString(markdown, { filePath: 'imported-skill.md' });
    if (!parsed) return null;
    return {
      name: parsed.definition.name,
      description: parsed.definition.description,
      content: parsed.definition.systemPrompt || markdown,
      tags: parsed.definition.tags,
      source,
      externalId,
    };
  }

  private rowToSkill(row: any): Skill {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description,
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      source: row.source,
      externalId: row.external_id,
      pinned: row.pinned === 1 || row.pinned === true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Validate skill content. Returns a human-readable error string, or null
   * if the content is acceptable.
   */
  private validateSkillContent(content: string): string | null {
    if (!content || content.trim().length === 0) {
      return 'Skill content must not be empty';
    }
    if (content.length > 100000) {
      return 'Skill content exceeds maximum length of 100000 characters';
    }
    if (!/[a-zA-Z]/.test(content)) {
      return 'Skill content must contain alphabetic text';
    }
    return null;
  }

  /**
   * Security scan for dangerous content embedded in a skill body. Returns a
   * human-readable reason on block, or null if acceptable.
   */
  private securityScanSkill(content: string): string | null {
    // (a) path traversal / absolute escape attempts targeting the host fs
    if (/\.\.[\/\\]/.test(content) || /(^|[\s"'`])\/(?:etc|proc|sys|var|usr|home|root)[\/\\]/.test(content) ||
        /(^|[\s"'`])(?:[a-zA-Z]:\\|\\\\|\/)/.test(content)) {
      return 'Skill content contains path traversal or absolute path escape sequence';
    }

    // (b) shell / command-injection payloads instructing host command exec
    if (/\brm\s+-rf\b/.test(content) ||
        /\bcurl\b[^`\n]*(?:\|\s*(?:sh|bash|zsh)\b)/.test(content) ||
        /\bwget\b[^`\n]*(?:\|\s*(?:sh|bash|zsh)\b)/.test(content) ||
        /\beval\s*\(/.test(content) ||
        /`[^`]+`/.test(content)) {
      return 'Skill content contains shell/command-injection payload';
    }

    // (c) template-injection exfiltrating secrets/env
    if (/\$\{\s*[^}]*(?:process\.env|env\b|DMRX_|API_KEY|SECRET|TOKEN)[^}]*\s*\}/i.test(content)) {
      return 'Skill content contains template-injection referencing env/secrets';
    }

    return null;
  }
}

export const skillService = new SkillService();
