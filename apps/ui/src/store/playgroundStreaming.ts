import { StateCreator } from 'zustand';
import type {
  PlaygroundState,
  StreamingEvent,
} from './usePlaygroundStore';

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
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
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
