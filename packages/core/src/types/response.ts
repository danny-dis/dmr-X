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
  resolution?: string;
  audio_url?: string;       // native audio track (Seedance, Veo, Kling)
  has_audio?: boolean;
}

export interface GeneratedAudio {
  url?: string;
  b64_json?: string;
  duration?: number;
  format?: string;
}

export interface Generated3D {
  url?: string;
  b64_json?: string;
  format?: string;
}

export interface GeneratedFile {
  filename: string;
  mimeType: string;
  url?: string;
  b64_json?: string;
  size?: number;
}

export interface AudioStem {
  name: string;
  url?: string;
  b64_json?: string;
  mimeType?: string;
}

export interface OcrText {
  text: string;
  confidence?: number;
  boundingBox?: [number, number, number, number];
  page?: number;
}

export interface OcrResult {
  text: string;
  ocrTexts?: OcrText[];
  fullTextAnnotation?: string;
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

/**
 * Async video generation job status.
 * Video models (Sora 2, Veo 3.1, Kling, etc.) are inherently async.
 */
export interface VideoJobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;         // 0-100
  result?: GeneratedVideo[];
  error?: string;
  pollingUrl?: string;
  createdAt?: string;
  completedAt?: string;
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

  // 3D
  models3d?: Generated3D[];

  // Embedding
  embeddings?: number[][];

  // Reranking
  rerankResults?: RerankResult[];

  // Moderation
  moderationResults?: ModerationResult[];

  // Code completion
  completion?: string;

  // Audio Separation
  stems?: AudioStem[];
  stemArchive?: GeneratedFile; // ZIP file containing all stems

  // OCR
  ocr?: OcrResult;
  files?: GeneratedFile[]; // For multi-page OCR or generated files

  // Timing
  latencyMs: number;
  timeToFirstTokenMs?: number;

  // Quality
  qualitySignals?: QualitySignal[];

  /**
   * Set only when the request was NOT served by the first provider/model the
   * router picked. Absent on the happy path.
   *
   * DMR-X's whole value is that it silently survives a provider failing — but
   * silently is the problem: a caller who asked for model X, got model Y, and
   * was never told cannot explain the latency spike, the different answer
   * shape, or the changed cost. This is the signal that a switch happened,
   * what it switched away from, and why.
   */
  fallback?: FallbackInfo;
}

/**
 * Describes a provider/model switch that occurred while serving a request.
 */
export interface FallbackInfo {
  /** Provider actually used, when it differs from the router's first choice. */
  fromProviderId: string;
  fromModelId: string;
  /** How many providers were attempted in total, including the successful one. */
  attempts: number;
  /**
   * Why the original choice was abandoned — the classified category of the
   * primary's failure (`rate_limit`, `model_not_found`, `auth_error`, …).
   */
  reason: string;
  /** Per-provider failure detail, oldest first. */
  errors: Array<{ provider: string; status?: number; message: string }>;
}
