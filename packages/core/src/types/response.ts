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

  // LLM
  message?: Message;
  usage?: TokenUsage;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;

  // Diffusion / Image
  images?: GeneratedImage[];

  // Video
  videos?: GeneratedVideo[];

  // Audio
  audio?: GeneratedAudio;

  // Embedding
  embeddings?: number[][];

  // Reranking
  rerankResults?: RerankResult[];

  // Moderation
  moderationResults?: ModerationResult[];

  // Code completion
  completion?: string;

  // Timing
  latencyMs: number;
  timeToFirstTokenMs?: number;

  // Quality
  qualitySignals?: QualitySignal[];
}
