import crypto from 'node:crypto';

import { logger } from '@dmr-x/utils';

/**
 * Content Capture for ML-ready event streaming.
 *
 * Captures request/response bodies per upstream call and emits them
 * as structured log records. Opt-in via env vars:
 *
 * - DMRX_CAPTURE_CONTENT=off|hashed|full  (default: off)
 * - DMRX_CAPTURE_MAX_BYTES=1048576         (default: 1MB)
 *
 * Modes:
 * - off:    No capture (zero overhead)
 * - hashed: Metadata + SHA-256 content hashes (no raw text)
 * - full:   Metadata + raw request/response bodies
 */

export type CaptureMode = 'off' | 'hashed' | 'full';

export interface CaptureEvent {
  type: 'llm_call';
  timestamp: string;
  providerId: string;
  modelId: string;
  requestId: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  statusCode: number;
  error?: string;
  requestHash?: string;
  responseHash?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  truncated?: boolean;
}

class ContentCaptureService {
  private mode: CaptureMode;
  private maxBytes: number;
  private buffer: CaptureEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushIntervalMs = 5000;

  constructor() {
    this.mode = (process.env.DMRX_CAPTURE_CONTENT as CaptureMode) || 'off';
    this.maxBytes = parseInt(process.env.DMRX_CAPTURE_MAX_BYTES || '1048576', 10);
  }

  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  getMode(): CaptureMode {
    return this.mode;
  }

  /**
   * Record a capture event. Non-blocking — failures are swallowed.
   */
  record(event: Omit<CaptureEvent, 'timestamp'>): void {
    if (this.mode === 'off') return;

    const fullEvent: CaptureEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    // Apply hashing or truncation based on mode
    if (this.mode === 'hashed') {
      if (fullEvent.requestBody !== undefined) {
        fullEvent.requestHash = this.sha256(JSON.stringify(fullEvent.requestBody));
        delete fullEvent.requestBody;
      }
      if (fullEvent.responseBody !== undefined) {
        fullEvent.responseHash = this.sha256(JSON.stringify(fullEvent.responseBody));
        delete fullEvent.responseBody;
      }
    } else if (this.mode === 'full') {
      // Truncate large bodies
      if (fullEvent.requestBody !== undefined) {
        const serialized = JSON.stringify(fullEvent.requestBody);
        if (serialized.length > this.maxBytes) {
          fullEvent.requestBody = JSON.parse(serialized.slice(0, this.maxBytes));
          fullEvent.truncated = true;
        }
      }
      if (fullEvent.responseBody !== undefined) {
        const serialized = JSON.stringify(fullEvent.responseBody);
        if (serialized.length > this.maxBytes) {
          fullEvent.responseBody = JSON.parse(serialized.slice(0, this.maxBytes));
          fullEvent.truncated = true;
        }
      }
    }

    this.buffer.push(fullEvent);

    // Flush if buffer is getting large
    if (this.buffer.length >= 50) {
      this.flush();
    }
  }

  /**
   * Start periodic flush.
   */
  startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    this.flushTimer.unref();
  }

  /**
   * Flush buffered events to the logger.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);
    for (const event of events) {
      logger.info({ capture: event }, 'content_capture');
    }
  }

  /**
   * Stop flushing and drain remaining events.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

export const contentCaptureService = new ContentCaptureService();
