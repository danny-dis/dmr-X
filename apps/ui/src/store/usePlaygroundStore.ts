import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { Admin } from '@/lib/admin';
import { api, apiPost, apiPut, apiDelete, fetchAuthenticated } from '@/lib/api';

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
  | 'godmode';  // G0DM0D3 integration

/**
 * A single SSE event parsed from a streaming response.
 *
 * Used for the `agentic` (`/v1/agentic/chat`) and `tool-loop` (`/v1/tools/loop`)
 * endpoints, both of which emit SSE events like `turn`, `step`, `tool_calls`,
 * `tool_results`, `approval_required`, `error`, and `done`. The Playground
 * stores the full list on the assistant message so the UI can render a
 * compact event trace below the final response.
 */
export interface StreamingEvent {
  name: string;
  data: any;
}

export interface PlaygroundConfig {
  temperature: number;
  maxTokens?: number;
  stream: boolean;
  /**
   * OpenAI-format tool definitions the user has supplied in the Playground.
   * Sent verbatim on the `tools` field of chat, agentic, and tool-loop
   * request bodies. Empty by default — `tool-loop` requires at least one
   * entry server-side (Zod `min(1)`), so the UI's tools picker gates that
   * mode on a non-empty array.
   */
  tools: any[];
  /**
   * G0DM0D3 pipeline settings (only used when mode = 'godmode')
   */
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
  /**
   * SSE events captured while streaming an `agentic` or `tool-loop` request.
   * Each entry is one parsed event from the server's event-stream response.
   * The first cut is purely UI-side — the server doesn't persist this.
   */
  events?: StreamingEvent[];
}

interface PlaygroundState {
  // Current session
  currentConversationId: string | null;
  conversations: Conversation[];
  messages: Message[];
  
  // UI state
  mode: PlaygroundMode;
  model: string;
  config: PlaygroundConfig;
  /** Cost filter for meta-model aliases: 'all' (paid + free) or 'free' (zero-cost only). */
  costFilter: 'all' | 'free';
  isTemporary: boolean;
  isStreaming: boolean;
  showSidebar: boolean;
  /**
   * Abort controller for the active streaming request. Updated whenever a
   * new turn starts; `cancelStreaming` reads it to abort. Not persisted
   * (a stale AbortController on the next session would be useless) and
   * kept here as state (not just a closure variable) so any action can
   * grab the current one via `get().abortController`.
   */
  abortController: AbortController | null;

  /**
   * Buffer of SSE events received during the current streaming response.
   * Mirrored onto the assistant message's `events` field in real time so the
   * UI can render the event trace as it arrives. Cleared when a new stream
   * starts or when the current one finishes.
   */
  streamingEvents: StreamingEvent[];

  // Actions
  createConversation: () => Promise<string>;
  loadConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  toggleTemporary: () => void;
  setMode: (mode: PlaygroundMode) => void;
  setModel: (model: string) => void;
  setCostFilter: (filter: 'all' | 'free') => void;
  setConfig: (config: Partial<PlaygroundConfig>) => void;
  setTools: (tools: any[]) => void;
  setGodmodeConfig: (godmode: Partial<PlaygroundConfig['godmode']>) => void;
  setShowSidebar: (show: boolean) => void;
  clearMessages: () => void;
  /**
   * Pending prompt seeded by external UI (e.g. the sample-prompt tiles in
   * EmptyState). PlaygroundInput consumes this on mount/change and clears
   * it once applied. Lets the empty-state tiles populate the input
   * without having to lift the prompt state out of PlaygroundInput.
   */
  pendingPrompt: string;
  setPromptSeed: (prompt: string) => void;
  consumePromptSeed: () => string | null;

  // Streaming
  cancelStreaming: () => void;
  updateStreamingMessage: (content: string) => void;
  addStreamingEvent: (event: StreamingEvent) => void;
  clearStreamingEvents: () => void;

  addMessagesBatch: (conversationId: string, messages: Message[]) => Promise<void>;

  // Internal helpers shared by sendMessage and regenerateMessage. The
  // underscore is a convention; they're part of the store interface so
  // `get()._helper(...)` resolves at the type level.
  _createAssistantPlaceholder: (conversationId: string) => Message;
  _buildRequest: (opts: {
    content: string;
    history: Message[];
    mode: PlaygroundMode;
    model: string;
    config: PlaygroundConfig;
  }) => { endpoint: string; body: any };
  _streamToEndpoint: (opts: {
    endpoint: string;
    body: any;
    mode: PlaygroundMode;
    model: string;
    config: PlaygroundConfig;
    conversationId: string;
    assistantMessageId: string;
  }) => Promise<void>;
}

