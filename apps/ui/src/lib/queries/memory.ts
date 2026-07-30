import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';
import type { ApiMemoryItem, ApiMemoryCreate } from '@/types/api';

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

export interface MemoryStats {
  total_items?: number;
  by_namespace?: Record<string, number>;
  by_source?: Record<string, number>;
  oldest_item?: string;
  newest_item?: string;
  retention_days?: number;
}

export function useMemoryItems(options?: PollOptions) {
  return useQuery({
    queryKey: keys.memory.list(),
    queryFn: () => Admin.listMemory({ limit: 100 }),
    ...options,
  });
}

export function useMemoryStats(options?: PollOptions) {
  return useQuery({
    queryKey: keys.memory.stats(),
    queryFn: () => Admin.getMemoryStats() as Promise<MemoryStats>,
    ...options,
  });
}

function useMemoryInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.memory.all });
}

export function useCreateMemory() {
  const invalidate = useMemoryInvalidation();
  return useMutation({
    mutationFn: (body: ApiMemoryCreate) => Admin.createMemory(body),
    onSuccess: invalidate,
  });
}

export function useDeleteMemory() {
  const invalidate = useMemoryInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.deleteMemory(id),
    onSuccess: invalidate,
  });
}

/**
 * Semantic search, triggered on demand (Enter / Search button) rather than a
 * `useQuery` — it's not something to poll or revalidate on focus, and its
 * "no query yet" state is meaningfully different from "query returned zero
 * results", which a query hook's data/undefined split doesn't express well.
 */
export function useSearchMemory() {
  return useMutation({
    mutationFn: (query: string) => Admin.searchMemory({ query, limit: 20 }) as Promise<ApiMemoryItem[]>,
  });
}
