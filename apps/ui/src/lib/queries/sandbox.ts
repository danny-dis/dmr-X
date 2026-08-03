import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';
import type { ApiSandboxJob, ApiSandboxSubmit } from '@/types/api';

// ---------------------------------------------------------------------------
// Sandbox jobs
// ---------------------------------------------------------------------------

export function useSandboxJobs(options?: PollOptions) {
  return useQuery({
    queryKey: keys.sandbox.jobs(),
    queryFn: () => Admin.listSandboxJobs(),
    ...options,
  });
}

function useSandboxInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.sandbox.jobs() });
}

export function useSubmitSandboxJob() {
  const invalidate = useSandboxInvalidation();
  return useMutation({
    mutationFn: (body: ApiSandboxSubmit) => Admin.submitSandbox(body),
    onSuccess: invalidate,
  });
}

export function useCancelSandboxJob() {
  const invalidate = useSandboxInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.cancelSandbox(id),
    onSuccess: invalidate,
  });
}
