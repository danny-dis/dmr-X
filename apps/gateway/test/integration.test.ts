// Integration test: Marketplace + Skill Capture flow
// Tests the full lifecycle: publish agent → browse marketplace → install → analyze session

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:47116';

describe('Marketplace Integration', () => {
  let agentId: string;
  let listingId: string;
  let instanceId: string;

  it('should publish an agent to the marketplace', async () => {
    // Get first agent
    const agentsRes = await fetch(`${GATEWAY_URL}/v1/agents?limit=1`);
    const agents = await agentsRes.json();
    expect(agents.items.length).toBeGreaterThan(0);
    agentId = agents.items[0].id;

    // Publish
    const publishRes = await fetch(`${GATEWAY_URL}/v1/agents/${agentId}/publish`, {
      method: 'POST',
    });
    expect(publishRes.ok).toBe(true);
    const listing = await publishRes.json();
    expect(listing.status).toBe('published');
    listingId = listing.id;
  });

  it('should browse the marketplace', async () => {
    const res = await fetch(`${GATEWAY_URL}/v1/marketplace`);
    const data = await res.json();
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.some((i: any) => i.id === listingId)).toBe(true);
  });

  it('should install from the marketplace', async () => {
    const res = await fetch(`${GATEWAY_URL}/v1/marketplace/${listingId}/install`, {
      method: 'POST',
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.instance).toBeDefined();
    expect(data.instance.status).toBe('active');
    instanceId = data.instance.id;
    expect(data.listing.installCount).toBeGreaterThan(0);
  });

  it('should search the marketplace', async () => {
    const res = await fetch(`${GATEWAY_URL}/v1/marketplace?search=test`);
    const data = await res.json();
    expect(data).toHaveProperty('items');
    expect(data).toHaveProperty('total');
  });
});

describe('Skill Capture Integration', () => {
  it('should analyze a transcript for skill suggestions', async () => {
    const messages = [
      { role: 'user', content: 'Run the tests' },
      { role: 'assistant', content: 'I will run the tests for you.', tool_calls: [{ id: '1', function: { name: 'bash', arguments: '{}', type: 'function' } }] },
      { role: 'assistant', content: 'Tests passed.' },
      { role: 'user', content: 'Run the tests again' },
      { role: 'assistant', content: 'Running tests again.', tool_calls: [{ id: '2', function: { name: 'bash', arguments: '{}', type: 'function' } }] },
      { role: 'assistant', content: 'Tests passed again.' },
      { role: 'user', content: 'Run the tests one more time' },
      { role: 'assistant', content: 'Running tests.', tool_calls: [{ id: '3', function: { name: 'bash', arguments: '{}', type: 'function' } }] },
      { role: 'assistant', content: 'All tests passed.' },
    ];

    // Get an instance
    const agentsRes = await fetch(`${GATEWAY_URL}/v1/agents/instances?status=active&limit=1`);
    const agents = await agentsRes.json();
    expect(agents.items.length).toBeGreaterThan(0);
    const instanceId = agents.items[0].id;

    const res = await fetch(`${GATEWAY_URL}/v1/agents/${instanceId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    expect(res.ok).toBe(true);
    const analysis = await res.json();
    expect(analysis).toHaveProperty('suggestions');
    expect(analysis).toHaveProperty('stats');
    expect(analysis.stats.totalTurns).toBeGreaterThan(0);
    expect(analysis.stats.toolCalls).toBeGreaterThan(0);
  });

  it('should return empty suggestions for short transcripts', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    const agentsRes = await fetch(`${GATEWAY_URL}/v1/agents/instances?status=active&limit=1`);
    const agents = await agentsRes.json();
    const instanceId = agents.items[0].id;

    const res = await fetch(`${GATEWAY_URL}/v1/agents/${instanceId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    expect(res.ok).toBe(true);
    const analysis = await res.json();
    expect(analysis.suggestions.length).toBe(0);
  });
});

describe('Health & Status', () => {
  it('should return health status', async () => {
    const res = await fetch(`${GATEWAY_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('should list agents', async () => {
    const res = await fetch(`${GATEWAY_URL}/v1/agents`);
    const data = await res.json();
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
  });
});
