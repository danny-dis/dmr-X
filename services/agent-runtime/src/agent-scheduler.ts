import crypto from 'node:crypto';
import { agentRegistryService } from '@dmr-x/agent-registry';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Agent Scheduler for Cron/Event Triggers (SQLite-persisted)
// ---------------------------------------------------------------------------

interface ScheduledJob {
  id: string;
  agentDefinitionId: string;
  tenantId: string;
  triggerType: string;
  triggerConfig: { cron: string };
  nextRunAt: Date;
  lastRunAt?: Date;
  timer?: ReturnType<typeof setTimeout>;
  enabled: boolean;
  prompt?: string;
  maxSteps?: number;
}

export class AgentScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private checkInterval?: ReturnType<typeof setInterval>;

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
    options?: { prompt?: string; maxSteps?: number },
  ): void {
    const jobId = crypto.randomUUID();
    const nextRunAt = this.calculateNextRun(cron);
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
      JSON.stringify({ cron }),
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
      triggerConfig: { cron },
      nextRunAt,
      enabled: true,
      prompt: options?.prompt,
      maxSteps: options?.maxSteps ?? 5,
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
        });
      }

      logger.info({ loadedCount: rows.length }, 'Loaded scheduled jobs from database');
    } catch (error) {
      // Table might not exist yet on first run
      logger.debug({ error }, 'Could not load scheduled jobs (table may not exist yet)');
    }
  }

  /**
   * Check for due jobs and execute them.
   */
  private async checkAndRun(): Promise<void> {
    const now = new Date();
    const db = getDb();

    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (job.nextRunAt > now) continue;

      try {
        await this.runJob(job);
      } catch (error) {
        logger.error({ jobId: job.id, error }, 'Scheduled agent job failed');
      }

      // Update next run time
      const nextRunAt = this.calculateNextRun(job.triggerConfig.cron);
      job.nextRunAt = nextRunAt;
      job.lastRunAt = now;

      // Persist updated schedule
      db.prepare(`
        UPDATE agent_scheduled_jobs
        SET next_run_at = ?, last_run_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(nextRunAt.toISOString(), now.toISOString(), job.id);
    }
  }

  /**
   * Execute a scheduled job.
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
  }

  /**
   * Calculate next run time from cron expression.
   * Supports basic patterns: every N minutes, hourly, daily.
   */
  private calculateNextRun(cron: string): Date {
    const now = new Date();
    const parts = cron.split(' ');

    // "*/N * * * *" — every N minutes
    if (parts[0]?.startsWith('*/')) {
      const minutes = parseInt(parts[0].slice(2), 10);
      if (!isNaN(minutes) && minutes > 0) {
        return new Date(now.getTime() + minutes * 60 * 1000);
      }
    }

    // "N * * * *" — at minute N of every hour
    const minute = parseInt(parts[0], 10);
    if (!isNaN(minute)) {
      const next = new Date(now);
      next.setMinutes(minute, 0, 0);
      if (next <= now) next.setHours(next.getHours() + 1);
      return next;
    }

    // Default: run in 1 hour
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
}

export const agentScheduler = new AgentScheduler();
