import { logger } from '@dmr-x/utils';

/**
 * Callback hook system for request/response lifecycle.
 *
 * Mirrors LiteLLM's callback system:
 * - Pre-request hooks (modify headers, body, auth)
 * - Post-request hooks (logging, metrics, transformation)
 * - Error hooks (error logging, retry decisions)
 * - Stream chunk hooks (per-chunk processing)
 *
 * Callbacks are configurable per model, per tenant.
 */

export interface RequestContext {
  requestId: string;
  providerId: string;
  modelId: string;
  tenantId?: string;
  userId?: string;
  teamId?: string;
  requestType: string; // 'chat', 'embedding', 'image', etc.
  messages?: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
}

export interface ResponseContext extends RequestContext {
  statusCode: number;
  latencyMs: number;
  tokens?: { promptTokens: number; completionTokens: number; totalTokens: number };
  cost?: number;
  finishReason?: string;
}

export interface ErrorContext extends RequestContext {
  error: Error;
  statusCode?: number;
  retryable: boolean;
}

export interface StreamChunkContext extends RequestContext {
  chunkIndex: number;
  token: string;
}

export type PreRequestHook = (ctx: RequestContext, body: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
export type PostRequestHook = (ctx: ResponseContext, body: unknown) => Promise<void> | void;
export type ErrorHook = (ctx: ErrorContext) => Promise<void> | void;
export type StreamChunkHook = (ctx: StreamChunkContext) => Promise<void> | void;

interface CallbackEntry {
  id: string;
  name: string;
  priority: number;
  preRequest?: PreRequestHook;
  postRequest?: PostRequestHook;
  onError?: ErrorHook;
  onStreamChunk?: StreamChunkHook;
  enabled: boolean;
  modelFilter?: string[];  // null = all models
  tenantFilter?: string[];  // null = all tenants
}

export class CallbackManager {
  private callbacks: CallbackEntry[] = [];
  private idCounter = 0;

  /**
   * Register a callback hook.
   */
  register(entry: Omit<CallbackEntry, 'id'>): string {
    const id = `cb_${++this.idCounter}`;
    this.callbacks.push({ ...entry, id });
    this.callbacks.sort((a, b) => b.priority - a.priority);
    logger.debug({ id, name: entry.name }, 'Callback registered');
    return id;
  }

  /**
   * Unregister a callback.
   */
  unregister(id: string): void {
    this.callbacks = this.callbacks.filter(c => c.id !== id);
  }

  /**
   * Run all pre-request hooks.
   */
  async runPreRequest(ctx: RequestContext, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let result = { ...body };
    for (const cb of this.callbacks) {
      if (!cb.enabled || !cb.preRequest) continue;
      if (!this.matchesFilter(ctx, cb)) continue;
      try {
        result = await cb.preRequest(ctx, result);
      } catch (err) {
        logger.warn({ err, callbackId: cb.id, callbackName: cb.name }, 'Pre-request hook failed');
      }
    }
    return result;
  }

  /**
   * Run all post-request hooks.
   */
  async runPostRequest(ctx: ResponseContext, body: unknown): Promise<void> {
    for (const cb of this.callbacks) {
      if (!cb.enabled || !cb.postRequest) continue;
      if (!this.matchesFilter(ctx, cb)) continue;
      try {
        await cb.postRequest(ctx, body);
      } catch (err) {
        logger.warn({ err, callbackId: cb.id, callbackName: cb.name }, 'Post-request hook failed');
      }
    }
  }

  /**
   * Run all error hooks.
   */
  async runOnError(ctx: ErrorContext): Promise<void> {
    for (const cb of this.callbacks) {
      if (!cb.enabled || !cb.onError) continue;
      if (!this.matchesFilter(ctx, cb)) continue;
      try {
        await cb.onError(ctx);
      } catch (err) {
        logger.warn({ err, callbackId: cb.id, callbackName: cb.name }, 'Error hook failed');
      }
    }
  }

  /**
   * Run all stream chunk hooks.
   */
  async runOnStreamChunk(ctx: StreamChunkContext): Promise<void> {
    for (const cb of this.callbacks) {
      if (!cb.enabled || !cb.onStreamChunk) continue;
      if (!this.matchesFilter(ctx, cb)) continue;
      try {
        await cb.onStreamChunk(ctx);
      } catch (err) {
        // Silent — don't break streaming for hook failures
      }
    }
  }

  /**
   * List all registered callbacks.
   */
  list(): Array<{ id: string; name: string; enabled: boolean; priority: number }> {
    return this.callbacks.map(c => ({
      id: c.id,
      name: c.name,
      enabled: c.enabled,
      priority: c.priority,
    }));
  }

  /**
   * Enable/disable a callback.
   */
  setEnabled(id: string, enabled: boolean): void {
    const cb = this.callbacks.find(c => c.id === id);
    if (cb) cb.enabled = enabled;
  }

  private matchesFilter(ctx: RequestContext, cb: CallbackEntry): boolean {
    if (cb.modelFilter && cb.modelFilter.length > 0) {
      if (!cb.modelFilter.includes(ctx.modelId)) return false;
    }
    if (cb.tenantFilter && cb.tenantFilter.length > 0) {
      if (ctx.tenantId && !cb.tenantFilter.includes(ctx.tenantId)) return false;
    }
    return true;
  }
}

export const callbackManager = new CallbackManager();
