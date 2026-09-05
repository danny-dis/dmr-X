import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AgentConcurrencyOptions {
  /** Default per-tenant capacity. Overridable via DMRX_MAX_CONCURRENT_AGENT_REQUESTS. */
  defaultLimit?: number;
}

interface TenantBucket {
  active: number;
}

/**
 * Per-tenant + global request-level semaphore for the agent/agentic/tool endpoints.
 *
 * External coding tools (Claude Code, Cursor, Codex, personal agents) fire many
 * subagent requests at once. Without a cap, all of them run concurrently and can
 * exhaust provider rate limits / memory. This guard caps in-flight agent requests
 * PER TENANT (so one heavy tenant cannot starve the others) AND enforces an overall
 * GLOBAL ceiling (so the combined load across all tenants stays bounded). Over-limit
 * requests are rejected with HTTP 429 instead of silently queueing (and risking
 * dropped jobs, as the code sandbox previously did).
 */
export function createAgentConcurrencyGuard(options?: AgentConcurrencyOptions) {
  // Overall capacity across all tenants. Existing env name is preserved.
  // Default raised from 20 → 50: the old cap blocked parallel agent fleets and
  // returned 429 on nearly all agent endpoints under modest load.
  const globalLimit =
    Number(process.env.DMRX_MAX_CONCURRENT_AGENT_REQUESTS) ||
    options?.defaultLimit ||
    50;

  // Per-tenant ceiling. Defaults to the global ceiling so a single tenant behaves
  // exactly as before; the global cap then protects total capacity under multi-tenant
  // load. Overridable via DMRX_MAX_CONCURRENT_AGENT_REQUESTS_PER_TENANT.
  const perTenantLimit =
    Number(process.env.DMRX_MAX_CONCURRENT_AGENT_REQUESTS_PER_TENANT) ||
    globalLimit;

  // Per-tenant active counts.
  const buckets = new Map<string, TenantBucket>();
  // Aggregate active count across every tenant (the global ceiling).
  let globalActive = 0;

  function getBucket(tenantId: string): TenantBucket {
    let b = buckets.get(tenantId);
    if (!b) {
      b = { active: 0 };
      buckets.set(tenantId, b);
    }
    return b;
  }

  /**
   * Fastify preHandler-style guard.
   * Returns `true` if the request is admitted (and registers release on reply close),
   * `false` if rejected (and a 429 has already been sent).
   */
  function guard(request: FastifyRequest, reply: FastifyReply): boolean {
    const tenantId = (request as any).tenant?.id ?? 'anonymous';
    const bucket = getBucket(tenantId);

    // Admit only if BOTH the global ceiling and the per-tenant ceiling allow it.
    // Synchronous increment/decrement of numbers keeps this safe under Fastify's
    // concurrent requests.
    if (globalActive < globalLimit && bucket.active < perTenantLimit) {
      globalActive += 1;
      bucket.active += 1;
      const release = () => {
        globalActive = Math.max(0, globalActive - 1);
        bucket.active = Math.max(0, bucket.active - 1);
        if (bucket.active === 0) buckets.delete(tenantId);
        reply.raw.removeListener('close', release);
        reply.raw.removeListener('finish', release);
        reply.raw.removeListener('error', release);
      };
      reply.raw.once('close', release);
      reply.raw.once('finish', release);
      reply.raw.once('error', release);
      return true;
    }

    // Over limit → 429. Hijack so the route handler + error handler are skipped.
    if (!reply.hijack()) {
      // hijack unsupported (shouldn't happen on Fastify 4) — send directly.
      if (!reply.sent) {
        reply.code(429).send({
          error: {
            message: 'Agent request concurrency limit reached (tenant or global)',
            retryAfter: 1,
            code: 'agent_concurrency_limit',
          },
        });
      }
      return false;
    }
    reply.raw.statusCode = 429;
    reply.raw.setHeader('Content-Type', 'application/json');
    reply.raw.setHeader('Retry-After', '1');
    reply.raw.end(
      JSON.stringify({
        error: {
          message: 'Agent request concurrency limit reached (tenant or global)',
          retryAfter: 1,
          code: 'agent_concurrency_limit',
        },
      }),
    );
    return false;
  }

  return { guard, limit: globalLimit, perTenantLimit };
}
