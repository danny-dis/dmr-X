import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

/** Live reachability + last-run telemetry for the Needle tool pre-filter. */
export function useNeedleStatus(options?: PollOptions) {
  return useQuery({
    queryKey: keys.needle.status(),
    queryFn: () => Admin.getNeedleStatus(),
    ...options,
  });
}

/** Every built depth rung on disk, plus the active one. */
export function useNeedleRungs(options?: PollOptions) {
  return useQuery({
    queryKey: keys.needle.rungs(),
    queryFn: () => Admin.getNeedleRungs(),
    ...options,
  });
}

/** Installed vs published cactus-needle versions (PyPI, cached 10min server-side). */
export function useNeedleVersions(options?: PollOptions) {
  return useQuery({
    queryKey: keys.needle.versions(),
    queryFn: () => Admin.getNeedleVersions(),
    // Version lists change rarely; don't re-fetch on every mount.
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

/**
 * Poll a long-running job until it settles. `enabled` gates the poll so an
 * unknown/absent id doesn't hammer the gateway.
 */
export function useNeedleJob(id: string | null) {
  return useQuery({
    queryKey: keys.needle.job(id ?? 'none'),
    queryFn: () => Admin.getNeedleJob(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'succeeded' || status === 'failed' ? false : 2000;
    },
  });
}

/** Build a new depth rung. Slow (~60s) — the caller polls the returned job id. */
export function useBuildNeedleRung() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (layers: number) => Admin.buildNeedleRung(layers),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.needle.rungs() }),
  });
}

/** Switch the active rung. Fast — the sidecar reloads its caches in place. */
export function useApplyNeedleRung() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weights: string | null) => Admin.applyNeedleRung(weights),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.needle.status() });
      qc.invalidateQueries({ queryKey: keys.needle.rungs() });
    },
  });
}

/** Upgrade the cactus-needle package (allowlisted server-side). */
export function useUpgradeNeedle() {
  return useMutation({
    mutationFn: (version: string) => Admin.upgradeNeedle(version),
  });
}

/** Benchmark one or more rungs. Minutes — the caller polls the returned job id. */
export function useRunNeedleBenchmark() {
  return useMutation({
    mutationFn: (rungs: string[]) => Admin.runNeedleBenchmark(rungs),
  });
}
