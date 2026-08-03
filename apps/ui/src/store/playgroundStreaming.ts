import { StateCreator } from 'zustand';
import type {
  PlaygroundState,
  StreamingEvent,
} from './usePlaygroundStore';
import { apiPost } from '@/lib/api';

export interface StreamingSlice {
  isStreaming: boolean;
  abortController: AbortController | null;
  streamingEvents: StreamingEvent[];
  cancelStreaming: () => void;
  updateStreamingMessage: (content: string) => void;
  addStreamingEvent: (event: StreamingEvent) => void;
  clearStreamingEvents: () => void;
}

export const createStreamingSlice: StateCreator<PlaygroundState, [], [], StreamingSlice> = (set, get) => ({
  isStreaming: false,
  abortController: null,
  streamingEvents: [],

  cancelStreaming: () => {
    const { abortController, mode, agentInstanceId, currentConversationId } = get();
    if (abortController) {
      abortController.abort();
    }
    // Agent mode runs a durable, server-side session
    // (`/v1/agents/:instanceId/chat`) — aborting the client fetch only stops
    // us reading the response. Tell the server to stop the run too, or it
    // keeps executing (and racking up cost) after the user hit Stop.
    // Best-effort: the UI has already stopped waiting on this stream either
    // way, so a failed cancel call isn't surfaced to the user.
    if (mode === 'agent' && agentInstanceId && currentConversationId) {
      apiPost(`/v1/agents/${agentInstanceId}/chat/${currentConversationId}/cancel`, {}).catch(() => {});
    }
    set({ isStreaming: false, abortController: null });
  },

  updateStreamingMessage: (content: string) => {
    set(state => ({
      messages: state.messages.map(m =>
        m.isStreaming ? { ...m, content } : m
      ),
    }));
  },

  addStreamingEvent: (event: StreamingEvent) => {
    set(state => ({
      streamingEvents: [...state.streamingEvents, event],
      messages: state.messages.map(m =>
        m.isStreaming
          ? { ...m, events: [...(m.events ?? []), event] }
          : m
      ),
    }));
  },

  clearStreamingEvents: () => {
    set({ streamingEvents: [] });
  },
});
