import type { UnifiedRequest, UnifiedResponse, Message, Tool } from '@dmr-x/core';

// --- Wire format types ---

export type WireFormat = 'openai' | 'anthropic' | 'gemini';

export interface OpenAIChatRequest {
  model: string;
  messages: Array<{ role: string; content: any; name?: string; tool_calls?: any[]; tool_call_id?: string }>;
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: any } }>;
  tool_choice?: any;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  response_format?: { type: string };
  seed?: number | null;
  n?: number;
  stream?: boolean;
  user?: string;
}

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system?: string | Array<{ type: 'text'; text: string }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }>;
  tools?: Array<{ name: string; description?: string; input_schema: any }>;
  tool_choice?: { type: string; name?: string };
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

export interface GeminiGenerateContentRequest {
  contents: Array<{ role: 'user' | 'model'; parts: any[] }>;
  systemInstruction?: { role: 'user'; parts: any[] };
  tools?: Array<{ functionDeclarations: Array<{ name: string; description?: string; parameters?: any }> }>;
  toolConfig?: { functionCallingConfig?: { mode?: string } };
  generationConfig?: { temperature?: number; topP?: number; maxOutputTokens?: number; stopSequences?: string[] };
  stream?: boolean;
}

// --- Detection ---

export function detectWireFormat(body: any): WireFormat {
  if (body.contents !== undefined || body.generationConfig !== undefined) return 'gemini';
  if (body.system !== undefined && body.max_tokens !== undefined && Array.isArray(body.messages)) {
    const firstMsg = body.messages[0];
    if (firstMsg && firstMsg.content !== undefined && (typeof firstMsg.content === 'string' || Array.isArray(firstMsg.content))) {
      return 'anthropic';
    }
  }
  return 'openai';
}

// --- OpenAI -> Unified ---

export function openAIToUnified(body: OpenAIChatRequest, meta: Record<string, unknown>): UnifiedRequest {
  const messages: Message[] = body.messages.map(m => ({
    role: m.role as Message['role'],
    content: m.content,
    name: m.name,
    tool_calls: m.tool_calls,
    tool_call_id: m.tool_call_id,
  }));

  const tools: Tool[] | undefined = body.tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));

  return {
    modality: 'llm',
    model: body.model,
    messages,
    tools,
    tool_choice: body.tool_choice as any,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    frequency_penalty: body.frequency_penalty,
    presence_penalty: body.presence_penalty,
    stop: body.stop,
    response_format: body.response_format as any,
    seed: body.seed,
    n: body.n,
    stream: body.stream ?? false,
    user: body.user,
    metadata: meta,
  };
}

// --- Anthropic -> Unified ---

export function anthropicToUnified(body: AnthropicMessagesRequest, meta: Record<string, unknown>): UnifiedRequest {
  const messages: Message[] = [];

  // Prepend system as a system message
  if (body.system) {
    const sysText = typeof body.system === 'string'
      ? body.system
      : body.system.map(b => b.text).join('\n');
    messages.push({ role: 'system', content: sysText });
  }

  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    } else {
      // Flatten content blocks into a single content string or structured parts
      const textParts = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text);
      const toolUseBlocks = msg.content.filter((b: any) => b.type === 'tool_use');
      const toolResultBlocks = msg.content.filter((b: any) => b.type === 'tool_result');

      if (toolUseBlocks.length > 0) {
        messages.push({
          role: 'assistant',
          content: textParts.join('\n') || '',
          tool_calls: toolUseBlocks.map((b: any) => ({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          })),
        });
      } else if (toolResultBlocks.length > 0) {
        for (const tr of toolResultBlocks) {
          messages.push({
            role: 'tool',
            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
            tool_call_id: tr.tool_use_id,
          });
        }
      } else {
        messages.push({ role: msg.role, content: textParts.join('\n') || '' });
      }
    }
  }

  const tools: Tool[] | undefined = body.tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  return {
    modality: 'llm',
    model: body.model,
    messages,
    tools,
    tool_choice: body.tool_choice as any,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    stop: body.stop_sequences,
    stream: body.stream ?? false,
    metadata: meta,
  };
}

// --- Gemini -> Unified ---

