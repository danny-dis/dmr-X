import { StateCreator } from 'zustand';
import type {
  PlaygroundState,
  Conversation,
} from './usePlaygroundStore';
import { api, apiPut } from '@/lib/api';

export interface ConversationsSlice {
  currentConversationId: string | null;
  conversations: Conversation[];
  createConversation: () => Promise<string>;
  loadConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
}

export const createConversationsSlice: StateCreator<PlaygroundState, [], [], ConversationsSlice> = (set, get) => ({
  currentConversationId: null,
  conversations: [],

  createConversation: async () => {
    const { mode, model, isTemporary } = get();

    const conversation = await api('/v1/conversations', {
      method: 'POST',
      body: { mode, model, isTemporary },
    });

    set(state => ({
      currentConversationId: (conversation as any).id,
      conversations: [(conversation as any), ...state.conversations],
      messages: [],
    }));

    return (conversation as any).id;
  },

  loadConversation: async (id: string) => {
    const conversation = await api(`/v1/conversations/${id}`);

    set({
      currentConversationId: id,
      messages: (conversation as any).messages || [],
      mode: (conversation as any).mode,
      model: (conversation as any).model || 'auto',
    });
  },

  deleteConversation: async (id: string) => {
    try {
      await api(`/v1/conversations/${id}`, {
        method: 'DELETE',
      });
    } catch (error: any) {
      if (error.status !== 404) {
        throw error;
      }
    }

    set(state => ({
      conversations: state.conversations.filter(c => c.id !== id),
      currentConversationId: state.currentConversationId === id ? null : state.currentConversationId,
      messages: state.currentConversationId === id ? [] : state.messages,
    }));
  },

  renameConversation: async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    // Capture the previous title so a failed write can roll back to it
    // instead of blanking the conversation's name.
    const previousTitle = get().conversations.find(c => c.id === id)?.title ?? '';

    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c
      ),
    }));

    try {
      await apiPut(`/v1/conversations/${id}`, { title: trimmed });
    } catch (_error) {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === id ? { ...c, title: previousTitle } : c
        ),
      }));
    }
  },
});
