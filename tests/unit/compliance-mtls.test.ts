import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { registerSiemForwarding } from '../../apps/gateway/src/middleware/siem-forward.middleware.js';

describe('compliance: SIEM forwarding (option 5 runtime)', () => {
  it('is a no-op when DMRX_SIEM_URL is unset and never throws', async () => {
    delete process.env.DMRX_SIEM_URL;
    const app = Fastify();
    app.get('/ping', async () => ({ ok: true }));
    expect(() => registerSiemForwarding(app)).not.toThrow();
    await app.ready();
    // A request must still complete normally with forwarding disabled.
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
