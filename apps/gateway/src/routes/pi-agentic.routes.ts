import { ValidationError } from '@dmr-x/core';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PiAgentService, type PiAgentRequest } from '../services/pi/pi-agent.service.js';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.any(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

const PiAgenticRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema).min(1),
  tools: z.array(z.any()).optional(),
  max_steps: z.number().int().positive().max(50).optional().default(10),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional().default(false),
  system_prompt: z.string().optional(),
});

let piAgentService: PiAgentService | null = null;

function getPiAgentService(server: FastifyInstance): PiAgentService {
  if (!piAgentService) {
    piAgentService = new PiAgentService(server);
  }
  return piAgentService;
}

function writeSSE(reply: { raw: { write: (data: string) => void } }, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function piAgenticRoutes(server: FastifyInstance): Promise<void> {
  const service = getPiAgentService(server);

  /**
   * POST /agentic/pi
   *
   * Pi-powered agentic endpoint. Uses Pi's Agent class for multi-turn
   * tool calling with streaming support.
   *
   * Events:
   * - agent_event: Agent lifecycle events (turn_end, tool_execution, etc.)
   * - done: Stream complete
   * - error: Error events
   */
  server.post('/agentic/pi', async (request, reply) => {
    const parsed = PiAgenticRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();

    const agentRequest: PiAgentRequest = {
      model: body.model,
      messages: body.messages as any[],
      tools: body.tools,
      max_steps: body.max_steps,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: body.stream,
      system_prompt: body.system_prompt,
    };

    if (body.stream) {
      try {
        await service.runStreaming(agentRequest, reply as any, requestId);
      } catch (err) {
        logger.error({ err, requestId }, 'Pi agent streaming error');
        writeSSE(reply, 'error', { error: { message: 'Request failed' } });
        reply.raw.end();
      }
      return reply;
    }

    // Non-streaming
    try {
      const result = await service.run(agentRequest, requestId);
      return {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.content,
            },
            finish_reason: 'stop',
          },
        ],
        steps_completed: result.steps,
      };
    } catch (err) {
      logger.error({ err, requestId }, 'Pi agent error');
      throw new ValidationError('Agent execution failed');
    }
  });
}
