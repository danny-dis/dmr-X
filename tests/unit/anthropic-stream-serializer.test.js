"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const anthropic_stream_serializer_js_1 = require("../../apps/gateway/src/converters/anthropic-stream-serializer.js");
async function collectStream(chunks, options = { model: 'test-model', requestId: 'msg_test123' }) {
    async function* mockStream() {
        for (const chunk of chunks) {
            yield chunk;
        }
    }
    const results = [];
    for await (const chunk of (0, anthropic_stream_serializer_js_1.createAnthropicSSEStream)(mockStream(), options)) {
        // Split each chunk into lines
        results.push(...chunk.split('\n').filter(l => l.trim()));
    }
    return results;
}
function parseEvents(lines) {
    const events = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('event: ')) {
            const event = line.replace('event: ', '').trim();
            const dataLine = lines[i + 1]?.trim();
            const data = dataLine?.startsWith('data: ')
                ? JSON.parse(dataLine.replace('data: ', ''))
                : {};
            events.push({ event, data });
        }
    }
    return events;
}
(0, vitest_1.describe)('createAnthropicSSEStream', () => {
    (0, vitest_1.it)('should emit correct event sequence for text streaming', async () => {
        const chunks = [
            { type: 'token', data: { content: 'Hello' }, index: 0 },
            { type: 'token', data: { content: ' world' }, index: 1 },
            {
                type: 'done',
                data: {
                    requestId: 'msg_test123',
                    modelId: 'test-model',
                    finishReason: 'stop',
                    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
                },
                index: 2,
            },
        ];
        const lines = await collectStream(chunks);
        const events = parseEvents(lines);
        (0, vitest_1.expect)(events).toHaveLength(7);
        // 1. message_start
        (0, vitest_1.expect)(events[0].event).toBe('message_start');
        (0, vitest_1.expect)(events[0].data.type).toBe('message_start');
        (0, vitest_1.expect)(events[0].data.message.id).toBe('msg_test123');
        (0, vitest_1.expect)(events[0].data.message.model).toBe('test-model');
        (0, vitest_1.expect)(events[0].data.message.role).toBe('assistant');
        (0, vitest_1.expect)(events[0].data.message.stop_reason).toBeNull();
        // 2. content_block_start
        (0, vitest_1.expect)(events[1].event).toBe('content_block_start');
        (0, vitest_1.expect)(events[1].data.index).toBe(0);
        (0, vitest_1.expect)(events[1].data.content_block).toEqual({ type: 'text', text: '' });
        // 3. content_block_delta (Hello)
        (0, vitest_1.expect)(events[2].event).toBe('content_block_delta');
        (0, vitest_1.expect)(events[2].data.index).toBe(0);
        (0, vitest_1.expect)(events[2].data.delta).toEqual({ type: 'text_delta', text: 'Hello' });
        // 4. content_block_delta ( world)
        (0, vitest_1.expect)(events[3].event).toBe('content_block_delta');
        (0, vitest_1.expect)(events[3].data.delta).toEqual({ type: 'text_delta', text: ' world' });
        // 5. content_block_stop
        (0, vitest_1.expect)(events[4].event).toBe('content_block_stop');
        (0, vitest_1.expect)(events[4].data.index).toBe(0);
        // 6. message_delta
        (0, vitest_1.expect)(events[5].event).toBe('message_delta');
        (0, vitest_1.expect)(events[5].data.delta.stop_reason).toBe('end_turn');
        (0, vitest_1.expect)(events[5].data.usage.output_tokens).toBe(2);
        // 7. message_stop
        (0, vitest_1.expect)(events[6].event).toBe('message_stop');
    });
    (0, vitest_1.it)('should emit message_stop after message_delta', async () => {
        const chunks = [
            { type: 'token', data: { content: 'Hi' }, index: 0 },
            {
                type: 'done',
                data: { requestId: 'msg_1', modelId: 'm', finishReason: 'stop' },
                index: 1,
            },
        ];
        const lines = await collectStream(chunks);
        const eventNames = lines
            .filter(l => l.startsWith('event: '))
            .map(l => l.replace('event: ', '').trim());
        (0, vitest_1.expect)(eventNames).toEqual([
            'message_start',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'message_delta',
            'message_stop',
        ]);
    });
    (0, vitest_1.it)('should map tool_calls finish reason to tool_use', async () => {
        const chunks = [
            { type: 'token', data: { content: 'Thinking...' }, index: 0 },
            {
                type: 'done',
                data: { requestId: 'msg_1', modelId: 'm', finishReason: 'tool_calls' },
                index: 1,
            },
        ];
        const lines = await collectStream(chunks);
        const events = parseEvents(lines);
        const messageDelta = events.find(e => e.event === 'message_delta');
        (0, vitest_1.expect)(messageDelta.data.delta.stop_reason).toBe('tool_use');
    });
    (0, vitest_1.it)('should map length finish reason to max_tokens', async () => {
        const chunks = [
            { type: 'token', data: { content: '...' }, index: 0 },
            {
                type: 'done',
                data: { requestId: 'msg_1', modelId: 'm', finishReason: 'length' },
                index: 1,
            },
        ];
        const lines = await collectStream(chunks);
        const events = parseEvents(lines);
        const messageDelta = events.find(e => e.event === 'message_delta');
        (0, vitest_1.expect)(messageDelta.data.delta.stop_reason).toBe('max_tokens');
    });
    (0, vitest_1.it)('should emit error event for error chunks', async () => {
        const chunks = [
            { type: 'error', data: { code: 'rate_limit', message: 'Too many requests' }, index: 0 },
        ];
        const lines = await collectStream(chunks);
        const events = parseEvents(lines);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].event).toBe('error');
        (0, vitest_1.expect)(events[0].data.type).toBe('error');
        (0, vitest_1.expect)(events[0].data.error.type).toBe('api_error');
        (0, vitest_1.expect)(events[0].data.error.message).toBe('Too many requests');
    });
    (0, vitest_1.it)('should close gracefully if stream ends without done chunk', async () => {
        const chunks = [
            { type: 'token', data: { content: 'Hello' }, index: 0 },
            // No done chunk
        ];
        const lines = await collectStream(chunks);
        const events = parseEvents(lines);
        // Should have: message_start, content_block_start, content_block_delta,
        // content_block_stop, message_delta, message_stop
        (0, vitest_1.expect)(events).toHaveLength(6);
        (0, vitest_1.expect)(events[4].event).toBe('message_delta');
        (0, vitest_1.expect)(events[4].data.delta.stop_reason).toBe('end_turn');
        (0, vitest_1.expect)(events[5].event).toBe('message_stop');
    });
    (0, vitest_1.it)('should handle empty content in token chunk', async () => {
        const chunks = [
            { type: 'token', data: { content: '' }, index: 0 },
            { type: 'token', data: { content: 'Hello' }, index: 1 },
            {
                type: 'done',
                data: { requestId: 'msg_1', modelId: 'm', finishReason: 'stop' },
                index: 2,
            },
        ];
        const lines = await collectStream(chunks);
        const events = parseEvents(lines);
        const deltas = events.filter(e => e.event === 'content_block_delta');
        // Empty content is skipped, only 'Hello' produces a delta
        (0, vitest_1.expect)(deltas).toHaveLength(1);
        (0, vitest_1.expect)(deltas[0].data.delta.text).toBe('Hello');
    });
    (0, vitest_1.it)('should count output tokens correctly', async () => {
        const chunks = [
            { type: 'token', data: { content: 'a' }, index: 0 },
            { type: 'token', data: { content: 'b' }, index: 1 },
            { type: 'token', data: { content: 'c' }, index: 2 },
            {
                type: 'done',
                data: { requestId: 'msg_1', modelId: 'm', finishReason: 'stop' },
                index: 3,
            },
        ];
        const lines = await collectStream(chunks);
        const events = parseEvents(lines);
        const messageDelta = events.find(e => e.event === 'message_delta');
        (0, vitest_1.expect)(messageDelta.data.usage.output_tokens).toBe(3);
    });
});
//# sourceMappingURL=anthropic-stream-serializer.test.js.map