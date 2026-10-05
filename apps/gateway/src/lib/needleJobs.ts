/**
 * needleJobs — in-process registry for long-running Needle operations.
 *
 * Building a depth rung takes ~60s, benchmarking every rung takes minutes, and
 * a package upgrade takes ~60s plus a sidecar restart. None of those fit inside
 * a sensible HTTP request, so each is dispatched as a job and the UI polls
 * `GET /admin/needle/jobs/:id`.
 *
 * Deliberately in-memory: these are operator actions against a local sidecar,
 * and a gateway restart should forget them rather than replay a half-finished
 * build. The cap keeps a pathological caller from growing the map forever.
 */
import crypto from 'node:crypto';

export type NeedleJobKind = 'build' | 'benchmark' | 'upgrade';
export type NeedleJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface NeedleJob {
  id: string;
  kind: NeedleJobKind;
  status: NeedleJobStatus;
  /** Human-readable label, e.g. "build 8-layer rung". */
  label: string;
  startedAt: string;
  finishedAt: string | null;
  /** Latest progress line, for a UI that shows one line rather than a log. */
  progress: string | null;
  /** Parsed result on success (benchmark JSON, applied rung, new version). */
  result: unknown | null;
  error: string | null;
  log: string[];
}

const MAX_JOBS = 20;
const MAX_LOG_LINES = 400;

const jobs = new Map<string, NeedleJob>();

export function createJob(kind: NeedleJobKind, label: string): NeedleJob {
  const job: NeedleJob = {
    id: crypto.randomUUID(),
    kind,
    label,
    status: 'queued',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: null,
    result: null,
    error: null,
    log: [],
  };
  jobs.set(job.id, job);

  // Evict the oldest finished job once over the cap, so an active job is never
  // dropped in favour of a stale one.
  if (jobs.size > MAX_JOBS) {
    const finished = [...jobs.values()]
      .filter((j) => j.status === 'succeeded' || j.status === 'failed')
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const stale of finished) {
      if (jobs.size <= MAX_JOBS) break;
      jobs.delete(stale.id);
    }
  }
  return job;
}

export function getJob(id: string): NeedleJob | undefined {
  return jobs.get(id);
}

export function listJobs(): NeedleJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Append a line to the job log and mirror it into `progress`. */
export function appendLog(job: NeedleJob, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  job.log.push(trimmed);
  if (job.log.length > MAX_LOG_LINES) {
    job.log.splice(0, job.log.length - MAX_LOG_LINES);
  }
  job.progress = trimmed;
}

export function markRunning(job: NeedleJob, progress?: string): void {
  job.status = 'running';
  if (progress) job.progress = progress;
}

export function markSucceeded(job: NeedleJob, result: unknown): void {
  job.status = 'succeeded';
  job.result = result;
  job.error = null;
  job.finishedAt = new Date().toISOString();
}

export function markFailed(job: NeedleJob, error: string): void {
  job.status = 'failed';
  job.error = error;
  job.finishedAt = new Date().toISOString();
  appendLog(job, error);
}

/** True while any job of this kind is still in flight — used to serialise. */
export function hasActiveJob(kind: NeedleJobKind): boolean {
  for (const job of jobs.values()) {
    if (job.kind === kind && (job.status === 'queued' || job.status === 'running')) {
      return true;
    }
  }
  return false;
}
