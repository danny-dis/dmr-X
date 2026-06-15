import { describe, it, expect } from 'vitest';
import { EventStream, parseOpenAISSE } from '../../packages/utils/src/event-stream.js';

function createChunkStream(chunks: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
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

describe('event-stream', () => {
  describe('EventStream', () => {
    it('should parse simple SSE messages', async () => {
      const stream = createChunkStream(['data: hello\n\n', 'data: world\n\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['hello', 'world']);
    });

    it('should handle [DONE] sentinel', async () => {
      const stream = createChunkStream(['data: chunk1\n\n', 'data: [DONE]\n\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => {
          if (msg.data === '[DONE]') return { done: true, value: undefined };
          return { done: false, value: msg.data! };
        },
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['chunk1']);
    });

    it('should handle event and id fields', async () => {
      const stream = createChunkStream(['event: message\ndata: test\nid: abc123\n\n']);
      const eventStream = new EventStream<{ event?: string | null; data?: string; id?: string | null }>(
        stream,
        (msg) => ({ done: false, value: { event: msg.event, data: msg.data, id: msg.id } }),
      );

      const results: { event?: string | null; data?: string; id?: string | null }[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('message');
      expect(results[0].data).toBe('test');
      expect(results[0].id).toBe('abc123');
    });

    it('should handle retry field', async () => {
      const stream = createChunkStream(['retry: 5000\ndata: hello\n\n']);
      const eventStream = new EventStream<{ retry?: number | null; data?: string }>(
        stream,
        (msg) => ({ done: false, value: { retry: msg.retry, data: msg.data } }),
      );

      const results: { retry?: number | null; data?: string }[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results[0].retry).toBe(5000);
    });

    it('should skip comment lines', async () => {
      const stream = createChunkStream([': this is a comment\ndata: real\n\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['real']);
    });

    it('should handle multi-line data', async () => {
      const stream = createChunkStream(['data: line1\ndata: line2\n\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['line1\nline2']);
    });

    it('should handle empty stream', async () => {
      const stream = createChunkStream([]);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual([]);
    });

    it('should handle \n\n boundary', async () => {
      const stream = createChunkStream(['data: test\n\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['test']);
    });

    it('should handle \r\n\r\n boundary', async () => {
      const stream = createChunkStream(['data: test\r\n\r\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['test']);
    });

    it('should skip data-less events when dataRequired is true (default)', async () => {
      const stream = createChunkStream(['event: ping\n\n', 'data: pong\n\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data ?? 'no-data' }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      // The event-only message should be skipped (no data field)
      expect(results).toEqual(['pong']);
    });

    it('should handle chunked delivery', async () => {
      // Simulate SSE arriving in multiple small chunks
      const stream = createChunkStream(['dat', 'a: hel', 'lo\n', '\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['hello']);
    });

    it('should handle boundary straddling two chunks', async () => {
      // The 4-byte `\r\n\r\n` boundary is split across two chunks.
      // Without the backtrack, the parser would miss this boundary.
      const stream = createChunkStream(['data: test\r', '\n\r\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['test']);
    });

    it('should handle boundary straddling two chunks (3-byte form)', async () => {
      // The 3-byte `\r\n\n` boundary is split across two chunks.
      const stream = createChunkStream(['data: test\r', '\n\n']);
      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
      );

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['test']);
    });

    it('should parse 1000 chunks of 1 KB each in O(n) total work (regression for CRIT-4)', async () => {
      // This test guards against the O(n^2) regression in findBoundary
      // where every `pull` rescanned the entire cumulative buffer. The
      // O(n^2) version would take well over 1 second for 1 MB of input;
      // the O(n) version finishes in a few milliseconds.
      const CHUNK_COUNT = 1000;
      const CHUNK_SIZE = 1024;
      const header = 'data: ';
      const footer = '\n\n';
      const contentSize = CHUNK_SIZE - header.length - footer.length;

      // Build CHUNK_COUNT events, each padded to exactly CHUNK_SIZE bytes.
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < CHUNK_COUNT; i++) {
        const content = String(i).padStart(contentSize, '0');
        const text = header + content + footer;
        const bytes = new TextEncoder().encode(text);
        expect(bytes.length).toBe(CHUNK_SIZE);
        chunks.push(bytes);
      }

      let chunkIdx = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkIdx >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(chunks[chunkIdx++]);
        },
      });

      // Record every state change so we can verify the scan cursor only
      // moves forward — never backward.
      const stateChanges: { scanStart: number; dataStart: number; bufferLength: number }[] = [];

      const eventStream = new EventStream<string>(
        stream,
        (msg) => ({ done: false, value: msg.data! }),
        {
          _onStateChange: (state) => {
            stateChanges.push({ ...state });
          },
        },
      );

      const results: string[] = [];
      const startTime = performance.now();
      for await (const value of eventStream) {
        results.push(value);
      }
      const elapsed = performance.now() - startTime;

      // (1) Correctness: every event is parsed exactly once.
      expect(results).toHaveLength(CHUNK_COUNT);
      for (let i = 0; i < CHUNK_COUNT; i++) {
        // The padded-index content is the i-th event; verify the suffix.
        const idxStr = String(i);
        expect(results[i].length).toBe(contentSize);
        expect(results[i].slice(-idxStr.length)).toBe(idxStr);
      }

      // (2) Monotonicity: the scan cursor never moves backward.
      // Any non-decreasing sequence satisfies the contract.
      let prevScanStart = -1;
      for (const s of stateChanges) {
        expect(s.scanStart).toBeGreaterThanOrEqual(prevScanStart);
        prevScanStart = s.scanStart;
      }
      let prevDataStart = -1;
      for (const s of stateChanges) {
        expect(s.dataStart).toBeGreaterThanOrEqual(prevDataStart);
        prevDataStart = s.dataStart;
      }
      // Also: scanStart must never exceed the current buffer length.
      for (const s of stateChanges) {
        expect(s.scanStart).toBeLessThanOrEqual(s.bufferLength);
      }

      // (3) Performance: 1 MB of input should parse in well under 50 ms.
      // The O(n^2) version takes > 1 s on the same input.
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('parseOpenAISSE', () => {
    it('should parse OpenAI SSE format', async () => {
      const stream = createChunkStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      const eventStream = parseOpenAISSE(stream);

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toHaveLength(2);
      expect(results[0]).toContain('Hello');
      expect(results[1]).toContain('world');
    });

    it('should stop at [DONE]', async () => {
      const stream = createChunkStream([
        'data: chunk\n\n',
        'data: [DONE]\n\n',
        'data: after-done\n\n',
      ]);
      const eventStream = parseOpenAISSE(stream);

      const results: string[] = [];
      for await (const value of eventStream) {
        results.push(value);
      }
      expect(results).toEqual(['chunk']);
    });
  });
});
