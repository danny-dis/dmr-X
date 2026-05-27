import type { StreamChunk } from '@dmr-x/core';
export declare function createOpenAISSEIterator(response: Response): AsyncIterable<StreamChunk>;
export declare function createSSESerializer(chunks: AsyncIterable<StreamChunk>): AsyncGenerator<string>;
//# sourceMappingURL=stream-normalizer.d.ts.map