/// <reference types="node" />

/**
 * Robust SSE (Server-Sent Events) parser.
 * Ported from OpenRouter SDK's EventStream with adaptations for DMR-X.
 *
 * Handles multiple SSE boundary formats, partial chunks, multi-line data,
 * and works across Node.js, Bun, Deno, and browsers.
 */

export type SseMessage<T> = {
  data?: T | undefined;
  event?: string | null | undefined;
  id?: string | null | undefined;
  retry?: number | null | undefined;
};

/**
 * A ReadableStream that parses SSE from a raw byte stream.
 * Extends ReadableStream<T> so it can be consumed with standard APIs.
 */
export class EventStream<T> extends ReadableStream<T> {
  constructor(
    responseBody: ReadableStream<Uint8Array>,
    parse: (x: SseMessage<string>) => IteratorResult<T, undefined>,
    opts?: {
      dataRequired?: boolean;
      /**
       * Optional callback fired whenever the internal parser state advances
       * (after a read, a boundary match, or a buffer compaction). Reports
       * the current buffer length and the dataStart / scanStart cursors.
       *
       * Intended for tests and instrumentation. Not part of the stable API.
       * @internal
       */
      _onStateChange?: (state: {
        bufferLength: number;
        dataStart: number;
        scanStart: number;
        /**
         * Cumulative bytes examined by findBoundary over the lifetime of
         * the stream. The O(n) parser keeps this linear in the total
         * input size; an O(n^2) parser would make it quadratic.
         */
        totalScanned: number;
      }) => void;
    },
  ) {
    const upstream = responseBody.getReader();
    // The buffer accumulates raw bytes read from the upstream. It is a
    // monotonically-growing view: consumed bytes are eventually discarded
    // via the compaction step below (never re-scanned).
    let buffer: Uint8Array = new Uint8Array();
    // Index of the first byte of the in-progress (not yet parsed) message.
    let dataStart = 0;
    // Index of the first byte that has not yet been scanned for a boundary.
    // Bytes in [0, scanStart) are guaranteed to never be re-scanned.
    let scanStart = 0;
    // Cumulative bytes examined by findBoundary over the lifetime of the
    // stream. The O(n) parser keeps this O(n) total; an O(n^2) parser
    // (which rescanned the entire cumulative buffer on every pull) would
    // make it ~n^2/2.
    let totalScanned = 0;
    const state = { eventId: undefined as string | undefined };
    const dataRequired = opts?.dataRequired ?? true;
    const onStateChange = opts?._onStateChange;

    const emitState = () => {
      onStateChange?.({ bufferLength: buffer.length, dataStart, scanStart, totalScanned });
    };

    super({
      async pull(downstream: ReadableStreamDefaultController<T>) {
        try {
          while (true) {
            // Single-pass scan: only look at bytes from scanStart onward.
            // Total work is O(n) over the lifetime of the stream, not O(n^2).
            totalScanned += buffer.length - scanStart;
            const match = findBoundary(buffer, scanStart);
            if (!match) {
              const chunk = await upstream.read();
              if (chunk.done) return downstream.close();
              // Backtrack up to 3 bytes (the longest boundary minus 1) to
              // capture multi-byte boundaries that may straddle the boundary
              // between already-scanned and freshly-read bytes. Without this,
              // a \r at the tail of the old buffer + \n at the head of the
              // new buffer would be missed.
              scanStart = Math.max(0, buffer.length - MAX_BOUNDARY_BACKTRACK);
              buffer = concatBuffer(buffer, chunk.value);
              emitState();
              continue;
            }

            // The message spans from the start of the in-progress data
            // to the start of the boundary. dataStart may be < match.index
            // when a single event was assembled across multiple chunks.
            const message = buffer.slice(dataStart, match.index);
            const nextStart = match.index + match.length;
            dataStart = nextStart;
            scanStart = nextStart;

            // Compact the buffer to free consumed bytes. Amortized O(1)
            // per byte of consumed data over the lifetime of the stream.
            if (dataStart >= BUFFER_COMPACT_THRESHOLD) {
              buffer = buffer.slice(dataStart);
              scanStart = 0;
              dataStart = 0;
            }
            emitState();

            const item = parseMessage(message, parse, state, dataRequired);
            if (item && !item.done) return downstream.enqueue(item.value);
            if (item?.done) {
              await upstream.cancel('done');
              return downstream.close();
            }
          }
        } catch (e) {
          downstream.error(e);
          await upstream.cancel(e);
        }
      },
      cancel: (reason: unknown) => upstream.cancel(reason),
    });
  }

