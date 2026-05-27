import { type ProviderTemplate } from './provider-catalog.js';
/**
 * Auto-register providers from environment variables
 *
 * Scans env for known API keys and auto-creates provider + model entries.
 */
export declare function autoRegisterProviders(): Promise<string[]>;
/**
 * Register a single provider from the catalog
 */
export declare function registerProvider(providerId: string, overrides?: Partial<ProviderTemplate>): Promise<string>;
/**
 * List all available providers from catalog
 */
export declare function listAvailableProviders(): ProviderTemplate[];
/**
 * Discover models from a Hugging Face task
 */
export declare function discoverHuggingFaceModels(task: string, limit?: number): Promise<{
    id: string;
    downloads: number;
    pipeline_tag: string;
}[]>;
//# sourceMappingURL=auto-register.d.ts.map