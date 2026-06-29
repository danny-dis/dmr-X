import { logger } from '@dmr-x/utils';

/**
 * Cluster-based routing scorer.
 *
 * Uses an ONNX embedding model to encode the request prompt, then finds
 * the nearest model cluster centroid to select the best provider/model.
 *
 * This is the DMR-X equivalent of workweave/router's AvengersPro cluster scorer.
 *
 * Configuration:
 * - DMRX_CLUSTER_ROUTING_ENABLED=true   (default: false)
 * - DMRX_ONNX_ASSETS_DIR=/path/to/assets (required when enabled)
 * - DMRX_ONNX_MODEL=model.onnx           (default: model.onnx)
 * - DMRX_CLUSTER_EMBED_TIMEOUT_MS=200    (default: 200ms)
 *
 * When disabled or unavailable, falls back to Thompson Sampling.
 */

export interface ClusterDecision {
  providerId: string;
  modelId: string;
  score: number;
  clusterId: string;
  distance: number;
}

export interface ClusterScorerConfig {
  enabled: boolean;
  assetsDir: string;
  modelName: string;
  embedTimeoutMs: number;
}

export class ClusterScorer {
  private config: ClusterScorerConfig;
  private ready = false;
  private session: any = null; // ONNX InferenceSession
  private centroids: Map<string, number[]> = new Map();
  private modelRegistry: Map<string, { providerId: string; modelId: string; clusterId: string }> = new Map();

  constructor(config?: Partial<ClusterScorerConfig>) {
    this.config = {
      enabled: config?.enabled ?? process.env.DMRX_CLUSTER_ROUTING_ENABLED === 'true',
      assetsDir: config?.assetsDir ?? process.env.DMRX_ONNX_ASSETS_DIR ?? '',
      modelName: config?.modelName ?? process.env.DMRX_ONNX_MODEL ?? 'model.onnx',
      embedTimeoutMs: config?.embedTimeoutMs ?? parseInt(process.env.DMRX_CLUSTER_EMBED_TIMEOUT_MS || '200', 10),
    };
  }

  /**
   * Initialize the ONNX session and load cluster artifacts.
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Cluster routing disabled (DMRX_CLUSTER_ROUTING_ENABLED != true)');
      return;
    }

    if (!this.config.assetsDir) {
      logger.warn('Cluster routing enabled but DMRX_ONNX_ASSETS_DIR not set');
      return;
    }

    try {
      // Dynamically import ONNX runtime to avoid hard dependency
      // @ts-ignore - onnxruntime-node is an optional dependency
      const ort = await import('onnxruntime-node').catch(() => null);
      if (!ort) {
        logger.warn('onnxruntime-node not installed — cluster routing unavailable');
        return;
      }

      const modelPath = `${this.config.assetsDir}/${this.config.modelName}`;
      // @ts-ignore - ort.InferenceSession exists at runtime
      this.session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
      });

      // Load centroids from artifacts directory
      await this.loadArtifacts();

      this.ready = true;
      logger.info({ assetsDir: this.config.assetsDir, model: this.config.modelName }, 'Cluster scorer initialized');
    } catch (err) {
      logger.warn({ error: String(err) }, 'Failed to initialize cluster scorer — falling back to Thompson Sampling');
      this.ready = false;
    }
  }

  /**
   * Check if the cluster scorer is ready to use.
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Score candidates using cluster-based routing.
   * Returns candidates sorted by cluster distance (closest first).
   */
  async score(
    promptText: string,
    candidates: Array<{ providerId: string; modelId: string; [key: string]: unknown }>,
  ): Promise<ClusterDecision[]> {
    if (!this.ready || !this.session) {
      return candidates.map(c => ({
        providerId: c.providerId,
        modelId: c.modelId,
        score: 0.5,
        clusterId: 'unknown',
        distance: 1.0,
      }));
    }

    try {
      // Embed the prompt
      const embedding = await this.embed(promptText);

      // Find nearest centroid for each candidate
      const scored = candidates.map(candidate => {
        const clusterId = this.modelRegistry.get(`${candidate.providerId}/${candidate.modelId}`)?.clusterId ?? 'default';
        const centroid = this.centroids.get(clusterId);

        if (!centroid) {
          return {
            providerId: candidate.providerId,
            modelId: candidate.modelId,
            score: 0.5,
            clusterId,
            distance: 1.0,
          };
        }

        const distance = this.cosineDistance(embedding, centroid);
        const score = 1 - distance; // Convert distance to similarity score

        return {
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          score,
          clusterId,
          distance,
        };
      });

      // Sort by score descending (closest cluster first)
      return scored.sort((a, b) => b.score - a.score);
    } catch (err) {
      logger.warn({ error: String(err) }, 'Cluster scoring failed, returning uniform scores');
      return candidates.map(c => ({
        providerId: c.providerId,
        modelId: c.modelId,
        score: 0.5,
        clusterId: 'unknown',
        distance: 1.0,
      }));
    }
  }

  /**
   * Embed text using the ONNX model.
   */
  private async embed(text: string): Promise<number[]> {
    if (!this.session) throw new Error('ONNX session not initialized');

    // Tokenize (simplified — real implementation would use the model's tokenizer)
    const tokens = this.simpleTokenize(text);
    const input = new Float32Array(tokens);

    // Run inference with timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Embed timeout')), this.config.embedTimeoutMs)
    );

    const inferencePromise = (async () => {
      const feeds = { input_ids: input } as any;
      const results = await this.session.run(feeds);
      // Extract embedding from output (model-specific)
      const outputKey = Object.keys(results)[0];
      return Array.from(results[outputKey].data as Float32Array);
    })();

    return Promise.race([inferencePromise, timeoutPromise]);
  }

  /**
   * Load cluster artifacts (centroids and model registry).
   */
  private async loadArtifacts(): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // Load centroids
    const centroidsPath = path.join(this.config.assetsDir, 'centroids.json');
    try {
      const data = await fs.readFile(centroidsPath, 'utf-8');
      const parsed = JSON.parse(data);
      for (const [id, vector] of Object.entries(parsed)) {
        this.centroids.set(id, vector as number[]);
      }
      logger.debug({ count: this.centroids.size }, 'Loaded cluster centroids');
    } catch {
      logger.warn('No centroids.json found — cluster routing will use uniform scores');
    }

    // Load model registry
    const registryPath = path.join(this.config.assetsDir, 'model-registry.json');
    try {
      const data = await fs.readFile(registryPath, 'utf-8');
      const parsed = JSON.parse(data);
      for (const entry of parsed) {
        this.modelRegistry.set(`${entry.providerId}/${entry.modelId}`, entry);
      }
      logger.debug({ count: this.modelRegistry.size }, 'Loaded model registry');
    } catch {
      logger.warn('No model-registry.json found');
    }
  }

  private simpleTokenize(text: string): number[] {
    // Simplified tokenization — real implementation uses the model's tokenizer.json
    // This is a fallback for development/testing
    const tokens: number[] = [];
    const words = text.toLowerCase().split(/\s+/).slice(0, 512);
    for (const word of words) {
      // Simple hash-based token IDs
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
      }
      tokens.push(Math.abs(hash) % 30000);
    }
    // Pad to fixed length
    while (tokens.length < 128) tokens.push(0);
    return tokens;
  }

  private cosineDistance(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 1;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 1;
    return 1 - (dot / denom);
  }
}
