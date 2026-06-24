/**
 * Semantic tool deduplication
 * 
 * Detects and resolves conflicts when multiple MCP servers
 * expose similar tools (e.g., github__create_issue vs jira__create_issue).
 * 
 * Uses embedding similarity to cluster duplicate tools.
 */

import type { ToolDocument } from './bm25.js';
import { EmbeddingEngine, type EmbeddingConfig } from './embeddings.js';

export interface DeduplicationConfig {
  /** Similarity threshold for considering tools as duplicates (0-1) */
  similarityThreshold?: number;
  /** Embedding configuration */
  embeddingConfig?: EmbeddingConfig;
}

export interface ToolCluster {
  /** Cluster ID */
  id: string;
  /** Primary tool (the "best" one) */
  primary: ToolDocument;
  /** All tools in this cluster */
  tools: ToolDocument[];
  /** Average similarity within cluster */
  avgSimilarity: number;
}

export interface DeduplicationResult {
  /** Unique tools (no duplicates) */
  unique: ToolDocument[];
  /** Tool clusters (groups of similar tools) */
  clusters: ToolCluster[];
  /** Mapping from duplicate tool ID to primary tool ID */
  duplicateMap: Map<string, string>;
}

/**
 * Semantic tool deduplication engine
 */
export class ToolDeduplicator {
  private embedding: EmbeddingEngine | null = null;
  private config: Required<DeduplicationConfig>;

  constructor(config?: DeduplicationConfig) {
    this.config = {
      similarityThreshold: 0.85,
      embeddingConfig: {
        provider: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'nomic-embed-text',
      },
      ...config,
    };
  }

  /**
   * Initialize the deduplicator
   */
  async initialize(): Promise<void> {
    this.embedding = new EmbeddingEngine(this.config.embeddingConfig);
    await this.embedding.initialize();
  }

  /**
   * Deduplicate a list of tools
   */
  async deduplicate(tools: ToolDocument[]): Promise<DeduplicationResult> {
    if (!this.embedding) {
      throw new Error('Deduplicator not initialized');
    }

    if (tools.length === 0) {
      return { unique: [], clusters: [], duplicateMap: new Map() };
    }

    // Generate embeddings for all tools
    const texts = tools.map((t) => `${t.name}: ${t.description}`);
    // We need to add documents first to embed them
    await this.embedding.addDocuments(tools);

    // Compute similarity matrix
    const similarityMatrix = await this.computeSimilarityMatrix(tools);

    // Cluster similar tools
    const clusters = this.clusterTools(tools, similarityMatrix);

    // Build deduplication result
    const unique: ToolDocument[] = [];
    const duplicateMap = new Map<string, string>();

    for (const cluster of clusters) {
      unique.push(cluster.primary);
      for (const tool of cluster.tools) {
        if (tool.id !== cluster.primary.id) {
          duplicateMap.set(tool.id, cluster.primary.id);
        }
      }
    }

    // Add tools that aren't in any cluster
    const clusteredIds = new Set(clusters.flatMap((c) => c.tools.map((t) => t.id)));
    for (const tool of tools) {
      if (!clusteredIds.has(tool.id)) {
        unique.push(tool);
      }
    }

    return { unique, clusters, duplicateMap };
  }

  /**
   * Compute pairwise similarity matrix
   */
  private async computeSimilarityMatrix(tools: ToolDocument[]): Promise<number[][]> {
    const matrix: number[][] = [];
    const vectors = await this.getToolVectors(tools);

    for (let i = 0; i < tools.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < tools.length; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else if (j < i) {
          matrix[i][j] = matrix[j][i]; // Use symmetry
        } else {
          matrix[i][j] = this.cosineSimilarity(vectors[i], vectors[j]);
        }
      }
    }

    return matrix;
  }

  /**
   * Cluster tools based on similarity
   */
  private clusterTools(
    tools: ToolDocument[],
    similarityMatrix: number[][]
  ): ToolCluster[] {
    const clusters: ToolCluster[] = [];
    const visited = new Set<number>();

    for (let i = 0; i < tools.length; i++) {
      if (visited.has(i)) continue;

      const clusterTools: ToolDocument[] = [tools[i]];
      visited.add(i);

      for (let j = i + 1; j < tools.length; j++) {
        if (visited.has(j)) continue;
        if (similarityMatrix[i][j] >= this.config.similarityThreshold) {
          clusterTools.push(tools[j]);
          visited.add(j);
        }
      }

      if (clusterTools.length > 1) {
        // Calculate average similarity
        let totalSimilarity = 0;
        let count = 0;
        for (const t1 of clusterTools) {
          for (const t2 of clusterTools) {
            if (t1.id !== t2.id) {
              const i1 = tools.findIndex((t) => t.id === t1.id);
              const i2 = tools.findIndex((t) => t.id === t2.id);
              totalSimilarity += similarityMatrix[i1][i2];
              count++;
            }
          }
        }

        // Select primary tool (prefer shorter names, more descriptive)
        const primary = this.selectPrimaryTool(clusterTools);

        clusters.push({
          id: `cluster-${clusters.length}`,
          primary,
          tools: clusterTools,
          avgSimilarity: count > 0 ? totalSimilarity / count : 0,
        });
      }
    }

    return clusters;
  }

  /**
   * Select the primary tool from a cluster
   * Prefers tools with:
   * - Shorter, more generic names
   * - From more well-known servers
   * - Better descriptions
   */
  private selectPrimaryTool(tools: ToolDocument[]): ToolDocument {
    // Simple heuristic: prefer tools from well-known servers
    const knownServers = ['github', 'jira', 'slack', 'notion', 'linear', 'sentry'];
    
    const scored = tools.map((tool) => {
      let score = 0;
      
      // Prefer known servers
      if (knownServers.includes(tool.serverId)) {
        score += 10;
      }
      
      // Prefer shorter names (more generic)
      score -= tool.name.length * 0.1;
      
      // Prefer longer descriptions (more informative)
      score += tool.description.length * 0.01;
      
      return { tool, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].tool;
  }

  /**
   * Get embedding vectors for tools
   */
  private async getToolVectors(tools: ToolDocument[]): Promise<number[][]> {
    // This is a simplified version - in production, you'd cache these
    const texts = tools.map((t) => `${t.name}: ${t.description}`);
    // Use the embedding engine's internal embed method
    // For now, return empty vectors as placeholder
    return tools.map(() => []);
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    
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
}
