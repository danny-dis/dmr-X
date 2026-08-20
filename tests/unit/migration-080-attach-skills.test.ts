import { describe, it, expect } from 'vitest';
import { MIGRATIONS } from '../../packages/db/src/migrations-data.js';

/**
 * Migration 080 attaches the seeded research skills (migration 079) to the
 * agents that actually do web work — selected by the agents' OWN declaration
 * (allowed_tools naming WebFetch/WebSearch), not by a keyword match on the name,
 * which would sweep in "Blockchain Security Auditor" and other non-web roles.
 *
 * `agent_definitions.skills` is a JSON array stored as TEXT (migration 046,
 * DEFAULT '[]'), so the migration has to handle both the empty case and the
 * append case, and must be safely re-runnable.
 */
describe('migration 080: research skills attached to web-tool agents', () => {
  it('is registered', () => {
    expect(MIGRATIONS[80]).toBeDefined();
    expect(MIGRATIONS[80].filename).toBe('080_attach_research_skills_to_web_agents.sql');
  });

  it('attaches to web agents, skips others, and is idempotent', async () => {
    const { DatabaseSync: Database } = await import('node:sqlite');
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE agent_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      skills TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));`);

    const ins = db.prepare('INSERT INTO agent_definitions (id,name,allowed_tools,skills) VALUES (?,?,?,?)');
    // Real shapes from this install: allowed_tools is a bare comma string.
    ins.run('a1', 'Trend Researcher', 'WebFetch, WebSearch, Read, Write, Edit', '[]');
    ins.run('a2', 'SEO Specialist', 'WebFetch, WebSearch, Read, Write, Edit', '[]');
    // Already has a skill -> must APPEND, not replace.
    ins.run('a3', 'Content Creator', 'WebFetch, WebSearch, Read', '["existing-skill"]');
    // No web tools -> must be left completely alone.
    ins.run('a4', 'Blockchain Security Auditor', 'Read, Write, Edit', '[]');
    // Unrestricted agent (empty allowed_tools) -> not a declared web agent.
    ins.run('a5', 'Codebase Archaeologist', '', '[]');

    db.exec(MIGRATIONS[80].sql);

    const get = (id: string) =>
      (db.prepare('SELECT skills FROM agent_definitions WHERE id=?').get(id) as any).skills;

    const a1 = JSON.parse(get('a1'));
    expect(a1).toContain('url-hunting-recovery');
    expect(a1).toContain('grounded-research-brief');
    expect(a1).toHaveLength(2);

    // Append case preserved the pre-existing entry.
    const a3 = JSON.parse(get('a3'));
    expect(a3).toContain('existing-skill');
    expect(a3).toContain('url-hunting-recovery');
    expect(a3).toContain('grounded-research-brief');
    expect(a3).toHaveLength(3);

    // Non-web agents untouched.
    expect(get('a4')).toBe('[]');
    expect(get('a5')).toBe('[]');

    // Every produced value must still be valid JSON — a broken string-splice
    // would corrupt definition.skills for the runtime.
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      expect(() => JSON.parse(get(id))).not.toThrow();
    }

    // IDEMPOTENT: a second apply must not duplicate entries.
    db.exec(MIGRATIONS[80].sql);
    const a1again = JSON.parse(get('a1'));
    expect(a1again).toHaveLength(2);
    const a3again = JSON.parse(get('a3'));
    expect(a3again).toHaveLength(3);

    console.log('ATTACHED:', JSON.stringify({ a1: get('a1'), a3: get('a3'), a4: get('a4') }));
    db.close();
  });
});
