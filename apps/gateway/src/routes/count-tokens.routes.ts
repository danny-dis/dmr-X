import { ValidationError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const CountTokensSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.union([z.string(), z.array(z.any())]).nullable().optional(),
  })).min(1),
  system: z.union([z.string(), z.array(z.any())]).optional(),
});

function estimateTokens(text: string): number {
  // GPT-style heuristic: ~4 chars per token for English, ~2 for CJK
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK unified ideographs range
    if (code >= 0x4e00 && code <= 0x9fff) {
      count += 1;
    } else {
      count += 0.25;
    }
  }
  return Math.ceil(count);
}

function countMessageTokens(messages: { role: string; content: any }[]): number {
  // Approximate per-message overhead (role + separators)
  const OVERHEAD_PER_MESSAGE = 4;
  let tokens = 0;

  for (const msg of messages) {
    tokens += OVERHEAD_PER_MESSAGE;
    if (typeof msg.content === 'string') {
      tokens += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          tokens += estimateTokens(block.text);
        } else if (block.type === 'image') {
          // Rough estimate for image tokens
          tokens += 1000;
        }
      }
    }
  }

  return tokens;
}

export async function countTokensRoutes(server: FastifyInstance): Promise<void> {
  server.post('/messages/count_tokens', async (request, reply) => {
    const parsed = CountTokensSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;

    // Build the full message list (system + messages)
    const allMessages: Array<{ role: string; content: any }> = [];

    if (body.system) {
      const systemContent = typeof body.system === 'string'
        ? body.system
        : body.system.map((b: any) => b.text || '').join('\n');
      allMessages.push({ role: 'system', content: systemContent });
    }

    allMessages.push(...body.messages.map(m => ({ role: m.role, content: m.content ?? '' })));

    const tokenCount = countMessageTokens(allMessages);

    logger.debug({ model: body.model, tokenCount }, 'Token count estimated');

    return {
      input_tokens: tokenCount,
    };
  });
}
