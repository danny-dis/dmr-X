import type { UnifiedRequest, TaskProfile } from '@dmr-x/core';
import { detectModality } from './modality-detector.js';
import { extractCapabilities } from './capability-extractor.js';

export interface ClassifyOptions {
  path: string;
  qualityTarget?: 'frontier' | 'balanced' | 'economy';
  priority?: number;
  /** When true, return only the routing plan without executing the request */
  planOnly?: boolean;
}

export function classifyTask(request: UnifiedRequest, options: ClassifyOptions): TaskProfile {
  const modality = detectModality(options.path);
  const capabilities = extractCapabilities(request);

  const sizeEstimate = estimateSize(request, modality);

  return {
    modality,
    capabilities,
    sizeEstimate,
    priority: options.priority ?? 5,
    streaming: request.stream,
    qualityTarget: options.qualityTarget ?? 'balanced',
  };
}

function estimateSize(
  request: UnifiedRequest,
  modality: string
): { inputTokens?: number; outputTokensEst?: number; pixelCount?: number } {
  if (modality === 'llm' && request.messages) {
    // Rough token estimate: ~4 chars per token
    const inputChars = request.messages.reduce((sum, msg) => {
      if (typeof msg.content === 'string') return sum + msg.content.length;
      return sum + 100; // estimate for non-text content
    }, 0);
    return {
      inputTokens: Math.ceil(inputChars / 4),
      outputTokensEst: request.max_tokens ?? 1024,
    };
  }

  if (modality === 'diffusion') {
    return {
      pixelCount: (request.width ?? 1024) * (request.height ?? 1024),
    };
  }

  return {};
}
