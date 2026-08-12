import { describe, it, expect, beforeAll } from 'vitest';

import {
  getRegisteredToolDefinitions,
  registerToolHandler,
  registerToolDefinition,
  type RegisteredToolDefinition,
} from '../../apps/gateway/src/routes/tools.routes.js';

// A subagent's allowedTools is a list of names (see agent-schema.ts).
// Phase 2c "tools always on": empty/absent allowedTools → the full registered
// standard set; an explicit non-empty list narrows.
function buildAgentTools(allowedTools: string[]): RegisteredToolDefinition[] | undefined {
  const defs =
    !allowedTools || allowedTools.length === 0
      ? getRegisteredToolDefinitions()
      : getRegisteredToolDefinitions(allowedTools);
  return defs.length > 0 ? defs : undefined;
}

describe('subagent tool wiring (tools: undefined bug fix)', () => {
  beforeAll(() => {
    // Simulate server bootstrap registering the coding tool handlers + schemas.
    registerToolHandler('read_file', async () => ({}), {
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    });
    registerToolHandler('bash', async () => ({}), {
      description: 'Run a shell command',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    });
    registerToolDefinition('search_files', {
      description: 'Search file contents',
      parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    });
  });

  it('returns real OpenAI-format schemas for allowed tools (not undefined)', () => {
    const tools = buildAgentTools(['read_file', 'bash', 'search_files']);
    expect(tools).toBeDefined();
    expect(tools).toHaveLength(3);

    const names = tools!.map((t) => t.function.name).sort();
    expect(names).toEqual(['bash', 'read_file', 'search_files']);

    // Every def must be a valid OpenAI function-tool object the model can consume.
    for (const t of tools!) {
      expect(t.type).toBe('function');
      expect(t.function).toHaveProperty('name');
      expect(t.function).toHaveProperty('description');
      expect(t.function).toHaveProperty('parameters');
      expect(t.function.parameters).toHaveProperty('type', 'object');
    }
  });

  it('narrows the tool list to the agent allowedTools (enforcement boundary)', () => {
    const tools = buildAgentTools(['bash']);
    expect(tools).toBeDefined();
    expect(tools).toHaveLength(1);
    expect(tools![0].function.name).toBe('bash');
  });

  it('returns the FULL standard tool set when the agent has no allowed tools (tools always on)', () => {
    // Empty/absent allowedTools now means "everything", not "tool-less".
    const fromEmpty = buildAgentTools([]);
    const fromUndefined = buildAgentTools(undefined as unknown as string[]);
    expect(fromEmpty).toBeDefined();
    expect(fromUndefined).toBeDefined();
    expect(fromEmpty!.map((t) => t.function.name).sort()).toEqual(['bash', 'read_file', 'search_files']);
    expect(fromUndefined!.map((t) => t.function.name).sort()).toEqual(['bash', 'read_file', 'search_files']);
  });

  it('skips tool names that have no registered definition', () => {
    const tools = buildAgentTools(['bash', 'nonexistent_tool']);
    expect(tools).toBeDefined();
    expect(tools).toHaveLength(1);
    expect(tools![0].function.name).toBe('bash');
  });
});
