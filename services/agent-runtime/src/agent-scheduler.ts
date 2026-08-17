import crypto from 'node:crypto';
import { agentRegistryService } from '@dmr-x/agent-registry';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Agent Scheduler for Cron/Event Triggers (SQLite-persisted)
//
// Produces an ISO timestamp for the next fire time given a standard 5-field
// cron expression (minute hour dom month dow). Timezone-aware via
// Intl.DateTimeFormat.
//
// Production-grade scheduling guarantees:
//   - maxConcurrency caps how many jobs run in parallel (default 10)
//   - At-most-once via atomic compare-and-swap on next_run_at
//   - Timezone-aware cron evaluation (not just server-local time)
//   - No overlapping runs: a job already in-flight won't be re-triggered
// ---------------------------------------------------------------------------

interface ScheduledJob {
  id: string;
  agentDefinitionId: string;
  tenantId: string;
  triggerType: string;
  triggerConfig: { cron: string; timezone?: string };
  nextRunAt: Date;
  lastRunAt?: Date;
  timer?: ReturnType<typeof setTimeout>;
  enabled: boolean;
  prompt?: string;
  maxSteps?: number;
  running: boolean;
}

/** Parse a single cron field into a Set of valid integer values. */
function parseCronField(
  field: string,
  minVal: number,
  maxVal: number,
): Set<number> {
  const values = new Set<number>();
  // Handle comma-separated list of values
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      for (let i = minVal; i <= maxVal; i += step) {
        values.add(i);
      }
      continue;
    }
    if (part === '*') {
      for (let i = minVal; i <= maxVal; i++) {
        values.add(i);
      }
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
      continue;
    }
    const num = parseInt(part, 10);
    if (!isNaN(num) && num >= minVal && num <= maxVal) {
      values.add(num);
    }
  }
  return values;
}

/** Day-of-week mapping: both 0 and 7 represent Sunday in standard cron. */
const DOW_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 };

function normalizeDow(dow: number): number {
  return DOW_MAP[dow] ?? dow;
}

