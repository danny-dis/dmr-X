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
  | 'godmode'
  | 'agent';

/**
 * Every valid `PlaygroundMode` value, in one place — used by the URL sync
 * (`/playground/:mode`) to validate the route param before trusting it, and
 * to fall back to `chat` for anything else (an old bookmark, a typo, a
 * conversation whose mode was removed).
 */
export const PLAYGROUND_MODE_VALUES: readonly PlaygroundMode[] = [
  'chat',
  'image',
  'embed',
  'tts',
  'rerank',
  'moderate',
  'agentic',
  'tool-loop',
  'godmode',
  'agent',
];

export function isPlaygroundMode(value: string | undefined | null): value is PlaygroundMode {
  return !!value && (PLAYGROUND_MODE_VALUES as readonly string[]).includes(value);
}

/**
 * Modes that behave like a chat transcript (turn-based, streamed into the
 * message list) as opposed to one-shot generators such as image/embed/tts.
 * `playgroundCaps.isCapabilityChatMode` imports this; it was referenced but
 * never exported, so that module failed to compile.
 */
export const CHAT_FAMILY_MODES: ReadonlySet<PlaygroundMode> = new Set<PlaygroundMode>([
  'chat',
  'agentic',
  'tool-loop',
  'godmode',
  'agent',
]);

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
  // Agent mode (`/v1/agents/:instanceId/chat`) — bounds enforced server-side
  // by AgentChatRequestSchema (maxSteps 1-50, max_cost_budget > 0).
  maxSteps?: number;
  maxCostBudget?: number;
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
  /** Set by video generation flows (GenerateButtons, VideoView). */
  videoUrl?: string;
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
        agentInstanceId: state.agentInstanceId,
        // The active conversation's identity has to survive a reload or the
        // next `sendMessage` finds `currentConversationId` null and mints a
        // brand-new conversation (see createConversationsSlice.createConversation
        // / messagesSlice.sendMessage) — every refresh "started fresh" because
        // this field was missing from the persisted partition. The message
        // list itself is intentionally NOT persisted (it can go stale/large
        // and includes ephemeral fields like isStreaming/blob URLs); instead
        // PlaygroundPage re-fetches it from the server via loadConversation()
        // on mount using this id.
        currentConversationId: state.currentConversationId,
      }),
    }
  )
);
