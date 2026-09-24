export interface HealthProbeAdapter {
  healthCheck(): Promise<{ healthy: boolean }>;
  checkGenerationCapability?(): Promise<boolean>;
}

export async function probeAdapterHealth(adapter: HealthProbeAdapter, activeKeyCount: number): Promise<boolean> {
  if (typeof adapter.checkGenerationCapability === 'function') {
    const capable = await adapter.checkGenerationCapability();
    if (capable) return true;
    if (activeKeyCount <= 1) return false;
  } else if ((await adapter.healthCheck()).healthy) {
    return true;
  }
  throw new Error('Provider health probe inconclusive');
}