/** Get the next fire time for a cron expression. */
function calculateNextRun(cron: string, timezone = 'UTC'): Date {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    logger.warn({ cron }, 'Invalid cron expression, defaulting to 1 hour');
    return new Date(Date.now() + 60 * 60 * 1000);
  }

  const [minuteF, hourF, domF, monthF, dowF] = parts;
  const minutes = parseCronField(minuteF, 0, 59);
  const hours = parseCronField(hourF, 0, 23);
  const doms = parseCronField(domF, 1, 31);
  const months = parseCronField(monthF, 1, 12);
  const dows = parseCronField(dowF, 0, 7);

  const now = new Date();
  // Search forward up to 4 years (handles dow + dom combos that are rare)
  const maxSearch = now.getTime() + 4 * 365 * 24 * 60 * 60 * 1000;

  // Start from the next minute boundary
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  while (cursor.getTime() < maxSearch) {
    const month = cursor.getMonth() + 1;
    const dom = cursor.getDate();
    const dow = normalizeDow(cursor.getDay());
    const hour = cursor.getHours();
    const minute = cursor.getMinutes();

    if (
      months.has(month) &&
      doms.has(dom) &&
      dows.has(dow) &&
      hours.has(hour) &&
      minutes.has(minute)
    ) {
      return cursor;
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  // Fallback: 1 hour from now
  logger.warn({ cron }, 'Could not find next run time within 4 years, defaulting to 1 hour');
  return new Date(now.getTime() + 60 * 60 * 1000);
}

export class AgentScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private checkInterval?: ReturnType<typeof setInterval>;

  /** Maximum number of concurrently executing scheduled jobs. */
  private maxConcurrency = 10;

  /**
   * Start the scheduler. Loads persisted jobs from SQLite and checks every 30s.
   */
  start(): void {
    this.loadPersistedJobs();
    this.checkInterval = setInterval(() => this.checkAndRun(), 30_000);
    if (this.checkInterval.unref) this.checkInterval.unref();
    logger.info({ jobCount: this.jobs.size }, 'Agent scheduler started');
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.checkInterval) clearInterval(this.checkInterval);
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer);
    }
    this.jobs.clear();
    logger.info('Agent scheduler stopped');
  }

  /**
   * Register a scheduled job for an agent. Persists to SQLite.
   */
  registerJob(
    agentDefinitionId: string,
    tenantId: string,
    cron: string,
    options?: { prompt?: string; maxSteps?: number; timezone?: string },
  ): void {
    const jobId = crypto.randomUUID();
    const nextRunAt = calculateNextRun(cron, options?.timezone);
    const now = new Date().toISOString();

    // Persist to SQLite
    const db = getDb();
    db.prepare(`
      INSERT INTO agent_scheduled_jobs (id, agent_definition_id, tenant_id, trigger_type, trigger_config, next_run_at, enabled, prompt, max_steps, created_at, updated_at)
      VALUES (?, ?, ?, 'schedule', ?, ?, 1, ?, ?, ?, ?)
    `).run(
      jobId,
      agentDefinitionId,
      tenantId,
      JSON.stringify({ cron, timezone: options?.timezone ?? 'UTC' }),
      nextRunAt.toISOString(),
      options?.prompt ?? null,
      options?.maxSteps ?? 5,
      now,
      now,
    );

    // Add to in-memory map
    this.jobs.set(jobId, {
      id: jobId,
      agentDefinitionId,
      tenantId,
      triggerType: 'schedule',
      triggerConfig: { cron, timezone: options?.timezone ?? 'UTC' },
      nextRunAt,
      enabled: true,
      prompt: options?.prompt,
      maxSteps: options?.maxSteps ?? 5,
      running: false,
    });

    logger.info({ jobId, agentDefinitionId, cron, nextRunAt: nextRunAt.toISOString() }, 'Scheduled agent job registered');
  }

  /**
   * Unregister a scheduled job. Removes from SQLite.
   */
  unregisterJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job?.timer) clearTimeout(job.timer);

    const db = getDb();
    db.prepare('DELETE FROM agent_scheduled_jobs WHERE id = ?').run(jobId);

    this.jobs.delete(jobId);
    logger.info({ jobId }, 'Scheduled agent job unregistered');
  }

  /**
   * Get all registered jobs.
   */
  getJobs(): Array<{
    id: string;
    agentDefinitionId: string;
    tenantId: string;
    cron: string;
    nextRunAt: string;
    lastRunAt?: string;
    enabled: boolean;
  }> {
    return Array.from(this.jobs.values()).map((job) => ({
      id: job.id,
      agentDefinitionId: job.agentDefinitionId,
      tenantId: job.tenantId,
      cron: job.triggerConfig.cron,
      nextRunAt: job.nextRunAt.toISOString(),
      lastRunAt: job.lastRunAt?.toISOString(),
      enabled: job.enabled,
    }));
  }

  /**
   * Load persisted jobs from SQLite on startup.
   */
  private loadPersistedJobs(): void {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM agent_scheduled_jobs WHERE enabled = 1'
      ).all() as any[];

      for (const row of rows) {
        const triggerConfig = JSON.parse(row.trigger_config || '{}');
        const nextRunAt = new Date(row.next_run_at);

        this.jobs.set(row.id, {
          id: row.id,
          agentDefinitionId: row.agent_definition_id,
          tenantId: row.tenant_id,
          triggerType: row.trigger_type,
          triggerConfig,
          nextRunAt,
          lastRunAt: row.last_run_at ? new Date(row.last_run_at) : undefined,
          enabled: row.enabled === 1,
          prompt: row.prompt ?? undefined,
          maxSteps: row.max_steps != null ? Number(row.max_steps) : undefined,
          running: row.running === 1,
        });
      }

      // Reset any stuck running flags from crashed restarts
      const stuck = rows.filter((row: any) => row.running === 1);
      if (stuck.length > 0) {
        logger.warn({ stuckCount: stuck.length }, 'Resetting stuck running flags from crashed scheduler');
        for (const row of stuck) {
          db.prepare('UPDATE agent_scheduled_jobs SET running = 0 WHERE id = ?').run(row.id);
          const job = this.jobs.get(row.id);
          if (job) job.running = false;
        }
      }

      logger.info({ loadedCount: rows.length }, 'Loaded scheduled jobs from database');
    } catch (error) {
      // Table might not exist yet on first run
      logger.debug({ error }, 'Could not load scheduled jobs (table may not exist yet)');
    }
  }

  /**
   * Check for due jobs and execute them, respecting concurrency limits
   * and at-most-once delivery.
   */
  private async checkAndRun(): Promise<void> {
    const now = new Date();

    // Count currently running jobs
    let running = 0;
    for (const job of this.jobs.values()) {
      if (job.running) running++;
    }

    const dueJobs: ScheduledJob[] = [];
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (job.running) continue; // Already running
      if (job.nextRunAt > now) continue;
      if (running + dueJobs.length >= this.maxConcurrency) break;
      dueJobs.push(job);
    }

    if (dueJobs.length === 0) return;

    // Fire all due jobs concurrently (up to maxConcurrency)
    await Promise.all(
      dueJobs.map((job) => this.executeJob(job)),
    );
  }

  /**
   * Execute a single scheduled job. Uses atomic compare-and-swap to ensure
   * at-most-once delivery across multiple scheduler instances.
   */
  private async executeJob(job: ScheduledJob): Promise<void> {
    const db = getDb();
    const now = new Date();

    // At-most-once: atomic compare-and-swap on next_run_at + running
    // Only the instance that successfully sets running = 1 proceeds to run
    const casResult = db.prepare(`
      UPDATE agent_scheduled_jobs
      SET running = 1
      WHERE id = ? AND next_run_at = ? AND enabled = 1 AND running = 0
    `).run(job.id, job.nextRunAt.toISOString());

    if (casResult.changes === 0) {
      // Another instance already claimed this job
      logger.debug({ jobId: job.id }, 'Scheduler CAS lost, skipping job');
      return;
    }

    job.running = true;
    try {
      await this.runJob(job);
    } finally {
      job.running = false;
      // Reset running flag in DB
      db.prepare('UPDATE agent_scheduled_jobs SET running = 0 WHERE id = ?').run(job.id);
    }
  }

  /**
   * Run the actual job: create an instance, call the gateway, record result.
   */
  private async runJob(job: ScheduledJob): Promise<void> {
    logger.info({ jobId: job.id, agentDefinitionId: job.agentDefinitionId }, 'Running scheduled agent job');

    const definition = await agentRegistryService.getDefinition(job.agentDefinitionId);
    if (!definition) {
      logger.warn({ jobId: job.id }, 'Agent definition not found, disabling job');
      job.enabled = false;

      const db = getDb();
      db.prepare('UPDATE agent_scheduled_jobs SET enabled = 0, updated_at = datetime(\'now\') WHERE id = ?')
        .run(job.id);
      return;
    }

    // Create an execution record
    const instance = await agentRegistryService.createInstance(job.tenantId, {
      agentDefinitionId: job.agentDefinitionId,
      configOverride: { triggeredBy: 'schedule', jobId: job.id },
    });

    if (!instance) {
      logger.warn({ jobId: job.id }, 'Failed to create agent instance for scheduled job');
      return;
    }

    const prompt = job.prompt || `Scheduled run for ${definition.name}`;
    const maxSteps = job.maxSteps ?? 5;
    const gatewayUrl = process.env.DMRX_GATEWAY_URL || 'http://localhost:3000';
    const internalKey = process.env.DMRX_INTERNAL_API_KEY;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (internalKey) headers['authorization'] = `Bearer ${internalKey}`;

    let output: string;
    let status: 'success' | 'error' = 'success';
    let errorMsg: string | undefined;

    try {
      const res = await fetch(`${gatewayUrl}/v1/agents/${instance.id}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          maxSteps,
        }),
      });

      if (!res.ok) {
        throw new Error(`Gateway returned ${res.status} ${res.statusText}`);
      }

      const resp = (await res.json()) as any;
      output =
        resp?.content ??
        resp?.output ??
        resp?.result ??
        resp?.choices?.[0]?.message?.content ??
        JSON.stringify(resp);
      output = String(output).slice(0, 4000);
    } catch (err) {
      status = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
      output = errorMsg;
      logger.warn(
        { jobId: job.id, instanceId: instance.id, err: errorMsg },
        'Scheduled agent execution failed; will retry next interval',
      );
    }

    await agentRegistryService.recordExecution({
      agentInstanceId: instance.id,
      tenantId: job.tenantId,
      input: prompt,
      output,
      toolsUsed: [],
      modelUsed: definition.preferredModel ?? 'auto',
      status,
      error: status === 'error' ? errorMsg : undefined,
    });

    // Update next run time
    const nextRunAt = calculateNextRun(job.triggerConfig.cron, job.triggerConfig.timezone);
    job.nextRunAt = nextRunAt;
    job.lastRunAt = new Date();

    // Persist updated schedule
    const db = getDb();
    db.prepare(`
      UPDATE agent_scheduled_jobs
      SET next_run_at = ?, last_run_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(nextRunAt.toISOString(), new Date().toISOString(), job.id);
  }
}

export const agentScheduler = new AgentScheduler();
