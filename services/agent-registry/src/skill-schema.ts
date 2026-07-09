import { z } from 'zod';

// ---------------------------------------------------------------------------
// Skill Schema
// ---------------------------------------------------------------------------

export const SkillSourceSchema = z.enum(['builtin', 'md', 'zip', 'github', 'agent']);

export type SkillSource = z.infer<typeof SkillSourceSchema>;

export const SkillCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  content: z.string().min(1).max(100000),
  tags: z.array(z.string().max(50)).optional(),
  source: SkillSourceSchema.optional().default('builtin'),
  externalId: z.string().optional(),
  pinned: z.boolean().optional(),
});

export type SkillCreate = z.infer<typeof SkillCreateSchema>;

export const SkillUpdateSchema = SkillCreateSchema.partial().extend({
  name: z.string().min(1).max(100).optional(),
});

export type SkillUpdate = z.infer<typeof SkillUpdateSchema>;

export const SkillListQuerySchema = z.object({
  search: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
});

export type SkillListQuery = z.infer<typeof SkillListQuerySchema>;

export const SkillPatchSchema = z.object({
  oldString: z.string().min(1),
  // allow empty string to delete a span
  newString: z.string(),
});

export type SkillPatch = z.infer<typeof SkillPatchSchema>;

export const SkillCreateFromAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  content: z.string().min(1).max(100000),
  tags: z.array(z.string()).max(20).optional(),
  pinned: z.boolean().optional().default(false),
});

export type SkillCreateFromAgent = z.infer<typeof SkillCreateFromAgentSchema>;
