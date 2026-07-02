import { describe, it, expect } from 'vitest';

import {
  AgentDefinitionCreateSchema,
  AgentDefinitionUpdateSchema,
  AgentInstanceCreateSchema,
  AgentChatRequestSchema,
  AgentListingCreateSchema,
  AgentRatingCreateSchema,
  AgentListQuerySchema,
  MarketplaceQuerySchema,
  AgentTriggerSchema,
} from '../../services/agent-registry/src/agent-schema.js';

describe('agent-schema', () => {
  describe('AgentDefinitionCreateSchema', () => {
    it('should accept valid minimal input', () => {
      const result = AgentDefinitionCreateSchema.safeParse({ name: 'Test Agent' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Agent');
        expect(result.data.version).toBe('1.0.0');
        expect(result.data.modelTier).toBe('auto');
        expect(result.data.visibility).toBe('private');
        expect(result.data.allowedTools).toEqual([]);
      }
    });

    it('should accept full input', () => {
      const result = AgentDefinitionCreateSchema.safeParse({
        name: 'Full Agent',
        description: 'A full agent',
        version: '2.0.0',
        systemPrompt: 'You are helpful',
        personality: 'Friendly',
        preferredModel: 'claude-3-5-sonnet',
        modelTier: 'premium',
        allowedTools: ['dmrx_chat', 'dmrx_workflow'],
        customTools: [{ name: 'custom', description: 'Custom tool' }],
        triggers: [{ type: 'schedule', cron: '*/5 * * * *' }],
        visibility: 'public',
        tags: ['helper', 'production'],
        category: 'Support',
        icon: 'https://example.com/icon.png',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = AgentDefinitionCreateSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid version format', () => {
      const result = AgentDefinitionCreateSchema.safeParse({
        name: 'Agent',
        version: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid visibility', () => {
      const result = AgentDefinitionCreateSchema.safeParse({
        name: 'Agent',
        visibility: 'global',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid modelTier', () => {
      const result = AgentDefinitionCreateSchema.safeParse({
        name: 'Agent',
        modelTier: 'enterprise',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AgentTriggerSchema', () => {
    it('should accept schedule trigger', () => {
      const result = AgentTriggerSchema.safeParse({ type: 'schedule', cron: '*/5 * * * *' });
      expect(result.success).toBe(true);
    });

    it('should accept webhook trigger', () => {
      const result = AgentTriggerSchema.safeParse({ type: 'webhook', url: 'https://example.com/hook' });
      expect(result.success).toBe(true);
    });

    it('should accept event trigger', () => {
      const result = AgentTriggerSchema.safeParse({ type: 'event', eventName: 'deploy' });
      expect(result.success).toBe(true);
    });

    it('should accept api trigger', () => {
      const result = AgentTriggerSchema.safeParse({ type: 'api', path: '/run', method: 'POST' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid trigger type', () => {
      const result = AgentTriggerSchema.safeParse({ type: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('AgentChatRequestSchema', () => {
    it('should accept valid chat request', () => {
      const result = AgentChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.stream).toBe(false);
      }
    });

    it('should accept streaming request', () => {
      const result = AgentChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty messages', () => {
      const result = AgentChatRequestSchema.safeParse({ messages: [] });
      expect(result.success).toBe(false);
    });

    it('should reject invalid role', () => {
      const result = AgentChatRequestSchema.safeParse({
        messages: [{ role: 'admin', content: 'Hello' }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AgentRatingCreateSchema', () => {
    it('should accept valid rating', () => {
      const result = AgentRatingCreateSchema.safeParse({ rating: 4, review: 'Great agent!' });
      expect(result.success).toBe(true);
    });

    it('should accept rating without review', () => {
      const result = AgentRatingCreateSchema.safeParse({ rating: 5 });
      expect(result.success).toBe(true);
    });

    it('should reject rating below 1', () => {
      const result = AgentRatingCreateSchema.safeParse({ rating: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject rating above 5', () => {
      const result = AgentRatingCreateSchema.safeParse({ rating: 6 });
      expect(result.success).toBe(false);
    });
  });

  describe('MarketplaceQuerySchema', () => {
    it('should use defaults', () => {
      const result = MarketplaceQuerySchema.parse({});
      expect(result.sort).toBe('rating');
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should accept all filters', () => {
      const result = MarketplaceQuerySchema.parse({
        category: 'Sales',
        tag: 'production',
        search: 'email',
        sort: 'installs',
        page: 2,
        limit: 10,
      });
      expect(result.category).toBe('Sales');
      expect(result.sort).toBe('installs');
    });
  });
});
