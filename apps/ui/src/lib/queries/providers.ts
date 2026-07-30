import { useQuery } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
//
// Several pages (Dashboard, Providers, Fusion Panel, Routing, the command
// palette) all show the same provider list at different cadences — Dashboard
// only revalidates on focus/mount, others poll every 30s or 60s. Rather than
// forking the query, each call site passes its own `refetchInterval`; the
// underlying cache entry (and in-flight request) is still shared via
// `keys.providers.list()`.

export function useProviders(options?: PollOptions) {
  return useQuery({
    queryKey: keys.providers.list(),
    queryFn: () => Admin.listProviders(),
    ...options,
  });
}

export function useProvider(id: string | undefined) {
  return useQuery({
    queryKey: keys.providers.detail(id ?? ''),
    queryFn: () => Admin.getProvider(id as string),
    enabled: !!id,
  });
}

/** Catalog of pre-configured provider templates — shared by the Providers
 * and Fusion Panel pages so both stop polling it independently. */
export function useCatalog(options?: PollOptions) {
  return useQuery({
    queryKey: keys.providers.catalog(),
    queryFn: () => Admin.getCatalog(),
    ...options,
  });
}
