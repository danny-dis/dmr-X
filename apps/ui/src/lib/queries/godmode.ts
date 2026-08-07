import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from '../queryClient';

// ---------------------------------------------------------------------------
// G0DM0D3 sidecar server
// ---------------------------------------------------------------------------

export type GodmodeServerStatus = 'not_installed' | 'stopped' | 'installing' | 'running' | 'error';

export interface GodmodeServerStatusResponse {
  status: GodmodeServerStatus;
  running: boolean;
  installed?: boolean;
  url?: string;
  runtime?: string;
  health?: { status?: string } | string;
  pid?: number;
  containerId?: string;
}

export interface GodmodeServerConfigResponse {
  baseUrl?: string;
  hasApiKey?: boolean;
  openrouterConfigured?: boolean;
  repo?: string;
  ref?: string;
}

/** GET /v1/godmode/server/updates — fork vs upstream sync health. */
export interface GodmodeUpdatesResponse {
  repo: string;
  upstream: string;
  pinnedRef: string;
  installedRef: string | null;
  forkHead: string | null;
  upstreamHead: string | null;
  behindUpstream: number | null;
  pinnedIsForkHead: boolean;
  checkedAt: string;
  error?: string;
}

export function useGodmodeServerStatus() {
  return useQuery({
    queryKey: keys.godmode.serverStatus(),
    queryFn: () => api<GodmodeServerStatusResponse>('/v1/godmode/server/status'),
    refetchInterval: 3_000,
  });
}

/** Static per-deployment config — never polled. */
export function useGodmodeServerConfig() {
  return useQuery({
    queryKey: keys.godmode.serverConfig(),
    queryFn: () => api<GodmodeServerConfigResponse>('/v1/godmode/server/config'),
  });
}

/** Deliberately NOT polled: each call costs the gateway up to three GitHub
 * API requests, and the commits it reports move at most once a night. */
export function useGodmodeServerUpdates() {
  return useQuery({
    queryKey: keys.godmode.serverUpdates(),
    queryFn: () => api<GodmodeUpdatesResponse>('/v1/godmode/server/updates'),
  });
}

export function useGodmodeServerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: 'install' | 'start' | 'stop') =>
      api<{ message?: string; url?: string }>(`/v1/godmode/server/${kind}`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.godmode.serverStatus() }),
  });
}
