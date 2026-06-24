import { Agent, type AgentEvent, type AgentMessage, type AgentOptions } from '@earendil-works/pi-agent-core';
import type { Model, Context, AssistantMessageEventStream, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createDmrXModel } from './dmr-x-provider.js';
import { createPiAgentTools } from './tools.js';
import type { FastifyInstance } from 'fastify';
import { logger } from '@dmr-x/utils';

export interface PiAgentRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: any[];
  max_steps?: number;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  system_prompt?: string;
}

export interface PiAgentResponse {
  content: string;
  model: string;
  usage?: any;
  steps: number;
  events: AgentEvent[];
}

/**
 * Service that wraps Pi's Agent class for use within DMR-X.
 * Manages agent lifecycle and streams events via SSE.
 */
export class PiAgentService {
  private agents = new Map<string, Agent>();
  private server: FastifyInstance;
  private baseUrl: string;

  constructor(server: FastifyInstance) {
    this.server = server;
    this.baseUrl = process.env.DMRX_GATEWAY_URL || 'http://localhost:3000';
  }

  /**
   * Run a Pi agent with SSE streaming. Writes events to the reply stream.
   */
  async runStreaming(
    request: PiAgentRequest,
    reply: { raw: { write: (data: string) => void; end: () => void; writeHead: (status: number, headers: Record<string, string>) => void } },
    requestId: string,
  ): Promise<void> {
    const model = this.resolveModel(request.model);
    const tools = createPiAgentTools(this.server);
    const maxSteps = request.max_steps ?? 10;
    let stepCount = 0;

    const agent = new Agent({
      initialState: {
        systemPrompt: this.buildSystemPrompt(request.system_prompt),
        model,
        messages: this.convertMessages(request.messages),
      },
      streamFn: this.createStreamFn(),
      toolExecution: 'parallel',
      prepareNextTurn: async () => {
        stepCount++;
        if (stepCount >= maxSteps) {
          return { context: undefined, model: undefined, thinkingLevel: undefined };
        }
        return undefined;
      },
    });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const writeSSE = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    agent.subscribe(async (event) => {
      writeSSE('agent_event', {
        type: event.type,
        ...(event.type === 'turn_end' ? {
          message: this.serializeMessage(event.message),
          toolResults: event.toolResults.map(r => ({
            toolName: r.toolName,
            isError: r.isError,
          })),
        } : {}),
        ...(event.type === 'tool_execution_start' ? {
          toolName: event.toolName,
          args: event.args,
        } : {}),
        ...(event.type === 'tool_execution_end' ? {
          toolName: event.toolName,
          isError: event.isError,
        } : {}),
        ...(event.type === 'message_update' ? {
          text: this.extractTextFromEvent(event.assistantMessageEvent),
        } : {}),
        ...(event.type === 'agent_end' ? {
          messages: event.messages.length,
        } : {}),
      });
    });

    try {
      const userMessage = request.messages[request.messages.length - 1]?.content || '';
      await agent.prompt(userMessage);
      await agent.waitForIdle();

      const finalMessages = agent.state.messages;
      const lastAssistant = [...finalMessages].reverse().find(m => m.role === 'assistant');
      const content = lastAssistant
        ? this.extractTextFromMessage(lastAssistant)
        : '';

      writeSSE('done', {
        status: 'completed',
        content,
        model: request.model,
        steps: finalMessages.filter(m => m.role === 'assistant').length,
      });
    } catch (err) {
      logger.error({ err, requestId }, 'Pi agent streaming error');
      writeSSE('error', { error: { message: 'Agent execution failed' } });
    } finally {
      reply.raw.end();
    }
  }

  /**
   * Run a Pi agent without streaming. Returns the full response.
   */
  async run(
    request: PiAgentRequest,
    requestId: string,
  ): Promise<PiAgentResponse> {
    const model = this.resolveModel(request.model);
    const tools = createPiAgentTools(this.server);
    const maxSteps = request.max_steps ?? 10;
    const events: AgentEvent[] = [];
    let stepCount = 0;

    const agent = new Agent({
      initialState: {
        systemPrompt: this.buildSystemPrompt(request.system_prompt),
        model,
        messages: this.convertMessages(request.messages),
      },
      streamFn: this.createStreamFn(),
      toolExecution: 'parallel',
      prepareNextTurn: async () => {
        stepCount++;
        if (stepCount >= maxSteps) {
          return { context: undefined, model: undefined, thinkingLevel: undefined };
        }
        return undefined;
      },
    });

    agent.subscribe(async (event) => {
      events.push(event);
    });

    const userMessage = request.messages[request.messages.length - 1]?.content || '';
    await agent.prompt(userMessage);
    await agent.waitForIdle();

    const finalMessages = agent.state.messages;
    const lastAssistant = [...finalMessages].reverse().find(m => m.role === 'assistant');
    const content = lastAssistant ? this.extractTextFromMessage(lastAssistant) : '';

    return {
      content,
      model: request.model,
      steps: finalMessages.filter(m => m.role === 'assistant').length,
      events,
    };
  }

