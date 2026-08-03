import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';
import type { ApiPolicyRule } from '@/types/api';

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export function usePolicies(options?: PollOptions) {
  return useQuery({
    queryKey: keys.policies.list(),
    queryFn: () => Admin.listPolicies(),
    ...options,
  });
}

function usePolicyInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.policies.all });
}

export function useUpsertPolicy() {
  const invalidate = usePolicyInvalidation();
  return useMutation({
    mutationFn: (body: Partial<ApiPolicyRule>) => Admin.upsertPolicy(body),
    onSuccess: invalidate,
  });
}

export function useUpdatePolicy() {
  const invalidate = usePolicyInvalidation();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<ApiPolicyRule>) => Admin.updatePolicy(id, body),
    onSuccess: invalidate,
  });
}

export function useDeletePolicy() {
  const invalidate = usePolicyInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.deletePolicy(id),
    onSuccess: invalidate,
  });
}
