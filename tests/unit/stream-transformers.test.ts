import { describe, it, expect, vi } from 'vitest';

// Mock stream-type-guards.js
vi.mock('../../packages/utils/src/stream-type-guards.js', () => ({
  isOutputTextDeltaEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.output_text.delta',
  isReasoningDeltaEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.reasoning_text.delta',
  isFunctionCallArgumentsDeltaEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.function_call_arguments.delta',
  isOutputItemAddedEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.output_item.added',
  isOutputItemDoneEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.output_item.done',
  isResponseCompletedEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.completed',
  isResponseFailedEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.failed',
  isResponseIncompleteEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.incomplete',
  isFunctionCallArgumentsDoneEvent: (e: unknown) =>
    typeof e === 'object' && e !== null && 'type' in e && (e as any).type === 'response.function_call_arguments.done',
  isOutputMessage: (item: unknown) =>
    typeof item === 'object' && item !== null && 'type' in item && (item as any).type === 'message',
  isFunctionCallItem: (item: unknown) =>
    typeof item === 'object' && item !== null && 'type' in item && (item as any).type === 'function_call',
  isReasoningOutputItem: (item: unknown) =>
    typeof item === 'object' && item !== null && 'type' in item && (item as any).type === 'reasoning',
  isWebSearchCallOutputItem: (item: unknown) =>
    typeof item === 'object' && item !== null && 'type' in item && (item as any).type === 'web_search_call',
  isFileSearchCallOutputItem: (item: unknown) =>
    typeof item === 'object' && item !== null && 'type' in item && (item as any).type === 'file_search_call',
  isImageGenerationCallOutputItem: (item: unknown) =>
    typeof item === 'object' && item !== null && 'type' in item && (item as any).type === 'image_generation_call',
  isOutputTextPart: (part: unknown) =>
    typeof part === 'object' && part !== null && 'type' in part && (part as any).type === 'output_text',
  isRefusalPart: (part: unknown) =>
    typeof part === 'object' && part !== null && 'type' in part && (part as any).type === 'refusal',
  isFileCitationAnnotation: (a: unknown) =>
    typeof a === 'object' && a !== null && 'type' in a && (a as any).type === 'file_citation',
  isURLCitationAnnotation: (a: unknown) =>
    typeof a === 'object' && a !== null && 'type' in a && (a as any).type === 'url_citation',
  isFilePathAnnotation: (a: unknown) =>
    typeof a === 'object' && a !== null && 'type' in a && (a as any).type === 'file_path',
}));

// Mock reusable-stream.js — provide a minimal mock
vi.mock('../../packages/utils/src/reusable-stream.js', () => ({
  // Not directly used in the pure function tests
}));

import {
  extractToolCallsFromResponse,
  responseHasToolCalls,
  extractTextFromResponse,
  extractMessageFromResponse,
  convertToClaudeMessage,
  extractUnsupportedContent,
  hasUnsupportedContent,
  getUnsupportedContentSummary,
  extractResponsesMessageFromResponse,
} from '../../packages/utils/src/stream-transformers.js';

