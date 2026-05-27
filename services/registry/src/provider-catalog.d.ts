/**
 * Comprehensive AI Provider Catalog
 *
 * 35+ providers with API details, modalities, and adapter configurations.
 * Users can add any of these via: dmrx add-provider <provider-id>
 */
export interface ProviderTemplate {
    id: string;
    name: string;
    category: 'cloud_llm' | 'cloud_diffusion' | 'cloud_audio' | 'cloud_video' | 'cloud_embedding' | 'local' | 'hosting' | 'specialized';
    baseUrl: string;
    authMethod: 'bearer' | 'x-api-key' | 'api-key-param' | 'xi-api-key' | 'custom';
    authHeader?: string;
    authParam?: string;
    apiFormat: 'openai' | 'anthropic' | 'google' | 'custom';
    modalities: string[];
    models: ModelTemplate[];
    streaming: boolean;
    toolCalling: boolean;
    envKey: string;
    description: string;
}
export interface FreeTierInfo {
    rateLimits: {
        rpm?: number;
        rpd?: number;
        tpm?: number;
        tpd?: number;
    };
    monthlyTokenBudget?: number;
    intelligenceRank?: number;
    speedRank?: number;
}
export interface ModelTemplate {
    id: string;
    modalities: string[];
    contextWindow?: number;
    maxOutputTokens?: number;
    inputCostPer1M?: number;
    outputCostPer1M?: number;
    costPerImage?: number;
    capabilities: string[];
    specializations: string[];
    freeTier?: FreeTierInfo;
}
/**
 * Full provider catalog
 */
export declare const PROVIDER_CATALOG: ProviderTemplate[];
/**
 * Get provider template by ID
 */
export declare function getProviderTemplate(id: string): ProviderTemplate | undefined;
/**
 * Get all providers in a category
 */
export declare function getProvidersByCategory(category: ProviderTemplate['category']): ProviderTemplate[];
/**
 * Get providers that support a specific modality
 */
export declare function getProvidersByModality(modality: string): ProviderTemplate[];
/**
 * Search providers by name or description
 */
export declare function searchProviders(query: string): ProviderTemplate[];
//# sourceMappingURL=provider-catalog.d.ts.map