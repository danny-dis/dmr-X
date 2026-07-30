import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { FusionPanel as FusionPanelApi } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

// ---------------------------------------------------------------------------
// Fusion panels
// ---------------------------------------------------------------------------

export function useFusionPanels(options?: PollOptions) {
  return useQuery({
    queryKey: keys.fusionPanels.list(),
    queryFn: () => FusionPanelApi.list(),
    ...options,
  });
}

function useFusionPanelInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.fusionPanels.all });
}

export function useCreateFusionPanel() {
  const invalidate = useFusionPanelInvalidation();
  return useMutation({
    mutationFn: (body: Parameters<typeof FusionPanelApi.create>[0]) => FusionPanelApi.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateFusionPanel() {
  const invalidate = useFusionPanelInvalidation();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof FusionPanelApi.update>[1]) =>
      FusionPanelApi.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteFusionPanel() {
  const invalidate = useFusionPanelInvalidation();
  return useMutation({
    mutationFn: (id: string) => FusionPanelApi.delete(id),
    onSuccess: invalidate,
  });
}

export function useAddFusionSlot() {
  const invalidate = useFusionPanelInvalidation();
  return useMutation({
    mutationFn: ({ panelId, ...body }: { panelId: string } & Parameters<typeof FusionPanelApi.addSlot>[1]) =>
      FusionPanelApi.addSlot(panelId, body),
    onSuccess: invalidate,
  });
}

export function useRemoveFusionSlot() {
  const invalidate = useFusionPanelInvalidation();
  return useMutation({
    mutationFn: ({ panelId, slotId }: { panelId: string; slotId: string }) =>
      FusionPanelApi.removeSlot(panelId, slotId),
    onSuccess: invalidate,
  });
}

export function useReorderFusionSlots() {
  const invalidate = useFusionPanelInvalidation();
  return useMutation({
    mutationFn: ({ panelId, slotIds }: { panelId: string; slotIds: string[] }) =>
      FusionPanelApi.reorderSlots(panelId, slotIds),
    onSuccess: invalidate,
  });
}