describe('stream-transformers', () => {
  describe('extractToolCallsFromResponse', () => {
    it('should extract tool calls with parsed arguments', () => {
      const response = {
        id: 'resp_1',
        output: [
          {
            type: 'function_call',
            callId: 'call_1',
            name: 'search',
            arguments: '{"query":"test"}',
          },
        ],
      } as any;

      const result = extractToolCallsFromResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'call_1',
        name: 'search',
        arguments: { query: 'test' },
      });
    });

    it('should handle empty arguments', () => {
      const response = {
        id: 'resp_1',
        output: [
          {
            type: 'function_call',
            callId: 'call_1',
            name: 'noop',
            arguments: '',
          },
        ],
      } as any;

      const result = extractToolCallsFromResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0].arguments).toEqual({});
    });

    it('should handle malformed JSON arguments gracefully', () => {
      const response = {
        id: 'resp_1',
        output: [
          {
            type: 'function_call',
            callId: 'call_1',
            name: 'broken',
            arguments: 'not-json',
          },
        ],
      } as any;

      const result = extractToolCallsFromResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0].arguments).toEqual({ _raw_arguments: 'not-json' });
    });

    it('should return empty array when no function calls', () => {
      const response = {
        id: 'resp_1',
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'hello' }],
          },
        ],
      } as any;

      const result = extractToolCallsFromResponse(response);
      expect(result).toHaveLength(0);
    });

    it('should extract multiple tool calls', () => {
      const response = {
        id: 'resp_1',
        output: [
          { type: 'function_call', callId: 'call_1', name: 'search', arguments: '{"q":"a"}' },
          { type: 'function_call', callId: 'call_2', name: 'lookup', arguments: '{"id":"123"}' },
        ],
      } as any;

      const result = extractToolCallsFromResponse(response);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('search');
      expect(result[1].name).toBe('lookup');
    });
  });

  describe('responseHasToolCalls', () => {
    it('should return true when response has function calls', () => {
      const response = {
        output: [{ type: 'function_call', callId: 'c1', name: 'test', arguments: '{}' }],
      } as any;
      expect(responseHasToolCalls(response)).toBe(true);
    });

    it('should return false when response has no function calls', () => {
      const response = {
        output: [{ type: 'message', id: 'm1', role: 'assistant', content: [] }],
      } as any;
      expect(responseHasToolCalls(response)).toBe(false);
    });

    it('should return false for empty output', () => {
      const response = { output: [] } as any;
      expect(responseHasToolCalls(response)).toBe(false);
    });
  });

  describe('extractTextFromResponse', () => {
    it('should extract text from outputText field', () => {
      const response = { outputText: 'Hello world', output: [] } as any;
      expect(extractTextFromResponse(response)).toBe('Hello world');
    });

    it('should extract text from message content when no outputText', () => {
      const response = {
        output: [
          {
            type: 'message',
            id: 'm1',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'From message' }],
          },
        ],
      } as any;
      expect(extractTextFromResponse(response)).toBe('From message');
    });

    it('should return empty string when no text found', () => {
      const response = { output: [] } as any;
      expect(extractTextFromResponse(response)).toBe('');
    });
  });

  describe('extractMessageFromResponse', () => {
    it('should extract assistant message from response', () => {
      const response = {
        output: [
          {
            type: 'message',
            id: 'm1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Hi there' }],
          },
        ],
      } as any;

      const result = extractMessageFromResponse(response);
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hi there');
    });

    it('should throw when no message in output', () => {
      const response = { output: [{ type: 'function_call', callId: 'c1', name: 'test', arguments: '{}' }] } as any;
      expect(() => extractMessageFromResponse(response)).toThrow('No message found');
    });
  });

  describe('extractResponsesMessageFromResponse', () => {
    it('should return the raw OutputMessage', () => {
      const msg = {
        type: 'message',
        id: 'm1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'test' }],
      };
      const response = { output: [msg] } as any;

      const result = extractResponsesMessageFromResponse(response);
      expect(result).toBe(msg);
    });

    it('should throw when no message found', () => {
      const response = { output: [] } as any;
      expect(() => extractResponsesMessageFromResponse(response)).toThrow();
    });
  });

  describe('convertToClaudeMessage', () => {
    it('should convert a simple text response to Claude format', () => {
      const response = {
        id: 'resp_1',
        model: 'gpt-4o',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'm1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Hello from Claude' }],
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any;

      const result = convertToClaudeMessage(response);
      expect(result.type).toBe('message');
      expect(result.role).toBe('assistant');
      expect(result.model).toBe('gpt-4o');
      expect(result.stop_reason).toBe('end_turn');
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello from Claude' });
    });

    it('should convert function calls to tool_use blocks', () => {
      const response = {
        id: 'resp_1',
        model: 'gpt-4o',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            callId: 'call_1',
            name: 'search',
            arguments: '{"query":"test"}',
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any;

      const result = convertToClaudeMessage(response);
      expect(result.stop_reason).toBe('tool_use');
      expect(result.content[0]).toEqual({
        type: 'tool_use',
        id: 'call_1',
        name: 'search',
        input: { query: 'test' },
      });
    });

    it('should handle reasoning items as thinking blocks', () => {
      const response = {
        id: 'resp_1',
        model: 'gpt-4o',
        status: 'completed',
        output: [
          {
            type: 'reasoning',
            id: 'r1',
            summary: [{ type: 'summary_text', text: 'Thinking about this...' }],
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any;

      const result = convertToClaudeMessage(response);
      expect(result.content[0]).toEqual({
        type: 'thinking',
        thinking: 'Thinking about this...',
        signature: '',
      });
    });

    it('should set stop_reason to max_tokens for incomplete max_output_tokens', () => {
      const response = {
        id: 'resp_1',
        model: 'gpt-4o',
        status: 'incomplete',
        incompleteDetails: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'message',
            id: 'm1',
            role: 'assistant',
            status: 'incomplete',
            content: [{ type: 'output_text', text: 'truncated' }],
          },
        ],
        usage: { inputTokens: 10, outputTokens: 100 },
      } as any;

      const result = convertToClaudeMessage(response);
      expect(result.stop_reason).toBe('max_tokens');
    });

    it('should track unsupported content for image generation calls', () => {
      const response = {
        id: 'resp_1',
        model: 'gpt-4o',
        status: 'completed',
        output: [
          {
            type: 'image_generation_call',
            id: 'img_1',
            result: 'base64data',
            status: 'completed',
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any;

      const result = convertToClaudeMessage(response);
      expect(result.unsupported_content).toBeDefined();
      expect(result.unsupported_content![0].original_type).toBe('image_generation_call');
    });
  });

  describe('extractUnsupportedContent', () => {
    it('should filter unsupported content by type', () => {
      const message = {
        unsupported_content: [
          { original_type: 'refusal', data: {}, reason: 'test' },
          { original_type: 'image_generation_call', data: {}, reason: 'test' },
        ],
      } as any;

      const result = extractUnsupportedContent(message, 'refusal');
      expect(result).toHaveLength(1);
      expect(result[0].original_type).toBe('refusal');
    });

    it('should return empty array when no unsupported content', () => {
      const message = {} as any;
      expect(extractUnsupportedContent(message, 'test')).toEqual([]);
    });
  });

  describe('hasUnsupportedContent', () => {
    it('should return true when unsupported content exists', () => {
      const message = { unsupported_content: [{ original_type: 'test', data: {}, reason: 'x' }] } as any;
      expect(hasUnsupportedContent(message)).toBe(true);
    });

    it('should return false when no unsupported content', () => {
      const message = {} as any;
      expect(hasUnsupportedContent(message)).toBe(false);
    });
  });

  describe('getUnsupportedContentSummary', () => {
    it('should count unsupported content by type', () => {
      const message = {
        unsupported_content: [
          { original_type: 'refusal', data: {}, reason: 'x' },
          { original_type: 'refusal', data: {}, reason: 'y' },
          { original_type: 'image_generation_call', data: {}, reason: 'z' },
        ],
      } as any;

      const result = getUnsupportedContentSummary(message);
      expect(result).toEqual({ refusal: 2, image_generation_call: 1 });
    });

    it('should return empty object when no unsupported content', () => {
      const message = {} as any;
      expect(getUnsupportedContentSummary(message)).toEqual({});
    });
  });
});
