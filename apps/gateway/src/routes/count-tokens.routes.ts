import { ValidationError } from '@dmr-x/core';
import { tokenizerRegistry } from '@dmr-x/tokenizers';
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

    const tokenizer = tokenizerRegistry.get(body.model);
    const tokenCount = tokenizer.countMessageTokens(allMessages);

    logger.debug({ model: body.model, tokenCount, tokenizer: tokenizer.family }, 'Token count estimated');

    return {
      input_tokens: tokenCount,
      tokenizer_used: tokenizer.family,
    };
  });
}
