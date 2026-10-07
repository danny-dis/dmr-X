import { z } from 'zod';

const RTKOptionsSchema = z.object({
  maxRepeated: z.number().int().min(1).max(1000).optional(),
  maxItems: z.number().int().min(1).max(1000).optional(),
  trimWhitespace: z.boolean().optional(),
  collapseBlankLines: z.boolean().optional(),
}).strict();

const CavemanOptionsSchema = z.object({
  allowLossy: z.boolean().optional(),
  preserveTechnical: z.boolean().optional(),
  aggressiveness: z.number().int().min(1).max(3).optional(),
  maxLineLength: z.number().int().min(1).max(10000).optional(),
}).strict();

const CommentStripOptionsSchema = z.object({
  removeSingleLine: z.boolean().optional(),
  removeMultiLine: z.boolean().optional(),
  removeDocblocks: z.boolean().optional(),
  language: z.enum(['auto', 'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'rust', 'go', 'ruby', 'php', 'swift', 'kotlin', 'css', 'html', 'sql', 'shell']).optional(),
}).strict();

export const CompressionConfigSchema = z.object({
  enabled: z.boolean().optional(),
  reversible: z.boolean().optional(),
  engine: z.enum(['headroom', 'rtk', 'caveman', 'comment-strip', 'auto']).optional(),
  minTokensToCompress: z.number().int().min(1).max(1_000_000).optional(),
  proxyUrl: z.string().url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)).optional(),
  apiKey: z.string().max(4096).optional(),
  rtkOptions: RTKOptionsSchema.optional(),
  cavemanOptions: CavemanOptionsSchema.optional(),
  commentStripOptions: CommentStripOptionsSchema.optional(),
}).strict();

export type CompressionConfigInput = z.infer<typeof CompressionConfigSchema>;
export { RTKOptionsSchema, CavemanOptionsSchema, CommentStripOptionsSchema };
