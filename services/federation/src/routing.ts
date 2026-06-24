import { logger } from '@dmr-x/utils';

import { federationService, type FederationNode } from './federation.service.js';
import { PeerClient } from './peer-client.js';

export class FederationRouter {
  private client: PeerClient;

  constructor() {
    this.client = new PeerClient();
  }

  async routeRequest(body: unknown): Promise<{ peer: FederationNode; response: unknown } | null> {
    const best = federationService.getBestPeer();
    if (!best) return null;

    const result = await this.client.chat(best.url, body);
    if (!result.ok) {
      logger.warn({ peer: best.name, status: result.status }, 'Federation route failed');
      return null;
    }

    return { peer: best, response: result.data };
  }

  getAvailableModels(): Array<{ peer: FederationNode; models: unknown[] }> {
    const nodes = federationService.list().filter(n => n.status === 'online');
    return nodes.map(n => ({ peer: n, models: [] }));
  }
}

export const federationRouter = new FederationRouter();
