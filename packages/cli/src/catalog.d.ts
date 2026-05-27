/**
 * DMR-X Provider Catalog
 *
 * Complete list of supported AI providers with metadata.
 * This is the single source of truth for available providers.
 */
export type ProviderCategory = 'llm' | 'image' | 'audio_tts' | 'audio_stt' | 'video' | 'music' | 'embedding' | 'reranking' | 'moderation' | 'local' | 'multi';
export interface ProviderEntry {
    id: string;
    name: string;
    description: string;
    category: ProviderCategory[];
    baseUrl: string;
    envKey: string;
    models: string[];
    freeModels: string[];
    website: string;
    docsUrl: string;
    pricingUrl: string;
}
export declare const PROVIDER_CATALOG: ProviderEntry[];
/**
 * Get a provider by ID
 */
export declare function getProvider(id: string): ProviderEntry | undefined;
/**
 * Get all provider IDs
 */
export declare function getAllProviderIds(): string[];
/**
 * Get providers by category
 */
export declare function getProvidersByCategory(category: ProviderCategory): ProviderEntry[];
/**
 * Search providers by name or description
 */
export declare function searchProviders(query: string): ProviderEntry[];
//# sourceMappingURL=catalog.d.ts.map