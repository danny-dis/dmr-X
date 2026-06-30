export type JobPriority = 'critical' | 'high' | 'normal' | 'low';
export type JobStatus = 'pending' | 'retryable' | 'running' | 'completed' | 'failed' | 'dead_letter';

export interface QueuedJob {
  id: string;
  jobType: string;
  payload: string;
  priority: JobPriority;
  maxRetries: number;
  retries: number;
  nextRetryAt: string | null;
  backoffMs: number;
  deadLetterAt: string | null;
  enqueuedBy: string | null;
  enqueuedAt: string;
  status: JobStatus;
  workerId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface EnqueueInput {
  jobType: string;
  payload: string;
  priority?: JobPriority;
  maxRetries?: number;
  enqueuedBy?: string;
}

export interface QueueConfig {
  pollIntervalMs?: number;
  maxConcurrentJobs?: number;
}

export interface QueueStats {
  pending: number;
  retryable: number;
  running: number;
  completed: number;
  failed: number;
  deadLetter: number;
}
