import { describe, it, expect } from 'vitest';

import { agentRuntimeService } from '@dmr-x/agent-runtime';

// Minimal AgentDefinition stub sufficient for buildSystemPrompt.
// `skills: []` makes resolveSkills return [] (it try/catches) so no DB is hit.
const makeDef = (over: Record<string, unknown> = {}) =>
  ({
    name: 'test-agent',
    humanName: 'Test Agent',
    allowedTools: ['skill_create', 'skill_patch'],
    skills: [],
    ...over,
  } as any);

describe('buildSystemPrompt skill-capture nudge', () => {
  it('soft reminder only when turn is undefined (dispatch single-shot)', async () => {
    const p = await agentRuntimeService.buildSystemPrompt(makeDef({ skillNudgeInterval: 3 }));
    expect(p).toContain('Skill Capture');
    expect(p).not.toContain('SKILL-CAPTURE TURN');
  });

  it('shows SKILL-CAPTURE TURN on a turn that is a multiple of the interval', async () => {
    const p = await agentRuntimeService.buildSystemPrompt(makeDef({ skillNudgeInterval: 3 }), 3);
    expect(p).toContain('Skill Capture');
    expect(p).toContain('SKILL-CAPTURE TURN');
  });

  it('soft reminder but no actionable nudge on a non-multiple turn', async () => {
    const p = await agentRuntimeService.buildSystemPrompt(makeDef({ skillNudgeInterval: 3 }), 1);
    expect(p).toContain('Skill Capture');
    expect(p).not.toContain('SKILL-CAPTURE TURN');
  });

  it('no nudge text at all when skillNudgeInterval is 0', async () => {
    const p = await agentRuntimeService.buildSystemPrompt(makeDef({ skillNudgeInterval: 0 }), 3);
    expect(p).not.toContain('Skill Capture');
    expect(p).not.toContain('SKILL-CAPTURE TURN');
  });

  it('no nudge text when skillNudgeInterval is undefined', async () => {
    const p = await agentRuntimeService.buildSystemPrompt(makeDef());
    expect(p).not.toContain('Skill Capture');
    expect(p).not.toContain('SKILL-CAPTURE TURN');
  });

  it('does not show actionable nudge on turn 0 even if it is a multiple', async () => {
    const p = await agentRuntimeService.buildSystemPrompt(makeDef({ skillNudgeInterval: 3 }), 0);
    expect(p).toContain('Skill Capture');
    expect(p).not.toContain('SKILL-CAPTURE TURN');
  });
});
