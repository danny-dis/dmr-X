/**
 * Semantic embedding search for tool discovery
 * 
 * Supports multiple embedding providers:
 * - Ollama (local, privacy-first)
 * - OpenAI embeddings API
 * - Remote custom endpoint
 */

import { createLogger } from '@dmr-x/utils';

import type { ToolDocument, SearchResult } from './bm25.js';

const logger = createLogger('tool-search:embeddings');

export interface EmbeddingConfig {
  /** Embedding provider */
  provider: 'ollama' | 'openai' | 'remote';
  /** Ollama base URL */
  ollamaUrl?: string;
  /** Ollama model name */
  ollamaModel?: string;
  /** OpenAI API key */
  openaiApiKey?: string;
  /** OpenAI model name */
  openaiModel?: string;
  /** Remote embedding endpoint URL */
  remoteUrl?: string;
  /** Remote endpoint API key */
  remoteApiKey?: string;
  /** Maximum number of results */
  maxResults?: number;
  /** Similarity threshold (0-1) */
  similarityThreshold?: number;
}

interface EmbeddingVector {
  id: string;
  vector: number[];
  document: ToolDocument;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Semantic embedding search engine
 */
export class EmbeddingEngine {
  private vectors: EmbeddingVector[] = [];
  private config: Required<EmbeddingConfig>;
  private initialized = false;

  constructor(config: EmbeddingConfig) {
    this.config = {
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'nomic-embed-text',
      openaiApiKey: '',
      openaiModel: 'text-embedding-3-small',
      remoteUrl: '',
      remoteApiKey: '',
      maxResults: 10,
      similarityThreshold: 0.3,
      ...config,
    };
  }

  /**
   * Initialize the embedding engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Test connection to embedding provider
      switch (this.config.provider) {
        case 'ollama':
          await this.testOllamaConnection();
          break;
        case 'openai':
          await this.testOpenAIConnection();
          break;
        case 'remote':
          await this.testRemoteConnection();
          break;
      }
      this.initialized = true;
      logger.info({ provider: this.config.provider }, 'Embedding engine initialized');
    } catch (error) {
      logger.error({ error, provider: this.config.provider }, 'Failed to initialize embedding engine');
      throw error;
    }
  }

  /**
   * Add documents and generate embeddings
   */
  async addDocuments(docs: ToolDocument[]): Promise<void> {
    const texts = docs.map((d) => `${d.name}: ${d.description}`);
    const embeddings = await this.embed(texts);

    for (let i = 0; i < docs.length; i++) {
      this.vectors.push({
        id: docs[i].id,
        vector: embeddings[i],
        document: docs[i],
      });
    }

    logger.info({ count: docs.length }, 'Documents added to embedding index');
  }

  /**
   * Remove a document by ID
   */
  removeDocument(docId: string): void {
    this.vectors = this.vectors.filter((v) => v.id !== docId);
  }

  /**
   * Search for similar tools
   */
  async search(query: string, maxResults?: number): Promise<SearchResult[]> {
    const limit = maxResults ?? this.config.maxResults;
    const queryEmbedding = await this.embed([query]);

    const results: SearchResult[] = [];
    for (const vec of this.vectors) {
      const similarity = cosineSimilarity(queryEmbedding[0], vec.vector);
      if (similarity >= this.config.similarityThreshold) {
        results.push({
          tool: vec.document,
          score: similarity,
          matchType: 'semantic',
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.vectors = [];
  }

  /**
   * Get index stats
   */
  getStats(): { vectorCount: number; dimension: number } {
    return {
      vectorCount: this.vectors.length,
      dimension: this.vectors.length > 0 ? this.vectors[0].vector.length : 0,
    };
  }

  /**
   * Generate embeddings for texts
   */
  private async embed(texts: string[]): Promise<number[][]> {
    switch (this.config.provider) {
      case 'ollama':
        return this.embedWithOllama(texts);
      case 'openai':
        return this.embedWithOpenAI(texts);
      case 'remote':
        return this.embedWithRemote(texts);
    }
  }

  private async embedWithOllama(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const response = await fetch(`${this.config.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.ollamaModel,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embedding failed: ${response.statusText}`);
      }

      const data = await response.json() as { embedding: number[] };
      results.push(data.embedding);
    }

    return results;
  }

  private async embedWithOpenAI(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.openaiModel,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  }

  private async embedWithRemote(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.config.remoteUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.remoteApiKey ? { 'Authorization': `Bearer ${this.config.remoteApiKey}` } : {}),
      },
      body: JSON.stringify({ texts }),
    });

    if (!response.ok) {
      throw new Error(`Remote embedding failed: ${response.statusText}`);
    }

    const data = await response.json() as { embeddings: number[][] };
    return data.embeddings;
  }

  private async testOllamaConnection(): Promise<void> {
    const response = await fetch(`${this.config.ollamaUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama connection failed: ${response.statusText}`);
    }
  }

  private async testOpenAIConnection(): Promise<void> {
    if (!this.config.openaiApiKey) {
      throw new Error('OpenAI API key is required');
    }
    // Simple test - list models
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${this.config.openaiApiKey}` },
    });
    if (!response.ok) {
      throw new Error(`OpenAI connection failed: ${response.statusText}`);
    }
  }

  private async testRemoteConnection(): Promise<void> {
    const response = await fetch(this.config.remoteUrl!, {
      method: 'GET',
      ...(this.config.remoteApiKey ? { headers: { 'Authorization': `Bearer ${this.config.remoteApiKey}` } } : {}),
    });
    if (!response.ok) {
      throw new Error(`Remote endpoint connection failed: ${response.statusText}`);
    }
  }
}
