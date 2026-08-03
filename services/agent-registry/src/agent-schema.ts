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
  humanName: z.string().max(100).optional(),
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
  skills: z.array(z.string()).optional().default([]),
  skillNudgeInterval: z.number().int().min(0).max(100).optional().default(8),
  verifyOnStop: z.boolean().optional().default(false),
  // Opt-in: emit a structured plan before the first ReAct turn (plan-then-execute).
  planMode: z.boolean().optional().default(false),
  // Opt-in: compact early tool-activity turns once the transcript grows large.
  historyCompaction: z.boolean().optional().default(false),
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
  // Optional client-supplied conversation id. When omitted a per-request
  // conversation is created, so concurrent callers never share a transcript.
  conversationId: z.string().min(1).max(256).optional(),
  maxSteps: z.number().int().min(1).max(50).optional(),
  max_cost_budget: z.number().positive().optional(),
  // Opt-in: composable SDK stop conditions for the durable loop.
  stopWhen: z.array(z.object({
    type: z.enum(['step_count', 'tool_call', 'text_match', 'max_tokens', 'max_cost', 'finish_reason']),
    value: z.union([z.number(), z.string()]),
  })).optional(),
  // Opt-in: pause before executing tool calls, persisted as awaiting_approval for /resume.
  approvalRequired: z.boolean().optional().default(false),
  // Opt-in: human approval decisions supplied on the /resume path.
  approvalDecisions: z.array(z.object({
    tool_call_id: z.string(),
    approved: z.boolean(),
    result: z.any().optional(),
  })).optional(),
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
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(1000).optional().default(20),
});

export type AgentListQuery = z.infer<typeof AgentListQuerySchema>;

export const MarketplaceQuerySchema = z.object({
  category: z.string().optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['rating', 'installs', 'newest', 'price']).optional().default('rating'),
  // Query params arrive as strings from the router — coerce like
  // AgentListQuerySchema above, or any ?page=&limit= request 500s.
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
});

export type MarketplaceQuery = z.infer<typeof MarketplaceQuerySchema>;

// ---------------------------------------------------------------------------
// Import Schema
// ---------------------------------------------------------------------------

/**
 * Canonical, expanded category list used across the platform (agents,
 * marketplace, and imports). Improves on the original 6-category set by
 * covering the full division set used by agent repos such as agency-agents.
 */
export const AGENT_CATEGORIES = [
  'Academic',
  'Design',
  'Engineering',
  'Finance',
  'Game Development',
  'GIS',
  'Healthcare',
  'Marketing',
  'Operations',
  'Paid Media',
  'Product',
  'Project Management',
  'Research',
  'Sales',
  'Security',
  'Spatial Computing',
  'Specialized',
  'Support',
  'Testing',
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

/**
 * Request body for POST /v1/agents/import.
 * Source modes:
 *  - github: fetch all .md agent definitions from a public repo
 *  - zip:    multipart upload of a .zip containing .md agent definitions
 *  - text:   a single pasted .md (or .agent/.json) agent definition
 *
 * Visibility is forced to 'public' on import regardless of input, per policy.
 */
export const AgentImportRequestSchema = z.object({
  source: z.enum(['github', 'zip', 'text']),
  githubUrl: z.string().url().optional(),
  content: z.string().optional(),
  filename: z.string().optional(),
  // Options (may also be supplied as query params for multipart uploads)
  category: z.string().optional(),
  modelTier: z.enum(['auto', 'premium', 'budget']).optional().default('auto'),
});

export type AgentImportRequest = z.infer<typeof AgentImportRequestSchema>;

export const ImportedAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  instanceId: z.string(),
  category: z.string().nullable(),
});

export const AgentImportResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ file: z.string(), error: z.string() })),
  agents: z.array(ImportedAgentSchema),
});

export type AgentImportResult = z.infer<typeof AgentImportResultSchema>;
