import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * Team management service — multi-team support with budgets.
 */

export interface Team {
  id: string;
  name: string;
  tenantId: string;
  maxBudget: number | null;  // cents
  budgetDuration: string | null;
  budgetSpent: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamInput {
  name: string;
  tenantId: string;
  maxBudget?: number;
  budgetDuration?: string;
  metadata?: Record<string, unknown>;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: 'admin' | 'member';
  createdAt: string;
}

export class TeamService {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          max_budget INTEGER,
          budget_duration TEXT,
          budget_spent INTEGER DEFAULT 0,
          metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS team_members (
          team_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT DEFAULT 'member',
          created_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (team_id, user_id),
          FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_team_tenant ON teams(tenant_id);
      `);
      this.initialized = true;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to initialize teams tables');
    }
  }

  create(input: CreateTeamInput): Team {
    this.init();
    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO teams (id, name, tenant_id, max_budget, budget_duration, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.tenantId,
      input.maxBudget || null,
      input.budgetDuration || null,
      JSON.stringify(input.metadata || {}),
    );

    logger.info({ id, name: input.name, tenantId: input.tenantId }, 'Team created');
    return this.getById(id)!;
  }

  getById(id: string): Team | null {
    this.init();
    const db = getDb();
    const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as any;
    return row ? this.rowToTeam(row) : null;
  }

  list(tenantId: string): Team[] {
    this.init();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM teams WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId) as any[];
    return rows.map(r => this.rowToTeam(r));
  }

  update(id: string, updates: Partial<Pick<Team, 'name' | 'maxBudget' | 'budgetDuration' | 'metadata'>>): void {
    this.init();
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.maxBudget !== undefined) { fields.push('max_budget = ?'); values.push(updates.maxBudget); }
    if (updates.budgetDuration !== undefined) { fields.push('budget_duration = ?'); values.push(updates.budgetDuration); }
    if (updates.metadata !== undefined) { fields.push('metadata = ?'); values.push(JSON.stringify(updates.metadata)); }

    if (fields.length > 0) {
      fields.push('updated_at = datetime(\'now\')');
      values.push(id);
      db.prepare(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  delete(id: string): void {
    this.init();
    const db = getDb();
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    logger.info({ id }, 'Team deleted');
  }

  recordSpend(id: string, costCents: number): void {
    this.init();
    const db = getDb();
    db.prepare('UPDATE teams SET budget_spent = budget_spent + ?, updated_at = datetime(\'now\') WHERE id = ?').run(costCents, id);
  }

  addMember(teamId: string, userId: string, role: 'admin' | 'member' = 'member'): void {
    this.init();
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, userId, role);
  }

  removeMember(teamId: string, userId: string): void {
    this.init();
    const db = getDb();
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId);
  }

  getMembers(teamId: string): TeamMember[] {
    this.init();
    const db = getDb();
    return db.prepare('SELECT * FROM team_members WHERE team_id = ?').all(teamId).map((r: any) => ({
      teamId: r.team_id,
      userId: r.user_id,
      role: r.role,
      createdAt: r.created_at,
    }));
  }

  getUserTeams(tenantId: string, userId: string): Team[] {
    this.init();
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.* FROM teams t
      INNER JOIN team_members tm ON t.id = tm.team_id
      WHERE t.tenant_id = ? AND tm.user_id = ?
    `).all(tenantId, userId) as any[];
    return rows.map(r => this.rowToTeam(r));
  }

  private rowToTeam(row: any): Team {
    return {
      id: row.id,
      name: row.name,
      tenantId: row.tenant_id,
      maxBudget: row.max_budget,
      budgetDuration: row.budget_duration,
      budgetSpent: row.budget_spent,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const teamService = new TeamService();
