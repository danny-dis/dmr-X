import { describe, it, expect, beforeEach } from 'vitest';

import { handleRpc, setAgentCardProvider } from '../../services/mcp-server/src/a2a/jsonrpc.js';
import { resetTaskManager } from '../../services/mcp-server/src/a2a/task-manager.js';

const rpc = (method: string, params: unknown = {}) =>
  handleRpc({ jsonrpc: '2.0', id: 1, method, params } as never, {} as never);

describe('A2A tasks/list', () => {
  beforeEach(() => resetTaskManager());

  it('returns a tasks array and does not 32601', async () => {
    const res = await rpc('tasks/list');
    expect(res.error).toBeUndefined();
    expect(Array.isArray((res.result as { tasks: unknown[] }).tasks)).toBe(true);
  });

  it('honours pageSize as the limit', async () => {
    const res = await rpc('tasks/list', { pageSize: 5 });
    expect(res.error).toBeUndefined();
    expect((res.result as { tasks: unknown[] }).tasks.length).toBeLessThanOrEqual(5);
  });

  it('rejects a pageSize above the spec maximum of 100', async () => {
    const res = await rpc('tasks/list', { pageSize: 5000 });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32602);
  });

  it('rejects a non-integer pageSize', async () => {
    const res = await rpc('tasks/list', { pageSize: 2.5 });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32602);
  });

  it('accepts a contextId filter', async () => {
    const res = await rpc('tasks/list', { contextId: 'ctx-none' });
    expect(res.error).toBeUndefined();
    expect((res.result as { tasks: unknown[] }).tasks).toHaveLength(0);
  });

  it('still returns METHOD_NOT_FOUND for an unknown method', async () => {
    const res = await rpc('tasks/bogus');
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
  });
});

describe('A2A agent/getExtendedCard', () => {
  it('returns the agent card when a provider is registered', async () => {
    setAgentCardProvider(() => ({ name: 'DMR-X Agent', skills: [{ id: 'dmrx_chat' }] }));
    const res = await rpc('agent/getExtendedCard');
    expect(res.error).toBeUndefined();
    expect((res.result as { name: string }).name).toBe('DMR-X Agent');
  });

  it('errors cleanly when no provider is registered', async () => {
    setAgentCardProvider(null);
    const res = await rpc('agent/getExtendedCard');
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32603);
  });

  it('accepts the authenticatedExtendedCard alias', async () => {
    setAgentCardProvider(() => ({ name: 'DMR-X Agent' }));
    const res = await rpc('agent/authenticatedExtendedCard');
    expect(res.error).toBeUndefined();
    expect((res.result as { name: string }).name).toBe('DMR-X Agent');
  });

  it('does not leak the provider across a reset to null', async () => {
    setAgentCardProvider(() => ({ name: 'X' }));
    expect((await rpc('agent/getExtendedCard')).error).toBeUndefined();
    setAgentCardProvider(null);
    expect((await rpc('agent/getExtendedCard')).error).toBeDefined();
  });
});
