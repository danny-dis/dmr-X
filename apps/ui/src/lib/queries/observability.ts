import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

// ---------------------------------------------------------------------------
// Alerts, audit log, telemetry
// ---------------------------------------------------------------------------
//
// Telemetry's live tail comes from `useLiveStore`'s `events`, fed by the
// single SSE subscription mounted in the app shell — this query is the
// initial page load / slow-poll fallback, not the primary path.

export function useAlerts() {
  return useQuery({
    queryKey: keys.dashboard.alerts(),
    queryFn: () => Admin.listAlerts(),
    refetchInterval: 10_000,
  });
}

export function useAuditEvents() {
  return useQuery({
    queryKey: keys.observability.audit(),
    queryFn: () => Admin.listAudit(),
    refetchInterval: 30_000,
  });
}

export function useTelemetryEvents() {
  return useQuery({
    queryKey: keys.observability.telemetry(),
    queryFn: () => Admin.listTelemetry(),
    staleTime: 30_000,
  });
}

/**
 * Alert ack/resolve is in-memory only server-side (no persistence table
 * yet), so this invalidation is mostly cosmetic — a refresh reverts it.
 * The toasts at the call site tell the user that explicitly.
 */
export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => Admin.acknowledgeAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.dashboard.alerts() }),
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => Admin.resolveAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.dashboard.alerts() }),
  });
}
