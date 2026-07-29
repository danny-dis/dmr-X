import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from '../queryClient';

// ---------------------------------------------------------------------------
// A2A (Agent-to-Agent)
// ---------------------------------------------------------------------------
//
// The A2A protocol runs in the MCP sidecar on a separate port, so every call
// here goes through the gateway's admin proxy rather than to the sidecar
// directly — a browser served from :3000 has no same-origin path to :3100.

export interface A2AStatus {
  enabled: boolean;
  reachable: boolean;
  base: string;
  agentCardUrl: string | null;
  jsonRpcUrl: string | null;
  protocolVersion?: string | null;
  error?: string | null;
  /** Actionable next step when disabled or unreachable. */
  hint: string | null;
}

export interface AgentCard {
  name?: string;
  description?: string;
  url?: string;
  version?: string;
  protocolVersion?: string;
  preferredTransport?: string;
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  securitySchemes?: Record<string, unknown>;
  skills?: Array<{ id?: string; name?: string; description?: string; tags?: string[] }>;
  provider?: Record<string, unknown>;
}

export interface A2AConfig {
  enabled?: boolean;
  agentCard?: { name?: string; description?: string; url?: string; version?: string };
  taskTimeout?: number;
}

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

export interface A2ATask {
  id: string;
  contextId: string;
  status: { state: A2ATaskState; timestamp?: string; message?: unknown };
  history: unknown[];
  artifacts: unknown[];
  kind: 'task';
  metadata?: Record<string, unknown>;
}

export function useA2AStatus() {
  return useQuery({
    queryKey: keys.a2a.status(),
    queryFn: () => api<A2AStatus>('/admin/a2a/status'),
    refetchInterval: 30_000,
  });
}

export function useAgentCard(enabled: boolean) {
  return useQuery({
    queryKey: keys.a2a.agentCard(),
    queryFn: () => api<AgentCard>('/admin/a2a/agent-card'),
    // Requesting the card while A2A is off returns 409; skip rather than
    // showing the operator an error they already know about.
    enabled,
  });
}

export function useA2AConfig() {
  return useQuery({
    queryKey: keys.a2a.config(),
    queryFn: () => api<A2AConfig>('/admin/a2a/config'),
  });
}

export function useA2ATasks(state: A2ATaskState | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.a2a.tasks(state),
    queryFn: () =>
      api<{ tasks: A2ATask[]; total: number; retained: number }>('/admin/a2a/tasks', {
        query: state ? { state } : undefined,
      }),
    enabled,
    // Tasks are in-flight work; this is the one A2A view worth polling.
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
}

export function useUpdateA2AConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: A2AConfig) =>
      api<{ success: boolean; a2a: A2AConfig; requiresSidecarRestart: boolean }>('/admin/a2a/config', {
        method: 'PUT',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.a2a.all }),
  });
}

export function useCancelA2ATask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ success: boolean }>(`/admin/a2a/tasks/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.a2a.all }),
  });
}

/**
 * Fetch a remote agent's card.
 *
 * Read-only by design: DMR-X does not yet act as an A2A *client*, so this
 * confirms a peer is reachable and shows what it advertises, but nothing
 * consumes the result beyond display.
 */
export function useProbeA2APeer() {
  return useMutation({
    mutationFn: (url: string) =>
      api<{
        ok: boolean;
        url: string;
        card: AgentCard;
        summary: {
          name: string | null;
          description: string | null;
          protocolVersion: string | null;
          preferredTransport: string | null;
          capabilities: AgentCard['capabilities'] | null;
          skillCount: number;
        };
      }>('/admin/a2a/peers/probe', { method: 'POST', body: { url } }),
  });
}
