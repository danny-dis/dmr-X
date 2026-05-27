import { Modality, QualityTarget } from './modality.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } };

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
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

  // Music
  genre?: string;
  duration_seconds?: number;
  instruments?: string[];

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

  // Common
  stream: boolean;
  user?: string;
  metadata: Record<string, unknown>;
}
