import type { UnifiedRequest, TaskProfile, CapabilityTier } from '@dmr-x/core';
import { detectModality } from './modality-detector.js';
import { extractCapabilities } from './capability-extractor.js';

export interface ClassifyOptions {
  path: string;
  qualityTarget?: 'frontier' | 'balanced' | 'economy';
  priority?: number;
  /** When true, return only the routing plan without executing the request */
  planOnly?: boolean;
  /** Request-scoped ID for tracing through the pipeline */
  requestId?: string;
  /** Explicit capability tier override (bypasses auto-inference) */
  requiredCapabilityTier?: CapabilityTier;
}

/**
 * Infer the required capability tier from the quality target.
 * This provides automatic tier preference based on the request's quality requirements.
 */
function inferCapabilityTier(qualityTarget: 'frontier' | 'balanced' | 'economy'): CapabilityTier {
  switch (qualityTarget) {
    case 'frontier':
      // Frontier tasks want the best — brain or thinker tier
      return 'brain';
    case 'balanced':
      // Balanced tasks are fine with executor or specialist
      return 'executor';
    case 'economy':
      // Economy tasks want cheap/fast — worker tier
      return 'worker';
    default:
      return 'executor';
  }
}

export function classifyTask(request: UnifiedRequest, options: ClassifyOptions): TaskProfile {
  const modality = detectModality(options.path);
  const capabilities = extractCapabilities(request);

  const sizeEstimate = estimateSize(request, modality);
  const qualityTarget = options.qualityTarget ?? 'balanced';

  // Use explicit override if provided, otherwise infer from quality target
  const requiredCapabilityTier = options.requiredCapabilityTier ?? inferCapabilityTier(qualityTarget);

  return {
    modality,
    capabilities,
    sizeEstimate,
    priority: options.priority ?? 5,
    streaming: request.stream,
    qualityTarget,
    requiredCapabilityTier,
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
