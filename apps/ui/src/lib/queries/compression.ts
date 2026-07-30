import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

// ---------------------------------------------------------------------------
// Headroom context compression
// ---------------------------------------------------------------------------

export interface CompressionConfig {
  enabled: boolean;
  proxyUrl: string;
  apiKey?: string;
  reversible: boolean;
  minTokensToCompress: number;
}

export interface CompressionStats {
  totalRequests: number;
  totalTokensSaved: number;
  avgCompressionRatio: number;
}

export function useCompressionConfig(options?: PollOptions) {
  return useQuery({
    queryKey: keys.compression.config(),
    queryFn: () => api<CompressionConfig>('/v1/compression/config'),
    ...options,
  });
}

export function useCompressionStats(options?: PollOptions) {
  return useQuery({
    queryKey: keys.compression.stats(),
    queryFn: () => api<CompressionStats>('/v1/compression/stats'),
    ...options,
  });
}

export function useUpdateCompressionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Partial<CompressionConfig>) =>
      api<CompressionConfig>('/v1/compression/config', { method: 'PUT', body: config }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.compression.config() }),
  });
}

export function useCleanupCompressionCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/v1/compression/cleanup', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.compression.stats() }),
  });
}
