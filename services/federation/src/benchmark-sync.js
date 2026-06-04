import { PeerClient } from './peer-client.js';
import { logger } from '@dmr-x/utils';
export class BenchmarkSync {
    client;
    constructor() {
        this.client = new PeerClient();
    }
    async sync(url, privacyLevel) {
        try {
            const result = await this.client.benchmarks(url);
            if (!result.ok)
                return false;
            const data = result.data;
            const sanitized = this.sanitize(data, privacyLevel);
            logger.info({
                score: sanitized.globalScore,
                privacy: privacyLevel,
            }, `Benchmark sync completed with ${url}`);
            return true;
        }
        catch (err) {
            logger.warn({ error: String(err) }, `Benchmark sync failed with ${url}`);
            return false;
        }
    }
    sanitize(data, privacyLevel) {
        if (privacyLevel === 'full')
            return data;
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
//# sourceMappingURL=benchmark-sync.js.map