export function geminiToUnified(body: GeminiGenerateContentRequest, meta: Record<string, unknown>): UnifiedRequest {
  const messages: Message[] = [];

  // System instruction
  if (body.systemInstruction) {
    const sysText = body.systemInstruction.parts
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join('\n');
    messages.push({ role: 'system', content: sysText });
  }

  for (const content of body.contents) {
    const role = content.role === 'model' ? 'assistant' : 'user';
    const textParts = content.parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text);
    const funcCallParts = content.parts.filter((p: any) => p.functionCall);
    const funcRespParts = content.parts.filter((p: any) => p.functionResponse);

    if (funcCallParts.length > 0) {
      messages.push({
        role: 'assistant',
        content: textParts.join('\n') || '',
        tool_calls: funcCallParts.map((p: any, i: number) => ({
          id: `call_${i}`,
          type: 'function' as const,
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) },
        })),
      });
    } else if (funcRespParts.length > 0) {
      for (const fr of funcRespParts) {
        messages.push({
          role: 'tool',
          content: JSON.stringify(fr.functionResponse.response),
          tool_call_id: `call_0`,
        });
      }
    } else {
      messages.push({ role: role as Message['role'], content: textParts.join('\n') || '' });
    }
  }

  const tools: Tool[] | undefined = body.tools?.flatMap(t =>
    t.functionDeclarations.map(fd => ({
      type: 'function' as const,
      function: {
        name: fd.name,
        description: fd.description,
        parameters: fd.parameters,
      },
    }))
  );

  return {
    modality: 'llm',
    model: 'gemini',
    messages,
    tools,
    tool_choice: body.toolConfig?.functionCallingConfig?.mode === 'NONE'
      ? { type: 'none' } as any
      : body.toolConfig?.functionCallingConfig?.mode === 'ANY'
        ? { type: 'any' } as any
        : undefined,
    temperature: body.generationConfig?.temperature,
    max_tokens: body.generationConfig?.maxOutputTokens,
    top_p: body.generationConfig?.topP,
    stop: body.generationConfig?.stopSequences,
    stream: body.stream ?? false,
    metadata: meta,
  };
}

// --- Unified -> OpenAI response ---

export function unifiedToOpenAIResponse(resp: UnifiedResponse, requestId: string): any {
  const choices = [{
    index: 0,
    message: {
      role: 'assistant',
      content: resp.message?.content || null,
      tool_calls: resp.message?.tool_calls,
    },
    finish_reason: resp.finishReason || 'stop',
  }];

  return {
    id: requestId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: resp.modelId,
    choices,
    usage: resp.usage ? {
      prompt_tokens: resp.usage.prompt_tokens ?? 0,
      completion_tokens: resp.usage.completion_tokens ?? 0,
      total_tokens: resp.usage.total_tokens ?? 0,
    } : undefined,
  };
}

// --- Unified -> Anthropic response ---

export function unifiedToAnthropicResponse(resp: UnifiedResponse, model: string): any {
  const content: any[] = [];

  if (resp.message?.content) {
    content.push({ type: 'text', text: resp.message.content });
  }

  if (resp.message?.tool_calls) {
    for (const tc of resp.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || '{}'),
      });
    }
  }

  const stopReason = resp.finishReason === 'tool_calls' ? 'tool_use'
    : resp.finishReason === 'length' ? 'max_tokens'
    : 'end_turn';

  return {
    type: 'message',
    id: `msg_${Date.now()}`,
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}

// --- Unified -> Gemini response ---

export function unifiedToGeminiResponse(resp: UnifiedResponse): any {
  const parts: any[] = [];

  if (resp.message?.content) {
    parts.push({ text: resp.message.content });
  }

  if (resp.message?.tool_calls) {
    for (const tc of resp.message.tool_calls) {
      parts.push({
        functionCall: {
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments || '{}'),
        },
      });
    }
  }

  const finishReason = resp.finishReason === 'tool_calls' ? 'STOP'
    : resp.finishReason === 'length' ? 'MAX_TOKENS'
    : 'STOP';

  return {
    candidates: [{
      content: { role: 'model', parts },
      finishReason,
    }],
    usageMetadata: {
      promptTokenCount: resp.usage?.prompt_tokens ?? 0,
      candidatesTokenCount: resp.usage?.completion_tokens ?? 0,
      totalTokenCount: resp.usage?.total_tokens ?? 0,
    },
  };
}
