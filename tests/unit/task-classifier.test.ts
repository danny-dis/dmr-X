import { describe, it, expect } from 'vitest';
import { classifyTask } from '../../services/router/src/classifier/task-classifier.js';
import type { UnifiedRequest } from '../../packages/core/src/types/index.js';

function makeRequest(overrides: Partial<UnifiedRequest> = {}): UnifiedRequest {
  return {
    modality: 'llm',
    stream: false,
    metadata: {},
    ...overrides,
  };
}

describe('taskClassifier', () => {
  it('should classify LLM request from chat completions path', () => {
    const request = makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const result = classifyTask(request, { path: '/v1/chat/completions' });
    expect(result.modality).toBe('llm');
    expect(result.streaming).toBe(false);
  });

  it('should detect vision capability', () => {
    const request = makeRequest({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
          ],
        },
      ],
    });

    const result = classifyTask(request, { path: '/v1/chat/completions' });
    expect(result.capabilities).toContain('vision');
  });

  it('should detect tool_use capability', () => {
    const request = makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ type: 'function', function: { name: 'test' } }],
    });

    const result = classifyTask(request, { path: '/v1/chat/completions' });
    expect(result.capabilities).toContain('tool_use');
  });

  it('should detect json_mode capability', () => {
    const request = makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
      response_format: { type: 'json_object' },
    });

    const result = classifyTask(request, { path: '/v1/chat/completions' });
    expect(result.capabilities).toContain('json_mode');
  });

  it('should classify diffusion request', () => {
    const request = makeRequest({
      modality: 'diffusion',
      prompt: 'A sunset',
      width: 1024,
      height: 1024,
    });

    const result = classifyTask(request, { path: '/v1/images/generations' });
    expect(result.modality).toBe('diffusion');
    expect(result.sizeEstimate.pixelCount).toBe(1024 * 1024);
  });

  it('should classify embedding request', () => {
    const request = makeRequest({
      modality: 'embedding',
      input: 'Hello world',
    });

    const result = classifyTask(request, { path: '/v1/embeddings' });
    expect(result.modality).toBe('embedding');
  });

  it('should estimate token count for LLM', () => {
    const request = makeRequest({
      messages: [{ role: 'user', content: 'Hello world, this is a test message' }],
      max_tokens: 500,
    });

    const result = classifyTask(request, { path: '/v1/chat/completions' });
    expect(result.sizeEstimate.inputTokens).toBeGreaterThan(0);
    expect(result.sizeEstimate.outputTokensEst).toBe(500);
  });

  it('should use provided quality target', () => {
    const request = makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const result = classifyTask(request, { path: '/v1/chat/completions', qualityTarget: 'frontier' });
    expect(result.qualityTarget).toBe('frontier');
  });

  it('should default to balanced quality target', () => {
    const request = makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const result = classifyTask(request, { path: '/v1/chat/completions' });
    expect(result.qualityTarget).toBe('balanced');
  });

  it('should throw on unknown path', () => {
    const request = makeRequest();
    expect(() => classifyTask(request, { path: '/v1/unknown' })).toThrow('Unknown API path');
  });
});
