import { z } from 'zod';
/**
 * Shared Zod schemas for route request validation.
 * Extracted from chat.routes.ts, tools.routes.ts, and agentic.routes.ts
 * to eliminate duplication and ensure contract consistency.
 */
export const ChatMessageSchema = z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.array(z.any())]).nullable().optional(),
    name: z.string().optional(),
    tool_calls: z.array(z.any()).optional(),
    tool_call_id: z.string().optional(),
});
export const ToolSchema = z.object({
    type: z.literal('function'),
    function: z.object({
        name: z.string(),
        description: z.string().optional(),
        parameters: z.record(z.unknown()).optional(),
    }),
});
export const ToolCallSchema = z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
        name: z.string(),
        arguments: z.string(),
    }),
});
//# sourceMappingURL=shared-schemas.js.map