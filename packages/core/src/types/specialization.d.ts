/**
 * Model specialization tags
 *
 * Each model can have multiple specializations.
 * The router uses these to match sub-tasks to the best specialist model.
 */
export type Specialization = 'ui_design' | 'ui_component' | 'frontend_logic' | 'backend_api' | 'backend_logic' | 'authentication' | 'database_schema' | 'database_query' | 'data_modeling' | 'orm' | 'devops' | 'cloud' | 'monitoring' | 'testing' | 'refactoring' | 'debugging' | 'bulk_generation' | 'documentation' | 'translation' | 'code_review' | 'architecture' | 'orchestration' | 'reasoning' | 'creative' | 'vision' | 'audio' | 'video' | 'embedding' | 'general' | 'fast' | 'cheap';
/**
 * Specialization profile for a model
 */
export interface SpecializationProfile {
    modelId: string;
    providerId: string;
    strengths: Partial<Record<Specialization, number>>;
    recommendedFor: Specialization[];
    costTier: 'free' | 'cheap' | 'standard' | 'premium' | 'frontier';
    speedTier: 'instant' | 'fast' | 'standard' | 'slow' | 'batch';
}
/**
 * Pre-configured specialization profiles for known models
 */
export declare const KNOWN_MODEL_SPECIALIZATIONS: Record<string, Partial<SpecializationProfile>>;
/**
 * Get the cost multiplier for a cost tier
 */
export declare function getCostMultiplier(tier: SpecializationProfile['costTier']): number;
/**
 * Get the latency weight for a speed tier
 */
export declare function getLatencyWeight(tier: SpecializationProfile['speedTier']): number;
//# sourceMappingURL=specialization.d.ts.map