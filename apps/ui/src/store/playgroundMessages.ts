import { StateCreator } from 'zustand';
import type {
  PlaygroundState,
  Message,
} from './usePlaygroundStore';
import { Admin } from '@/lib/admin';
import { api, apiPost, apiDelete } from '@/lib/api';
import { streamSSE, SSE_DONE } from '@/lib/sse';

export interface MessagesSlice {
  messages: Message[];
  sendMessage: (content: string) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  clearMessages: () => void;
  updateMessageContent: (messageId: string, content: string) => void;
  deleteMessage: (messageId: string) => void;
  setMessageRole: (messageId: string, role: 'user' | 'assistant' | 'system') => void;
  insertMessageAfter: (messageId: string, role: 'user' | 'assistant') => string;
  _createAssistantPlaceholder: (conversationId: string) => Message;
  _buildRequest: (opts: {
    content: string;
    history: Message[];
    mode: PlaygroundState['mode'];
    model: string;
    config: PlaygroundState['config'];
    agentInstanceId?: string | null;
  }) => { endpoint: string; body: any };
  _streamToEndpoint: (opts: {
    endpoint: string;
    body: any;
    mode: PlaygroundState['mode'];
    model: string;
    config: PlaygroundState['config'];
    conversationId: string;
    assistantMessageId: string;
  }) => Promise<void>;
  addMessagesBatch: (conversationId: string, messages: Message[]) => Promise<void>;
  /**
   * Append an already-formed message to the transcript without triggering a
   * completion. Used by flows that produce their own content (image/video
   * generation) and just need it rendered in the conversation.
   */
  appendMessage: (
    message: Pick<Message, 'role' | 'content'> & Partial<Omit<Message, 'role' | 'content'>>,
  ) => Promise<void>;
}

