import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';
import { Executor } from './executor.js';
import { ResourceLimiter } from './resource-limiter.js';

const cache = createNamespacedCache('sandbox');

/** Languages allowed for sandbox execution (bash/sh removed for security). */
const ALLOWED_LANGUAGES = new Set(['python', 'python3', 'node', 'javascript', 'js', 'deno', 'bun']);

/** Maximum code size in characters. */
const MAX_CODE_SIZE = 100_000;

/** Clamp timeout between 1 second and 30 seconds. */
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

/** Maximum retry count. */
const MAX_RETRIES = 3;

export interface SandboxJob {
  id: string;
  tenantId: string | null;
  language: string;
  code: string;
  status: string;
  isolationLevel: string;
  timeoutMs: number;
  maxRetries: number;
  retries: number;
  output: string | null;
  error: string | null;
  resourceCpu: number | null;
  resourceMemory: number | null;
  resourceIo: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  submittedAt: string;
}

export interface SubmitJobInput {
  tenantId?: string;
  language?: string;
  code: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class SandboxService {
  private executor: Executor;
  private limiter: ResourceLimiter;
  private maxConcurrent = 5;
  private runningCount = 0;

  constructor() {
    this.executor = new Executor();
    this.limiter = new ResourceLimiter();
  }

  async submit(input: SubmitJobInput): Promise<SandboxJob> {
    // Validate language
    const language = input.language || 'python';
    if (!ALLOWED_LANGUAGES.has(language)) {
      throw new Error(`Unsupported language: ${language}. Allowed: ${[...ALLOWED_LANGUAGES].join(', ')}`);
    }

    // Validate code
    if (!input.code || input.code.length === 0) {
      throw new Error('Code is required');
    }
    if (input.code.length > MAX_CODE_SIZE) {
      throw new Error(`Code exceeds maximum size (${MAX_CODE_SIZE} characters)`);
    }

    // Clamp timeout and retries to safe bounds
    const timeoutMs = Math.min(Math.max(input.timeoutMs || 5000, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
    const maxRetries = Math.min(Math.max(input.maxRetries ?? 2, 0), MAX_RETRIES);

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO sandbox_jobs (id, tenant_id, language, code, status, isolation_level, timeout_ms, max_retries)
      VALUES (?, ?, ?, ?, 'queued', 'process', ?, ?)
    `).run(id, input.tenantId || null, language, input.code, timeoutMs, maxRetries);

    const job = this.getById(id)!;

    if (this.runningCount < this.maxConcurrent) {
      this.runJob(id).catch(err => {
        logger.error({ error: String(err) }, `Sandbox job ${id} failed`);
      });
    }

    return job;
  }

  getById(id: string): SandboxJob | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sandbox_jobs WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  list(limit = 50): SandboxJob[] {
    const cached = cache.get('list');
    if (cached) return JSON.parse(cached);

    const db = getDb();
    const rows = db.prepare('SELECT * FROM sandbox_jobs ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
    const jobs = rows.map(r => this.mapRow(r));
    cache.set('list', JSON.stringify(jobs), 5);
    return jobs;
  }

  cancel(id: string): boolean {
    const db = getDb();
    const result = db.prepare(`
      UPDATE sandbox_jobs SET status = 'cancelled', completed_at = datetime('now')
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(id);
    cache.delete('list');
    return result.changes > 0;
  }

  private async runJob(id: string): Promise<void> {
    const db = getDb();
    this.runningCount++;

    try {
      db.prepare(`
        UPDATE sandbox_jobs SET status = 'running', started_at = datetime('now')
        WHERE id = ? AND status = 'queued'
      `).run(id);

      const job = this.getById(id);
      if (!job || job.status !== 'running') {
        // Already cancelled or picked up by another runner — don't decrement here,
        // the finally block handles it.
        return;
      }

      const resourceCheck = this.limiter.checkLimits();
      if (!resourceCheck.ok) {
        db.prepare(`
          UPDATE sandbox_jobs SET status = 'failed', error = ?, completed_at = datetime('now')
          WHERE id = ?
        `).run(resourceCheck.reason, id);
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
      } else if (result.error) {
        if (job.retries < job.maxRetries) {
          db.prepare(`
            UPDATE sandbox_jobs SET retries = retries + 1, status = 'queued'
            WHERE id = ?
          `).run(id);
          cache.delete('list');
          // Decrement before recursive call to keep count accurate
          this.runningCount--;
          this.runJob(id);
          return;
        }
        db.prepare(`
          UPDATE sandbox_jobs SET status = 'failed', error = ?, output = ?, completed_at = datetime('now')
          WHERE id = ?
        `).run(result.error, result.stdout, id);
      } else {
        db.prepare(`
          UPDATE sandbox_jobs SET status = 'completed', output = ?, completed_at = datetime('now')
          WHERE id = ?
        `).run(result.stdout, id);
      }
    } catch (err) {
      db.prepare(`
        UPDATE sandbox_jobs SET status = 'failed', error = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(String(err), id);
    } finally {
      this.runningCount--;
      cache.delete('list');
    }
  }

  private mapRow(row: any): SandboxJob {
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
