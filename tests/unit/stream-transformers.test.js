"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock stream-type-guards.js
vitest_1.vi.mock('../../packages/utils/src/stream-type-guards.js', () => ({
    isOutputTextDeltaEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.output_text.delta',
    isReasoningDeltaEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.reasoning_text.delta',
    isFunctionCallArgumentsDeltaEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.function_call_arguments.delta',
    isOutputItemAddedEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.output_item.added',
    isOutputItemDoneEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.output_item.done',
    isResponseCompletedEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.completed',
    isResponseFailedEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.failed',
    isResponseIncompleteEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.incomplete',
    isFunctionCallArgumentsDoneEvent: (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'response.function_call_arguments.done',
    isOutputMessage: (item) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'message',
    isFunctionCallItem: (item) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'function_call',
    isReasoningOutputItem: (item) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'reasoning',
    isWebSearchCallOutputItem: (item) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'web_search_call',
    isFileSearchCallOutputItem: (item) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'file_search_call',
    isImageGenerationCallOutputItem: (item) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'image_generation_call',
    isOutputTextPart: (part) => typeof part === 'object' && part !== null && 'type' in part && part.type === 'output_text',
    isRefusalPart: (part) => typeof part === 'object' && part !== null && 'type' in part && part.type === 'refusal',
    isFileCitationAnnotation: (a) => typeof a === 'object' && a !== null && 'type' in a && a.type === 'file_citation',
    isURLCitationAnnotation: (a) => typeof a === 'object' && a !== null && 'type' in a && a.type === 'url_citation',
    isFilePathAnnotation: (a) => typeof a === 'object' && a !== null && 'type' in a && a.type === 'file_path',
}));
// Mock reusable-stream.js — provide a minimal mock
vitest_1.vi.mock('../../packages/utils/src/reusable-stream.js', () => ({
// Not directly used in the pure function tests
}));
const stream_transformers_js_1 = require("../../packages/utils/src/stream-transformers.js");
(0, vitest_1.describe)('stream-transformers', () => {
    (0, vitest_1.describe)('extractToolCallsFromResponse', () => {
        (0, vitest_1.it)('should extract tool calls with parsed arguments', () => {
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
            };
            const result = (0, stream_transformers_js_1.extractToolCallsFromResponse)(response);
            (0, vitest_1.expect)(result).toHaveLength(1);
            (0, vitest_1.expect)(result[0]).toEqual({
                id: 'call_1',
                name: 'search',
                arguments: { query: 'test' },
            });
        });
        (0, vitest_1.it)('should handle empty arguments', () => {
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
            };
            const result = (0, stream_transformers_js_1.extractToolCallsFromResponse)(response);
            (0, vitest_1.expect)(result).toHaveLength(1);
            (0, vitest_1.expect)(result[0].arguments).toEqual({});
        });
        (0, vitest_1.it)('should handle malformed JSON arguments gracefully', () => {
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
            };
            const result = (0, stream_transformers_js_1.extractToolCallsFromResponse)(response);
            (0, vitest_1.expect)(result).toHaveLength(1);
            (0, vitest_1.expect)(result[0].arguments).toEqual({ _raw_arguments: 'not-json' });
        });
        (0, vitest_1.it)('should return empty array when no function calls', () => {
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
            };
            const result = (0, stream_transformers_js_1.extractToolCallsFromResponse)(response);
            (0, vitest_1.expect)(result).toHaveLength(0);
        });
        (0, vitest_1.it)('should extract multiple tool calls', () => {
            const response = {
                id: 'resp_1',
                output: [
                    { type: 'function_call', callId: 'call_1', name: 'search', arguments: '{"q":"a"}' },
                    { type: 'function_call', callId: 'call_2', name: 'lookup', arguments: '{"id":"123"}' },
                ],
            };
            const result = (0, stream_transformers_js_1.extractToolCallsFromResponse)(response);
            (0, vitest_1.expect)(result).toHaveLength(2);
            (0, vitest_1.expect)(result[0].name).toBe('search');
            (0, vitest_1.expect)(result[1].name).toBe('lookup');
        });
    });
    (0, vitest_1.describe)('responseHasToolCalls', () => {
        (0, vitest_1.it)('should return true when response has function calls', () => {
            const response = {
                output: [{ type: 'function_call', callId: 'c1', name: 'test', arguments: '{}' }],
            };
            (0, vitest_1.expect)((0, stream_transformers_js_1.responseHasToolCalls)(response)).toBe(true);
        });
        (0, vitest_1.it)('should return false when response has no function calls', () => {
            const response = {
                output: [{ type: 'message', id: 'm1', role: 'assistant', content: [] }],
            };
            (0, vitest_1.expect)((0, stream_transformers_js_1.responseHasToolCalls)(response)).toBe(false);
        });
        (0, vitest_1.it)('should return false for empty output', () => {
            const response = { output: [] };
            (0, vitest_1.expect)((0, stream_transformers_js_1.responseHasToolCalls)(response)).toBe(false);
        });
    });
    (0, vitest_1.describe)('extractTextFromResponse', () => {
        (0, vitest_1.it)('should extract text from outputText field', () => {
            const response = { outputText: 'Hello world', output: [] };
            (0, vitest_1.expect)((0, stream_transformers_js_1.extractTextFromResponse)(response)).toBe('Hello world');
        });
        (0, vitest_1.it)('should extract text from message content when no outputText', () => {
            const response = {
                output: [
                    {
                        type: 'message',
                        id: 'm1',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'From message' }],
                    },
                ],
            };
            (0, vitest_1.expect)((0, stream_transformers_js_1.extractTextFromResponse)(response)).toBe('From message');
        });
        (0, vitest_1.it)('should return empty string when no text found', () => {
            const response = { output: [] };
            (0, vitest_1.expect)((0, stream_transformers_js_1.extractTextFromResponse)(response)).toBe('');
        });
    });
    (0, vitest_1.describe)('extractMessageFromResponse', () => {
        (0, vitest_1.it)('should extract assistant message from response', () => {
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
            };
            const result = (0, stream_transformers_js_1.extractMessageFromResponse)(response);
            (0, vitest_1.expect)(result.role).toBe('assistant');
            (0, vitest_1.expect)(result.content).toBe('Hi there');
        });
        (0, vitest_1.it)('should throw when no message in output', () => {
            const response = { output: [{ type: 'function_call', callId: 'c1', name: 'test', arguments: '{}' }] };
            (0, vitest_1.expect)(() => (0, stream_transformers_js_1.extractMessageFromResponse)(response)).toThrow('No message found');
        });
    });
    (0, vitest_1.describe)('extractResponsesMessageFromResponse', () => {
        (0, vitest_1.it)('should return the raw OutputMessage', () => {
            const msg = {
                type: 'message',
                id: 'm1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'test' }],
            };
            const response = { output: [msg] };
            const result = (0, stream_transformers_js_1.extractResponsesMessageFromResponse)(response);
            (0, vitest_1.expect)(result).toBe(msg);
        });
        (0, vitest_1.it)('should throw when no message found', () => {
            const response = { output: [] };
            (0, vitest_1.expect)(() => (0, stream_transformers_js_1.extractResponsesMessageFromResponse)(response)).toThrow();
        });
    });
    (0, vitest_1.describe)('convertToClaudeMessage', () => {
        (0, vitest_1.it)('should convert a simple text response to Claude format', () => {
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
            };
            const result = (0, stream_transformers_js_1.convertToClaudeMessage)(response);
            (0, vitest_1.expect)(result.type).toBe('message');
            (0, vitest_1.expect)(result.role).toBe('assistant');
            (0, vitest_1.expect)(result.model).toBe('gpt-4o');
            (0, vitest_1.expect)(result.stop_reason).toBe('end_turn');
            (0, vitest_1.expect)(result.content).toHaveLength(1);
            (0, vitest_1.expect)(result.content[0]).toEqual({ type: 'text', text: 'Hello from Claude' });
        });
        (0, vitest_1.it)('should convert function calls to tool_use blocks', () => {
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
            };
            const result = (0, stream_transformers_js_1.convertToClaudeMessage)(response);
            (0, vitest_1.expect)(result.stop_reason).toBe('tool_use');
            (0, vitest_1.expect)(result.content[0]).toEqual({
                type: 'tool_use',
                id: 'call_1',
                name: 'search',
                input: { query: 'test' },
            });
        });
        (0, vitest_1.it)('should handle reasoning items as thinking blocks', () => {
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
            };
            const result = (0, stream_transformers_js_1.convertToClaudeMessage)(response);
            (0, vitest_1.expect)(result.content[0]).toEqual({
                type: 'thinking',
                thinking: 'Thinking about this...',
                signature: '',
            });
        });
        (0, vitest_1.it)('should set stop_reason to max_tokens for incomplete max_output_tokens', () => {
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
            };
            const result = (0, stream_transformers_js_1.convertToClaudeMessage)(response);
            (0, vitest_1.expect)(result.stop_reason).toBe('max_tokens');
        });
        (0, vitest_1.it)('should track unsupported content for image generation calls', () => {
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
            };
            const result = (0, stream_transformers_js_1.convertToClaudeMessage)(response);
            (0, vitest_1.expect)(result.unsupported_content).toBeDefined();
            (0, vitest_1.expect)(result.unsupported_content[0].original_type).toBe('image_generation_call');
        });
    });
    (0, vitest_1.describe)('extractUnsupportedContent', () => {
        (0, vitest_1.it)('should filter unsupported content by type', () => {
            const message = {
                unsupported_content: [
                    { original_type: 'refusal', data: {}, reason: 'test' },
                    { original_type: 'image_generation_call', data: {}, reason: 'test' },
                ],
            };
            const result = (0, stream_transformers_js_1.extractUnsupportedContent)(message, 'refusal');
            (0, vitest_1.expect)(result).toHaveLength(1);
            (0, vitest_1.expect)(result[0].original_type).toBe('refusal');
        });
        (0, vitest_1.it)('should return empty array when no unsupported content', () => {
            const message = {};
            (0, vitest_1.expect)((0, stream_transformers_js_1.extractUnsupportedContent)(message, 'test')).toEqual([]);
        });
    });
    (0, vitest_1.describe)('hasUnsupportedContent', () => {
        (0, vitest_1.it)('should return true when unsupported content exists', () => {
            const message = { unsupported_content: [{ original_type: 'test', data: {}, reason: 'x' }] };
            (0, vitest_1.expect)((0, stream_transformers_js_1.hasUnsupportedContent)(message)).toBe(true);
        });
        (0, vitest_1.it)('should return false when no unsupported content', () => {
            const message = {};
            (0, vitest_1.expect)((0, stream_transformers_js_1.hasUnsupportedContent)(message)).toBe(false);
        });
    });
    (0, vitest_1.describe)('getUnsupportedContentSummary', () => {
        (0, vitest_1.it)('should count unsupported content by type', () => {
            const message = {
                unsupported_content: [
                    { original_type: 'refusal', data: {}, reason: 'x' },
                    { original_type: 'refusal', data: {}, reason: 'y' },
                    { original_type: 'image_generation_call', data: {}, reason: 'z' },
                ],
            };
            const result = (0, stream_transformers_js_1.getUnsupportedContentSummary)(message);
            (0, vitest_1.expect)(result).toEqual({ refusal: 2, image_generation_call: 1 });
        });
        (0, vitest_1.it)('should return empty object when no unsupported content', () => {
            const message = {};
            (0, vitest_1.expect)((0, stream_transformers_js_1.getUnsupportedContentSummary)(message)).toEqual({});
        });
    });
});
//# sourceMappingURL=stream-transformers.test.js.map