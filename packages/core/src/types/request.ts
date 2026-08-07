import { Modality } from './modality.js';
import type { ProviderPreferences } from './provider-preferences.js';

/**
 * Prompt-cache breakpoint marker, modelled on Anthropic's `cache_control`.
 *
 * Caching is a *prefix* match: the provider hashes the rendered prompt up to
 * each breakpoint. Any byte change before a breakpoint invalidates it and
 * everything after it. Render order is tools -> system -> messages, so a
 * breakpoint on the last system block covers tools and system together.
 */
export interface CacheControl {
  type: 'ephemeral';
  /** Defaults to 5m. 1h costs 2x to write instead of 1.25x. */
  ttl?: '5m' | '1h';
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** Breakpoint applied to this message's final content block. */
  cache_control?: CacheControl;
}

export type ContentPart =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | {
      type: 'image_url';
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
      cache_control?: CacheControl;
    }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } };

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
  /** Breakpoint applied after this tool definition. */
  cache_control?: CacheControl;
}

/**
 * Gateway-level prompt-cache policy.
 *
 * - `auto` (default): inject breakpoints when the prefix is large enough to
 *   cache. Gives caching to OpenAI-format callers, who have no wire syntax
 *   for expressing it.
 * - `explicit`: honor only caller-supplied `cache_control`, inject nothing.
 * - `off`: strip every breakpoint before dispatch.
 */
export interface CachePolicy {
  mode?: 'auto' | 'explicit' | 'off';
  ttl?: '5m' | '1h';
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface UnifiedRequest {
  modality: Modality;
  model?: string;

  // LLM
  messages?: Message[];
  tools?: Tool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  response_format?: { type: 'text' | 'json_object' };
  seed?: number | null;
  n?: number;

  // Diffusion / Image
  prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  diffusion_seed?: number;
  style?: string;
  cfg_scale?: number;
  image?: string; // base64 or URL for img2img/inpainting
  mask?: string;  // base64 or URL for inpainting

  // Embedding
  input?: string | string[];
  dimensions?: number;
  encoding_format?: 'float' | 'base64';

  // Audio TTS
  voice?: string;
  speed?: number;
  format?: string;
  language?: string;

  // Audio STT
  audio?: string; // base64 or URL
  audio_format?: 'wav' | 'mp3' | 'm4a' | 'webm';

  // Video
  duration?: number;
  fps?: number;
  aspect_ratio?: string;
  resolution?: '480p' | '720p' | '1080p' | '4k';
  generate_audio?: boolean;
  camera_fixed?: boolean;
  camera_control?: {
    type: 'pan' | 'tilt' | 'zoom' | 'dolly' | 'crane' | 'tracking' | 'orbital';
    direction?: string;
    speed?: 'slow' | 'medium' | 'fast';
  };

  // Video multimodal references (Seedance 2.0, Kling 3.0, Wan 2.7, Veo 3.1)
  reference_images?: string[]; // up to 9 image URLs or base64
  reference_video?: string;    // video URL or base64 for style/motion reference
  reference_audio?: string[];  // up to 3 audio URLs or base64
  last_frame_image?: string;   // end-frame control

  // Video editing (Sora 2, Runway Aleph, Wan 2.7)
  edit_video?: string;         // video URL to edit
  edit_instruction?: string;   // text instruction for editing

  // Video extension (Veo 3.1, Sora 2, Luma)
  extend_video?: string;       // video URL to extend

  // Music
  genre?: string;
  duration_seconds?: number;
  instruments?: string[];

  // 3D Generation
  texture_resolution?: number;

  // Reranking
  query?: string;
  documents?: string[];
  top_n?: number;

  // Moderation
  content?: string;

  // Code completion
  prefix?: string;
  suffix?: string;
  language_code?: string;

  // Audio Separation
  stem_count?: 2 | 4 | 5 | 6; // Number of stems to separate
  separate_vocals?: boolean; // For 2-stem separation
  separate_drums?: boolean;
  separate_bass?: boolean;
  separate_other?: boolean;
  separate_guitar?: boolean;
  separate_piano?: boolean;

  // OCR
  ocr_image?: string; // base64 or URL for OCR
  ocr_language?: string; // Language code (e.g., 'en', 'ch', 'es')
  ocr_detect_direction?: boolean; // Detect text direction
  ocr_paragraph?: boolean; // Output paragraph info
  ocr_lines?: boolean; // Output line info
  ocr_words?: boolean; // Output word info

  // Common
  stream: boolean;
  user?: string;
  /** Prompt-cache policy. Defaults to `{ mode: 'auto' }`. */
  cache?: CachePolicy;
  metadata: Record<string, unknown> & {
    providerPreferences?: ProviderPreferences;
  };
}
