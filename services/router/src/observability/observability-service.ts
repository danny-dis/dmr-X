// services/router/src/observability/observability-service.ts
export type ProviderStatus = 'healthy' | 'degraded' | 'down';

export interface ProviderHealth {
  providerId: string;
  status: ProviderStatus;
  lastUpdated: number;
}

export interface RoutingTrace {
  requestId: string;
  selectedProvider: string;
  selectedModel: string;
  rejectedCandidates: Array<{ providerId: string; reason: string }>;
  timestamp: number;
}

export interface FreePoolHealth {
  providers: ProviderHealth[];
  totalProviders: number;
  healthyProviders: number;
  degradedProviders: number;
  downProviders: number;
}

export class ObservabilityService {
  private health = new Map<string, ProviderHealth>();
  private traces = new Map<string, RoutingTrace>();

  recordProviderHealth(providerId: string, status: ProviderStatus): void {
    this.health.set(providerId, {
      providerId,
      status,
      lastUpdated: Date.now(),
    });
  }

  recordTrace(trace: Omit<RoutingTrace, 'timestamp'>): void {
    this.traces.set(trace.requestId, { ...trace, timestamp: Date.now() });
  }

  getFreePoolHealth(): FreePoolHealth {
    const providers = Array.from(this.health.values());
    return {
      providers,
      totalProviders: providers.length,
      healthyProviders: providers.filter(p => p.status === 'healthy').length,
      degradedProviders: providers.filter(p => p.status === 'degraded').length,
      downProviders: providers.filter(p => p.status === 'down').length,
    };
  }

  getTrace(requestId: string): RoutingTrace | undefined {
    return this.traces.get(requestId);
  }
}