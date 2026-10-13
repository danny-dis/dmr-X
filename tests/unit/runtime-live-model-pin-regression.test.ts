import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openIsolatedTestDb } from './isolated-db.js';
import { createInitialState } from '../../packages/utils/src/index.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';

let db: Awaited<ReturnType<typeof openIsolatedTestDb>>;
beforeAll(async () => { db = await openIsolatedTestDb('dmrx-model-pin-'); });
afterAll(async () => { await db.close(); });

describe('hosted agent model selection', () => {
  it.each([false, true])('passes the admitted model into the actual inference request (stream=%s)', async (stream) => {
    const model = 'provider-uuid/openai/gpt-oss-20b';
    const route = vi.fn().mockResolvedValue({ response: {
      requestId: 'pin-request', providerId: 'provider-uuid', modelId: 'openai/gpt-oss-20b',
      message: { role: 'assistant', content: 'PIN_OK' },
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }, finishReason: 'stop',
    } });
    const conversation = createInitialState('pin-conversation-' + stream);
    conversation.messages = [{ role: 'user', content: 'test pin' }];
    await runAgentChatLoop({
      conversation, maxSteps: 2, model, agentTools: ['bash'],
      agentToolDefs: [{ type: 'function', function: { name: 'bash', description: 'shell', parameters: { type: 'object' } } }],
      body: { messages: [{ role: 'user', content: 'test pin' }] }, requestId: 'pin-request',
      tenant: { id: 'pin-tenant', name: 'pin-tenant' }, router: { route } as any,
      context: { instanceId: 'pin-instance', definition: { id: 'pin-definition' }, instance: {} } as any,
      runtime: {} as any, stream, onStreamEvent: vi.fn(), freeOnly: true,
      buildSystemPrompt: async () => 'runtime pin test',
      agentDefinition: { id: 'pin-definition', name: 'Pin verifier', tenantId: 'pin-tenant', allowedTools: ['bash'] },
      loadedSkillIds: [],
    } as any);
    const sent = route.mock.calls[0][0];
    expect(sent.model).toBe(model);
    expect(sent.metadata.freeTierStrategy).toBe('free_only');
    expect(sent.tools[0].function.name).toBe('bash');
  });
});
