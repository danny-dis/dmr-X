import { describe, it, expect } from 'vitest';

import { buildAgentCard, validateAgentCard } from '../../services/mcp-server/src/a2a/agent-card.js';

const TOOLS = [
  { name: 'dmrx_chat', description: 'Chat completion' },
  { name: 'dmrx_generate_image', description: 'Image generation' },
];

describe('A2A agent card — v1.0 dual shape', () => {
  it('emits supportedInterfaces with major.minor protocolVersion', () => {
    const card = buildAgentCard({ url: 'https://agent.example/a2a' }, TOOLS);
    expect(Array.isArray(card.supportedInterfaces)).toBe(true);
    expect(card.supportedInterfaces.length).toBeGreaterThan(0);
    const primary = card.supportedInterfaces[0];
    expect(primary.url).toBe('https://agent.example/a2a');
    expect(primary.protocolBinding).toBe('JSONRPC');
    expect(primary.protocolVersion).toBe('1.0');
  });

  it('keeps the legacy 0.3.0 fields for back-compat', () => {
    const card = buildAgentCard({ url: 'https://agent.example/a2a' }, TOOLS);
    expect(card.url).toBe('https://agent.example/a2a');
    expect(card.preferredTransport).toBe('JSONRPC');
    expect(card.protocolVersion).toBe('0.3.0');
  });

  it('primary interface url matches the legacy url field', () => {
    const card = buildAgentCard({ url: 'https://x.test/a2a' }, TOOLS);
    expect(card.supportedInterfaces[0].url).toBe(card.url);
  });

  it('appends additionalInterfaces after the primary', () => {
    const card = buildAgentCard(
      {
        url: 'https://agent.example/a2a',
        additionalInterfaces: [
          { url: 'https://grpc.example/a2a', protocolBinding: 'GRPC', protocolVersion: '1.0' },
        ],
      },
      TOOLS,
    );
    expect(card.supportedInterfaces).toHaveLength(2);
    expect(card.supportedInterfaces[1].protocolBinding).toBe('GRPC');
  });

  it('carries tenant onto the primary interface when configured', () => {
    const card = buildAgentCard({ url: 'https://agent.example/a2a', tenant: 'acme' }, TOOLS);
    expect(card.supportedInterfaces[0].tenant).toBe('acme');
  });

  it('omits tenant and iconUrl when not configured', () => {
    const card = buildAgentCard({ url: 'https://agent.example/a2a' }, TOOLS);
    expect(card.supportedInterfaces[0]).not.toHaveProperty('tenant');
    expect(card).not.toHaveProperty('iconUrl');
  });

  it('emits iconUrl when configured', () => {
    const card = buildAgentCard(
      { url: 'https://agent.example/a2a', iconUrl: 'https://agent.example/icon.png' },
      TOOLS,
    );
    expect(card.iconUrl).toBe('https://agent.example/icon.png');
  });
});

describe('A2A agent card — validation', () => {
  it('accepts a well-formed card', () => {
    const card = buildAgentCard({ url: 'https://agent.example/a2a' }, TOOLS);
    expect(validateAgentCard(card)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a card with no interfaces', () => {
    const card = buildAgentCard({ url: 'https://agent.example/a2a' }, TOOLS);
    card.supportedInterfaces = [];
    const result = validateAgentCard(card);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/supportedInterfaces/i);
  });

  it('rejects an interface missing protocolVersion', () => {
    const card = buildAgentCard({ url: 'https://agent.example/a2a' }, TOOLS);
    // @ts-expect-error — deliberately invalid for the negative case
    card.supportedInterfaces[0] = { url: 'https://x.test', protocolBinding: 'JSONRPC' };
    const result = validateAgentCard(card);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/protocolVersion/i);
  });

  it('rejects a full patch version like 1.0.1 on an interface', () => {
    const card = buildAgentCard({ url: 'https://agent.example/a2a' }, TOOLS);
    card.supportedInterfaces[0].protocolVersion = '1.0.1';
    const result = validateAgentCard(card);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/major\.minor/i);
  });
});
