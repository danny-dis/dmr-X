import { Modality, IntelligenceLayer, QualityTarget } from './modality.js';
export type FreeTierStrategy = 'prioritize' | 'load_balance' | 'fallback' | 'none';
export interface TaskProfile {
    modality: Modality;
    capabilities: string[];
    sizeEstimate: {
        inputTokens?: number;
        outputTokensEst?: number;
        pixelCount?: number;
    };
    priority: number;
    streaming: boolean;
    qualityTarget: QualityTarget;
}
export interface ProviderModel {
    providerId: string;
    providerName: string;
    modelId: string;
    modality: Modality;
    intelligenceLayer: IntelligenceLayer;
    capabilities: string[];
    costPerInputToken: number;
    costPerOutputToken: number;
    costPerImage: number;
    avgLatencyMs: number;
    qualityScore: number;
    isHealthy: boolean;
    compositeScore?: number;
}
export type CandidateSet = ProviderModel[];
export interface SelectedProvider {
    providerId: string;
    modelId: string;
    adapterType: string;
    score: number;
}
export type FallbackTrigger = 'timeout' | 'error' | 'rate_limit' | 'quality_reject';
export interface FallbackStep {
    provider: SelectedProvider;
    trigger: FallbackTrigger;
    waitMs: number;
}
export interface RoutingPlan {
    primary: SelectedProvider;
    chain: FallbackStep[];
    timeoutMs: number;
    maxRetries: number;
}
//# sourceMappingURL=routing.d.ts.map