export const createMessagesSlice: StateCreator<PlaygroundState, [], [], MessagesSlice> = (set, get) => ({
  messages: [],

  sendMessage: async (content: string) => {
    const { currentConversationId, mode, model, config, messages, agentInstanceId } = get();

    // Agent mode needs an instance to build the endpoint
    // (`/v1/agents/:instanceId/chat`) — fail before touching the transcript
    // rather than sending a user message nothing will ever answer.
    if (mode === 'agent' && !agentInstanceId) {
      throw new Error('Select an agent instance before sending a message.');
    }

    let conversationId = currentConversationId;

    if (!conversationId) {
      conversationId = await get().createConversation();
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      conversationId: conversationId!,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    const historyWithUser = [...messages, userMessage];
    set({ messages: historyWithUser });

    // Persist the user turn immediately. Previously only the assistant
    // reply was ever POSTed to `/v1/conversations/:id/messages` (see the
    // apiPost calls at the end of `_streamToEndpoint`), so a reload — or
    // anyone else calling loadConversation() — recreated history missing
    // every user message even though the conversation id itself was
    // stable. Best-effort: a failed save shouldn't block sending.
    try {
      await apiPost(`/v1/conversations/${conversationId}/messages`, {
        role: 'user',
        content,
      });
    } catch {
      /* transcript stays in memory for this session */
    }

    const assistantMessage = get()._createAssistantPlaceholder(conversationId!);

    const req = get()._buildRequest({
      content,
      history: historyWithUser,
      mode,
      model,
      config,
      agentInstanceId,
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

  regenerateMessage: async (messageId: string) => {
    const { messages, currentConversationId, isStreaming } = get();
    if (isStreaming) return;
    if (!currentConversationId) return;

    const assistantIdx = messages.findIndex(m => m.id === messageId);
    if (assistantIdx === -1 || messages[assistantIdx].role !== 'assistant') return;

    let userIdx = assistantIdx - 1;
    while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx--;
    if (userIdx < 0) return;
    const userMessage = messages[userIdx];

    const truncated = messages.slice(0, assistantIdx);
    set({ messages: truncated });

    try {
      await apiDelete(`/v1/conversations/${currentConversationId}/messages/${messageId}`);
    } catch {
      // Non-fatal
    }

    const { mode, model, config, agentInstanceId } = get();
    const assistant = get()._createAssistantPlaceholder(currentConversationId);
    const req = get()._buildRequest({
      content: userMessage.content,
      history: truncated,
      mode,
      model,
      config,
      agentInstanceId,
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

  clearMessages: () => {
    set({ messages: [], currentConversationId: null });
  },

  updateMessageContent: (messageId: string, content: string) => {
    set(state => ({
      messages: state.messages.map(m =>
        m.id === messageId ? { ...m, content } : m
      ),
    }));
  },

  deleteMessage: (messageId: string) => {
    set(state => ({
      messages: state.messages.filter(m => m.id !== messageId),
    }));
  },

  setMessageRole: (messageId: string, role: 'user' | 'assistant' | 'system') => {
    set(state => ({
      messages: state.messages.map(m =>
        m.id === messageId ? { ...m, role } : m
      ),
    }));
  },

  insertMessageAfter: (messageId: string, role: 'user' | 'assistant') => {
    const newId = crypto.randomUUID();
    const newMsg: Message = {
      id: newId,
      conversationId: '',
      role,
      content: '',
      createdAt: new Date().toISOString(),
    };
    set(state => {
      const idx = state.messages.findIndex(m => m.id === messageId);
      if (idx === -1) return { messages: [...state.messages, newMsg] };
      const next = [...state.messages];
      next.splice(idx + 1, 0, newMsg);
      return { messages: next };
    });
    return newId;
  },

  // GenerateButtons calls this on every image/video generation. It was never
  // implemented, so `s.appendMessage` resolved to undefined and clicking
  // Generate threw "appendMessage is not a function".
  appendMessage: async (message) => {
    let conversationId = get().currentConversationId;
    if (!conversationId) {
      conversationId = await get().createConversation();
    }

    const full: Message = {
      id: crypto.randomUUID(),
      conversationId: conversationId!,
      createdAt: new Date().toISOString(),
      ...message,
    };

    set({ messages: [...get().messages, full] });

    // Best-effort persistence: the message is already on screen, so a failed
    // write should not surface as a thrown error mid-generation.
    try {
      await get().addMessagesBatch(conversationId!, [full]);
    } catch {
      /* transcript stays in memory for this session */
    }
  },

  addMessagesBatch: async (conversationId: string, messages: Message[]) => {
    await Admin.batchAddMessages(conversationId, messages);
    set(state => ({
      messages: [...state.messages, ...messages],
    }));
  },

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

  _buildRequest: (opts: {
    content: string;
    history: Message[];
    mode: PlaygroundState['mode'];
    model: string;
    config: PlaygroundState['config'];
    agentInstanceId?: string | null;
  }): { endpoint: string; body: any } => {
    const { content, history, mode, model, config, agentInstanceId } = opts;
    let endpoint = '/v1/chat/completions';
    let body: any = { model, stream: config.stream };

    if (mode === 'chat') {
      const sp = (get as any)().systemPrompt ?? '';
      const hist = history.map(m => ({ role: m.role, content: m.content }));
      body.messages = [
        ...(sp ? [{ role: 'system', content: sp }] : []),
        ...hist,
        { role: 'user', content },
      ];
      body.temperature = config.temperature;
      if (config.maxTokens) body.max_tokens = config.maxTokens;
      if (Array.isArray(config.tools) && config.tools.length > 0) body.tools = config.tools;
      // Advanced params — only sent when non-default
      if (config.topP !== undefined && config.topP !== 1) body.top_p = config.topP;
      if (config.topK !== undefined && config.topK > 0) body.top_k = config.topK;
      if (config.repeatPenalty !== undefined && config.repeatPenalty !== 1) body.repeat_penalty = config.repeatPenalty;
      if (config.seed !== undefined) body.seed = config.seed;
      if (config.presencePenalty !== undefined && config.presencePenalty !== 0) body.presence_penalty = config.presencePenalty;
      if (config.frequencyPenalty !== undefined && config.frequencyPenalty !== 0) body.frequency_penalty = config.frequencyPenalty;
      if (config.stop?.length && config.stop.some(s => s.trim())) body.stop = config.stop.filter(s => s.trim());
      if (config.responseFormat) body.response_format = config.responseFormat;
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
    } else if (mode === 'agent') {
      // Body shape matches AgentChatRequestSchema (services/agent-registry) —
      // camelCase `maxTokens`/`maxSteps`, snake_case `max_cost_budget`. The
      // instance id lives in the path, not the body.
      endpoint = `/v1/agents/${agentInstanceId ?? ''}/chat`;
      const hist = history.map(m => ({ role: m.role, content: m.content }));
      body = {
        messages: [...hist, { role: 'user', content }],
        stream: true,
      };
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (config.maxTokens) body.maxTokens = config.maxTokens;
      if (config.maxSteps) body.maxSteps = config.maxSteps;
      if (config.maxCostBudget) body.max_cost_budget = config.maxCostBudget;
    }

    return { endpoint, body };
  },

  _streamToEndpoint: async (opts: {
    endpoint: string;
    body: any;
    mode: PlaygroundState['mode'];
    model: string;
    config: PlaygroundState['config'];
    conversationId: string;
    assistantMessageId: string;
  }) => {
    const { endpoint, body, mode, model, config, conversationId, assistantMessageId } = opts;

    const abortController = new AbortController();
    set({ abortController });

    const start = performance.now();

    const costFilter = get().costFilter;
    const extraHeaders: Record<string, string> = costFilter === 'free'
      ? { 'x-cost-filter': 'free' }
      : {};

    // `streamSSE` resolves cleanly (rather than throwing) when `signal` is
    // aborted — a user pressing Stop isn't an error. The old raw-`fetch`
    // parsers relied on the reject to show "[Generation cancelled]"; each
    // branch below checks this instead, right after its `streamSSE` call.
    const markCancelled = () => {
      set(state => ({
        messages: state.messages.map(m =>
          m.id === assistantMessageId
            ? { ...m, content: '[Generation cancelled]', isStreaming: false }
            : m
        ),
        isStreaming: false,
      }));
    };

    try {
      if (mode === 'agentic' || mode === 'tool-loop') {
        get().clearStreamingEvents();

        body.conversationId = conversationId;

        let lastContent = '';
        let lastModel = model;
        let lastUsage: any = null;
        let firstErrorMessage: string | null = null;

        await streamSSE(endpoint, {
          body,
          signal: abortController.signal,
          headers: extraHeaders,
          onFrame: (frame) => {
            if (frame.data === SSE_DONE) return;
            let parsed: any;
            try {
              parsed = JSON.parse(frame.data);
            } catch {
              return;
            }

            get().addStreamingEvent({ name: frame.event, data: parsed });

            if (frame.event === 'error' && parsed?.error?.message) {
              if (firstErrorMessage === null) firstErrorMessage = parsed.error.message;
              return;
            }

            if (mode === 'agentic' && frame.event === 'turn' && parsed.message) {
              const text = typeof parsed.message.content === 'string'
                ? parsed.message.content
                : '';
              if (text) lastContent = text;
              if (parsed.model) lastModel = parsed.model;
              if (parsed.usage) lastUsage = parsed.usage;
            } else if (mode === 'tool-loop' && frame.event === 'step' && parsed.choices?.[0]?.message) {
              const text = parsed.choices[0].message.content;
              if (typeof text === 'string' && text) lastContent = text;
              if (parsed.model) lastModel = parsed.model;
              if (parsed.usage) lastUsage = parsed.usage;
            }
          },
        });

        if (abortController.signal.aborted) {
          markCancelled();
          return;
        }

        const latency = performance.now() - start;
        const finalContent = firstErrorMessage
          ? `Error: ${firstErrorMessage}`
          : lastContent;

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

        await apiPost(`/v1/conversations/${conversationId}/messages`, {
            role: 'assistant',
            content: finalContent,
            model: lastModel,
            latencyMs: latency,
            tokensInput: lastUsage?.prompt_tokens,
            tokensOutput: lastUsage?.completion_tokens,
            events: capturedEvents && capturedEvents.length > 0 ? capturedEvents : undefined,
          });
      } else if (mode === 'agent') {
        // `/v1/agents/:instanceId/chat` — same durable-session conversation
        // id doubles as the `:conversationId` in the cancel endpoint
        // (`cancelStreaming` in playgroundStreaming.ts uses it).
        get().clearStreamingEvents();

        body.conversationId = conversationId;

        let lastContent = '';
        let lastModel = model;
        let lastUsage: any = null;
        let firstErrorMessage: string | null = null;
        let doneInfo: any = null;

        await streamSSE(endpoint, {
          body,
          signal: abortController.signal,
          headers: extraHeaders,
          onFrame: (frame) => {
            let parsed: any;
            try {
              parsed = JSON.parse(frame.data);
            } catch {
              return;
            }

            get().addStreamingEvent({ name: frame.event, data: parsed });

            if (frame.event === 'error' && parsed?.message) {
              if (firstErrorMessage === null) firstErrorMessage = parsed.message;
              return;
            }
            if (frame.event === 'turn' && parsed.message) {
              const text = typeof parsed.message.content === 'string'
                ? parsed.message.content
                : '';
              if (text) lastContent = text;
              if (parsed.model) lastModel = parsed.model;
              if (parsed.usage) lastUsage = parsed.usage;
            } else if (frame.event === 'done') {
              doneInfo = parsed;
            }
          },
        });

        if (abortController.signal.aborted) {
          markCancelled();
          return;
        }

        const latency = doneInfo?.durationMs ?? (performance.now() - start);
        const finalContent = firstErrorMessage
          ? `Error: ${firstErrorMessage}`
          : lastContent;

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
                  cost: doneInfo?.totalCost,
                }
              : m
          ),
          isStreaming: false,
          streamingEvents: [],
        }));

        await apiPost(`/v1/conversations/${conversationId}/messages`, {
            role: 'assistant',
            content: finalContent,
            model: lastModel,
            latencyMs: latency,
            tokensInput: lastUsage?.prompt_tokens,
            tokensOutput: lastUsage?.completion_tokens,
            cost: doneInfo?.totalCost,
            events: capturedEvents && capturedEvents.length > 0 ? capturedEvents : undefined,
          });
      } else if (config.stream && mode === 'chat') {
        let fullContent = '';
        let lastChunk: any = null;

        await streamSSE(endpoint, {
          body,
          signal: abortController.signal,
          headers: extraHeaders,
          onFrame: (frame) => {
            if (frame.data === SSE_DONE) return;
            let data: any;
            try {
              data = JSON.parse(frame.data);
            } catch {
              return;
            }
            lastChunk = data;
            if (data.error?.message) {
              lastChunk = { error: data.error };
            } else if (data.choices?.[0]?.delta?.content) {
              fullContent += data.choices[0].delta.content;
              get().updateStreamingMessage(fullContent);
            }
          },
        });

        if (abortController.signal.aborted) {
          markCancelled();
          return;
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
        let fullContent = '';
        let lastChunk: any = null;

        await streamSSE(endpoint, {
          body,
          signal: abortController.signal,
          headers: extraHeaders,
          onFrame: (frame) => {
            if (frame.data === SSE_DONE) return;
            let data: any;
            try {
              data = JSON.parse(frame.data);
            } catch {
              return;
            }
            lastChunk = data;
            if (data.error?.message) {
              lastChunk = { error: data.error };
            } else if (data.choices?.[0]?.delta?.content) {
              fullContent += data.choices[0].delta.content;
              get().updateStreamingMessage(fullContent);
            }
          },
        });

        if (abortController.signal.aborted) {
          markCancelled();
          return;
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
        set(state => ({
          messages: state.messages.map(m =>
            m.id === assistantMessageId
              ? { ...m, content: '[Generation cancelled]', isStreaming: false }
              : m
          ),
          isStreaming: false,
        }));
      } else {
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
});
