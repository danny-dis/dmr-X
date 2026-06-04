import { logger } from '@dmr-x/utils';
export class PeerClient {
    defaultTimeoutMs = 10_000;
    async request(url, req) {
        const start = Date.now();
        const timeout = req.timeoutMs || this.defaultTimeoutMs;
        try {
            const response = await fetch(`${url}${req.path}`, {
                method: req.method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Federation-Source': 'dmr-x',
                    ...req.headers,
                },
                body: req.body ? JSON.stringify(req.body) : undefined,
                signal: AbortSignal.timeout(timeout),
            });
            const data = await response.json().catch(() => null);
            const latencyMs = Date.now() - start;
            return {
                ok: response.ok,
                status: response.status,
                data,
                latencyMs,
            };
        }
        catch (err) {
            const latencyMs = Date.now() - start;
            logger.warn({ err, method: req.method, url }, 'Peer request failed');
            return {
                ok: false,
                status: 0,
                data: null,
                latencyMs,
            };
        }
    }
    async health(url) {
        return this.request(url, { method: 'GET', path: '/health', timeoutMs: 5000 });
    }
    async models(url) {
        return this.request(url, { method: 'GET', path: '/v1/models' });
    }
    async chat(url, body) {
        return this.request(url, { method: 'POST', path: '/v1/chat/completions', body });
    }
    async benchmarks(url) {
        return this.request(url, { method: 'GET', path: '/admin/benchmarks' });
    }
}
//# sourceMappingURL=peer-client.js.map