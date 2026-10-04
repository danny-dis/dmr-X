import { describe, expect, it } from 'vitest';
import type { CandidateSet } from '../../packages/core/src/types/index.js';
import { resolveMetaModel } from '../../services/router/src/meta-models.js';

const candidate = (modelId: string, providerId = 'example'): CandidateSet[number] => ({
  providerId, providerName: providerId, modelId, modality: 'llm',
  intelligenceLayer: 'executor', capabilityTier: 'balanced', capabilities: [],
  costPerInputToken: 0, costPerOutputToken: 0, costPerImage: 0,
  avgLatencyMs: 1000, qualityScore: 0.8, contextLength: 128000,
  isHealthy: true, pricingTier: 'free',
});

const specialists = [
  'Qwen3Guard-Gen-0.6B',
  'nvidia/nemotron-3.5-content-safety',
  'nvidia/riva-translate-4b-instruct-v2',
  'nvidia/nemotron-parse-2.0',
];

describe('chat meta-model eligibility', () => {
  it.each(['auto', 'auto-coding', 'auto-reasoning', 'free', 'auto-free'])(
    '%s does not select specialist-only models for ordinary chat', (alias) => {
      const candidates = [candidate('gemini-2.5-flash', 'google'),
        ...specialists.map(id => candidate(id, 'nvidia-nim'))];
      const resolved = resolveMetaModel(alias, candidates, 'free');
      expect(resolved).not.toBeNull();
      expect(resolved!.resolved.map(item => item.modelId)).toEqual(['gemini-2.5-flash']);
    },
  );

  it('does not silently substitute moderation/translation output for chat', () => {
    expect(resolveMetaModel('auto', specialists.map(id => candidate(id)))).toBeNull();
  });
});
