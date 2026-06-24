import { describe, it, expect } from 'vitest';

import {
  convertAnthropicRequestToUnified,
  convertUnifiedResponseToAnthropic,
} from '../../apps/gateway/src/converters/anthropic-converter.js';
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
} from '../../apps/gateway/src/converters/anthropic-converter.js';
import type { UnifiedResponse } from '../../packages/core/src/types/index.js';

function makeAnthropicRequest(
  overrides: Partial<AnthropicMessagesRequest> = {}
): AnthropicMessagesRequest {
  return {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

function makeUnifiedResponse(
  overrides: Partial<UnifiedResponse> = {}
): UnifiedResponse {
  return {
    modality: 'llm',
    requestId: 'msg_test123',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5-20250929',
    message: { role: 'assistant', content: 'Hi there!' },
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    finishReason: 'stop',
    latencyMs: 500,
    ...overrides,
  };
}

describe('convertAnthropicRequestToUnified', () => {
  it('should convert simple text message', () => {
    const req = makeAnthropicRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    const result = convertAnthropicRequestToUnified(req, {});

    expect(result.messages).toHaveLength(1);
    expect(result.messages![0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('should extract system prompt from string', () => {
    const req = makeAnthropicRequest({
      system: 'You are a helpful assistant',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const result = convertAnthropicRequestToUnified(req, {});

    expect(result.messages).toHaveLength(2);
    expect(result.messages![0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant',
    });
  });

  it('should extract system prompt from content block array', () => {
    const req = makeAnthropicRequest({
      system: [
        { type: 'text', text: 'You are ' },
        { type: 'text', text: 'helpful' },
      ],
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const result = convertAnthropicRequestToUnified(req, {});

    expect(result.messages![0]).toEqual({
      role: 'system',
      content: 'You are helpful',
    });
  });

  it('should convert tool_use blocks in assistant messages to tool_calls', () => {
    const req = makeAnthropicRequest({
      messages: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'get_weather',
              input: { city: 'NYC' },
            },
          ],
        },
      ],
    });
    const result = convertAnthropicRequestToUnified(req, {});

    expect(result.messages).toHaveLength(2);
    const assistantMsg = result.messages![1];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toBe('Let me check.');
    expect(assistantMsg.tool_calls).toEqual([
      {
        id: 'toolu_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"NYC"}',
        },
      },
    ]);
  });

  it('should convert tool_result blocks to separate tool messages', () => {
    const req = makeAnthropicRequest({
      messages: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'get_weather',
              input: { city: 'NYC' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: '72F and sunny',
            },
          ],
        },
      ],
    });
    const result = convertAnthropicRequestToUnified(req, {});

    // Should have: user, assistant, tool
    expect(result.messages).toHaveLength(3);
    expect(result.messages![2]).toEqual({
      role: 'tool',
      tool_call_id: 'toolu_123',
      content: '72F and sunny',
    });
  });

  it('should convert Anthropic tools to unified format', () => {
    const req = makeAnthropicRequest({
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ],
    });
    const result = convertAnthropicRequestToUnified(req, {});

    expect(result.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ]);
  });

  it('should map tool_choice auto', () => {
    const req = makeAnthropicRequest({ tool_choice: { type: 'auto' } });
    const result = convertAnthropicRequestToUnified(req, {});
    expect(result.tool_choice).toBe('auto');
  });

  it('should map tool_choice any to required', () => {
    const req = makeAnthropicRequest({ tool_choice: { type: 'any' } });
    const result = convertAnthropicRequestToUnified(req, {});
    expect(result.tool_choice).toBe('required');
  });

  it('should map tool_choice none', () => {
    const req = makeAnthropicRequest({ tool_choice: { type: 'none' } });
    const result = convertAnthropicRequestToUnified(req, {});
    expect(result.tool_choice).toBe('none');
  });

  it('should map tool_choice tool to specific function', () => {
    const req = makeAnthropicRequest({
      tool_choice: { type: 'tool', name: 'get_weather' },
    });
    const result = convertAnthropicRequestToUnified(req, {});
    expect(result.tool_choice).toEqual({
      type: 'function',
      function: { name: 'get_weather' },
    });
  });

  it('should pass through temperature and max_tokens', () => {
    const req = makeAnthropicRequest({
      temperature: 0.7,
      max_tokens: 2048,
    });
    const result = convertAnthropicRequestToUnified(req, {});

    expect(result.temperature).toBe(0.7);
    expect(result.max_tokens).toBe(2048);
  });

  it('should map stop_sequences to stop', () => {
    const req = makeAnthropicRequest({
      stop_sequences: ['END', 'STOP'],
    });
    const result = convertAnthropicRequestToUnified(req, {});
    expect(result.stop).toEqual(['END', 'STOP']);
  });

  it('should include metadata in result', () => {
    const req = makeAnthropicRequest({
      metadata: { user_id: 'user123' },
    });
    const result = convertAnthropicRequestToUnified(req, { requestId: 'req_1' });
    expect(result.user).toBe('user123');
    expect(result.metadata).toEqual({ requestId: 'req_1' });
  });
});

