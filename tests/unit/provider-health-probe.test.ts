import { describe, expect, it } from 'vitest';
import { probeAdapterHealth } from '../../apps/gateway/src/utils/provider-health-probe.js';

describe('provider health probe', () => {
  it('does not condemn a provider when an ambiguous adapter probe fails', async () => {
    await expect(probeAdapterHealth({ healthCheck: async () => ({ healthy: false }) }, 8))
      .rejects.toThrow('inconclusive');
  });

  it('does not condemn an eight-key provider after one credential fails generation', async () => {
    await expect(probeAdapterHealth({
      healthCheck: async () => ({ healthy: false }),
      checkGenerationCapability: async () => false,
    }, 8)).rejects.toThrow('inconclusive');
  });

  it('treats a definitive single-key generation failure as unhealthy', async () => {
    await expect(probeAdapterHealth({
      healthCheck: async () => ({ healthy: true }),
      checkGenerationCapability: async () => false,
    }, 1)).resolves.toBe(false);
  });

  it('accepts a successful adapter probe', async () => {
    await expect(probeAdapterHealth({ healthCheck: async () => ({ healthy: true }) }, 8))
      .resolves.toBe(true);
  });
});
