import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * Organization management service — multi-tenant hierarchy with budget propagation.
 *
 * Hierarchy: Organization → Tenant → Team → User
 * Budgets cascade down: org → tenant → team
 */

export interface Organization {
  id: string;
  name: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrganizationInput {
  name: string;
  settings?: Record<string, unknown>;
}

export interface OrganizationMember {
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

/**
 * Get effective budget by traversing the hierarchy.
 * Returns the first non-null budget found (team > tenant > org).
 */
export function getEffectiveBudget(
  teamBudget: number | null | undefined,
  tenantBudget: number | null | undefined,
  orgBudget: number | null | undefined,
): number | null {
  if (teamBudget != null && teamBudget > 0) return teamBudget;
  if (tenantBudget != null && tenantBudget > 0) return tenantBudget;
  if (orgBudget != null && orgBudget > 0) return orgBudget;
  return null;
}

export class OrganizationService {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          settings TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS organization_members (
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT DEFAULT 'member',
          created_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (organization_id, user_id),
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
        CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
      `);

      // Add org_id column to tenants if it doesn't exist
      this.addColumnIfNotExists('tenants', 'org_id', 'TEXT REFERENCES organizations(id)');
      // Add parent_tenant_id for tenant hierarchy
      this.addColumnIfNotExists('tenants', 'parent_tenant_id', 'TEXT REFERENCES tenants(id)');
      // Add parent_team_id for team hierarchy
      this.addColumnIfNotExists('teams', 'parent_team_id', 'TEXT REFERENCES teams(id)');

      this.initialized = true;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to initialize organization tables');
    }
  }

  private addColumnIfNotExists(table: string, column: string, type: string): void {
    try {
      const db = getDb();
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      const exists = columns.some(c => c.name === column);
      if (!exists) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        logger.info({ table, column }, 'Added column to existing table');
      }
    } catch (error) {
      // Column might already exist or table doesn't exist yet
      logger.debug({ table, column, error: String(error) }, 'Column check/add failed (may be expected)');
    }
  }

  // ─── Organization CRUD ────────────────────────────────────────────────────

  create(input: CreateOrganizationInput): Organization {
    this.init();
    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO organizations (id, name, settings)
      VALUES (?, ?, ?)
    `).run(id, input.name, JSON.stringify(input.settings || {}));

    return this.getById(id)!;
  }

  getById(id: string): Organization | null {
    this.init();
    const db = getDb();
    const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      settings: JSON.parse(row.settings || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): Organization[] {
    this.init();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM organizations ORDER BY name').all() as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      settings: JSON.parse(row.settings || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  update(id: string, input: Partial<CreateOrganizationInput>): Organization | null {
    this.init();
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.settings !== undefined) {
      updates.push('settings = ?');
      params.push(JSON.stringify(input.settings));
    }

    if (updates.length === 0) return existing;

    updates.push("updated_at = datetime('now')");
    params.push(id);

    db.prepare(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return this.getById(id);
  }

  delete(id: string): boolean {
    this.init();
    const db = getDb();
    const result = db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ─── Organization Members ─────────────────────────────────────────────────

  addMember(organizationId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): void {
    this.init();
    const db = getDb();

    db.prepare(`
      INSERT OR REPLACE INTO organization_members (organization_id, user_id, role)
      VALUES (?, ?, ?)
    `).run(organizationId, userId, role);
  }

  removeMember(organizationId: string, userId: string): boolean {
    this.init();
    const db = getDb();
    const result = db.prepare(
      'DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?'
    ).run(organizationId, userId);
    return result.changes > 0;
  }

  getMembers(organizationId: string): OrganizationMember[] {
    this.init();
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM organization_members WHERE organization_id = ?'
    ).all(organizationId) as any[];

    return rows.map(row => ({
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role,
      createdAt: row.created_at,
    }));
  }

  getUserOrganizations(userId: string): Organization[] {
    this.init();
    const db = getDb();
    const rows = db.prepare(`
      SELECT o.* FROM organizations o
      JOIN organization_members m ON m.organization_id = o.id
      WHERE m.user_id = ?
      ORDER BY o.name
    `).all(userId) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      settings: JSON.parse(row.settings || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // ─── Hierarchy Queries ────────────────────────────────────────────────────

  /**
   * Get all tenants in an organization.
   */
  getTenants(organizationId: string): Array<{ id: string; name: string; orgId: string | null }> {
    this.init();
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, name, org_id FROM tenants WHERE org_id = ? ORDER BY name'
    ).all(organizationId) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      orgId: row.org_id,
    }));
  }

  /**
   * Get effective budget for a team by traversing the hierarchy.
   */
  getEffectiveBudgetForTeam(teamId: string): number | null {
    this.init();
    const db = getDb();

    // Get team and its parent
    const team = db.prepare(`
      SELECT t.*, ten.org_id FROM teams t
      LEFT JOIN tenants ten ON t.tenant_id = ten.id
      WHERE t.id = ?
    `).get(teamId) as any;

    if (!team) return null;

    // Get tenant budget
    const tenant = db.prepare('SELECT max_budget FROM tenants WHERE id = ?')
      .get(team.tenant_id) as any;

    // Get org budget if tenant has an org
    let orgBudget: number | null = null;
    if (team.org_id) {
      const org = db.prepare('SELECT settings FROM organizations WHERE id = ?')
        .get(team.org_id) as any;
      if (org) {
        const settings = JSON.parse(org.settings || '{}');
        orgBudget = settings.maxBudget ?? null;
      }
    }

    return getEffectiveBudget(team.max_budget, tenant?.max_budget, orgBudget);
  }
}

// Singleton
let instance: OrganizationService | null = null;

export function getOrganizationService(): OrganizationService {
  if (!instance) {
    instance = new OrganizationService();
  }
  return instance;
}
