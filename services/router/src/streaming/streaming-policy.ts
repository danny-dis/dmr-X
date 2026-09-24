// services/router/src/streaming/streaming-policy.ts
import crypto from 'node:crypto';

export interface DisconnectInfo {
  ttftMs: number | null;
  bytesReceived: number;
}

export interface OutputReservation {
  reserved: number;
  estimated: number;
}

export interface StreamRequestContext {
  /** Stable request id for logging/correlation (x-request-id). */
  requestId: string;
  /** Idempotency key: retries with the same key never create a duplicate generation. */
  idempotencyKey: string;
  bytesReceived: number;
  ttftMs: number | null;
}

/**
 * Generate a fresh idempotency key for a stream request.
 * Format: `stream_<16 hex chars>` — unique per logical generation.
 */
export function generateStreamIdempotencyKey(): string {
  return `stream_${crypto.randomBytes(8).toString('hex')}`;
}

/** Attach (or preserve) idempotency + request headers for a stream dispatch. */
export function streamHeaders(
  existing: Record<string, string> = {},
  opts: { requestId?: string; idempotencyKey?: string } = {},
): Record<string, string> {
  const requestId = opts.requestId ?? crypto.randomUUID();
  const idempotencyKey = opts.idempotencyKey ?? generateStreamIdempotencyKey();
  return {
    ...existing,
    'x-request-id': existing['x-request-id'] ?? requestId,
    'idempotency-key': existing['idempotency-key'] ?? existing['Idempotency-Key'] ?? idempotencyKey,
  };
}

export class StreamingPolicy {
  /**
   * Seen idempotency keys for in-flight/completed stream generations.
   * A retry presenting a known key is a replay — it must NOT create a
   * duplicate generation; the original result (or its status) is returned.
   */
  private seenIdempotencyKeys = new Set<string>();

  classifyDisconnect(info: DisconnectInfo): 'retryable' | 'non-retryable' {
    if (info.ttftMs === null && info.bytesReceived === 0) {
      return 'retryable';
    }
    return 'non-retryable';
  }

  reserveOutput(params: { maxTokens: number; estimatedOutputTokens: number }): OutputReservation {
    return {
      reserved: params.maxTokens,
      estimated: params.estimatedOutputTokens,
    };
  }

  shouldRetryDisconnect(info: DisconnectInfo): boolean {
    return this.classifyDisconnect(info) === 'retryable';
  }

  /**
   * Streaming replay safety (Issue #16 Task 8).
   *
   * - Before first token / zero bytes: retryable, but ONLY with the same
   *   idempotency key so the provider dedupes (no duplicate generation).
   * - After partial output: non-retryable as a new generation; resume with
   *   the same key or fail — never blindly re-dispatch.
   */
  shouldReplayWithIdempotency(
    ctx: StreamRequestContext,
  ): { replay: boolean; idempotencyKey: string; reason: string } {
    const decision = this.classifyDisconnect({ ttftMs: ctx.ttftMs, bytesReceived: ctx.bytesReceived });
    if (decision === 'retryable') {
      this.seenIdempotencyKeys.add(ctx.idempotencyKey);
      return {
        replay: true,
        idempotencyKey: ctx.idempotencyKey,
        reason: 'Pre-first-token disconnect; safe to replay with identical idempotency key',
      };
    }
    return {
      replay: false,
      idempotencyKey: ctx.idempotencyKey,
      reason: 'Partial output received; replay would duplicate generation — resume or fail, do not re-dispatch',
    };
  }

  /** True when this idempotency key was already seen (duplicate/replay). */
  isDuplicateIdempotencyKey(key: string): boolean {
    return this.seenIdempotencyKeys.has(key);
  }

  /** Register a stream generation key explicitly (e.g. at dispatch time). */
  registerIdempotencyKey(key: string): void {
    this.seenIdempotencyKeys.add(key);
  }

  clearIdempotencyKeys(): void {
    this.seenIdempotencyKeys.clear();
  }
}