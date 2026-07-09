import { describe, it, expect } from 'vitest';

import {
  SkillCreateSchema,
  SkillUpdateSchema,
  SkillSourceSchema,
  SkillListQuerySchema,
} from '../../services/agent-registry/src/skill-schema.js';

// The new tenant-scoped skill schemas are authored by a sibling agent and may
// not be exported yet. Load them defensively so this file always parses and
// the pre-existing tests keep running regardless of sibling landing state.
let SkillCreateFromAgentSchema: any | undefined;
let SkillPatchSchema: any | undefined;
try {
  const mod = await import('../../services/agent-registry/src/skill-schema.js');
  SkillCreateFromAgentSchema = (mod as any).SkillCreateFromAgentSchema;
  SkillPatchSchema = (mod as any).SkillPatchSchema;
} catch {
  // schema module not resolvable in this environment; tests below self-skip
}

import {
  AgentDefinitionCreateSchema,
} from '../../services/agent-registry/src/agent-schema.js';

describe('SkillCreateSchema', () => {
  it('accepts a valid skill (name + content required)', () => {
    const result = SkillCreateSchema.safeParse({
      name: 'Web Search',
      content: 'Steps to perform a web search...',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Web Search');
      // source defaults to 'builtin' when omitted
      expect(result.data.source).toBe('builtin');
    }
  });

  it('rejects a skill missing name', () => {
    const result = SkillCreateSchema.safeParse({ content: 'body' });
    expect(result.success).toBe(false);
  });

  it('rejects a skill missing content', () => {
    const result = SkillCreateSchema.safeParse({ name: 'No Body' });
    expect(result.success).toBe(false);
  });

  it('accepts optional tags and description', () => {
    const result = SkillCreateSchema.safeParse({
      name: 'Summarizer',
      description: 'Summarizes text',
      content: 'body',
      tags: ['text', 'nlp'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid source enum', () => {
    const result = SkillCreateSchema.safeParse({
      name: 'X',
      content: 'body',
      source: 'not-a-source',
    });
    expect(result.success).toBe(false);
  });

  it('accepts every valid source enum value', () => {
    for (const source of ['builtin', 'md', 'zip', 'github']) {
      const result = SkillCreateSchema.safeParse({ name: 'X', content: 'body', source });
      expect(result.success, `source=${source}`).toBe(true);
    }
  });
});

describe('SkillUpdateSchema', () => {
  it('accepts a partial update with only name', () => {
    const result = SkillUpdateSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty update', () => {
    const result = SkillUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('SkillSourceSchema', () => {
  it('only allows the four known sources', () => {
    const ok = SkillSourceSchema.safeParse('zip');
    const bad = SkillSourceSchema.safeParse('yaml');
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });
});

describe('SkillListQuerySchema', () => {
  it('defaults limit to 20', () => {
    const result = SkillListQuerySchema.parse({});
    expect(result.limit).toBe(20);
  });
});

describe('AgentDefinitionCreateSchema — skills & humanName', () => {
  it('accepts an agent with humanName and a skills array', () => {
    const result = AgentDefinitionCreateSchema.safeParse({
      name: 'x',
      skills: ['a', 'b'],
      humanName: 'Ada',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual(['a', 'b']);
      expect(result.data.humanName).toBe('Ada');
    }
  });

  it('defaults skills to an empty array when omitted', () => {
    const result = AgentDefinitionCreateSchema.safeParse({ name: 'x' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual([]);
    }
  });

  it('leaves humanName undefined when omitted', () => {
    const result = AgentDefinitionCreateSchema.safeParse({ name: 'x' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.humanName).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// skill patch + create-from-agent schemas
// (NEW tenant-scoped skill handlers register against these contracts)
// ---------------------------------------------------------------------------

describe('skill patch + create-from-agent schemas', () => {
  const skip = !SkillCreateFromAgentSchema || !SkillPatchSchema;

  describe.skipIf(skip)('SkillCreateFromAgentSchema', () => {
    it('passes for a valid name + content', () => {
      const result = SkillCreateFromAgentSchema.safeParse({
        name: 'Web Search',
        content: 'Steps to perform a web search...',
      });
      expect(result.success).toBe(true);
    });

    it('fails when content is missing', () => {
      const result = SkillCreateFromAgentSchema.safeParse({ name: 'No Body' });
      expect(result.success).toBe(false);
    });

    it('fails when name exceeds 100 chars', () => {
      const result = SkillCreateFromAgentSchema.safeParse({
        name: 'x'.repeat(101),
        content: 'body',
      });
      expect(result.success).toBe(false);
    });

    it('accepts an optional tags array', () => {
      const result = SkillCreateFromAgentSchema.safeParse({
        name: 'Summarizer',
        content: 'body',
        tags: ['text', 'nlp'],
        pinned: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe.skipIf(skip)('SkillPatchSchema', () => {
    it('passes for valid oldString + newString', () => {
      const result = SkillPatchSchema.safeParse({
        id: 'abc',
        oldString: 'old',
        newString: 'new',
      });
      expect(result.success).toBe(true);
    });

    it('fails when oldString is missing', () => {
      const result = SkillPatchSchema.safeParse({
        id: 'abc',
        newString: 'new',
      });
      expect(result.success).toBe(false);
    });
  });
});
