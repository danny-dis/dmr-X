/**
 * AgentMemoryManager tests.
 *
 * Uses a fresh in-memory database initialized via @dmr-x/db's initDb, which
 * applies all migrations (including 051_agent_memory). No live external DB
 * required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { initDb, closeDb } from '@dmr-x/db';
import { AgentMemoryManager } from '../../services/memory/src/memory-manager.js';

const manager = new AgentMemoryManager();

const TENANT = 'test-tenant';
const AGENT = 'test-agent';
const SESSION = 'test-session';

beforeAll(async () => {
  await initDb();
}, 30000);

afterAll(async () => {
  await closeDb();
});

describe('AgentMemoryManager', () => {
  it('remembers a long-term memory by default and recalls it', async () => {
    await manager.remember(TENANT, AGENT, 'The user prefers TypeScript.');
    const recalled = await manager.recall(TENANT, AGENT, { kind: 'long_term' });
    expect(recalled.length).toBeGreaterThanOrEqual(1);
    expect(recalled.some(m => m.content.includes('TypeScript'))).toBe(true);
  });

  it('stores a short-term memory when sessionId is provided without kind', async () => {
    await manager.remember(TENANT, AGENT, 'Current turn mentioned the weather.', { sessionId: SESSION });
    const short = await manager.recall(TENANT, AGENT, { sessionId: SESSION, kind: 'short_term' });
    expect(short.length).toBeGreaterThanOrEqual(1);
    expect(short.some(m => m.kind === 'short_term' && m.content.includes('weather'))).toBe(true);
  });

  it('filters recall by substring query', async () => {
    await manager.remember(TENANT, AGENT, 'Unique coffee fact for filtering test.');
    const res = await manager.recall(TENANT, AGENT, { query: 'coffee' });
    expect(res.some(m => m.content.includes('coffee'))).toBe(true);
    const none = await manager.recall(TENANT, AGENT, { query: 'nonexistentterm' });
    expect(none.every(m => m.content.toLowerCase().includes('nonexistentterm'))).toBe(true);
  });

  it('prefetchForPrompt includes long-term and current session short-term content', async () => {
    const block = await manager.prefetchForPrompt(TENANT, AGENT, SESSION);
    expect(block).toContain('Memory:');
    expect(block).toContain('TypeScript');
    expect(block).toContain('weather');
  });

  it('prefetchForPrompt returns empty string for unknown agent', async () => {
    const block = await manager.prefetchForPrompt('other-tenant', 'other-agent', 's');
    expect(block).toBe('');
  });

  it('sync stores a short-term memory after a turn', async () => {
    await manager.sync(TENANT, AGENT, SESSION, 'Sync convenience method content.');
    const short = await manager.recall(TENANT, AGENT, { sessionId: SESSION, kind: 'short_term' });
    expect(short.some(m => m.content.includes('Sync convenience'))).toBe(true);
  });
});
