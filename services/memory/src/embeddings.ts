import { logger } from '@dmr-x/utils';

export interface RealEmbedding {
  embedding: number[];
  provider: 'openai' | 'ollama';
  model: string;
  dimensions: number;
  namespace: string;
}

export interface RealEmbeddingOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_REAL_EMBEDDING_TIMEOUT_MS = 500;
const MIN_REAL_EMBEDDING_TIMEOUT_MS = 1;
const MAX_REAL_EMBEDDING_TIMEOUT_MS = 10_000;

export class EmbeddingsService {
  private defaultModel = 'text-embedding-3-small';
  private dimensions = 1536;

  getDefaultModel(): string {
    return this.defaultModel;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      return this.embedOpenAI(text, apiKey);
    }

    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    try {
      return await this.embedOllama(text, ollamaUrl);
    } catch {
      logger.warn('Ollama embedding unavailable, using hash-based fallback');
      return this.hashEmbed(text);
    }
  }

  /** Cache-only embedding path: never substitutes deterministic hash vectors. */
  async embedReal(text: string, options: RealEmbeddingOptions = {}): Promise<RealEmbedding> {
    const apiKey = process.env.OPENAI_API_KEY;
    const provider = apiKey ? 'openai' : 'ollama';
    const model = provider === 'openai' ? this.defaultModel : 'nomic-embed-text';
    const endpoint = provider === 'openai'
      ? 'https://api.openai.com/v1/embeddings'
      : `${(process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '')}/api/embeddings`;
    const timeoutMs = this.realEmbeddingTimeout(options.timeoutMs);
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason ?? new Error('Embedding deadline exceeded'));
    const timer = setTimeout(abort, timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });

    try {
      if (options.signal?.aborted) abort();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: provider === 'openai'
          ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
          : { 'Content-Type': 'application/json' },
        body: provider === 'openai'
          ? JSON.stringify({ model, input: text, dimensions: this.dimensions })
          : JSON.stringify({ model, prompt: text }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${provider} embedding failed: ${response.status}`);
      const data = await response.json() as { data?: { embedding?: unknown }[]; embedding?: unknown };
      const embedding = provider === 'openai' ? data.data?.[0]?.embedding : data.embedding;
      this.assertRealEmbedding(embedding);
      const vector = embedding as number[];
      return {
        embedding: vector,
        provider,
        model,
        dimensions: vector.length,
        namespace: `semantic-v1:${provider}:${model}:${vector.length}:${this.endpointIdentity(endpoint)}`,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private realEmbeddingTimeout(value: number | undefined): number {
    if (!Number.isFinite(value) || value === undefined) return DEFAULT_REAL_EMBEDDING_TIMEOUT_MS;
    return Math.min(MAX_REAL_EMBEDDING_TIMEOUT_MS, Math.max(MIN_REAL_EMBEDDING_TIMEOUT_MS, Math.floor(value)));
  }

  private assertRealEmbedding(value: unknown): asserts value is number[] {
    if (!Array.isArray(value) || value.length === 0 || !value.every(Number.isFinite)) {
      throw new Error('invalid embedding returned by provider');
    }
    const magnitude = Math.sqrt(value.reduce((sum, entry) => sum + entry * entry, 0));
    if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error('invalid embedding returned by provider');
  }

  private endpointIdentity(endpoint: string): string {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  }

  private async embedOpenAI(text: string, apiKey: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.defaultModel,
        input: text,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.status}`);
    }

    const data = await response.json() as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  }

  private async embedOllama(text: string, baseUrl: string): Promise<number[]> {
    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status}`);
    }

    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  }

  private hashEmbed(text: string): number[] {
    const dim = this.dimensions;
    const emb = new Array<number>(dim);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);

    for (let i = 0; i < dim; i++) {
      let hash = 0;
      for (let j = 0; j < bytes.length; j++) {
        hash = ((hash << 5) - hash + bytes[(j + i * 7) % bytes.length]) | 0;
      }
      emb[i] = (Math.sin(hash * 0.001) + 1) / 2;
    }

    const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
    return emb.map(v => v / (norm || 1));
  }
}
