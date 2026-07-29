/**
 * Hybrid search engine combining BM25 and semantic search
 * 
 * Uses Reciprocal Rank Fusion (RRF) to combine results from
 * multiple search methods for optimal accuracy.
 * 
 * Based on research:
 * - BM25 alone: 14% top-1 accuracy (StackOne)
 * - Hybrid BM25 + semantic: 94% top-1 accuracy (Stacklok)
 */

import type { ToolDocument, SearchResult } from './bm25.js';
import { BM25Engine } from './bm25.js';
import { EmbeddingEngine, type EmbeddingConfig } from './embeddings.js';

export interface HybridSearchConfig {
  /** BM25 weight in fusion (0-1) */
  bm25Weight?: number;
  /** Semantic weight in fusion (0-1) */
  semanticWeight?: number;
  /** RRF constant (k in RRF formula) */
  rrfConstant?: number;
  /** Maximum results to return */
  maxResults?: number;
  /** Minimum score threshold */
  minScore?: number;
  /** Enable/disable BM25 search */
  enableBM25?: boolean;
  /** Enable/disable semantic search */
  enableSemantic?: boolean;
  /** Embedding configuration (required if semantic is enabled) */
  embeddingConfig?: EmbeddingConfig;
}

const DEFAULT_CONFIG: Required<HybridSearchConfig> = {
  bm25Weight: 0.4,
  semanticWeight: 0.6,
  rrfConstant: 60,
  maxResults: 10,
  minScore: 0.01,
  enableBM25: true,
  enableSemantic: true,
  embeddingConfig: {
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'nomic-embed-text',
  },
};

/**
 * Hybrid search engine combining BM25 and semantic search
 */
export class HybridSearchEngine {
  private bm25: BM25Engine | null = null;
  private embedding: EmbeddingEngine | null = null;
  private config: Required<HybridSearchConfig>;
  private initialized = false;
  /** True once the embedding backend has failed; search then runs lexical-only. */
  private semanticDegraded = false;
  /** Last embedding-backend error message, surfaced for diagnostics. */
  private lastSemanticError: string | null = null;

  constructor(config?: HybridSearchConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    if (this.config.enableBM25) {
      this.bm25 = new BM25Engine();
    }
    
    if (this.config.enableSemantic && this.config.embeddingConfig) {
      this.embedding = new EmbeddingEngine(this.config.embeddingConfig);
    }
  }

  /**
   * Initialize the search engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.embedding) {
      try {
        await this.embedding.initialize();
      } catch (err) {
        this.semanticDegraded = true;
        this.lastSemanticError = err instanceof Error ? err.message : String(err);
      }
    }

    this.initialized = true;
  }

  /**
   * Add tools to the search index
   */
  async addTools(tools: ToolDocument[]): Promise<void> {
    if (this.bm25) {
      for (const tool of tools) {
        this.bm25.addDocument(tool);
      }
    }

    // Semantic indexing is best-effort: the embedding backend (Ollama/OpenAI)
    // is an optional external dependency. If it is unreachable the BM25 index
    // above is still valid, so degrade to lexical-only instead of throwing and
    // taking the whole tool-discovery surface down with it.
    if (this.embedding) {
      try {
        await this.embedding.addDocuments(tools);
      } catch (err) {
        this.semanticDegraded = true;
        this.lastSemanticError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  /**
   * Remove a tool from the index
   */
  removeTool(toolId: string): void {
    if (this.bm25) {
      this.bm25.removeDocument(toolId);
    }
    if (this.embedding) {
      this.embedding.removeDocument(toolId);
    }
  }

  /**
   * Search for tools using hybrid approach
   */
  async search(query: string, maxResults?: number): Promise<SearchResult[]> {
    const limit = maxResults ?? this.config.maxResults;
    const results: SearchResult[] = [];

    // Run searches in parallel. `allSettled` (not `all`) is deliberate: the
    // semantic leg talks to an optional external embedding backend, and a
    // rejection there must not fail a search that BM25 could still answer.
    const [bm25Settled, semanticSettled] = await Promise.allSettled([
      this.config.enableBM25 && this.bm25
        ? this.bm25.search(query, limit * 2)
        : Promise.resolve([] as SearchResult[]),
      this.config.enableSemantic && this.embedding && !this.semanticDegraded
        ? this.embedding.search(query, limit * 2)
        : Promise.resolve([] as SearchResult[]),
    ]);

    let bm25Results: SearchResult[] = [];
    if (bm25Settled.status === 'fulfilled') {
      bm25Results = bm25Settled.value;
    }

    let semanticResults: SearchResult[] = [];
    if (semanticSettled.status === 'fulfilled') {
      semanticResults = semanticSettled.value;
    } else {
      this.semanticDegraded = true;
      this.lastSemanticError =
        semanticSettled.reason instanceof Error
          ? semanticSettled.reason.message
          : String(semanticSettled.reason);
    }

    const semanticOk = semanticSettled.status === 'fulfilled' && !this.semanticDegraded;

    // If BM25 also failed there is nothing left to fuse — surface the real
    // cause rather than silently returning an empty result set.
    if (bm25Settled.status === 'rejected' && !semanticOk) {
      throw bm25Settled.reason;
    }

    // Only one search method is usable (either disabled by config, or the
    // semantic backend is unavailable) — return its results directly.
    if (!this.config.enableBM25 || !this.config.enableSemantic || !semanticOk) {
      const singleResults = this.config.enableBM25 ? bm25Results : semanticResults;
      return singleResults
        .filter((r) => r.score >= this.config.minScore)
        .slice(0, limit);
    }

    // Reciprocal Rank Fusion
    const scores = new Map<string, number>();
    const toolMap = new Map<string, ToolDocument>();

    // BM25 results
    bm25Results.forEach((result, rank) => {
      const rrfScore = this.config.bm25Weight / (this.config.rrfConstant + rank + 1);
      scores.set(result.tool.id, (scores.get(result.tool.id) || 0) + rrfScore);
      toolMap.set(result.tool.id, result.tool);
    });

    // Semantic results
    semanticResults.forEach((result, rank) => {
      const rrfScore = this.config.semanticWeight / (this.config.rrfConstant + rank + 1);
      scores.set(result.tool.id, (scores.get(result.tool.id) || 0) + rrfScore);
      toolMap.set(result.tool.id, result.tool);
    });

    // Convert to results array and sort
    for (const [toolId, score] of scores) {
      const tool = toolMap.get(toolId);
      if (tool && score >= this.config.minScore) {
        results.push({ tool, score, matchType: 'hybrid' });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Report whether semantic search is currently usable. When `degraded` is
   * true the engine is answering from BM25 alone and `error` holds the reason.
   */
  getSemanticStatus(): { enabled: boolean; degraded: boolean; error: string | null } {
    return {
      enabled: this.config.enableSemantic && this.embedding !== null,
      degraded: this.semanticDegraded,
      error: this.lastSemanticError,
    };
  }

  /**
   * Get all indexed tools
   */
  getAllTools(): ToolDocument[] {
    if (this.bm25) {
      return this.bm25.getAllDocuments();
    }
    return [];
  }

  /**
   * Clear the search index
   */
  clear(): void {
    if (this.bm25) {
      this.bm25.clear();
    }
    if (this.embedding) {
      this.embedding.clear();
    }
  }

  /**
   * Get search engine statistics
   */
  getStats(): {
    bm25?: { documentCount: number; termCount: number; avgDocLength: number };
    embedding?: { vectorCount: number; dimension: number };
  } {
    return {
      bm25: this.bm25?.getStats(),
      embedding: this.embedding?.getStats(),
    };
  }
}
