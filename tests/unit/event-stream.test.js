"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const event_stream_js_1 = require("../../packages/utils/src/event-stream.js");
function createChunkStream(chunks) {
    let i = 0;
    return new ReadableStream({
        pull(controller) {
            if (i >= chunks.length) {
                controller.close();
                return;
            }
            controller.enqueue(new TextEncoder().encode(chunks[i]));
            i++;
        },
    });
}
(0, vitest_1.describe)('event-stream', () => {
    (0, vitest_1.describe)('EventStream', () => {
        (0, vitest_1.it)('should parse simple SSE messages', async () => {
            const stream = createChunkStream(['data: hello\n\n', 'data: world\n\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: msg.data }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual(['hello', 'world']);
        });
        (0, vitest_1.it)('should handle [DONE] sentinel', async () => {
            const stream = createChunkStream(['data: chunk1\n\n', 'data: [DONE]\n\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => {
                if (msg.data === '[DONE]')
                    return { done: true, value: undefined };
                return { done: false, value: msg.data };
            });
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual(['chunk1']);
        });
        (0, vitest_1.it)('should handle event and id fields', async () => {
            const stream = createChunkStream(['event: message\ndata: test\nid: abc123\n\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: { event: msg.event, data: msg.data, id: msg.id } }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].event).toBe('message');
            (0, vitest_1.expect)(results[0].data).toBe('test');
            (0, vitest_1.expect)(results[0].id).toBe('abc123');
        });
        (0, vitest_1.it)('should handle retry field', async () => {
            const stream = createChunkStream(['retry: 5000\ndata: hello\n\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: { retry: msg.retry, data: msg.data } }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results[0].retry).toBe(5000);
        });
        (0, vitest_1.it)('should skip comment lines', async () => {
            const stream = createChunkStream([': this is a comment\ndata: real\n\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: msg.data }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual(['real']);
        });
        (0, vitest_1.it)('should handle multi-line data', async () => {
            const stream = createChunkStream(['data: line1\ndata: line2\n\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: msg.data }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual(['line1\nline2']);
        });
        (0, vitest_1.it)('should handle empty stream', async () => {
            const stream = createChunkStream([]);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: msg.data }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual([]);
        });
        (0, vitest_1.it)('should handle \n\n boundary', async () => {
            const stream = createChunkStream(['data: test\n\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: msg.data }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual(['test']);
        });
        (0, vitest_1.it)('should handle \r\n\r\n boundary', async () => {
            const stream = createChunkStream(['data: test\r\n\r\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: msg.data }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual(['test']);
        });
        (0, vitest_1.it)('should skip data-less events when dataRequired is true (default)', async () => {
            const stream = createChunkStream(['event: ping\n\n', 'data: pong\n\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: msg.data ?? 'no-data' }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            // The event-only message should be skipped (no data field)
            (0, vitest_1.expect)(results).toEqual(['pong']);
        });
        (0, vitest_1.it)('should handle chunked delivery', async () => {
            // Simulate SSE arriving in multiple small chunks
            const stream = createChunkStream(['dat', 'a: hel', 'lo\n', '\n']);
            const eventStream = new event_stream_js_1.EventStream(stream, (msg) => ({ done: false, value: msg.data }));
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual(['hello']);
        });
    });
    (0, vitest_1.describe)('parseOpenAISSE', () => {
        (0, vitest_1.it)('should parse OpenAI SSE format', async () => {
            const stream = createChunkStream([
                'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
                'data: [DONE]\n\n',
            ]);
            const eventStream = (0, event_stream_js_1.parseOpenAISSE)(stream);
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results[0]).toContain('Hello');
            (0, vitest_1.expect)(results[1]).toContain('world');
        });
        (0, vitest_1.it)('should stop at [DONE]', async () => {
            const stream = createChunkStream([
                'data: chunk\n\n',
                'data: [DONE]\n\n',
                'data: after-done\n\n',
            ]);
            const eventStream = (0, event_stream_js_1.parseOpenAISSE)(stream);
            const results = [];
            for await (const value of eventStream) {
                results.push(value);
            }
            (0, vitest_1.expect)(results).toEqual(['chunk']);
        });
    });
});
//# sourceMappingURL=event-stream.test.js.map