import { describe, expect, it } from 'bun:test';
import { buildAgentCard } from '../../services/mcp-server/src/a2a/agent-card.ts';

const tools = [{ name: 'dmrx_chat', description: 'Chat completion' }];

describe('A2A 0.3 preferred transport endpoint', () => {
  it('advertises the real RPC endpoint rather than an unroutable bare origin', () => {
    const card = buildAgentCard({ url: 'http://127.0.0.1:47922' }, tools);
    expect(card.url).toBe('http://127.0.0.1:47922/a2a');
    expect(card.url).toBe(card.supportedInterfaces[0].url);
  });
  it('normalizes a trailing slash for both client generations', () => {
    const card = buildAgentCard({ url: 'http://127.0.0.1:47922/' }, tools);
    expect(card.url).toBe('http://127.0.0.1:47922/a2a');
    expect(card.url).toBe(card.supportedInterfaces[0].url);
  });
  it('preserves an explicitly configured custom RPC path', () => {
    const card = buildAgentCard({ url: 'https://agent.example/custom/rpc' }, tools);
    expect(card.url).toBe('https://agent.example/custom/rpc');
    expect(card.url).toBe(card.supportedInterfaces[0].url);
  });
});
