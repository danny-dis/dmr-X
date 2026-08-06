import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

// ---------------------------------------------------------------------------
// Gateway settings
// ---------------------------------------------------------------------------

export function useSettings(options?: PollOptions) {
  return useQuery({
    queryKey: keys.settings.all,
    queryFn: () => Admin.getSettings(),
    ...options,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => Admin.updateSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings.all }),
  });
}

/** Live reachability + last-run telemetry for the Needle tool pre-filter —
 * polled independently of the settings form so the status card stays fresh. */
export function useNeedleStatus(options?: PollOptions) {
  return useQuery({
    queryKey: keys.needle.status(),
    queryFn: () => Admin.getNeedleStatus(),
    ...options,
  });
}

export function useRotateAdminKey() {
  return useMutation({
    mutationFn: () => Admin.rotateAdminKey(),
  });
}