describe('convertUnifiedResponseToAnthropic', () => {
  it('should convert text response to Anthropic format', () => {
    const resp = makeUnifiedResponse();
    const result = convertUnifiedResponseToAnthropic(resp);

    expect(result.type).toBe('message');
    expect(result.id).toBe('msg_test123');
    expect(result.role).toBe('assistant');
    expect(result.content).toEqual([{ type: 'text', text: 'Hi there!' }]);
    expect(result.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('should convert tool calls to tool_use blocks', () => {
    const resp = makeUnifiedResponse({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"NYC"}',
            },
          },
        ],
      },
    });
    const result = convertUnifiedResponseToAnthropic(resp);

    expect(result.content).toEqual([
      { type: 'tool_use', id: 'call_123', name: 'get_weather', input: { city: 'NYC' } },
    ]);
  });

  it('should combine text and tool_use blocks', () => {
    const resp = makeUnifiedResponse({
      message: {
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"NYC"}',
            },
          },
        ],
      },
    });
    const result = convertUnifiedResponseToAnthropic(resp);

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Let me check.' });
    expect(result.content[1]).toEqual({
      type: 'tool_use',
      id: 'call_123',
      name: 'get_weather',
      input: { city: 'NYC' },
    });
  });

  it('should map stop to end_turn', () => {
    const resp = makeUnifiedResponse({ finishReason: 'stop' });
    const result = convertUnifiedResponseToAnthropic(resp);
    expect(result.stop_reason).toBe('end_turn');
  });

  it('should map tool_calls to tool_use', () => {
    const resp = makeUnifiedResponse({ finishReason: 'tool_calls' });
    const result = convertUnifiedResponseToAnthropic(resp);
    expect(result.stop_reason).toBe('tool_use');
  });

  it('should map length to max_tokens', () => {
    const resp = makeUnifiedResponse({ finishReason: 'length' });
    const result = convertUnifiedResponseToAnthropic(resp);
    expect(result.stop_reason).toBe('max_tokens');
  });

  it('should map content_filter to end_turn', () => {
    const resp = makeUnifiedResponse({ finishReason: 'content_filter' });
    const result = convertUnifiedResponseToAnthropic(resp);
    expect(result.stop_reason).toBe('end_turn');
  });

  it('should map usage fields', () => {
    const resp = makeUnifiedResponse({
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    const result = convertUnifiedResponseToAnthropic(resp);

    expect(result.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
    });
  });

  it('should handle null finishReason', () => {
    const resp = makeUnifiedResponse({ finishReason: undefined });
    const result = convertUnifiedResponseToAnthropic(resp);
    expect(result.stop_reason).toBeNull();
  });
});
