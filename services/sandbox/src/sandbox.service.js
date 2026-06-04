import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';
import { Executor } from './executor.js';
import { ResourceLimiter } from './resource-limiter.js';
const cache = createNamespacedCache('sandbox');
export class SandboxService {
    executor;
    limiter;
    maxConcurrent = 5;
    runningCount = 0;
    constructor() {
        this.executor = new Executor();
        this.limiter = new ResourceLimiter();
    }
    async submit(input) {
        const db = getDb();
        const id = crypto.randomUUID();
        const language = input.language || 'python';
        const timeoutMs = input.timeoutMs || 5000;
        const maxRetries = input.maxRetries || 2;
        db.prepare(`
      INSERT INTO sandbox_jobs (id, tenant_id, language, code, status, isolation_level, timeout_ms, max_retries)
      VALUES (?, ?, ?, ?, 'queued', 'process', ?, ?)
    `).run(id, input.tenantId || null, language, input.code, timeoutMs, maxRetries);
        const job = this.getById(id);
        if (this.runningCount < this.maxConcurrent) {
            this.runJob(id).catch(err => {
                logger.error({ error: String(err) }, `Sandbox job ${id} failed`);
            });
        }
        return job;
    }
    getById(id) {
        const db = getDb();
        const row = db.prepare('SELECT * FROM sandbox_jobs WHERE id = ?').get(id);
        return row ? this.mapRow(row) : null;
    }
    list(limit = 50) {
        const cached = cache.get('list');
        if (cached)
            return JSON.parse(cached);
        const db = getDb();
        const rows = db.prepare('SELECT * FROM sandbox_jobs ORDER BY created_at DESC LIMIT ?').all(limit);
        const jobs = rows.map(r => this.mapRow(r));
        cache.set('list', JSON.stringify(jobs), 5);
        return jobs;
    }
    cancel(id) {
        const db = getDb();
        const result = db.prepare(`
      UPDATE sandbox_jobs SET status = 'cancelled', completed_at = datetime('now')
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(id);
        cache.delete('list');
        return result.changes > 0;
    }
    async runJob(id) {
        const db = getDb();
        this.runningCount++;
        try {
            db.prepare(`
        UPDATE sandbox_jobs SET status = 'running', started_at = datetime('now')
        WHERE id = ? AND status = 'queued'
      `).run(id);
            const job = this.getById(id);
            if (!job || job.status !== 'running') {
                this.runningCount--;
                return;
            }
            const resourceCheck = this.limiter.checkLimits();
            if (!resourceCheck.ok) {
                db.prepare(`
          UPDATE sandbox_jobs SET status = 'failed', error = ?, completed_at = datetime('now')
          WHERE id = ?
        `).run(resourceCheck.reason, id);
                this.runningCount--;
                cache.delete('list');
                return;
            }
            const result = await this.executor.execute({
                language: job.language,
                code: job.code,
                timeoutMs: job.timeoutMs,
            });
            if (result.cancelled) {
                db.prepare(`
          UPDATE sandbox_jobs SET status = 'cancelled', completed_at = datetime('now')
          WHERE id = ?
        `).run(id);
            }
            else if (result.error) {
                if (job.retries < job.maxRetries) {
                    db.prepare(`
            UPDATE sandbox_jobs SET retries = retries + 1, status = 'queued'
            WHERE id = ?
          `).run(id);
                    this.runningCount--;
                    cache.delete('list');
                    this.runJob(id);
                    return;
                }
                db.prepare(`
          UPDATE sandbox_jobs SET status = 'failed', error = ?, output = ?, completed_at = datetime('now')
          WHERE id = ?
        `).run(result.error, result.stdout, id);
            }
            else {
                db.prepare(`
          UPDATE sandbox_jobs SET status = 'completed', output = ?, completed_at = datetime('now')
          WHERE id = ?
        `).run(result.stdout, id);
            }
        }
        catch (err) {
            db.prepare(`
        UPDATE sandbox_jobs SET status = 'failed', error = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(String(err), id);
        }
        finally {
            this.runningCount--;
            cache.delete('list');
        }
    }
    mapRow(row) {
        const start = row.started_at ? new Date(row.started_at).getTime() : null;
        const end = row.completed_at ? new Date(row.completed_at).getTime() : null;
        return {
            id: row.id,
            tenantId: row.tenant_id,
            language: row.language,
            code: row.code,
            status: row.status,
            isolationLevel: row.isolation_level,
            timeoutMs: row.timeout_ms,
            maxRetries: row.max_retries,
            retries: row.retries,
            output: row.output,
            error: row.error,
            resourceCpu: row.resource_cpu,
            resourceMemory: row.resource_memory,
            resourceIo: row.resource_io,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            createdAt: row.created_at,
            durationMs: start && end ? end - start : null,
            submittedAt: row.created_at,
        };
    }
}
export const sandboxService = new SandboxService();
//# sourceMappingURL=sandbox.service.js.map