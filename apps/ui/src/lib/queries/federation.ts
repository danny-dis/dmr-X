import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';
import type { ApiFederationRegister } from '@/types/api';

// ---------------------------------------------------------------------------
// Federation peers
// ---------------------------------------------------------------------------

export function useFederationNodes(options?: PollOptions) {
  return useQuery({
    queryKey: keys.federation.list(),
    queryFn: () => Admin.listFederation(),
    ...options,
  });
}

function useFederationInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.federation.all });
}

export function useRegisterFederationNode() {
  const invalidate = useFederationInvalidation();
  return useMutation({
    mutationFn: (body: ApiFederationRegister) => Admin.registerFederation(body),
    onSuccess: invalidate,
  });
}

export function useUnregisterFederationNode() {
  const invalidate = useFederationInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.unregisterFederation(id),
    onSuccess: invalidate,
  });
}

export function useHealthCheckFederationNode() {
  const invalidate = useFederationInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.healthCheckFederation(id),
    onSuccess: invalidate,
  });
}

/** Fire-and-forget — doesn't invalidate the node list, it just kicks off an
 * async sync job on the gateway with no immediately observable field. */
export function useSyncFederationBenchmark() {
  return useMutation({
    mutationFn: (id: string) => Admin.syncFederationBenchmark(id),
  });
}
