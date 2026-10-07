import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticCacheService } from '../../services/cache/src/semantic-cache.js';

const state = vi.hoisted(() => ({
  db: null as any,
  embedReal: vi.fn(async (_text: string) => ({ embedding: [1, 0], provider: 'ollama', model: 'nomic-embed-text', dimensions: 2, namespace: 'semantic-v1:ollama:nomic-embed-text:2:http://localhost:11434/api/embeddings' })),
}));
vi.mock('@dmr-x/db', () => ({ getDb: () => state.db }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@dmr-x/memory', () => ({ EmbeddingsService: class { embedReal = state.embedReal; } }));
let cache: SemanticCacheService;
const answer = { modality: 'llm', modelId: 'model-a', message: { role: 'assistant', content: 'Answer A' }, finishReason: 'stop' };
const prompt = 'Explain the deployment policy in detail.';
function body(system: string, extra: Record<string, unknown> = {}) {
  return { model: 'model-a', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], ...extra };
}

beforeEach(() => {
  vi.stubEnv('DMRX_SEMANTIC_CACHE_ENABLED', 'true');
  vi.stubEnv('OLLAMA_BASE_URL', 'http://localhost:11434');
  state.db = new DatabaseSync(':memory:');
  state.db.exec(`CREATE TABLE semantic_cache_entries (
    id TEXT PRIMARY KEY, tenant_id TEXT, request_type TEXT NOT NULL, prompt_text TEXT NOT NULL,
    embedding BLOB NOT NULL, response TEXT NOT NULL, tokens INTEGER DEFAULT 0, hit_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`);
  state.embedReal.mockClear();
  cache = new SemanticCacheService();
});
afterEach(() => { cache.destroy(); state.db.close(); vi.unstubAllEnvs(); });

describe('semantic cache context boundaries', () => {
  it('never reuses an answer under different system instructions', async () => {
    await cache.store('chat', 'tenant-a', body('Answer in English.'), answer);
    expect(await cache.lookup('chat', 'tenant-a', body('Answer in English.'))).not.toBeNull();
    expect(await cache.lookup('chat', 'tenant-a', body('Answer in French.'))).toBeNull();
  });

  it('treats expired ISO-timestamp entries as misses and cleans them up', async () => {
    await cache.store('chat', 'tenant-a', body('Answer in English.'), answer);
    const expired = new Date(Date.now() - 60_000).toISOString();
    state.db.prepare('UPDATE semantic_cache_entries SET expires_at = ?').run(expired);
    expect(await cache.lookup('chat', 'tenant-a', body('Answer in English.'))).toBeNull();
    cache.cleanup();
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM semantic_cache_entries').get().count).toBe(0);
  });

  it.each([
    { model: 'model-b' }, { response_format: { type: 'json_object' } },
    { max_tokens: 8 }, { top_p: 0.1 }, { stop: ['STOP'] }, { seed: 42 }, { user: 'other-user' },
  ])('separates model, generation and user settings: %j', async extra => {
    await cache.store('chat', 'tenant-a', body('policy'), answer);
    expect(await cache.lookup('chat', 'tenant-a', body('policy', extra))).toBeNull();
  });

  it('isolates tenants and conversation history', async () => {
    await cache.store('chat', 'tenant-a', body('policy'), answer);
    expect(await cache.lookup('chat', 'tenant-b', body('policy'))).toBeNull();
    const changed = body('policy');
    changed.messages.splice(1, 0, { role: 'assistant', content: 'Different earlier facts.' });
    expect(await cache.lookup('chat', 'tenant-a', changed)).toBeNull();
  });

  it('requires explicit opt-in before matching different latest-user wording', async () => {
    const original = body('policy');
    const different = body('policy');
    different.messages[1].content = 'Describe the rollout policy thoroughly.';
    await cache.store('chat', 'tenant-a', original, answer);
    expect(await cache.lookup('chat', 'tenant-a', different)).toBeNull();
    const approximate = { metadata: { semanticCache: 'approximate' } };
    await cache.store('chat', 'tenant-a', { ...original, ...approximate }, answer);
    expect(await cache.lookup('chat', 'tenant-a', { ...different, ...approximate })).not.toBeNull();
    expect(await cache.lookup('chat', 'tenant-a', body('new policy', approximate))).toBeNull();
  });

  it('does not store tool, multimodal or incomplete responses', async () => {
    const toolBody = body('policy', { tools: [{ type: 'function' }] });
    await cache.store('chat', 'tenant-a', toolBody, answer);
    await cache.store('chat', 'tenant-a', body('policy'), { ...answer, finishReason: 'length' });
    const imageBody = body('policy', { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'image' } }] }] });
    await cache.store('chat', 'tenant-a', imageBody, answer);
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM semantic_cache_entries').get().count).toBe(0);
    expect(state.embedReal).not.toHaveBeenCalled();
  });
});
