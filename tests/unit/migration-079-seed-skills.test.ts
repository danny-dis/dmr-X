import { describe, it, expect } from 'vitest';
import { MIGRATIONS } from '../../packages/db/src/migrations-data.js';

describe('migration 079: seeded web-research skills are permanent', () => {
  it('is registered', () => {
    expect(MIGRATIONS[79]).toBeDefined();
    expect(MIGRATIONS[79].filename).toBe('079_seed_web_research_skills.sql');
  });

  it('applies cleanly to a fresh in-memory schema and seeds per tenant', async () => {
    const { DatabaseSync: Database } = await import('node:sqlite');
    const db = new Database(':memory:');
    // minimal schema: tenants + skills (mirrors migrations 001 and 045)
    db.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL);`);
    db.exec(`CREATE TABLE skills (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT, content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'builtin',
      external_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(tenant_id, name));`);
    // two tenants, like a multi-tenant install
    db.prepare('INSERT INTO tenants (id,name) VALUES (?,?)').run('t-local', 'local');
    db.prepare('INSERT INTO tenants (id,name) VALUES (?,?)').run('t-default', 'default');

    db.exec(MIGRATIONS[79].sql);

    const rows = db.prepare('SELECT tenant_id, name, source, length(content) len FROM skills ORDER BY tenant_id, name').all() as any[];
    console.log('SEEDED:', JSON.stringify(rows.map(r => [r.tenant_id, r.name, r.source, r.len])));
    expect(rows).toHaveLength(4); // 2 skills x 2 tenants
    expect(rows.every(r => r.source === 'seed')).toBe(true);
    expect(rows.every(r => r.len > 1000)).toBe(true);
    // the critical content survived SQL escaping
    const uh = rows.find(r => r.name === 'url-hunting-recovery');
    expect(uh.len).toBeGreaterThan(3000);

    // IDEMPOTENT: re-running must not duplicate or throw
    db.exec(MIGRATIONS[79].sql);
    const after = db.prepare('SELECT COUNT(*) c FROM skills').get() as any;
    expect(after.c).toBe(4);

    // a hand-edited copy must NOT be overwritten
    db.prepare("UPDATE skills SET content='MINE' WHERE tenant_id='t-local' AND name='url-hunting-recovery'").run();
    db.exec(MIGRATIONS[79].sql);
    const mine = db.prepare("SELECT content FROM skills WHERE tenant_id='t-local' AND name='url-hunting-recovery'").get() as any;
    expect(mine.content).toBe('MINE');

    // content sanity: apostrophes escaped correctly, no truncation at "don't"
    expect(uh.len).toBeGreaterThan(3000);
    const full = db.prepare("SELECT content FROM skills WHERE tenant_id='t-default' AND name='url-hunting-recovery'").get() as any;
    expect(full.content).toContain("don't know its address");
    expect(full.content).toContain('suspectedErrorShell');
    expect(full.content).toContain('__next_error__');
    db.close();
  });
});
