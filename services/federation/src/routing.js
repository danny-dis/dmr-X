import { federationService } from './federation.service.js';
import { PeerClient } from './peer-client.js';
import { logger } from '@dmr-x/utils';
export class FederationRouter {
    client;
    constructor() {
        this.client = new PeerClient();
    }
    async routeRequest(body) {
        const best = federationService.getBestPeer();
        if (!best)
            return null;
        const result = await this.client.chat(best.url, body);
        if (!result.ok) {
            logger.warn({ peer: best.name, status: result.status }, 'Federation route failed');
            return null;
        }
        return { peer: best, response: result.data };
    }
    getAvailableModels() {
        const nodes = federationService.list().filter(n => n.status === 'online');
        return nodes.map(n => ({ peer: n, models: [] }));
    }
}
export const federationRouter = new FederationRouter();
//# sourceMappingURL=routing.js.map