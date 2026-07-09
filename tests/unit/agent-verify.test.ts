import { describe, it, expect } from 'vitest';
import { AgentDefinitionCreateSchema } from '@dmr-x/agent-registry';

describe('agent verifyOnStop schema', () => {
  it('accepts verifyOnStop: true', () => {
    const r = AgentDefinitionCreateSchema.safeParse({ name: 'x', verifyOnStop: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.verifyOnStop).toBe(true);
  });

  it('defaults verifyOnStop to false when omitted', () => {
    const r = AgentDefinitionCreateSchema.safeParse({ name: 'x' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.verifyOnStop).toBe(false);
  });
});
