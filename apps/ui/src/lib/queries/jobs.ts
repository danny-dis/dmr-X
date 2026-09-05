import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiPost } from '../api';
import { keys } from '../queryClient';

// ---------------------------------------------------------------------------
// Jobs (multi-agent job intake: /v1/jobs)
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  tenantId: string;
  source: string;
  brief: string;
  acceptanceCriteria?: unknown;
  status: string;
  budgetUsd?: number | null;
  spentUsd?: number;
  spentTokens?: number;
  result?: unknown;
  decisionLog?: Array<{ at?: string; by?: string; action?: string; [k: string]: unknown }> | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobTask {
  id: string;
  jobId: string;
  seq: number;
  title: string;
  description?: string | null;
  status: string;
  dependsOn?: string[];
  attempt?: number;
  output?: { deliverable?: { summary?: string }; [k: string]: unknown } | null;
}

export function useJobs(status?: string) {
  return useQuery({
    queryKey: keys.jobs.list(status),
    queryFn: () =>
      api<{ items: Job[]; total: number }>('/jobs', {
        query: { limit: 50, ...(status ? { status } : {}) },
      }),
    refetchInterval: 5000,
  });
}

export function useJobTasks(jobId: string | undefined) {
  return useQuery({
    queryKey: keys.jobs.tasks(jobId ?? ''),
    queryFn: () => api<JobTask[]>(`/jobs/${jobId}/tasks`),
    enabled: !!jobId,
  });
}

function useJobInvalidation() {
  const qc = useQueryClient();
  return (jobId?: string) => {
    void qc.invalidateQueries({ queryKey: keys.jobs.all });
    if (jobId) void qc.invalidateQueries({ queryKey: keys.jobs.tasks(jobId) });
  };
}

export interface CreateJobInput {
  brief: string;
  acceptanceCriteria?: string[];
}

export function useCreateJob() {
  const invalidate = useJobInvalidation();
  return useMutation({
    mutationFn: (body: CreateJobInput) => apiPost<string>('/jobs', body),
    onSuccess: invalidate,
  });
}

export function useRunJob() {
  const invalidate = useJobInvalidation();
  return useMutation({
    // Pre-staff via the Receptionist matcher before enqueueing.
    mutationFn: ({ id, coordinator }: { id: string; coordinator?: boolean }) =>
      apiPost<{ jobId: string }>(`/jobs/${id}/run`, coordinator ? { coordinator: 'receptionist' } : {}),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function usePlanJob() {
  const invalidate = useJobInvalidation();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiPost<{ jobId: string }>(`/jobs/${id}/plan`),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useCancelJob() {
  const invalidate = useJobInvalidation();
  return useMutation({
    mutationFn: (id: string) => apiPost<string>(`/jobs/${id}/cancel`),
    onSuccess: invalidate,
  });
}