  // Polyfill for older runtimes that don't have async iterator on ReadableStream
  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    const fn = (ReadableStream.prototype as any)[Symbol.asyncIterator];
    if (typeof fn === 'function') return fn.call(this);

    const reader = this.getReader();
    return {
      async next() {
        const r = await reader.read();
        if (r.done) {
          reader.releaseLock();
          return { done: true, value: undefined };
        }
        return { done: false, value: r.value };
      },
      async throw(e) {
        await reader.cancel(e);
        reader.releaseLock();
        return { done: true, value: undefined };
      },
      async return() {
        await reader.cancel('done');
        reader.releaseLock();
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

function concatBuffer(a: Uint8Array, b: Uint8Array): Uint8Array {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

const CR = 13;
const LF = 10;

// All possible SSE message boundaries, ordered by specificity
const BOUNDARIES: number[][] = [
  [CR, LF, CR, LF], // \r\n\r\n
  [CR, LF, CR],      // \r\n\r
  [CR, LF, LF],      // \r\n\n
  [CR, CR, LF],      // \r\r\n
  [LF, CR, LF],      // \n\r\n
  [CR, CR],           // \r\r
  [LF, CR],           // \n\r
  [LF, LF],           // \n\n
];

// Maximum length of a single boundary in BOUNDARIES. Used to backtrack
// the scanStart cursor so multi-byte boundaries straddling the boundary
// between already-read and freshly-read bytes are not missed.
const MAX_BOUNDARY_LENGTH = BOUNDARIES.reduce((m, b) => Math.max(m, b.length), 0);

// Number of bytes to re-scan (at most) after a read so a boundary that
// starts near the tail of the previous buffer is not missed.
const MAX_BOUNDARY_BACKTRACK = MAX_BOUNDARY_LENGTH - 1;

// Threshold (in bytes) at which the cumulative buffer is compacted. Each
// compaction is O(buffer.length - dataStart), so total work is O(n) over
// the lifetime of the stream.
const BUFFER_COMPACT_THRESHOLD = 64 * 1024;

/**
 * Find the next SSE message boundary in `buf`, scanning from `start` to the
 * end of the buffer.
 *
 * Callers MUST maintain a `scanStart` cursor and pass it as `start` so bytes
 * that have already been examined are not re-scanned. With that invariant,
 * the total work over the lifetime of a stream is O(n) rather than O(n^2).
 */
function findBoundary(buf: Uint8Array, start: number): { index: number; length: number } | null {
  const len = buf.length;
  for (let i = start; i < len; i++) {
    if (buf[i] !== CR && buf[i] !== LF) continue;
    for (const boundary of BOUNDARIES) {
      if (i + boundary.length > len) continue;
      let match = true;
      for (let j = 0; j < boundary.length; j++) {
        if (buf[i + j] !== boundary[j]) {
          match = false;
          break;
        }
      }
      if (match) return { index: i, length: boundary.length };
    }
  }
  return null;
}

function parseMessage<T>(
  chunk: Uint8Array,
  parse: (x: SseMessage<string>) => IteratorResult<T, undefined>,
  state: { eventId: string | undefined },
  dataRequired: boolean,
): IteratorResult<T, undefined> | undefined {
  const text = new TextDecoder().decode(chunk);
  const lines = text.split(/\r\n|\r|\n/);
  const dataLines: string[] = [];
  const ret: SseMessage<string> = {};
  let ignore = true;

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    ignore = false;

    const i = line.indexOf(':');
    let field = line;
    let value = '';

    if (i > 0) {
      field = line.slice(0, i);
      value = line[i + 1] === ' ' ? line.slice(i + 2) : line.slice(i + 1);
    }

    if (field === 'data') dataLines.push(value);
    else if (field === 'event') ret.event = value;
    else if (field === 'id' && !value.includes('\0')) state.eventId = value;
    else if (field === 'retry' && /^\d+$/.test(value)) {
      ret.retry = Number(value);
    }
  }

  if (ignore) return;

  ret.id = state.eventId;
  if (dataLines.length) {
    ret.data = dataLines.join('\n');
  } else if (dataRequired) {
    return; // skip data-less events when data is required
  }

  return parse(ret);
}

/**
 * Convenience: parse an OpenAI-compatible SSE stream into typed messages.
 */
export function parseOpenAISSE(responseBody: ReadableStream<Uint8Array>): EventStream<string> {
  return new EventStream<string>(
    responseBody,
    (msg) => {
      if (msg.data === '[DONE]') return { done: true, value: undefined };
      return { done: false, value: msg.data! };
    },
  );
}
