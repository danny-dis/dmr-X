export type Modality = 'llm' | 'diffusion' | 'embedding' | 'audio_tts' | 'audio_stt' | 'video' | 'music' | 'reranking' | 'moderation' | 'code_completion' | 'image_upscaling' | 'image_inpainting';
export type IntelligenceLayer = 'brain' | 'thinker' | 'executor' | 'worker' | 'temp_worker';
export type QualityTarget = 'frontier' | 'balanced' | 'economy';
export declare const MODALITY_ENDPOINTS: Record<string, Modality>;
export declare const DEFAULT_FALLBACK_CHAINS: Record<Modality, string[]>;
export declare const MODALITY_TIMEOUTS: Record<Modality, number>;
//# sourceMappingURL=modality.d.ts.map