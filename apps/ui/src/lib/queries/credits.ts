import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

// ---------------------------------------------------------------------------
// Credits & balance
// ---------------------------------------------------------------------------

export interface CreditBalance {
  tenantId: string;
  balanceCents: number;
  totalTopupCents: number;
  totalUsedCents: number;
}

export interface CreditTransaction {
  id: string;
  tenantId: string;
  type: 'topup' | 'usage' | 'refund' | 'adjustment';
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
  requestId: string | null;
  createdAt: string;
}

export function useCreditBalance(tenantId?: string, options?: PollOptions) {
  return useQuery({
    queryKey: keys.credits.balance(),
    queryFn: () => Admin.getCreditBalance(tenantId) as Promise<CreditBalance>,
    ...options,
  });
}

export function useCreditTransactions(opts?: { type?: string; limit?: number; offset?: number }, options?: PollOptions) {
  return useQuery({
    queryKey: keys.credits.transactions(opts),
    queryFn: () => Admin.getCreditTransactions(opts) as Promise<{ transactions: CreditTransaction[] }>,
    ...options,
  });
}

export function useTopupCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ amountCents, description }: { amountCents: number; description?: string }) =>
      Admin.topupCredits(amountCents, description),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.credits.all }),
  });
}
