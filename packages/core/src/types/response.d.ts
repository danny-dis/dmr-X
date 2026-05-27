import { Modality } from './modality.js';
import { Message } from './request.js';
export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}
export interface GeneratedImage {
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
}
export interface GeneratedVideo {
    url?: string;
    b64_json?: string;
    duration?: number;
    fps?: number;
}
export interface GeneratedAudio {
    url?: string;
    b64_json?: string;
    duration?: number;
    format?: string;
}
export interface RerankResult {
    index: number;
    relevance_score: number;
    document?: string;
}
export interface ModerationResult {
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
}
export interface QualitySignal {
    type: string;
    score: number;
    details?: Record<string, unknown>;
}
export interface UnifiedResponse {
    modality: Modality;
    requestId: string;
    providerId: string;
    modelId: string;
    message?: Message;
    usage?: TokenUsage;
    finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
    images?: GeneratedImage[];
    videos?: GeneratedVideo[];
    audio?: GeneratedAudio;
    embeddings?: number[][];
    rerankResults?: RerankResult[];
    moderationResults?: ModerationResult[];
    completion?: string;
    latencyMs: number;
    timeToFirstTokenMs?: number;
    qualitySignals?: QualitySignal[];
}
//# sourceMappingURL=response.d.ts.map