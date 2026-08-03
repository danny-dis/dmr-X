import { fetchAuthenticated } from './api';

/**
 * Authenticated Server-Sent Events reader.
 *
 * `EventSource` cannot set an Authorization header, so every SSE consumer here
 * uses `fetch` + a ReadableStream instead. That was previously reimplemented
 * four times (chat, godmode, agentic, tool-loop) with three different parsers,
 * two of which split on `\n` with no residual buffer:
 *
 *     const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
 *
 * A `data:` line straddling a chunk boundary — which happens routinely on
 * long tokens and under TCP pressure — was silently dropped, so streamed
 * replies lost text with no error anywhere. This module keeps the leftover
 * bytes and is the single implementation.
 */

export interface SSEFrame {
  /** From an `event:` line; SSE defaults this to 'message'. */
  event: string;
  /** Joined `data:` lines, newline-separated per the spec. */
  data: string;
  id?: string;
}

export interface SSEOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onFrame: (frame: SSEFrame) => void;
  /** Called once when the stream closes cleanly. */
  onDone?: () => void;
}

/** OpenAI-style terminator. Not an SSE concept, but every provider sends it. */
export const SSE_DONE = '[DONE]';

/**
 * Split a buffer into complete SSE frames, returning any partial trailer.
 *
 * Frames are separated by a blank line. Both `\n\n` and `\r\n\r\n` appear in
 * the wild, so normalise line endings before splitting rather than matching
 * one form.
 */
function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  // The final element is either an incomplete frame or '' when the buffer
  // ended exactly on a separator. Either way it is not yet safe to emit.
  const rest = parts.pop() ?? '';
  return { frames: parts.filter((p) => p.trim().length > 0), rest };
}

function parseFrame(raw: string): SSEFrame | null {
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // comment / heartbeat
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // Exactly one leading space after the colon is part of the framing.
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n'), id };
}

/**
 * Consume an SSE endpoint, invoking `onFrame` for each complete frame.
 *
 * Resolves when the stream ends. Aborting via `signal` resolves rather than
 * throwing — a user pressing Stop is not an error.
 */
export async function streamSSE(path: string, opts: SSEOptions): Promise<void> {
  const { method = 'POST', body, headers = {}, signal, onFrame, onDone } = opts;

  const res = await fetchAuthenticated(path, {
    method,
    signal,
    headers: { Accept: 'text/event-stream', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    // Read the body for a useful message — an error response is JSON, not SSE.
    const text = await res.text().catch(() => '');
    let message = `Request failed: ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      message = parsed?.error?.message ?? parsed?.message ?? message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  if (!res.body) throw new Error('Response has no body to stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // `stream: true` keeps multi-byte characters split across chunks intact.
      buffer += decoder.decode(value, { stream: true });

      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const raw of frames) {
        const frame = parseFrame(raw);
        if (frame) onFrame(frame);
      }
    }

    // Flush a final frame that arrived without a trailing blank line.
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const frame = parseFrame(buffer.replace(/\r\n/g, '\n'));
      if (frame) onFrame(frame);
    }

    onDone?.();
  } catch (err) {
    // An abort is a deliberate stop, not a failure.
    if (signal?.aborted || (err as Error)?.name === 'AbortError') {
      onDone?.();
      return;
    }
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

/**
 * Subscribe to a long-lived server-push endpoint, reconnecting with backoff.
 *
 * Used for the dashboard and telemetry streams, which must survive a gateway
 * restart. Distinct from `streamSSE`, which models one finite response.
 *
 * Returns an unsubscribe function.
 */
export function subscribeSSE(
  path: string,
  handlers: {
    onFrame: (frame: SSEFrame) => void;
    onStatus?: (status: 'connecting' | 'open' | 'closed') => void;
  },
  opts: { maxBackoffMs?: number; pauseWhenHidden?: boolean } = {},
): () => void {
  const { maxBackoffMs = 30_000, pauseWhenHidden = true } = opts;

  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;
  let stopped = false;

  const connect = async () => {
    if (stopped) return;
    if (pauseWhenHidden && typeof document !== 'undefined' && document.hidden) {
      // Don't hold a connection open for a tab nobody is looking at; the
      // visibility listener reconnects on focus.
      return;
    }

    controller = new AbortController();
    handlers.onStatus?.('connecting');

    try {
      await streamSSE(path, {
        method: 'GET',
        signal: controller.signal,
        onFrame: (frame) => {
          // Any successful frame proves the endpoint is healthy, so reset the
          // backoff — otherwise a long-lived connection that drops after an
          // hour would retry as if it had been failing all along.
          backoff = 1000;
          handlers.onStatus?.('open');
          handlers.onFrame(frame);
        },
      });
    } catch {
      // Fall through to the retry schedule below.
    }

    if (stopped) return;
    handlers.onStatus?.('closed');
    retryTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, maxBackoffMs);
  };

  const onVisibility = () => {
    if (stopped) return;
    if (!document.hidden && !controller?.signal.aborted) {
      // Returning to the tab: drop any pending retry and reconnect now.
      if (retryTimer) clearTimeout(retryTimer);
      backoff = 1000;
      void connect();
    }
  };

  if (pauseWhenHidden && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  void connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller?.abort();
    if (pauseWhenHidden && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
