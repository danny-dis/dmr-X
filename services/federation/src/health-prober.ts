import { logger } from '@dmr-x/utils';

import { PeerClient } from './peer-client.js';

export interface HealthCheckResult {
  status: string;
  latencyMs: number | null;
  version: string | null;
}

export class HealthProber {
  private client: PeerClient;

  constructor() {
    this.client = new PeerClient();
  }

  async check(url: string): Promise<HealthCheckResult> {
    const result = await this.client.health(url);

    if (!result.ok) {
      return {
        status: 'offline',
        latencyMs: result.latencyMs,
        version: null,
      };
    }

    const data = result.data as any;
    let status = 'online';
    if (result.latencyMs > 5000) {
      status = 'degraded';
    }

    return {
      status,
      latencyMs: result.latencyMs,
      version: data?.version || null,
    };
  }

  async checkCapability(url: string, capability: string): Promise<boolean> {
    const result = await this.client.models(url);
    if (!result.ok) return false;

    const data = result.data as any;
    const models = data?.data || [];
    return models.some((m: any) => m.id?.includes(capability));
  }
}
