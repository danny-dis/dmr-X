import type { StreamChunk } from '@dmr-x/core';
interface AnthropicStreamOptions {
    model: string;
    requestId: string;
}
/**
 * Converts internal StreamChunk stream to Anthropic SSE event format.
 *
 * Anthropic streaming protocol:
 * 1. message_start - message envelope
 * 2. content_block_start - start of a content block
 * 3. content_block_delta - incremental content (one or more)
 * 4. content_block_stop - end of a content block
 * 5. message_delta - final stop_reason and usage
 * 6. message_stop - stream complete
 */
export declare function createAnthropicSSEStream(chunks: AsyncIterable<StreamChunk>, options: AnthropicStreamOptions): AsyncGenerator<string>;
export {};
//# sourceMappingURL=anthropic-stream-serializer.d.ts.map