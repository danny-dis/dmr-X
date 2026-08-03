import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';
import type { ApiWorkerRegister } from '@/types/api';

// ---------------------------------------------------------------------------
// Infrastructure workers
// ---------------------------------------------------------------------------

export function useWorkers(options?: PollOptions) {
  return useQuery({
    queryKey: keys.workers.list(),
    queryFn: () => Admin.listWorkers(),
    ...options,
  });
}

export function useWorkerJobs(id: string | undefined, options?: PollOptions) {
  return useQuery({
    queryKey: keys.workers.jobs(id),
    queryFn: () => Admin.listWorkerJobs(id),
    ...options,
  });
}

function useWorkerInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.workers.all });
}

export function useRegisterWorker() {
  const invalidate = useWorkerInvalidation();
  return useMutation({
    mutationFn: (body: ApiWorkerRegister) => Admin.registerWorker(body),
    onSuccess: invalidate,
  });
}

export function useDrainWorker() {
  const invalidate = useWorkerInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.drainWorker(id),
    onSuccess: invalidate,
  });
}

export function useResumeWorker() {
  const invalidate = useWorkerInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.resumeWorker(id),
    onSuccess: invalidate,
  });
}

export function useCleanupWorkers() {
  const invalidate = useWorkerInvalidation();
  return useMutation({
    mutationFn: (daysToKeep?: number) => Admin.cleanupWorkers(daysToKeep),
    onSuccess: invalidate,
  });
}
