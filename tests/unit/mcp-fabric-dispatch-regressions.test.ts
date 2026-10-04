import { describe, expect, it, vi } from 'vitest';
import { MCPServerRegistry, type ConnectedServer } from '../../services/mcp-client/src/registry.js';
import { MCPClient } from '../../services/mcp-client/src/client.js';

function fixture(registry: MCPServerRegistry, id: string, names: string[], allowedTools?: string[]) {
  const callTool = vi.fn(async (args: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(args) }] }));
  const listTools = vi.fn(async () => ({ tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) }));
  const server = { config: { id, name: id, transport: 'http', allowedTools }, client: { callTool, listTools, close: vi.fn() }, connectedAt: new Date(), tools: names.map(name => ({ name })) } as unknown as ConnectedServer;
  const internal = registry as unknown as { servers: Map<string, ConnectedServer>; indexServerTools: (server: ConnectedServer) => void };
  internal.servers.set(id, server);
  internal.indexServerTools(server);
  return { server, callTool, listTools };
}

describe('MCP fabric dispatch and index security', () => {
  it('refuses ambiguous raw names but resolves canonical names', () => {
    const r = new MCPServerRegistry(); const a = fixture(r, 'a', ['read']); fixture(r, 'b', ['read']);
    expect(r.findServerForTool('read')).toBeUndefined();
    expect(r.findServerForTool('a__read')).toBe(a.server);
  });
  it('rejects tools outside the allowlist before invoking the upstream', async () => {
    const r = new MCPServerRegistry(); const s = fixture(r, 'a', ['read', 'write'], ['read']);
    await expect(r.callTool('a', 'write', {})).rejects.toThrow(/not allowed/);
    expect(s.callTool).not.toHaveBeenCalled();
  });
  it('rejects tools absent from discovery before invoking the upstream', async () => {
    const r = new MCPServerRegistry(); const s = fixture(r, 'a', ['read']);
    await expect(r.callTool('a', 'gone', {})).rejects.toThrow(/not found/);
    expect(s.callTool).not.toHaveBeenCalled();
  });
  it('removes stale tools only after a successful refresh', async () => {
    const r = new MCPServerRegistry(); const s = fixture(r, 'a', ['old']);
    s.listTools.mockResolvedValueOnce({ tools: [{ name: 'new', inputSchema: { type: 'object' } }] });
    await r.refreshTools('a');
    expect(r.findServerForTool('old')).toBeUndefined();
    expect(r.findServerForTool('a__new')).toBe(s.server);
  });
  it('retains discovery if a refresh fails', async () => {
    const r = new MCPServerRegistry(); const s = fixture(r, 'a', ['read']);
    s.listTools.mockRejectedValueOnce(new Error('offline'));
    await expect(r.refreshTools('a')).rejects.toThrow('offline');
    expect(r.findServerForTool('read')).toBe(s.server);
  });
  it('does not erase another server when disconnecting a colliding server', async () => {
    const r = new MCPServerRegistry(); const a = fixture(r, 'a', ['read']); fixture(r, 'b', ['read']);
    await r.disconnect('b');
    expect(r.findServerForTool('read')).toBe(a.server);
  });
  it('forwards the actual upstream name, including embedded separators', async () => {
    const c = new MCPClient(); const s = fixture(c.getRegistry(), 'my__server', ['tool__name']);
    await c.callTool('my__server__tool__name', { value: 1 });
    expect(s.callTool.mock.calls[0][0]).toMatchObject({ name: 'tool__name', arguments: { value: 1 } });
  });
  it('preserves a unique unqualified upstream name containing separators', async () => {
    const c = new MCPClient(); const s = fixture(c.getRegistry(), 'server', ['tool__name']);
    await c.callTool('tool__name', {});
    expect(s.callTool.mock.calls[0][0]).toMatchObject({ name: 'tool__name' });
  });
  it('fails closed on colliding canonical references', () => {
    const r = new MCPServerRegistry(); fixture(r, 'a', ['b__tool']); fixture(r, 'a__b', ['tool']);
    expect(r.findServerForTool('a__b__tool')).toBeUndefined();
  });
});
