import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .filter(([, item]) => item !== undefined).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

/** Versioned namespaces make old, context-blind rows unreachable without a DB reset. */
export function semanticCacheIdentity(requestType: string, body: Record<string, unknown>): { scope: string; prompt: string } | null {
  if (requestType !== 'chat' || body.stream || (Array.isArray(body.tools) && body.tools.length)) return null;
  if (!Array.isArray(body.messages) || !body.messages.length) return null;
  const messages = body.messages as Array<Record<string, unknown>>;
  if (messages.some(message => !message || !['system', 'developer', 'user', 'assistant'].includes(String(message.role)) ||
      typeof message.content !== 'string' || message.tool_calls || message.function_call || message.tool_call_id)) return null;
  const latest = messages[messages.length - 1];
  if (latest.role !== 'user' || typeof latest.content !== 'string' || latest.content.length < 10) return null;
  const prompt = latest.content;
  const approximate = (body.metadata as Record<string, unknown> | undefined)?.semanticCache === 'approximate';
  const scopedBody: Record<string, unknown> = { ...body, messages: messages.map((message, index) =>
    approximate && index === messages.length - 1 ? { ...message, content: null } : message) };
  delete scopedBody.stream;
  const digest = createHash('sha256').update(JSON.stringify(canonicalize(scopedBody))).digest('hex');
  return { scope: `${requestType}:context-v2:${digest}`, prompt };
}
