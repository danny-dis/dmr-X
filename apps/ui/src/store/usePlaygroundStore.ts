import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { createConversationsSlice } from './playgroundConversations';
import type { ConversationsSlice } from './playgroundConversations';
import { createMessagesSlice } from './playgroundMessages';
import type { MessagesSlice } from './playgroundMessages';
import { createStreamingSlice } from './playgroundStreaming';
import type { StreamingSlice } from './playgroundStreaming';
import { createUISlice } from './playgroundUI';
import type { UISlice } from './playgroundUI';

// Types
export type PlaygroundMode =
  | 'chat'
  | 'image'
  | 'embed'
  | 'tts'
  | 'rerank'
  | 'moderate'
  | 'agentic'
  | 'tool-loop'
  | 'godmode';

export interface StreamingEvent {
  name: string;
  data: any;
}

export interface PlaygroundConfig {
  temperature: number;
  maxTokens?: number;
  stream: boolean;
  tools: any[];
  // Advanced sampling / generation params (OpenAI-style). All optional;
  // only sent on the wire when non-default — see _buildRequest.
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
  responseFormat?: { type: 'text' | 'json_object' } | null;
  godmode?: {
    autotune: boolean;
    parseltongue: boolean;
    parseltongueTechnique: string;
    parseltongueIntensity: 'light' | 'medium' | 'heavy';
    stmModules: string[];
    customSystemPrompt?: string;
  };
}

export interface Conversation {
  id: string;
  title: string;
  mode: PlaygroundMode;
  model: string;
  isTemporary: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  audioUrl?: string;
  imageUrl?: string;
  embeddingData?: string;
  model?: string;
  provider?: string;
  tokensInput?: number;
  tokensOutput?: number;
  cost?: number;
  latencyMs?: number;
  routingDecision?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  isStreaming?: boolean;
  events?: StreamingEvent[];
}

export type PlaygroundState = ConversationsSlice & MessagesSlice & StreamingSlice & UISlice;

export const usePlaygroundStore = create<PlaygroundState>()(
  persist(
    (...a) => ({
      ...createConversationsSlice(...a),
      ...createMessagesSlice(...a),
      ...createStreamingSlice(...a),
      ...createUISlice(...a),
    }),
    {
      name: 'playground-storage',
      partialize: (state) => ({
        mode: state.mode,
        model: state.model,
        costFilter: state.costFilter,
        config: state.config,
        isTemporary: state.isTemporary,
        showSidebar: state.showSidebar,
        activeTab: state.activeTab,
        systemPrompt: state.systemPrompt,
      }),
    }
  )
);
