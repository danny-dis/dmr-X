import { StateCreator } from 'zustand';
import type {
  PlaygroundState,
  Message,
} from './usePlaygroundStore';
import { Admin } from '@/lib/admin';
import { api, apiPost, apiDelete, fetchAuthenticated } from '@/lib/api';

export interface MessagesSlice {
  messages: Message[];
  sendMessage: (content: string) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  clearMessages: () => void;
  _createAssistantPlaceholder: (conversationId: string) => Message;
  _buildRequest: (opts: {
    content: string;
    history: Message[];
    mode: PlaygroundState['mode'];
    model: string;
    config: PlaygroundState['config'];
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
}

export const createMessagesSlice: StateCreator<PlaygroundState, [], [], MessagesSlice> = (set, get) => ({
  messages: [],

  sendMessage: async (content: string) => {
    const { currentConversationId, mode, model, config, messages } = get();

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

    const assistantMessage = get()._createAssistantPlaceholder(conversationId!);

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

  clearMessages: () => {
    set({ messages: [], currentConversationId: null });
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
  }): { endpoint: string; body: any } => {
    const { content, history, mode, model, config } = opts;
    let endpoint = '/v1/chat/completions';
    let body: any = { model, stream: config.stream };

    if (mode === 'chat') {
      const hist = history.map(m => ({ role: m.role, content: m.content }));
      body.messages = [...hist, { role: 'user', content }];
      body.temperature = config.temperature;
      if (config.maxTokens) body.max_tokens = config.maxTokens;
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

    try {
      if (mode === 'agentic' || mode === 'tool-loop') {
        get().clearStreamingEvents();

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
        let lastContent = '';
        let lastModel = model;
        let lastUsage: any = null;
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
              continue;
            }

            get().addStreamingEvent({ name, data: parsed });

            if (name === 'error' && parsed?.error?.message) {
              if (firstErrorMessage === null) firstErrorMessage = parsed.error.message;
              continue;
            }

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
      } else if (config.stream && mode === 'chat') {
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
            } catch (_e) {
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
