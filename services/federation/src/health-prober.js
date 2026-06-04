import { PeerClient } from './peer-client.js';
export class HealthProber {
    client;
    constructor() {
        this.client = new PeerClient();
    }
    async check(url) {
        const result = await this.client.health(url);
        if (!result.ok) {
            return {
                status: 'offline',
                latencyMs: result.latencyMs,
                version: null,
            };
        }
        const data = result.data;
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
    async checkCapability(url, capability) {
        const result = await this.client.models(url);
        if (!result.ok)
            return false;
        const data = result.data;
        const models = data?.data || [];
        return models.some((m) => m.id?.includes(capability));
    }
}
//# sourceMappingURL=health-prober.js.map