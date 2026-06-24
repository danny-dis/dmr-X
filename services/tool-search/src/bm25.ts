/**
 * BM25-based tool search engine using Orama
 * 
 * Provides fast keyword-based tool discovery with:
 * - Inverted index for O(1) term lookup
 * - BM25 ranking algorithm
 * - Incremental index updates
 */

export interface ToolDocument {
  id: string;
  name: string;
  description: string;
  serverId: string;
  serverName: string;
  inputSchema?: Record<string, unknown>;
  tags?: string[];
}

export interface SearchResult {
  tool: ToolDocument;
  score: number;
  matchType: 'bm25' | 'semantic' | 'hybrid';
}

export interface BM25Config {
  /** BM25 k1 parameter (term frequency saturation) */
  k1?: number;
  /** BM25 b parameter (length normalization) */
  b?: number;
  /** Maximum number of results */
  maxResults?: number;
}

const DEFAULT_CONFIG: Required<BM25Config> = {
  k1: 1.2,
  b: 0.75,
  maxResults: 10,
};

/**
 * Simple BM25 implementation for tool search
 */
export class BM25Engine {
  private documents = new Map<string, ToolDocument>();
  private invertedIndex = new Map<string, Map<string, number>>(); // term -> docId -> tf
  private docLengths = new Map<string, number>();
  private avgDocLength = 0;
  private totalDocs = 0;
  private config: Required<BM25Config>;

  constructor(config?: BM25Config) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add or update a tool document in the index
   */
  addDocument(doc: ToolDocument): void {
    const text = this.tokenize(`${doc.name} ${doc.description} ${(doc.tags || []).join(' ')}`);
    const docLength = text.length;

    this.documents.set(doc.id, doc);
    this.docLengths.set(doc.id, docLength);

    // Update inverted index
    for (const term of text) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Map());
      }
      const termDocs = this.invertedIndex.get(term)!;
      termDocs.set(doc.id, (termDocs.get(doc.id) || 0) + 1);
    }

    this.recalculateStats();
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docId: string): void {
    const doc = this.documents.get(docId);
    if (!doc) return;

    const text = this.tokenize(`${doc.name} ${doc.description} ${(doc.tags || []).join(' ')}`);

    // Remove from inverted index
    for (const term of text) {
      const termDocs = this.invertedIndex.get(term);
      if (termDocs) {
        termDocs.delete(docId);
        if (termDocs.size === 0) {
          this.invertedIndex.delete(term);
        }
      }
    }

    this.documents.delete(docId);
    this.docLengths.delete(docId);
    this.recalculateStats();
  }

  /**
   * Search for tools matching a query
   */
  search(query: string, maxResults?: number): SearchResult[] {
    const limit = maxResults ?? this.config.maxResults;
    const queryTerms = this.tokenize(query);
    const scores = new Map<string, number>();

    for (const term of queryTerms) {
      const termDocs = this.invertedIndex.get(term);
      if (!termDocs) continue;

      const df = termDocs.size; // document frequency
      const idf = Math.log((this.totalDocs - df + 0.5) / (df + 0.5) + 1);

      for (const [docId, tf] of termDocs) {
        const docLength = this.docLengths.get(docId) || 0;
        const numerator = tf * (this.config.k1 + 1);
        const denominator = tf + this.config.k1 * (1 - this.config.b + this.config.b * (docLength / this.avgDocLength));
        const bm25Score = idf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) || 0) + bm25Score);
      }
    }

    // Sort by score and return top results
    const results: SearchResult[] = [];
    for (const [docId, score] of scores) {
      const doc = this.documents.get(docId);
      if (doc) {
        results.push({ tool: doc, score, matchType: 'bm25' });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Get all documents (for embedding index building)
   */
  getAllDocuments(): ToolDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.avgDocLength = 0;
    this.totalDocs = 0;
  }

  /**
   * Get index statistics
   */
  getStats(): { documentCount: number; termCount: number; avgDocLength: number } {
    return {
      documentCount: this.totalDocs,
      termCount: this.invertedIndex.size,
      avgDocLength: this.avgDocLength,
    };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private recalculateStats(): void {
    this.totalDocs = this.documents.size;
    let totalLength = 0;
    for (const len of this.docLengths.values()) {
      totalLength += len;
    }
    this.avgDocLength = this.totalDocs > 0 ? totalLength / this.totalDocs : 0;
  }
}