  private resolveModel(modelId: string): Model<'openai-completions'> {
    return createDmrXModel({
      id: modelId,
      name: modelId,
    });
  }

  private createStreamFn() {
    return async (
      model: Model<any>,
      context: Context,
      options?: SimpleStreamOptions,
    ): Promise<AssistantMessageEventStream> => {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model.id,
          messages: context.messages.map(m => ({
            role: m.role === 'toolResult' ? 'tool' : m.role,
            content: this.messageToContent(m),
            ...(m.role === 'toolResult' ? { tool_call_id: (m as any).toolCallId } : {}),
          })),
          tools: context.tools?.map(t => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
          temperature: options?.temperature,
          max_tokens: options?.maxTokens,
          stream: true,
        }),
        signal: options?.signal,
      });

      if (!response.ok) {
        throw new Error(`DMR-X chat request failed: ${response.status}`);
      }

      const stream = createAssistantMessageEventStream();

      // Process the SSE stream from DMR-X
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      (async () => {
        try {
          let contentIndex = 0;
          const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  break;
                }

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;

                  if (delta?.content) {
                    if (contentIndex === 0) {
                      stream.push({ type: 'text_start', contentIndex: 0, partial: {} as any });
                    }
                    stream.push({
                      type: 'text_delta',
                      contentIndex: 0,
                      delta: delta.content,
                      partial: {} as any,
                    });
                    contentIndex++;
                  }

                  if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                      const idx = tc.index ?? toolCalls.size;
                      if (!toolCalls.has(idx)) {
                        toolCalls.set(idx, { id: tc.id || `call_${idx}`, name: tc.function?.name || '', arguments: '' });
                        stream.push({
                          type: 'toolcall_start',
                          contentIndex: idx + 1,
                          partial: {} as any,
                        });
                      }
                      const existing = toolCalls.get(idx)!;
                      if (tc.function?.name) existing.name = tc.function.name;
                      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                      if (tc.id) existing.id = tc.id;

                      stream.push({
                        type: 'toolcall_delta',
                        contentIndex: idx + 1,
                        delta: tc.function?.arguments || '',
                        partial: {} as any,
                      });
                    }
                  }

                  if (parsed.choices?.[0]?.finish_reason === 'stop' || parsed.choices?.[0]?.finish_reason === 'tool_calls') {
                    for (const [idx, tc] of toolCalls) {
                      stream.push({
                        type: 'toolcall_end',
                        contentIndex: idx + 1,
                        toolCall: {
                          type: 'toolCall',
                          id: tc.id,
                          name: tc.name,
                          arguments: JSON.parse(tc.arguments || '{}'),
                        },
                        partial: {} as any,
                      });
                    }

                    stream.end({
                      role: 'assistant',
                      content: [],
                      api: 'openai-completions',
                      provider: 'dmr-x',
                      model: model.id,
                      usage: parsed.usage || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                      stopReason: parsed.choices[0].finish_reason === 'tool_calls' ? 'toolUse' : 'stop',
                      timestamp: Date.now(),
                    });
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
        } catch (err) {
          stream.end({
            role: 'assistant',
            content: [],
            api: 'openai-completions',
            provider: 'dmr-x',
            model: model.id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'error',
            errorMessage: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          });
        }
      })();

      return stream;
    };
  }

  private buildSystemPrompt(customPrompt?: string): string {
    if (customPrompt) return customPrompt;
    return `You are a helpful AI assistant with access to DMR-X tools. Use the available tools to help users with their tasks. Be concise and helpful.`;
  }

  private convertMessages(messages: Array<{ role: string; content: string }>): AgentMessage[] {
    return messages.map(m => {
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          content: [{ type: 'text', text: m.content }],
          api: 'openai-completions',
          provider: 'dmr-x',
          model: 'unknown',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp: Date.now(),
        };
      }
      return {
        role: 'user',
        content: m.content,
        timestamp: Date.now(),
      };
    });
  }

  private messageToContent(m: any): string {
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
    }
    return '';
  }

  private extractTextFromEvent(event: any): string {
    if (event?.type === 'text_delta') return event.delta || '';
    return '';
  }

  private extractTextFromMessage(message: any): string {
    if (!message?.content) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
    }
    return '';
  }

  private serializeMessage(message: any): any {
    if (!message) return null;
    return {
      role: message.role,
      content: this.extractTextFromMessage(message),
      model: message.model,
      usage: message.usage,
      stopReason: message.stopReason,
    };
  }
}
