/**
 * Capability Ontology — Issue #15 P0 Routing.
 *
 * 9-dimension taxonomy for model capabilities. Replaces the legacy
 * IntelligenceLayer enum with a composable capability description.
 */

export type CapabilityDimension =
  | 'modality'
  | 'reasoning'
  | 'coding'
  | 'multimodal'
  | 'streaming'
  | 'tool_use'
  | 'function_calling'
  | 'context_length'
  | 'throughput';

export type CapabilityLevel = 0 | 1 | 2 | 3 | 4;

export interface ModelCapabilityProfile {
  modelId: string;
  providerId: string;
  /** Per-dimension level (0 = not supported, 4 = best-in-class). */
  dimensions: Partial<Record<CapabilityDimension, CapabilityLevel>>;
  /** Maximum supported context window tokens. */
  contextWindow: number;
  /** Input modalities supported. */
  inputModalities: Array<'text' | 'image' | 'audio' | 'video'>;
  /** Output modalities supported. */
  outputModalities: Array<'text' | 'image' | 'audio' | 'video'>;
  /** Streaming support. */
  supportsStreaming: boolean;
  /** Tool/function calling support. */
  supportsTools: boolean;
}

export function supportsDimension(
  profile: ModelCapabilityProfile,
  dimension: CapabilityDimension,
  minLevel: CapabilityLevel = 1,
): boolean {
  return (profile.dimensions[dimension] ?? 0) >= minLevel;
}

export function satisfiesRequirement(
  profile: ModelCapabilityProfile,
  required: Partial<Record<CapabilityDimension, CapabilityLevel>>,
): boolean {
  for (const [dim, level] of Object.entries(required)) {
    if ((profile.dimensions[dim as CapabilityDimension] ?? 0) < level) {
      return false;
    }
  }
  return true;
}
