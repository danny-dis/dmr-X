import { useQuery } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from '../queryClient';

import type { Conversation } from '@/store/usePlaygroundStore';

// ---------------------------------------------------------------------------
// Playground conversations
// ---------------------------------------------------------------------------

export function useConversations() {
  return useQuery({
    queryKey: keys.conversations.list(),
    queryFn: () => api<{ conversations: Conversation[] }>('/v1/conversations'),
    refetchInterval: 30_000,
  });
}
