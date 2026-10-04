import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ProviderUnavailableError } from '../../packages/core/src/types/errors.js';
import { registerSecurity } from '../../apps/gateway/src/security-headers.js';

describe('provider exhaustion response', () => {
  it('exposes a bounded Retry-After on non-streaming 503 responses', async () => {
    const app = Fastify({ logger: false });
    try {
      registerSecurity(app);
      app.get('/test', async () => { throw new ProviderUnavailableError(['free/model'], 47); });
      const response = await app.inject('/test');
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('47');
      expect(response.json().error.message).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('does not tell clients to retry immediately when no reset time is known', async () => {
    const app = Fastify({ logger: false });
    try {
      registerSecurity(app);
      app.get('/test', async () => { throw new ProviderUnavailableError([], 0); });
      const response = await app.inject('/test');
      expect(response.headers['retry-after']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
