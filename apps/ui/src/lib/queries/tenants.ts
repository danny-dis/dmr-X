import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';
import type { ApiTenant, ApiKey } from '@/types/api';

// ---------------------------------------------------------------------------
// Tenants, API keys, quota & billing
// ---------------------------------------------------------------------------

export function useTenants(options?: PollOptions) {
  return useQuery({
    queryKey: keys.tenants.list(),
    queryFn: () => Admin.listTenants(),
    ...options,
  });
}

/**
 * All API keys, filtered client-side to one tenant.
 *
 * `/admin/api-keys` has no per-tenant filter server-side, so this mirrors the
 * pre-migration `useApiData` behaviour (fetch all, `.filter` by tenant) rather
 * than adding a query param the gateway doesn't support.
 */
export function useApiKeysForTenant(tenantId: string | null, options?: PollOptions) {
  return useQuery({
    queryKey: keys.apiKeys.list(),
    queryFn: () => Admin.listApiKeys(),
    select: (all: ApiKey[]) => all.filter((k) => k.tenant_id === tenantId),
    enabled: !!tenantId,
    ...options,
  });
}

export function useQuota(tenantId: string | null, options?: PollOptions) {
  return useQuery({
    queryKey: keys.quota.byTenant(tenantId ?? ''),
    queryFn: () => Admin.getQuota(tenantId as string),
    enabled: !!tenantId,
    ...options,
  });
}

export function useBilling(period: string, options?: PollOptions) {
  return useQuery({
    queryKey: keys.billing.summary(period),
    queryFn: () => Admin.getBilling(period),
    ...options,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

function useTenantInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.tenants.all });
}

export function useCreateTenant() {
  const invalidate = useTenantInvalidation();
  return useMutation({
    mutationFn: (body: Partial<ApiTenant>) => Admin.createTenant(body),
    onSuccess: invalidate,
  });
}

export function useUpdateTenant() {
  const invalidate = useTenantInvalidation();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<ApiTenant>) => Admin.updateTenant(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteTenant() {
  const invalidate = useTenantInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.deleteTenant(id),
    onSuccess: invalidate,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { tenant_id: string; name?: string; scopes?: string[]; allowed_tools?: string[] }) =>
      Admin.createApiKey(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apiKeys.all }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => Admin.revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apiKeys.all }),
  });
}
