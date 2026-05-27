"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const anthropic_converter_js_1 = require("../../apps/gateway/src/converters/anthropic-converter.js");
function makeAnthropicRequest(overrides = {}) {
    return {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        ...overrides,
    };
}
function makeUnifiedResponse(overrides = {}) {
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
(0, vitest_1.describe)('convertAnthropicRequestToUnified', () => {
    (0, vitest_1.it)('should convert simple text message', () => {
        const req = makeAnthropicRequest({
            messages: [{ role: 'user', content: 'Hello' }],
        });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.messages).toHaveLength(1);
        (0, vitest_1.expect)(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    });
    (0, vitest_1.it)('should extract system prompt from string', () => {
        const req = makeAnthropicRequest({
            system: 'You are a helpful assistant',
            messages: [{ role: 'user', content: 'Hi' }],
        });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.messages).toHaveLength(2);
        (0, vitest_1.expect)(result.messages[0]).toEqual({
            role: 'system',
            content: 'You are a helpful assistant',
        });
    });
    (0, vitest_1.it)('should extract system prompt from content block array', () => {
        const req = makeAnthropicRequest({
            system: [
                { type: 'text', text: 'You are ' },
                { type: 'text', text: 'helpful' },
            ],
            messages: [{ role: 'user', content: 'Hi' }],
        });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.messages[0]).toEqual({
            role: 'system',
            content: 'You are helpful',
        });
    });
    (0, vitest_1.it)('should convert tool_use blocks in assistant messages to tool_calls', () => {
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
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.messages).toHaveLength(2);
        const assistantMsg = result.messages[1];
        (0, vitest_1.expect)(assistantMsg.role).toBe('assistant');
        (0, vitest_1.expect)(assistantMsg.content).toBe('Let me check.');
        (0, vitest_1.expect)(assistantMsg.tool_calls).toEqual([
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
    (0, vitest_1.it)('should convert tool_result blocks to separate tool messages', () => {
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
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        // Should have: user, assistant, tool
        (0, vitest_1.expect)(result.messages).toHaveLength(3);
        (0, vitest_1.expect)(result.messages[2]).toEqual({
            role: 'tool',
            tool_call_id: 'toolu_123',
            content: '72F and sunny',
        });
    });
    (0, vitest_1.it)('should convert Anthropic tools to unified format', () => {
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
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.tools).toEqual([
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
    (0, vitest_1.it)('should map tool_choice auto', () => {
        const req = makeAnthropicRequest({ tool_choice: { type: 'auto' } });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.tool_choice).toBe('auto');
    });
    (0, vitest_1.it)('should map tool_choice any to required', () => {
        const req = makeAnthropicRequest({ tool_choice: { type: 'any' } });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.tool_choice).toBe('required');
    });
    (0, vitest_1.it)('should map tool_choice none', () => {
        const req = makeAnthropicRequest({ tool_choice: { type: 'none' } });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.tool_choice).toBe('none');
    });
    (0, vitest_1.it)('should map tool_choice tool to specific function', () => {
        const req = makeAnthropicRequest({
            tool_choice: { type: 'tool', name: 'get_weather' },
        });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.tool_choice).toEqual({
            type: 'function',
            function: { name: 'get_weather' },
        });
    });
    (0, vitest_1.it)('should pass through temperature and max_tokens', () => {
        const req = makeAnthropicRequest({
            temperature: 0.7,
            max_tokens: 2048,
        });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.temperature).toBe(0.7);
        (0, vitest_1.expect)(result.max_tokens).toBe(2048);
    });
    (0, vitest_1.it)('should map stop_sequences to stop', () => {
        const req = makeAnthropicRequest({
            stop_sequences: ['END', 'STOP'],
        });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, {});
        (0, vitest_1.expect)(result.stop).toEqual(['END', 'STOP']);
    });
    (0, vitest_1.it)('should include metadata in result', () => {
        const req = makeAnthropicRequest({
            metadata: { user_id: 'user123' },
        });
        const result = (0, anthropic_converter_js_1.convertAnthropicRequestToUnified)(req, { requestId: 'req_1' });
        (0, vitest_1.expect)(result.user).toBe('user123');
        (0, vitest_1.expect)(result.metadata).toEqual({ requestId: 'req_1' });
    });
});
(0, vitest_1.describe)('convertUnifiedResponseToAnthropic', () => {
    (0, vitest_1.it)('should convert text response to Anthropic format', () => {
        const resp = makeUnifiedResponse();
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.type).toBe('message');
        (0, vitest_1.expect)(result.id).toBe('msg_test123');
        (0, vitest_1.expect)(result.role).toBe('assistant');
        (0, vitest_1.expect)(result.content).toEqual([{ type: 'text', text: 'Hi there!' }]);
        (0, vitest_1.expect)(result.model).toBe('claude-sonnet-4-5-20250929');
    });
    (0, vitest_1.it)('should convert tool calls to tool_use blocks', () => {
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
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.content).toEqual([
            { type: 'tool_use', id: 'call_123', name: 'get_weather', input: { city: 'NYC' } },
        ]);
    });
    (0, vitest_1.it)('should combine text and tool_use blocks', () => {
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
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.content).toHaveLength(2);
        (0, vitest_1.expect)(result.content[0]).toEqual({ type: 'text', text: 'Let me check.' });
        (0, vitest_1.expect)(result.content[1]).toEqual({
            type: 'tool_use',
            id: 'call_123',
            name: 'get_weather',
            input: { city: 'NYC' },
        });
    });
    (0, vitest_1.it)('should map stop to end_turn', () => {
        const resp = makeUnifiedResponse({ finishReason: 'stop' });
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.stop_reason).toBe('end_turn');
    });
    (0, vitest_1.it)('should map tool_calls to tool_use', () => {
        const resp = makeUnifiedResponse({ finishReason: 'tool_calls' });
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.stop_reason).toBe('tool_use');
    });
    (0, vitest_1.it)('should map length to max_tokens', () => {
        const resp = makeUnifiedResponse({ finishReason: 'length' });
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.stop_reason).toBe('max_tokens');
    });
    (0, vitest_1.it)('should map content_filter to end_turn', () => {
        const resp = makeUnifiedResponse({ finishReason: 'content_filter' });
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.stop_reason).toBe('end_turn');
    });
    (0, vitest_1.it)('should map usage fields', () => {
        const resp = makeUnifiedResponse({
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.usage).toEqual({
            input_tokens: 100,
            output_tokens: 50,
        });
    });
    (0, vitest_1.it)('should handle null finishReason', () => {
        const resp = makeUnifiedResponse({ finishReason: undefined });
        const result = (0, anthropic_converter_js_1.convertUnifiedResponseToAnthropic)(resp);
        (0, vitest_1.expect)(result.stop_reason).toBeNull();
    });
});
//# sourceMappingURL=anthropic-converter.test.js.map