import { logger } from '@dmr-x/utils';

import { PeerClient } from './peer-client.js';

export interface BenchmarkData {
  globalScore: number;
  localScore: number;
  variance: number;
  modelScores: Record<string, number>;
}

export class BenchmarkSync {
  private client: PeerClient;

  constructor() {
    this.client = new PeerClient();
  }

  async sync(url: string, privacyLevel: string): Promise<boolean> {
    try {
      const result = await this.client.benchmarks(url);
      if (!result.ok) return false;

      const data = result.data as BenchmarkData;
      const sanitized = this.sanitize(data, privacyLevel);

      logger.info(
        {
          score: sanitized.globalScore,
          privacy: privacyLevel,
        },
        `Benchmark sync completed with ${url}`
      );

      return true;
    } catch (err) {
      logger.warn({ error: String(err) }, `Benchmark sync failed with ${url}`);
      return false;
    }
  }

  private sanitize(data: BenchmarkData, privacyLevel: string): BenchmarkData {
    if (privacyLevel === 'full') return data;

    if (privacyLevel === 'aggregated') {
      return {
        globalScore: Math.round(data.globalScore * 10) / 10,
        localScore: Math.round(data.localScore * 10) / 10,
        variance: Math.round(data.variance * 10) / 10,
        modelScores: {},
      };
    }

    return {
      globalScore: Math.round(data.globalScore),
      localScore: Math.round(data.localScore),
      variance: Math.round(data.variance),
      modelScores: {},
    };
  }
}
