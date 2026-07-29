import { useQuery } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export function useProviders() {
  return useQuery({
    queryKey: keys.providers.list(),
    queryFn: () => Admin.listProviders(),
  });
}

export function useProvider(id: string | undefined) {
  return useQuery({
    queryKey: keys.providers.detail(id ?? ''),
    queryFn: () => Admin.getProvider(id as string),
    enabled: !!id,
  });
}
