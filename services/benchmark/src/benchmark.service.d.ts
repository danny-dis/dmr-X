import type { AdapterRegistry } from '@dmr-x/adapters';
import type { UnifiedRequest } from '@dmr-x/core';
export interface BenchmarkPrompt {
    id: string;
    category: string;
    modality: string;
    request: UnifiedRequest;
    expectedQuality?: number;
}
export interface BenchmarkResult {
    modelId: string;
    providerId: string;
    benchmarkType: string;
    score: number;
    latencyMs: number;
    details: Record<string, unknown>;
}
export declare class BenchmarkService {
    private adapterRegistry;
    private interval;
    constructor(adapterRegistry: AdapterRegistry);
    runBenchmarks(): Promise<BenchmarkResult[]>;
    private runBenchmarkForModality;
    private evaluateResponse;
    private storeResults;
    startScheduled(intervalMs?: number): void;
    stop(): void;
}
//# sourceMappingURL=benchmark.service.d.ts.map