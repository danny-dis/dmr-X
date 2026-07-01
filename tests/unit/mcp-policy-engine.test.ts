import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the database module
vi.mock('@dmr-x/db', () => ({
  getDb: vi.fn(),
}));

import { ToolInvocationPolicyEngine } from '../../services/mcp-server/src/policies/tool-invocation-policy.js';
import { getDb } from '@dmr-x/db';

describe('ToolInvocationPolicyEngine', () => {
  let engine: ToolInvocationPolicyEngine;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      }),
    };
    
    (getDb as any).mockReturnValue(mockDb);
    engine = new ToolInvocationPolicyEngine();
  });

  describe('evaluate()', () => {
    it('allows tool call when no policies exist', () => {
      mockDb.prepare().all.mockReturnValue([]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: { messages: [] },
      });

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
    });

    it('allows tool call when policy matches allow action', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-1',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'allow',
          priority: 10,
          is_active: true,
        },
      ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: {},
      });

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
      expect(result.policy?.id).toBe('policy-1');
    });

    it('denies tool call when policy matches deny action', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-2',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'deny',
          description: 'Chat disabled for this tenant',
          priority: 10,
          is_active: true,
        },
      ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: {},
      });

      expect(result.allowed).toBe(false);
      expect(result.action).toBe('deny');
      expect(result.reason).toBe('Chat disabled for this tenant');
    });

    it('respects priority ordering', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-low',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'allow',
          priority: 1,
          is_active: true,
        },
        {
          id: 'policy-high',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'deny',
          priority: 10,
          is_active: true,
        },
      ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: {},
      });

      expect(result.allowed).toBe(false);
      expect(result.policy?.id).toBe('policy-high');
    });

    it('evaluates tenant policies before global policies', () => {
      mockDb.prepare()
        .all
        .mockReturnValueOnce([
          {
            id: 'tenant-allow',
            tenant_id: 'default',
            tool_name: 'dmrx_chat',
            action: 'allow',
            priority: 5,
            is_active: true,
          },
        ])
        .mockReturnValueOnce([
          {
            id: 'global-deny',
            tenant_id: '*',
            tool_name: 'dmrx_chat',
            action: 'deny',
            priority: 10,
            is_active: true,
          },
        ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: {},
      });

      // Tenant policy should match first
      expect(result.allowed).toBe(true);
      expect(result.policy?.id).toBe('tenant-allow');
    });
  });

  describe('tool name matching', () => {
    it('matches exact tool names', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-exact',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'deny',
          priority: 10,
          is_active: true,
        },
      ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: {},
      });

      expect(result.allowed).toBe(false);
    });

    it('matches wildcard tool names', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-wildcard',
          tenant_id: 'default',
          tool_name: 'dmrx_*',
          action: 'deny',
          priority: 10,
          is_active: true,
        },
      ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_generate_image',
        tool_input: {},
      });

      expect(result.allowed).toBe(false);
    });

    it('matches global wildcard', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-global',
          tenant_id: 'default',
          tool_name: '*',
          action: 'deny',
          priority: 10,
          is_active: true,
        },
      ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'any_tool',
        tool_input: {},
      });

      expect(result.allowed).toBe(false);
    });

    it('does not match unrelated tools', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-specific',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'deny',
          priority: 10,
          is_active: true,
        },
      ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_generate_image',
        tool_input: {},
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('condition matching', () => {
    it('matches policies with no conditions', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-no-conditions',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'deny',
          conditions: null,
          priority: 10,
          is_active: true,
        },
      ]);

      const result = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: { messages: [] },
      });

      expect(result.allowed).toBe(false);
    });

    it('matches policies with simple conditions', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-conditions',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'deny',
          conditions: JSON.stringify({ model: 'gpt-4' }),
          priority: 10,
          is_active: true,
        },
      ]);

      // Should match
      const result1 = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: { model: 'gpt-4' },
      });
      expect(result1.allowed).toBe(false);

      // Should not match
      const result2 = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: { model: 'gpt-3.5-turbo' },
      });
      expect(result2.allowed).toBe(true);
    });

    it('matches policies with nested conditions', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-nested',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'deny',
          conditions: JSON.stringify({ routing: { provider: 'openai' } }),
          priority: 10,
          is_active: true,
        },
      ]);

      // Should match
      const result1 = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: { routing: { provider: 'openai' } },
      });
      expect(result1.allowed).toBe(false);

      // Should not match
      const result2 = engine.evaluate({
        tenant_id: 'default',
        tool_name: 'dmrx_chat',
        tool_input: { routing: { provider: 'anthropic' } },
      });
      expect(result2.allowed).toBe(true);
    });
  });

  describe('evaluateBatch()', () => {
    it('evaluates multiple contexts', () => {
      mockDb.prepare().all.mockReturnValue([
        {
          id: 'policy-batch',
          tenant_id: 'default',
          tool_name: 'dmrx_chat',
          action: 'deny',
          priority: 10,
          is_active: true,
        },
      ]);

      const results = engine.evaluateBatch([
        { tenant_id: 'default', tool_name: 'dmrx_chat', tool_input: {} },
        { tenant_id: 'default', tool_name: 'dmrx_generate_image', tool_input: {} },
      ]);

      expect(results.size).toBe(2);
      expect(results.get(0)!.allowed).toBe(false);
      expect(results.get(1)!.allowed).toBe(true);
    });
  });
});
