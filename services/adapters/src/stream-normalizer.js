import { EventStream, logger } from '@dmr-x/utils';
/**
 * Parse an OpenAI-compatible SSE response into StreamChunks.
 * Uses the robust EventStream parser that handles multiple boundary formats.
 */
export function createOpenAISSEIterator(response) {
    const body = response.body;
    if (!body) {
        throw new Error('Response body is null');
    }
    let index = 0;
    const eventStream = new EventStream(body, (msg) => {
        if (msg.data === '[DONE]') {
            return {
                done: false,
                value: { type: 'done', data: {}, index: index++ },
            };
        }
        try {
            const parsed = JSON.parse(msg.data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
                return {
                    done: false,
                    value: {
                        type: 'token',
                        data: {
                            content: delta.content,
                            tool_calls: delta.tool_calls,
                            role: delta.role,
                        },
                        index: index++,
                    },
                };
            }
        }
        catch (parseErr) {
            // Skip malformed JSON chunks
            logger.debug({ err: parseErr }, 'SSE stream: skipped malformed JSON chunk');
        }
        return { done: false, value: undefined };
    });
    return eventStream;
}
/**
 * Convert StreamChunks back to SSE text format for writing to HTTP responses.
 * Uses the EventStream-based SSE serializer from @dmr-x/utils for robust parsing,
 * then re-serializes into OpenAI-compatible SSE format.
 */
export async function* createSSESerializer(chunks) {
    for await (const chunk of chunks) {
        if (chunk.type === 'token') {
            const delta = chunk.data;
            const data = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                choices: [{
                        index: 0,
                        delta: { content: delta.content, role: delta.role },
                        finish_reason: null,
                    }],
            };
            yield `data: ${JSON.stringify(data)}\n\n`;
        }
        else if (chunk.type === 'done') {
            const data = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: 'stop',
                    }],
            };
            yield `data: ${JSON.stringify(data)}\n\n`;
            yield 'data: [DONE]\n\n';
        }
        else if (chunk.type === 'error') {
            yield `data: ${JSON.stringify({ error: chunk.data })}\n\n`;
        }
    }
}
/**
 * Format a single StreamChunk as an OpenAI-compatible SSE data line.
 * Returns the formatted string or undefined for unrecognized chunk types.
 * Does NOT include the [DONE] marker -- callers handle stream termination.
 */
export function formatSSEChunk(chunk, requestId) {
    if (chunk.type === 'token') {
        const delta = chunk.data;
        return `data: ${JSON.stringify({
            id: requestId,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: delta.content, role: delta.role }, finish_reason: null }],
        })}\n\n`;
    }
    if (chunk.type === 'done') {
        return `data: ${JSON.stringify({
            id: requestId,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`;
    }
    return undefined;
}
//# sourceMappingURL=stream-normalizer.js.map