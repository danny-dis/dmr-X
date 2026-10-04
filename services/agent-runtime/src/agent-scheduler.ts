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
  /** Stable hosted instance reused across schedule fires. */
  agentInstanceId?: string;
  /**
   * Deterministic key (`<jobId>:<claimed next_run_at>`) for the most recently
   * claimed fire. Persisted so a restart cannot refire an already-claimed
   * occurrence, and passed into the gateway call + execution record as an
   * idempotency key.
   */
  lastOccurrenceKey?: string;
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
    options?: { prompt?: string; maxSteps?: number; timezone?: string; agentInstanceId?: string },
  ): void {
    const jobId = crypto.randomUUID();
    const nextRunAt = calculateNextRun(cron, options?.timezone);
    const now = new Date().toISOString();

    // Persist to SQLite
    const db = getDb();
    db.prepare(`
      INSERT INTO agent_scheduled_jobs (
        id, agent_definition_id, tenant_id, trigger_type, trigger_config,
        next_run_at, enabled, prompt, max_steps, agent_instance_id, created_at, updated_at
      )
      VALUES (?, ?, ?, 'schedule', ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      agentDefinitionId,
      tenantId,
      JSON.stringify({ cron, timezone: options?.timezone ?? 'UTC' }),
      nextRunAt.toISOString(),
      options?.prompt ?? null,
      options?.maxSteps ?? 5,
      options?.agentInstanceId ?? null,
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
      agentInstanceId: options?.agentInstanceId,
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
    agentInstanceId?: string;
    lastOccurrenceKey?: string;
  }> {
    return Array.from(this.jobs.values()).map((job) => ({
      id: job.id,
      agentDefinitionId: job.agentDefinitionId,
      tenantId: job.tenantId,
      cron: job.triggerConfig.cron,
      nextRunAt: job.nextRunAt.toISOString(),
      lastRunAt: job.lastRunAt?.toISOString(),
      enabled: job.enabled,
      agentInstanceId: job.agentInstanceId,
      lastOccurrenceKey: job.lastOccurrenceKey,
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
          agentInstanceId: row.agent_instance_id ?? undefined,
          lastOccurrenceKey: row.last_occurrence_key ?? undefined,
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
   * Execute a single scheduled job. Claims the occurrence AND advances
   * `next_run_at` in one atomic compare-and-swap, then runs the job tagged with
   * the claimed occurrence key.
   *
   * Advancing at claim time (rather than after the external gateway call) is
   * what makes a crash between the call and schedule bookkeeping unable to
   * refire the same occurrence. The `running` guard still serialises
   * concurrent in-process claims; the CAS on `next_run_at` serialises across
   * processes. Delivery contract: at-most-once ADVANCEMENT per occurrence,
   * at-least-once downstream execution (a call accepted before a crash may
   * still have run) — downstream consumers must treat the occurrence key as an
   * idempotency key. Exactly-once external side effects are NOT promised.
   */
  private async executeJob(job: ScheduledJob): Promise<void> {
    const db = getDb();
    const claimedNextRun = job.nextRunAt.toISOString();
    const occurrenceKey = `${job.id}:${claimedNextRun}`;
    // Compute the advanced fire ONCE and share it with runJob so the persisted
    // row and the in-memory job cannot drift apart.
    const nextRunAt = calculateNextRun(job.triggerConfig.cron, job.triggerConfig.timezone);

    // Claim AND advance in ONE atomic UPDATE.
    const casResult = db.prepare(`
      UPDATE agent_scheduled_jobs
      SET running = 1,
          next_run_at = ?,
          last_occurrence_key = ?,
          updated_at = datetime('now')
      WHERE id = ? AND next_run_at = ? AND enabled = 1 AND running = 0
    `).run(nextRunAt.toISOString(), occurrenceKey, job.id, claimedNextRun);

    if (casResult.changes === 0) {
      // Another instance (or an earlier tick) already claimed this occurrence.
      logger.debug({ jobId: job.id }, 'Scheduler CAS lost, skipping job');
      return;
    }

    job.running = true;
    job.nextRunAt = nextRunAt;
    job.lastOccurrenceKey = occurrenceKey;
    try {
      await this.runJob(job, occurrenceKey);
    } finally {
      job.running = false;
      // Reset the running flag in DB. next_run_at is NOT touched here — it was
      // already advanced by the claim above.
      db.prepare('UPDATE agent_scheduled_jobs SET running = 0 WHERE id = ?').run(job.id);
    }
  }

  /**
   * Run the actual job: create an instance, call the gateway, record result.
   *
   * `occurrenceKey` was claimed and stamped on the job row by `executeJob`
   * before this runs. If a prior delivery of the SAME occurrence already
   * recorded an execution (duplicate delivery, or a crash-replay after the
   * claim), the gateway call is skipped — the unique index on
   * (tenant, instance, occurrence_key) is the backstop.
   */
  private async runJob(job: ScheduledJob, occurrenceKey: string): Promise<void> {
    const db = getDb();
    logger.info({ jobId: job.id, agentDefinitionId: job.agentDefinitionId, occurrenceKey }, 'Running scheduled agent job');

    const definition = await agentRegistryService.getDefinition(job.agentDefinitionId);
    if (!definition) {
      logger.warn({ jobId: job.id }, 'Agent definition not found, disabling job');
      job.enabled = false;

      db.prepare('UPDATE agent_scheduled_jobs SET enabled = 0, updated_at = datetime(\'now\') WHERE id = ?')
        .run(job.id);
      return;
    }

    // Create an execution record
    // A schedule owns a stable persistent identity. Create it once on first
    // fire, then wake/reuse the same instance on every later fire.
    let instance = job.agentInstanceId
      ? await agentRegistryService.getInstance(job.agentInstanceId)
      : null;

    // A corrupted/stale pin must never cross tenant or definition boundaries.
    // Treat it as missing and create a fresh owned instance.
    if (
      instance &&
      (instance.tenantId !== job.tenantId ||
        instance.agentDefinitionId !== job.agentDefinitionId)
    ) {
      instance = null;
      job.agentInstanceId = undefined;
    }

    if (!instance || instance.lifecycleState === 'retired') {
      instance = await agentRegistryService.createInstance(job.tenantId, {
        agentDefinitionId: job.agentDefinitionId,
        configOverride: { triggeredBy: 'schedule', jobId: job.id },
        runtimeMode: 'persistent',
        accessScope: 'private',
      });

      if (!instance) {
        logger.warn({ jobId: job.id }, 'Failed to create agent instance for scheduled job');
        return;
      }

      job.agentInstanceId = instance.id;
      db.prepare(
        'UPDATE agent_scheduled_jobs SET agent_instance_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
      ).run(instance.id, job.id);
    } else if (['paused', 'stopped'].includes(instance.lifecycleState)) {
      instance = await agentRegistryService.transitionInstanceLifecycle(
        instance.id,
        job.tenantId,
        'ready',
      );
      if (!instance) {
        logger.warn({ jobId: job.id, instanceId: job.agentInstanceId }, 'Failed to wake scheduled agent instance');
        return;
      }
    }

    // Duplicate-delivery guard: this occurrence was already recorded for this
    // instance (e.g. a redelivered tick, or a crash-replay after the claim).
    // Skip the side-effecting gateway call entirely.
    const alreadyRecorded = db.prepare(
      'SELECT id FROM agent_executions WHERE tenant_id = ? AND agent_instance_id = ? AND occurrence_key = ?',
    ).get(job.tenantId, instance.id, occurrenceKey) as any;
    if (alreadyRecorded) {
      logger.info(
        { jobId: job.id, instanceId: instance.id, occurrenceKey },
        'Scheduled occurrence already recorded, skipping duplicate delivery',
      );
      return;
    }

    const prompt = job.prompt || `Scheduled run for ${definition.name}`;
    const maxSteps = job.maxSteps ?? 5;
    const gatewayUrl = process.env.DMRX_GATEWAY_URL || 'http://localhost:3000';
    const internalKey = process.env.DMRX_INTERNAL_API_KEY;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // Deterministic idempotency key so a downstream consumer can collapse a
      // redelivered occurrence. At-least-once delivery; exactly-once external
      // side effects are not promised.
      'x-dmrx-occurrence-key': occurrenceKey,
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
          metadata: { occurrenceKey, jobId: job.id, triggeredBy: 'schedule' },
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
        'Scheduled agent execution failed; occurrence is still recorded so it is not retried',
      );
    }

    // Record the execution tagged with the occurrence key. A duplicate key is
    // rejected by the DB unique index; swallow that one specific case so a
    // racing delivery cannot turn a benign dedupe into a crash.
    try {
      await agentRegistryService.recordExecution({
        agentInstanceId: instance.id,
        tenantId: job.tenantId,
        input: prompt,
        output,
        toolsUsed: [],
        modelUsed: definition.preferredModel ?? 'auto',
        status,
        error: status === 'error' ? errorMsg : undefined,
        occurrenceKey,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('UNIQUE constraint failed')) throw err;
      logger.info({ jobId: job.id, occurrenceKey }, 'Scheduled occurrence already recorded (race), deduplicated');
    }

    job.lastRunAt = new Date();
    // next_run_at was already advanced atomically by executeJob's claim; only
    // last_run_at remains to be persisted here.
    db.prepare(
      'UPDATE agent_scheduled_jobs SET last_run_at = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).run(job.lastRunAt.toISOString(), job.id);
  }
}

export const agentScheduler = new AgentScheduler();
