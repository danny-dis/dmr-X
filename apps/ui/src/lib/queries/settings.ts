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
