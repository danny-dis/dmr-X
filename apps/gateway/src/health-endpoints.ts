import type { FastifyInstance } from 'fastify';
import { getDb } from '@dmr-x/db';

export function registerHealthEndpoints(
  server: FastifyInstance,
  opts: { router: any; MEMORY_LIMIT: number },
): void {
  const { router, MEMORY_LIMIT } = opts;

  server.get('/health', async () => ({ status: 'ok' }));

  server.get('/healthz', async (_request, reply) => {
    const checks: Record<string, { status: string; detail?: string }> = {};
    let healthy = true;

    // 1) SQLite read
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      checks.db_read = { status: 'ok' };
    } catch (err) {
      checks.db_read = { status: 'fail', detail: err instanceof Error ? err.message : String(err) };
      healthy = false;
    }

    // 2) SQLite write — catches read-only filesystems / locked DB
    try {
      const db = getDb();
      const healthId = crypto.randomUUID();
      db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run(healthId, '_health_write_check');
      db.prepare("DELETE FROM tenants WHERE id = ?").run(healthId);
      checks.db_write = { status: 'ok' };
    } catch (err) {
      checks.db_write = { status: 'fail', detail: err instanceof Error ? err.message : String(err) };
      healthy = false;
    }

    // 3) Router has loaded at least one candidate (otherwise no requests can be served)
    try {
      const count = router?.getCandidateCount?.() ?? 0;
      if (count > 0) {
        checks.candidates = { status: 'ok', detail: `${count} candidates` };
      } else {
        checks.candidates = { status: 'fail', detail: 'no routing candidates loaded' };
        healthy = false;
      }
    } catch (err) {
      checks.candidates = { status: 'fail', detail: err instanceof Error ? err.message : String(err) };
      healthy = false;
    }

    // 4) Memory pressure — RSS compared against DMRX_MEMORY_LIMIT
    try {
      const rss = process.memoryUsage().rss;
      if (rss < MEMORY_LIMIT) {
        checks.memory = { status: 'ok', detail: `${Math.round(rss / 1024 / 1024)}MB / ${Math.round(MEMORY_LIMIT / 1024 / 1024)}MB` };
      } else {
        checks.memory = { status: 'fail', detail: `rss ${Math.round(rss / 1024 / 1024)}MB exceeds limit ${Math.round(MEMORY_LIMIT / 1024 / 1024)}MB` };
        healthy = false;
      }
    } catch (err) {
      checks.memory = { status: 'fail', detail: err instanceof Error ? err.message : String(err) };
    }

    const status = healthy ? 'ok' : 'degraded';
    if (!healthy) reply.status(503);
    return {
      status,
      checks,
      uptime: Math.round(process.uptime()),
    };
  });

  server.get('/ready', async (_request, reply) => {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      // Also check router has loaded candidates
      if (!router || router.getCandidateCount() === 0) {
        reply.status(503);
        return { status: 'not_ready', reason: 'no_routing_candidates' };
      }
      return { status: 'ready' };
    } catch {
      reply.status(503);
      return { status: 'not_ready' };
    }
  });

  server.get('/livez', async () => ({ status: 'alive' }));
}
