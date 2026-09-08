import { describe, it, expect } from 'vitest';
import { ObservabilityService } from '../../services/router/src/observability/observability-service.js';

describe('ObservabilityService', () => {
  it('tracks free pool health', () => {
    const obs = new ObservabilityService();
    obs.recordProviderHealth('google', 'healthy');
    obs.recordProviderHealth('openrouter', 'degraded');
    const health = obs.getFreePoolHealth();
    expect(health.providers).toHaveLength(2);
    expect(health.providers.find(p => p.providerId === 'google')?.status).toBe('healthy');
  });

  it('records routing traces', () => {
    const obs = new ObservabilityService();
    obs.recordTrace({
      requestId: 'req1',
      selectedProvider: 'google',
      selectedModel: 'gemini-1.5-flash',
      rejectedCandidates: [{ providerId: 'p2', reason: 'rate-limited' }],
    });
    const trace = obs.getTrace('req1');
    expect(trace).toBeDefined();
    expect(trace!.selectedProvider).toBe('google');
  });
});