import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError, type UnifiedRequest } from '@dmr-x/core';
import { generateRequestId } from '@dmr-x/utils';
import type { Router } from '@dmr-x/router';
import {
  convertAnthropicRequestToUnified,
  convertUnifiedResponseToAnthropic,
} from '../converters/anthropic-converter.js';
import { createAnthropicSSEStream } from '../converters/anthropic-stream-serializer.js';

const AnthropicContentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    source: z.object({
      type: z.literal('base64'),
      media_type: z.string(),
      data: z.string(),
    }),
  }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(z.any())]).optional(),
  }),
]);

const AnthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(AnthropicContentBlockSchema)]),
});

const AnthropicToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.record(z.unknown()),
});

const AnthropicMessagesRequestSchema = z.object({
  model: z.string(),
  max_tokens: z.number().positive(),
  system: z.union([z.string(), z.array(z.any())]).optional(),
  messages: z.array(AnthropicMessageSchema).min(1),
  tools: z.array(AnthropicToolSchema).optional(),
  tool_choice: z
    .union([
      z.object({ type: z.literal('auto') }),
      z.object({ type: z.literal('any') }),
      z.object({ type: z.literal('none') }),
      z.object({ type: z.literal('tool'), name: z.string() }),
    ])
    .optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional().default(false),
  metadata: z.object({ user_id: z.string().optional() }).optional(),
});

export async function anthropicRoutes(server: FastifyInstance): Promise<void> {
  server.post('/messages', async (request, reply) => {
    const parsed = AnthropicMessagesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid Anthropic request', {
        errors: parsed.error.errors,
      });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;

    const unifiedRequest = convertAnthropicRequestToUnified(body, {
      requestId,
      tenant: (request as any).tenant,
      apiFormat: 'anthropic',
    });

    try {
      const { plan, response } = await router.route(unifiedRequest, {
        path: '/v1/messages',
        qualityTarget: 'balanced',
      });

      if (body.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const adapterRegistry = (server as any).adapterRegistry;
        const adapter = adapterRegistry.get(plan.primary.providerId);
        if (adapter) {
          const stream = adapter.executeStream(unifiedRequest);
          for await (const sseLine of createAnthropicSSEStream(stream, {
            model: response.modelId,
            requestId,
          })) {
            reply.raw.write(sseLine);
          }
        }
        reply.raw.end();
        return reply;
      }

      return convertUnifiedResponseToAnthropic(response);
    } catch (error) {
      throw error;
    }
  });
}
