import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticCacheService } from '../../services/cache/src/semantic-cache.js';

const state = vi.hoisted(() => ({
  db: null as any,
  embedReal: vi.fn(async () => ({ embedding: [1, 0], provider: 'ollama', model: 'nomic-embed-text', dimensions: 2, namespace: 'semantic-v1:ollama:nomic-embed-text:2:http://ollama.test/api/embeddings' })),
}));
vi.mock('@dmr-x/db', () => ({ getDb: () => state.db }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@dmr-x/memory', () => ({ EmbeddingsService: class { embedReal = state.embedReal; } }));

let cache: SemanticCacheService;
const answer = { modality: 'llm', modelId: 'model-a', message: { role: 'assistant', content: 'Answer A' }, finishReason: 'stop' };
const body = { model: 'model-a', messages: [{ role: 'system', content: 'Use the policy.' }, { role: 'user', content: 'Explain the deployment policy in detail.' }] };

beforeEach(() => {
  vi.stubEnv('DMRX_SEMANTIC_CACHE_ENABLED', 'true');
  vi.stubEnv('OLLAMA_BASE_URL', 'http://ollama.test');
  state.db = new DatabaseSync(':memory:');
  state.db.exec(`CREATE TABLE semantic_cache_entries (id TEXT PRIMARY KEY, tenant_id TEXT, request_type TEXT NOT NULL, prompt_text TEXT NOT NULL, embedding BLOB NOT NULL, response TEXT NOT NULL, tokens INTEGER DEFAULT 0, hit_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
  state.embedReal.mockClear();
  cache = new SemanticCacheService();
});
afterEach(() => { cache.destroy(); state.db.close(); vi.unstubAllEnvs(); });

describe('semantic cache provider safety', () => {
  it('uses real-only embeddings and partitions rows when the embedding namespace changes', async () => {
    await cache.store('chat', 'tenant-a', body, answer);
    expect(await cache.lookup('chat', 'tenant-a', body)).not.toBeNull();
    state.embedReal.mockResolvedValueOnce({ embedding: [1, 0, 0], provider: 'openai', model: 'text-embedding-3-small', dimensions: 3, namespace: 'semantic-v1:openai:text-embedding-3-small:3:https://api.openai.com/v1/embeddings' });
    expect(await cache.lookup('chat', 'tenant-a', body)).toBeNull();
  });

  it('skips corrupt stored vectors rather than producing a false hit', async () => {
    await cache.store('chat', 'tenant-a', body, answer);
    state.db.prepare('UPDATE semantic_cache_entries SET embedding = ?').run(Buffer.from([1, 2, 3]));
    expect(await cache.lookup('chat', 'tenant-a', body)).toBeNull();
  });

  it('fails open when the real provider rejects and stores no hash substitute', async () => {
    state.embedReal.mockRejectedValueOnce(new Error('provider unavailable'));
    await cache.store('chat', 'tenant-a', body, answer);
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM semantic_cache_entries').get().count).toBe(0);
  });
});
