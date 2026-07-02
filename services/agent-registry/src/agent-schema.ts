import { z } from 'zod';

// ---------------------------------------------------------------------------
// Agent Definition Schema
// ---------------------------------------------------------------------------

export const AgentTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('api'),
    path: z.string().min(1),
    method: z.enum(['GET', 'POST']),
  }),
  z.object({
    type: z.literal('webhook'),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal('schedule'),
    cron: z.string().min(1),
  }),
  z.object({
    type: z.literal('event'),
    eventName: z.string().min(1),
  }),
  z.object({
    type: z.literal('a2a'),
    agentCardUrl: z.string().url(),
  }),
]);

export type AgentTriggerInput = z.infer<typeof AgentTriggerSchema>;

export const AgentDefinitionCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional().default('1.0.0'),
  systemPrompt: z.string().max(100000).optional(),
  personality: z.string().max(5000).optional(),
  preferredModel: z.string().optional(),
  modelTier: z.enum(['auto', 'premium', 'budget']).optional().default('auto'),
  allowedTools: z.array(z.string()).optional().default([]),
  customTools: z.array(z.object({
    name: z.string().min(1),
    description: z.string(),
    parameters: z.record(z.unknown()).optional(),
  })).optional().default([]),
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    steps: z.array(z.object({
      id: z.string(),
      name: z.string(),
      tool: z.string(),
      input: z.record(z.unknown()).optional(),
      dependsOn: z.array(z.string()).optional(),
      condition: z.object({
        field: z.string(),
        operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'contains']),
        value: z.unknown(),
      }).optional(),
      retry: z.object({
        maxRetries: z.number().min(0).max(10),
        backoffMs: z.number().min(0),
        backoffMultiplier: z.number().optional(),
      }).optional(),
      timeout: z.number().optional(),
      onError: z.enum(['fail', 'skip', 'retry']).optional(),
    })),
    variables: z.record(z.unknown()).optional(),
    timeout: z.number().optional(),
  }).optional(),
  triggers: z.array(AgentTriggerSchema).optional().default([]),
  visibility: z.enum(['private', 'team', 'public']).optional().default('private'),
  tags: z.array(z.string().max(50)).optional().default([]),
  category: z.string().max(100).optional(),
  icon: z.string().optional(),
});

export type AgentDefinitionCreate = z.infer<typeof AgentDefinitionCreateSchema>;

export const AgentDefinitionUpdateSchema = AgentDefinitionCreateSchema.partial().extend({
  name: z.string().min(1).max(100).optional(),
});

export type AgentDefinitionUpdate = z.infer<typeof AgentDefinitionUpdateSchema>;

// ---------------------------------------------------------------------------
// Agent Instance Schema
// ---------------------------------------------------------------------------

export const AgentInstanceCreateSchema = z.object({
  agentDefinitionId: z.string().uuid(),
  configOverride: z.record(z.unknown()).optional().default({}),
});

export type AgentInstanceCreate = z.infer<typeof AgentInstanceCreateSchema>;

// ---------------------------------------------------------------------------
// Agent Chat Schema
// ---------------------------------------------------------------------------

export const AgentChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(100000),
});

export const AgentChatRequestSchema = z.object({
  messages: z.array(AgentChatMessageSchema).min(1).max(100),
  stream: z.boolean().optional().default(false),
  maxTokens: z.number().min(1).max(1000000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export type AgentChatRequest = z.infer<typeof AgentChatRequestSchema>;

// ---------------------------------------------------------------------------
// Marketplace Schema
// ---------------------------------------------------------------------------

export const AgentListingCreateSchema = z.object({
  agentDefinitionId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  longDescription: z.string().max(50000).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).optional().default([]),
  icon: z.string().optional(),
  screenshots: z.array(z.string().url()).optional().default([]),
  priceCents: z.number().min(0).optional().default(0),
});

export type AgentListingCreate = z.infer<typeof AgentListingCreateSchema>;

export const AgentRatingCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().max(2000).optional(),
});

export type AgentRatingCreate = z.infer<typeof AgentRatingCreateSchema>;

// ---------------------------------------------------------------------------
// Query / Filter Schema
// ---------------------------------------------------------------------------

export const AgentListQuerySchema = z.object({
  visibility: z.enum(['private', 'team', 'public']).optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  page: z.number().min(1).optional().default(1),
  limit: z.number().min(1).max(100).optional().default(20),
});

export type AgentListQuery = z.infer<typeof AgentListQuerySchema>;

export const MarketplaceQuerySchema = z.object({
  category: z.string().optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['rating', 'installs', 'newest', 'price']).optional().default('rating'),
  page: z.number().min(1).optional().default(1),
  limit: z.number().min(1).max(100).optional().default(20),
});

export type MarketplaceQuery = z.infer<typeof MarketplaceQuerySchema>;
