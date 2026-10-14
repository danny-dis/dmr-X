import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaskExecutor } from '../../apps/gateway/src/lib/job-runner.js';

const gatewayUrl = 'http://executor.invalid';
const instanceId = 'agent/selected';
type Context = Parameters<ReturnType<typeof createTaskExecutor>>[0];
function context(assigned: boolean): Context {
  return {
    job: { id: 'job-status' },
    task: {
      id: 'task-status', jobId: 'job-status', title: 'Produce a deliverable',
      description: 'Preserve partial evidence', assignedInstanceId: assigned ? instanceId : null,
    },
    boardContext: '<untrusted-data>Dependency context</untrusted-data>',
  } as Context;
}
function stubAgent(body: unknown, assigned: boolean, httpStatus = 200) {
  const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!assigned && url === `${gatewayUrl}/v1/agentic/dispatch`) {
      expect(JSON.parse(String(init?.body))).toEqual({
        task: 'Produce a deliverable\nPreserve partial evidence', run: false,
      });
      return Response.json({ selected: { instanceId } });
    }
    expect(url).toBe(`${gatewayUrl}/v1/agents/agent%2Fselected/chat`);
    expect(init?.method).toBe('POST');
    const request = JSON.parse(String(init?.body));
    expect(request.stream).toBe(false);
    expect(request.messages[0].content).toContain(context(assigned).boardContext);
    return Response.json(body, { status: httpStatus });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const evidence = {
  agentName: 'Evidence agent', content: 'Partial work: sources collected, not delivered.',
  costUsd: 0.75, totalTokens: 750,
  usage: { cost: 0.01, total_tokens: 10 },
};
afterEach(() => vi.unstubAllGlobals());

for (const assigned of [true, false]) {
  describe(assigned ? 'assigned agent' : 'selection dispatch then agent chat', () => {
    it.each(['interrupted', 'awaiting_approval', 'error', 'in_progress', 'unknown_status'])
      ('rejects HTTP 200 operation status %s without losing run evidence', async (status) => {
        const fetch = stubAgent({ ...evidence, status }, assigned);
        const result = await createTaskExecutor({ gatewayUrl, apiKey: '', timeoutMs: 1000 })(context(assigned));
        expect(result.ok).toBe(false);
        expect(result).toMatchObject({
          agentName: evidence.agentName, summary: evidence.content, costUsd: 0.75, tokens: 750,
        });
        expect(result.error).toContain(status);
        expect(result).not.toHaveProperty('retryable');
        expect(fetch).toHaveBeenCalledTimes(assigned ? 1 : 2);
      });

    it.each([
      { error: { code: 'budget_exceeded', message: 'Budget exhausted after partial work' } },
      { status: 'completed', error: { message: 'Agent tool failed' } },
      { error: { code: 'agent_error' } },
      { error: {} },
      { error: 'Agent tool failed' },
    ])('rejects HTTP 200 error envelope %j with evidence and aggregate spend', async (envelope) => {
      const fetch = stubAgent({ ...evidence, ...envelope }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, apiKey: '', timeoutMs: 1000 })(context(assigned));
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({
        agentName: evidence.agentName, summary: evidence.content, costUsd: 0.75, tokens: 750,
      });
      expect(result.error).toContain('agent operation');
      const responseError = envelope.error;
      if (typeof responseError === 'object' && 'message' in responseError) {
        expect(result.error).toContain(responseError.message);
      }
      expect(fetch).toHaveBeenCalledTimes(assigned ? 1 : 2);
    });

    it('rejects a legacy status-absent result.error envelope', async () => {
      stubAgent({ ...evidence, error: null, result: { error: { message: 'Nested operation failure' } } }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, timeoutMs: 1000 })(context(assigned));
      expect(result).toMatchObject({
        ok: false, agentName: evidence.agentName, summary: evidence.content, costUsd: 0.75, tokens: 750,
      });
      expect(result.error).toContain('Nested operation failure');
    });

    it('accepts an explicit null result.error', async () => {
      stubAgent({ ...evidence, status: 'completed', result: { error: null } }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, timeoutMs: 1000 })(context(assigned));
      expect(result).toMatchObject({ ok: true, summary: evidence.content, costUsd: 0.75, tokens: 750 });
      expect(result.error).toBeUndefined();
    });

    it('does not mistake recoverable tool or artifact errors for an operation failure', async () => {
      stubAgent({
        ...evidence, status: 'completed',
        result: { artifacts: [{ error: { message: 'Artifact metadata only' } }] },
        artifacts: [{ error: 'Artifact metadata only' }],
        all_steps: [{ tool_results: [{ error: { message: 'Recovered tool error' } }] }],
      }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, timeoutMs: 1000 })(context(assigned));
      expect(result).toMatchObject({ ok: true, summary: evidence.content, costUsd: 0.75, tokens: 750 });
      expect(result.error).toBeUndefined();
    });

    it('retains legacy string result text', async () => {
      stubAgent({ result: 'Legacy delivered text' }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, timeoutMs: 1000 })(context(assigned));
      expect(result).toMatchObject({ ok: true, summary: 'Legacy delivered text', costUsd: 0, tokens: 0 });
      expect(result.error).toBeUndefined();
    });

    it.each(['completed', 'interrupted'])('keeps explicit zero aggregate totals for %s', async (status) => {
      stubAgent({ ...evidence, status, costUsd: 0, totalTokens: 0 }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, apiKey: '' })(context(assigned));
      expect(result).toMatchObject({ ok: status === 'completed', costUsd: 0, tokens: 0 });
    });

    it.each([
      { cost: 0.25, total_tokens: 250 },
      { total_cost: 0.25, totalTokens: 250 },
    ])('preserves legacy usage fallback %j on interrupted runs', async (usage) => {
      stubAgent({ status: 'interrupted', content: 'Partial evidence', usage }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, apiKey: '' })(context(assigned));
      expect(result).toMatchObject({
        ok: false, agentName: instanceId, summary: 'Partial evidence', costUsd: 0.25, tokens: 250,
      });
    });

    it('accepts completed with a null error and no usage', async () => {
      stubAgent({ status: 'completed', error: null, content: 'Delivered' }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, apiKey: '' })(context(assigned));
      expect(result).toMatchObject({ ok: true, summary: 'Delivered', costUsd: 0, tokens: 0 });
      expect(result.error).toBeUndefined();
    });

    it('keeps HTTP failures unsuccessful', async () => {
      stubAgent({ status: 'completed', error: { message: 'Not authorized' } }, assigned, 403);
      const result = await createTaskExecutor({ gatewayUrl, apiKey: '' })(context(assigned));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('agent call failed: 403');
    });

    it.each(['completed', undefined])('accepts completed or legacy status %s with aggregate totals', async (status) => {
      const fetch = stubAgent({ ...evidence, ...(status === undefined ? {} : { status }) }, assigned);
      const result = await createTaskExecutor({ gatewayUrl, apiKey: '', timeoutMs: 1000 })(context(assigned));
      expect(result).toMatchObject({
        ok: true, agentName: evidence.agentName, summary: evidence.content, costUsd: 0.75, tokens: 750,
      });
      expect(result.error).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(assigned ? 1 : 2);
    });
  });
}
