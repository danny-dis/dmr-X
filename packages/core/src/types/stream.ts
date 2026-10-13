import type { ToolCall } from './request.js';

export interface StreamChunk {
  type: "token" | "image_partial" | "video_partial" | "audio_chunk" | "audio_partial" | "done" | "error";
  data: unknown;
  index: number;
}

export interface TokenStreamChunk extends StreamChunk {
  type: "token";
  data: {
    content?: string;
    tool_calls?: {
      index: number;
      id?: string;
      type?: "function";
      function?: { name?: string; arguments?: string };
      extra_content?: ToolCall['extra_content'];
    }[];
    role?: string;
  };
}

export interface DoneStreamChunk extends StreamChunk {
  type: "done";
  data: {
    requestId: string;
    modelId: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    finishReason?: string;
  };
}

export interface ErrorStreamChunk extends StreamChunk {
  type: "error";
  data: {
    code: string;
    message: string;
  };
}