export const usePlaygroundStore = create<PlaygroundState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentConversationId: null,
      conversations: [],
      messages: [],
      mode: 'chat',
      model: 'auto',
      config: {
        temperature: 0.7,
        stream: true,
        tools: [],
        godmode: {
          autotune: true,
          parseltongue: true,
          parseltongueTechnique: 'leetspeak',
          parseltongueIntensity: 'medium',
          stmModules: ['hedge_reducer', 'direct_mode'],
        },
      },
      costFilter: 'all',
      isTemporary: false,
      isStreaming: false,
      showSidebar: true,
      streamingEvents: [],
      pendingPrompt: '',

      // Abort controller for streaming. See the interface comment.
      abortController: null,
      
      // Create new conversation
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
      
      // Load conversation
      loadConversation: async (id: string) => {
        const conversation = await api(`/v1/conversations/${id}`);
        
        set({
          currentConversationId: id,
          messages: (conversation as any).messages || [],
          mode: (conversation as any).mode,
          model: (conversation as any).model || 'auto',
        });
      },
      
      // Send message
      sendMessage: async (content: string) => {
        const { currentConversationId, mode, model, config, messages } = get();

        let conversationId = currentConversationId;

        // Create conversation if needed
        if (!conversationId) {
          conversationId = await get().createConversation();
        }

        // Add user message to local state
        const userMessage: Message = {
          id: crypto.randomUUID(),
          conversationId: conversationId!,
          role: 'user',
          content,
          createdAt: new Date().toISOString(),
        };

        const historyWithUser = [...messages, userMessage];
        set({ messages: historyWithUser });

        const assistantMessage = get()._createAssistantPlaceholder(conversationId!);

        // Build endpoint + body for this turn. We pass `historyWithUser`
        // as the conversation history so the body matches what was just
        // committed to the messages array (matters for chat/agentic/tool-loop).
        const req = get()._buildRequest({
          content,
          history: historyWithUser,
          mode,
          model,
          config,
        });

        await get()._streamToEndpoint({
          ...req,
          mode,
          model,
          config,
          conversationId: conversationId!,
          assistantMessageId: assistantMessage.id,
        });
      },
      
      // Delete conversation
      deleteConversation: async (id: string) => {
        try {
          await api(`/v1/conversations/${id}`, {
            method: 'DELETE',
          });
        } catch (error: any) {
          // If conversation doesn't exist (404), treat as already deleted
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
      
      // Toggle temporary mode
      toggleTemporary: () => {
        set(state => ({ isTemporary: !state.isTemporary }));
      },
      
      // Set mode
      setMode: (mode: PlaygroundMode) => {
        set({ mode, messages: [], currentConversationId: null });
      },
      
      // Set model
      setModel: (model: string) => {
        set({ model });
      },

      // Set cost filter
      setCostFilter: (filter: 'all' | 'free') => {
        set({ costFilter: filter });
      },

      // Set config
      setConfig: (config: Partial<PlaygroundConfig>) => {
        set(state => ({ config: { ...state.config, ...config } }));
      },

      // Set the tools array on the config. Convenience over `setConfig`
      // for the tools picker so the UI doesn't have to spread a partial.
      setTools: (tools: any[]) => {
        set(state => ({ config: { ...state.config, tools } }));
      },

      // Set godmode config
      setGodmodeConfig: (godmode: Partial<PlaygroundConfig['godmode']>) => {
        set(state => ({
          config: {
            ...state.config,
            godmode: { ...state.config.godmode!, ...godmode },
          },
        }));
      },

      // Set show sidebar
      setShowSidebar: (show: boolean) => {
        set({ showSidebar: show });
      },
      
      // Clear messages
      clearMessages: () => {
        set({ messages: [], currentConversationId: null });
      },
      
      // Cancel streaming
      cancelStreaming: () => {
        const { abortController } = get();
        if (abortController) {
          abortController.abort();
        }
        set({ isStreaming: false, abortController: null });
      },
      
      // Update streaming message
      updateStreamingMessage: (content: string) => {
        set(state => ({
          messages: state.messages.map(m =>
            m.isStreaming ? { ...m, content } : m
          ),
        }));
      },

      // Append an SSE event to the active streaming message and to the
      // streamingEvents buffer. Used by the agentic/tool-loop SSE path so
      // the event trace renders live as the server emits events.
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

      // Reset the streamingEvents buffer. Called at the start of an
      // agentic/tool-loop stream so each new run starts with a clean slate.
      clearStreamingEvents: () => {
        set({ streamingEvents: [] });
      },

      addMessagesBatch: async (conversationId: string, messages: Message[]) => {
        await Admin.batchAddMessages(conversationId, messages);
        set(state => ({
          messages: [...state.messages, ...messages],
        }));
      },

      // Append a fresh assistant-message placeholder to the active
      // conversation. Used by both `sendMessage` and `regenerateMessage` to
      // seed the streaming target.
      _createAssistantPlaceholder: (conversationId: string): Message => {
        const assistant: Message = {
          id: crypto.randomUUID(),
          conversationId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          isStreaming: true,
        };
        set(state => ({
          messages: [...state.messages, assistant],
          isStreaming: true,
        }));
        return assistant;
      },

      // Build the request body and pick the right endpoint for the current
      // mode. The `history` argument is the full messages list INCLUDING
      // the user message we are about to send — this matches the existing
      // `sendMessage` behaviour and is what regenerateMessage relies on
      // (it passes a truncated list with the original user message at the
      // tail so we resend the same prompt with the same history).
      _buildRequest: (opts: {
        content: string;
        history: Message[];
        mode: PlaygroundMode;
        model: string;
        config: PlaygroundConfig;
      }): { endpoint: string; body: any } => {
        const { content, history, mode, model, config } = opts;
        let endpoint = '/v1/chat/completions';
        let body: any = { model, stream: config.stream };

        if (mode === 'chat') {
          // Include conversation history for context
          const hist = history.map(m => ({ role: m.role, content: m.content }));
          body.messages = [...hist, { role: 'user', content }];
          body.temperature = config.temperature;
          if (config.maxTokens) body.max_tokens = config.maxTokens;
          // Pass through user-defined tools for the regular chat path.
          // Only include the field when non-empty so we don't surprise
          // downstream providers that reject an empty `tools` array.
          if (Array.isArray(config.tools) && config.tools.length > 0) body.tools = config.tools;
        } else if (mode === 'image') {
          endpoint = '/v1/images/generations';
          body.prompt = content;
        } else if (mode === 'tts') {
          endpoint = '/v1/audio/speech';
          body.input = content;
          body.voice = 'alloy';
        } else if (mode === 'embed') {
          endpoint = '/v1/embeddings';
          body.input = content;
        } else if (mode === 'rerank') {
          endpoint = '/v1/rerank';
          body.query = content;
          body.documents = ['Example doc 1', 'Example doc 2'];
        } else if (mode === 'moderate') {
          endpoint = '/v1/moderations';
          body = { input: content };
        } else if (mode === 'agentic') {
          // Multi-turn agentic loop with optional tool calling. The server
          // streams SSE events (turn, tool_calls, tool_results,
          // approval_required, error, done) that we render below the final
          // message content.
          endpoint = '/v1/agentic/chat';
          const hist = history.map(m => ({ role: m.role, content: m.content }));
          body = {
            model,
            messages: [...hist, { role: 'user', content }],
            tools: config.tools,
            max_steps: 10,
            temperature: config.temperature,
            stream: true,
          };
          if (config.maxTokens) body.max_tokens = config.maxTokens;
        } else if (mode === 'tool-loop') {
          // Multi-turn tool execution loop. The server streams SSE events
          // (step, tool_results, error, done). The `tools` field is
          // required (`min(1)` server-side) — the UI's tools picker is
          // responsible for ensuring a non-empty array is defined for
          // this mode, so we just pass `config.tools` through.
          endpoint = '/v1/tools/loop';
          const hist = history.map(m => ({ role: m.role, content: m.content }));
          body = {
            model,
            messages: [...hist, { role: 'user', content }],
            tools: config.tools,
            max_steps: 10,
            temperature: config.temperature,
            stream: true,
          };
          if (config.maxTokens) body.max_tokens = config.maxTokens;
        } else if (mode === 'godmode') {
          // G0DM0D3 integration — uses the godmode chat endpoint with
          // AutoTune, Parseltongue, and STM pipeline settings.
          endpoint = '/v1/godmode/chat';
          const hist = history.map(m => ({ role: m.role, content: m.content }));
          body = {
            messages: [...hist, { role: 'user', content }],
            stream: config.stream,
            godmode: config.godmode?.autotune ?? true,
            autotune: config.godmode?.autotune ?? true,
            parseltongue: config.godmode?.parseltongue ?? true,
            parseltongue_technique: config.godmode?.parseltongueTechnique ?? 'leetspeak',
            parseltongue_intensity: config.godmode?.parseltongueIntensity ?? 'medium',
            stm_modules: config.godmode?.stmModules ?? ['hedge_reducer', 'direct_mode'],
          };
          if (config.godmode?.customSystemPrompt) {
            body.custom_system_prompt = config.godmode.customSystemPrompt;
          }
          if (config.maxTokens) body.max_tokens = config.maxTokens;
        }

        return { endpoint, body };
      },

      // The three streaming paths (agentic/tool-loop SSE, chat stream,
      // non-streaming) all funnel through this helper. The caller is
      // responsible for putting the assistant-message placeholder into the
      // store; this method writes back the final content/metadata and
      // persists to the DB.
      _streamToEndpoint: async (opts: {
        endpoint: string;
        body: any;
        mode: PlaygroundMode;
        model: string;
        config: PlaygroundConfig;
        conversationId: string;
        assistantMessageId: string;
      }) => {
        const { endpoint, body, mode, model, config, conversationId, assistantMessageId } = opts;

        // Fresh AbortController per turn so a stale controller from a
        // previous (cancelled or completed) stream doesn't cancel the new
        // request. The store-level `cancelStreaming` still works because it
        // reads whatever the latest controller is.
        const abortController = new AbortController();
        set({ abortController });

        const start = performance.now();

        // Pass the cost filter as a request header when set to 'free'.
        const costFilter = get().costFilter;
        const extraHeaders: Record<string, string> = costFilter === 'free'
          ? { 'x-cost-filter': 'free' }
          : {};

        try {
          if (mode === 'agentic' || mode === 'tool-loop') {
            // SSE-parse path. The event-stream format is:
            //   event: <name>\ndata: <json>\n\n
            // with each event blank-line terminated. We accumulate partial
            // chunks in `buffer` and split on \n\n; the last fragment may
            // be incomplete so we keep it in the buffer for the next read.
            get().clearStreamingEvents();

            // Pass the conversation ID so the backend can maintain
            // in-memory state across multi-turn agentic/tool-loop requests.
            body.conversationId = conversationId;

            const response = await fetchAuthenticated(endpoint, {
              method: 'POST',
              body: JSON.stringify(body),
              signal: abortController.signal,
              headers: extraHeaders,
            });

            if (!response.ok || !response.body) {
              const errText = await response.text().catch(() => response.statusText);
              throw new Error(`Stream failed: ${response.status} ${errText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            // The final assistant text is the content of the last "primary"
            // event the server emits (`turn` for agentic, `step` for
            // tool-loop). Earlier events may carry intermediate text but the
            // server breaks the loop after the model stops calling tools, so
            // the last such event is the final answer.
            let lastContent = '';
            let lastModel = model;
            let lastUsage: any = null;
            // Capture the first error event so we can surface it after the
            // stream closes; the server usually follows with `done`, so we
            // don't want to abort on a single error event.
            let firstErrorMessage: string | null = null;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const rawEvents = buffer.split('\n\n');
              buffer = rawEvents.pop() ?? '';

              for (const evt of rawEvents) {
                const lines = evt.split('\n');
                let name = 'message';
                let data = '';
                for (const line of lines) {
                  if (line.startsWith('event: ')) name = line.slice(7).trim();
                  else if (line.startsWith('data: ')) data = line.slice(6).trim();
                }
                if (data === '[DONE]') continue;
                if (!data) continue;

                let parsed: any = {};
                try {
                  parsed = JSON.parse(data);
                } catch {
                  // Malformed JSON — skip rather than abort the stream.
                  continue;
                }

                get().addStreamingEvent({ name, data: parsed });

                if (name === 'error' && parsed?.error?.message) {
                  if (firstErrorMessage === null) firstErrorMessage = parsed.error.message;
                  continue;
                }

                // Extract the final assistant text + metadata from the
                // primary events. The server emits `turn` for agentic and
                // `step` for tool-loop; each carries the model response for
                // that iteration. We keep the latest one because the loop
                // terminates when the model stops calling tools, so the
                // last such event is the final response.
                if (mode === 'agentic' && name === 'turn' && parsed.message) {
                  const text = typeof parsed.message.content === 'string'
                    ? parsed.message.content
                    : '';
                  if (text) lastContent = text;
                  if (parsed.model) lastModel = parsed.model;
                  if (parsed.usage) lastUsage = parsed.usage;
                } else if (mode === 'tool-loop' && name === 'step' && parsed.choices?.[0]?.message) {
                  const text = parsed.choices[0].message.content;
                  if (typeof text === 'string' && text) lastContent = text;
                  if (parsed.model) lastModel = parsed.model;
                  if (parsed.usage) lastUsage = parsed.usage;
                }
              }
            }

            const latency = performance.now() - start;
            const finalContent = firstErrorMessage
              ? `Error: ${firstErrorMessage}`
              : lastContent;

            // Update final message — copy the events list to the message
            // itself (clearing the streaming buffer) and stamp the basic
            // metadata. The events list is what PlaygroundMain renders.
            const capturedEvents = get().streamingEvents;
            set(state => ({
              messages: state.messages.map(m =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      content: finalContent,
                      events: capturedEvents,
                      isStreaming: false,
                      latencyMs: latency,
                      model: lastModel,
                      tokensInput: lastUsage?.prompt_tokens,
                      tokensOutput: lastUsage?.completion_tokens,
                    }
                  : m
              ),
              isStreaming: false,
              streamingEvents: [],
            }));

            // Persist to DB. The event trace is sent in the `events` field
            // so reloads restore the full agentic/tool-loop trace. We
            // strip the field when empty so the server stores NULL rather
            // than an empty JSON array — matching the "no events captured"
            // signal and keeping column size down.
            await apiPost(`/v1/conversations/${conversationId}/messages`, {
                role: 'assistant',
                content: finalContent,
                model: lastModel,
                latencyMs: latency,
                tokensInput: lastUsage?.prompt_tokens,
                tokensOutput: lastUsage?.completion_tokens,
                events: capturedEvents && capturedEvents.length > 0 ? capturedEvents : undefined,
              });
          } else if (config.stream && mode === 'chat') {
            // Streaming response
            const response = await fetchAuthenticated(endpoint, {
              method: 'POST',
              body: JSON.stringify(body),
              signal: abortController.signal,
              headers: extraHeaders,
            });

            if (!response.ok || !response.body) {
              const errText = await response.text().catch(() => response.statusText);
              throw new Error(`Stream failed: ${response.status} ${errText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            // The OpenAI-style stream only sends usage / routing metadata on
            // the final chunk, so we hold on to the last parsed `data` and
            // apply it after the stream closes.
            let lastChunk: any = null;
            let sawDone = false;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

              for (const line of lines) {
                if (line === 'data: [DONE]') {
                  sawDone = true;
                  break;
                }
                try {
                  const data = JSON.parse(line.slice(6));
                  lastChunk = data;
                  if (data.error?.message) {
                    // Gateway error (no provider, routing failure, etc.)
                    lastChunk = { error: data.error };
                  } else if (data.choices?.[0]?.delta?.content) {
                    fullContent += data.choices[0].delta.content;
                    get().updateStreamingMessage(fullContent);
                  }
                } catch (e) {
                  // Skip invalid JSON — the gateway may emit heartbeats
                  // or partial lines that aren't complete SSE events yet.
                }
              }
              if (sawDone) break;
            }

            const latency = performance.now() - start;
            const finalContent = fullContent
              || (lastChunk?.error?.message ? `Error: ${lastChunk.error.message}` : '')
              || lastChunk?.choices?.[0]?.message?.content
              || '';

            // Update final message
            set(state => ({
              messages: state.messages.map(m =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      content: finalContent,
                      isStreaming: false,
                      latencyMs: latency,
                      model: lastChunk?.model ?? model,
                      provider: lastChunk?.provider ?? 'auto',
                      tokensInput: lastChunk?.usage?.prompt_tokens,
                      tokensOutput: lastChunk?.usage?.completion_tokens,
                      cost: lastChunk?.cost,
                      routingDecision: lastChunk?.routing_decision,
                    }
                  : m
              ),
              isStreaming: false,
            }));

            // Persist to DB (skipped automatically server-side when the
            // conversation is `is_temporary=1`).
            await apiPost(`/v1/conversations/${conversationId}/messages`, {
                role: 'assistant',
                content: finalContent,
                model: lastChunk?.model ?? model,
                provider: lastChunk?.provider ?? 'auto',
                tokensInput: lastChunk?.usage?.prompt_tokens,
                tokensOutput: lastChunk?.usage?.completion_tokens,
                cost: lastChunk?.cost,
                latencyMs: latency,
                routingDecision: lastChunk?.routing_decision,
              });
          } else if (config.stream && mode === 'godmode') {
            // G0DM0D3 streaming — same OpenAI-style SSE format
            const response = await fetchAuthenticated(endpoint, {
              method: 'POST',
              body: JSON.stringify(body),
              signal: abortController.signal,
              headers: extraHeaders,
            });

            if (!response.ok || !response.body) {
              const errText = await response.text().catch(() => response.statusText);
              throw new Error(`Godmode stream failed: ${response.status} ${errText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            let lastChunk: any = null;
            let sawDone = false;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

              for (const line of lines) {
                if (line === 'data: [DONE]') {
                  sawDone = true;
                  break;
                }
                try {
                  const data = JSON.parse(line.slice(6));
                  lastChunk = data;
                  if (data.error?.message) {
                    lastChunk = { error: data.error };
                  } else if (data.choices?.[0]?.delta?.content) {
                    fullContent += data.choices[0].delta.content;
                    get().updateStreamingMessage(fullContent);
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
              if (sawDone) break;
            }

            const latency = performance.now() - start;
            const finalContent = fullContent
              || (lastChunk?.error?.message ? `Error: ${lastChunk.error.message}` : '')
              || lastChunk?.choices?.[0]?.message?.content
              || '';

            set(state => ({
              messages: state.messages.map(m =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      content: finalContent,
                      isStreaming: false,
                      latencyMs: latency,
                      model: lastChunk?.model ?? model,
                      provider: 'godmode',
                      tokensInput: lastChunk?.usage?.prompt_tokens,
                      tokensOutput: lastChunk?.usage?.completion_tokens,
                    }
                  : m
              ),
              isStreaming: false,
            }));

            await apiPost(`/v1/conversations/${conversationId}/messages`, {
                role: 'assistant',
                content: finalContent,
                model: lastChunk?.model ?? model,
                provider: 'godmode',
                tokensInput: lastChunk?.usage?.prompt_tokens,
                tokensOutput: lastChunk?.usage?.completion_tokens,
                latencyMs: latency,
              });
          } else {
            // Non-streaming response
            const responseType = mode === 'tts' ? 'blob' : 'json';
            const data = await api<any>(endpoint, {
              method: 'POST',
              body: { ...body, stream: false },
              signal: abortController.signal,
              responseType,
              headers: extraHeaders,
            });

            let text = '';
            let audioUrl = '';
            let imageUrl = '';

            if (mode === 'chat') text = data.choices?.[0]?.message?.content ?? data.text;
            else if (mode === 'image') imageUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json;
            else if (mode === 'tts') {
              audioUrl = URL.createObjectURL(data as Blob);
              text = 'Audio generated successfully.';
            }
            else if (mode === 'embed') text = `Vector: [${data.data?.[0]?.embedding?.slice(0, 5).join(', ')}...] (${data.data?.[0]?.embedding?.length} dims)`;
            else if (mode === 'moderate') text = JSON.stringify(data, null, 2);
            else text = JSON.stringify(data, null, 2);

            // Update final message
            set(state => ({
              messages: state.messages.map(m =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      content: text,
                      audioUrl,
                      imageUrl,
                      isStreaming: false,
                      latencyMs: performance.now() - start,
                      model: data.model ?? model,
                      provider: data.provider ?? 'auto',
                      tokensInput: data.usage?.total_tokens ?? 0,
                      tokensOutput: 0,
                      cost: data.cost ?? 0,
                      routingDecision: data.routing_decision,
                    }
                  : m
              ),
              isStreaming: false,
            }));

            // Save to database
            await apiPost(`/v1/conversations/${conversationId}/messages`, {
                role: 'assistant',
                content: text,
                audioUrl,
                imageUrl,
                model: data.model ?? model,
                provider: data.provider ?? 'auto',
                tokensInput: data.usage?.total_tokens ?? 0,
                tokensOutput: 0,
                cost: data.cost ?? 0,
                latencyMs: performance.now() - start,
                routingDecision: data.routing_decision,
              });
          }
        } catch (error: any) {
          if (error.name === 'AbortError') {
            // User cancelled
            set(state => ({
              messages: state.messages.map(m =>
                m.id === assistantMessageId
                  ? { ...m, content: '[Generation cancelled]', isStreaming: false }
                  : m
              ),
              isStreaming: false,
            }));
          } else {
            // Error
            set(state => ({
              messages: state.messages.map(m =>
                m.id === assistantMessageId
                  ? { ...m, content: `Error: ${error.message}`, isStreaming: false }
                  : m
              ),
              isStreaming: false,
            }));
          }
        }
      },

      // Rename a conversation. Persists via the existing
      // PUT /v1/conversations/:id endpoint (the gateway exposes
      // UpdateConversationSchema with an optional `title` field — we just
      // send `{ title }`). Optimistically updates the local list so the
      // sidebar reflects the change immediately.
      renameConversation: async (id: string, title: string) => {
        const trimmed = title.trim();
        if (!trimmed) return;

        // Optimistic local update
        set(state => ({
          conversations: state.conversations.map(c =>
            c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c
          ),
        }));

        try {
          await apiPut(`/v1/conversations/${id}`, { title: trimmed });
        } catch (error) {
          // The DB write failed; revert the optimistic update so the
          // sidebar doesn't display a title the server never accepted.
          set(state => ({
            conversations: state.conversations.map(c =>
              c.id === id ? { ...c, title: '' } : c
            ),
          }));
        }
      },

      // Regenerate an assistant message by re-sending the user prompt
      // that immediately precedes it. We truncate the conversation to
      // just before the assistant message, delete the old assistant
      // message from the DB, then run the same streaming pipeline used
      // by `sendMessage`. The original user message is reused (its id
      // stays in the messages array, so the user sees the same prompt
      // followed by a fresh assistant turn).
      regenerateMessage: async (messageId: string) => {
        const { messages, currentConversationId, isStreaming } = get();
        if (isStreaming) return;
        if (!currentConversationId) return;

        const assistantIdx = messages.findIndex(m => m.id === messageId);
        if (assistantIdx === -1 || messages[assistantIdx].role !== 'assistant') return;

        // Find the most recent user message before the assistant. The
        // first non-assistant message in the trailing run is always a
        // user message in our store, but we still walk explicitly so a
        // stray system message in the future doesn't break us.
        let userIdx = assistantIdx - 1;
        while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx--;
        if (userIdx < 0) return;
        const userMessage = messages[userIdx];

        // Truncate to just before the assistant message (user message
        // stays in the array so its id persists across the regen).
        const truncated = messages.slice(0, assistantIdx);
        set({ messages: truncated });

        // Drop the old assistant message from the DB so the next POST
        // doesn't leave a stale copy. Fire-and-forget — if this fails
        // the worst case is a duplicate, which the server already
        // prevents via unique row ids.
        try {
          await apiDelete(`/v1/conversations/${currentConversationId}/messages/${messageId}`);
        } catch {
          // Non-fatal — proceed with the regeneration.
        }

        const { mode, model, config } = get();
        const assistant = get()._createAssistantPlaceholder(currentConversationId);
        const req = get()._buildRequest({
          content: userMessage.content,
          history: truncated,
          mode,
          model,
          config,
        });

        await get()._streamToEndpoint({
          ...req,
          mode,
          model,
          config,
          conversationId: currentConversationId,
          assistantMessageId: assistant.id,
        });
      },

      // Stash a prompt for PlaygroundInput to consume. Used by the
      // sample-prompt tiles in EmptyState.
      setPromptSeed: (prompt: string) => {
        set({ pendingPrompt: prompt });
      },

      // Read-and-clear the pending prompt. Returns null when nothing is
      // queued so the consumer can short-circuit the effect.
      consumePromptSeed: () => {
        const { pendingPrompt } = get();
        if (!pendingPrompt) return null;
        set({ pendingPrompt: '' });
        return pendingPrompt;
      },
    }),
    {
      name: 'playground-storage',
      partialize: (state) => ({
        // Only persist these fields
        mode: state.mode,
        model: state.model,
        costFilter: state.costFilter,
        config: state.config,
        isTemporary: state.isTemporary,
        showSidebar: state.showSidebar,
      }),
    }
  )
);