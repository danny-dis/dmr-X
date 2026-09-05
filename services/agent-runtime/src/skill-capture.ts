// ---------------------------------------------------------------------------
// Skill Auto-Capture
//
// Post-session pattern detection: analyzes a completed agent conversation
// transcript and suggests skills that could be captured from repeated
// workflows, tool usage patterns, and reusable response templates.
//
// This is the "L5" TODO item: pattern detection, not just nudge.
// ---------------------------------------------------------------------------

import { agentRegistryService } from '@dmr-x/agent-registry';
import { logger } from '@dmr-x/utils';

export interface SkillSuggestion {
  name: string;
  description: string;
  content: string;
  tags: string[];
  confidence: number; // 0-1, how likely this is a real reusable pattern
  source: {
    type: 'tool_pattern' | 'response_template' | 'workflow_sequence';
    evidence: string; // what we saw that triggered this suggestion
    occurrences: number;
  };
}

export interface CaptureAnalysis {
  suggestions: SkillSuggestion[];
  stats: {
    totalTurns: number;
    toolCalls: number;
    uniqueTools: number;
    repeatedPatterns: number;
  };
}

/**
 * Analyze a completed conversation transcript for skill-capture opportunities.
 *
 * Detection strategies:
 * 1. Tool pattern: same tool called 3+ times with similar arguments
 * 2. Response template: assistant produces similar structured responses
 * 3. Workflow sequence: same sequence of tools used multiple times
 */
export function analyzeTranscript(
  messages: Array<{ role: string; content: string; tool_calls?: any[] }>,
  loadedSkillIds: string[],
): CaptureAnalysis {
  const suggestions: SkillSuggestion[] = [];
  const stats = {
    totalTurns: 0,
    toolCalls: 0,
    uniqueTools: 0,
    repeatedPatterns: 0,
  };

  // Count assistant turns and tool calls
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  stats.totalTurns = assistantMessages.length;

  // Collect all tool calls
  const allToolCalls: Array<{ name: string; arguments: any }> = [];
  for (const msg of assistantMessages) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        allToolCalls.push({
          name: tc.function?.name ?? 'unknown',
          arguments: tc.function?.arguments ?? {},
        });
        stats.toolCalls++;
      }
    }
  }

  const uniqueToolNames = new Set(allToolCalls.map((tc) => tc.name));
  stats.uniqueTools = uniqueToolNames.size;

  // Strategy 1: Tool pattern detection (same tool 3+ times)
  const toolCounts = new Map<string, number>();
  for (const tc of allToolCalls) {
    toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
  }

  for (const [toolName, count] of toolCounts) {
    if (count >= 3) {
      stats.repeatedPatterns++;
      suggestions.push({
        name: `${toolName} workflow`,
        description: `Reusable pattern: "${toolName}" used ${count} times in a single session`,
        content: generateToolSkillContent(toolName, count),
        tags: ['auto-captured', 'tool-pattern', toolName],
        confidence: Math.min(0.9, 0.5 + count * 0.1),
        source: {
          type: 'tool_pattern',
          evidence: `Tool "${toolName}" called ${count} times`,
          occurrences: count,
        },
      });
    }
  }

  // Strategy 2: Response template detection (similar structured responses)
  const responseTemplates = detectResponseTemplates(assistantMessages);
  for (const template of responseTemplates) {
    stats.repeatedPatterns++;
    suggestions.push({
      name: template.name,
      description: `Reusable response template: "${template.name}"`,
      content: template.content,
      tags: ['auto-captured', 'response-template'],
      confidence: template.confidence,
      source: {
        type: 'response_template',
        evidence: template.evidence,
        occurrences: template.occurrences,
      },
    });
  }

  // Strategy 3: Workflow sequence detection (same tool sequence 2+ times)
  const sequences = detectWorkflowSequences(allToolCalls);
  for (const seq of sequences) {
    stats.repeatedPatterns++;
    suggestions.push({
      name: seq.name,
      description: `Reusable workflow: ${seq.tools.join(' → ')}`,
      content: generateSequenceSkillContent(seq.tools, seq.occurrences),
      tags: ['auto-captured', 'workflow-sequence'],
      confidence: seq.confidence,
      source: {
        type: 'workflow_sequence',
        evidence: `Sequence "${seq.tools.join(' → ')}" repeated ${seq.occurrences} times`,
        occurrences: seq.occurrences,
      },
    });
  }

  // Filter out suggestions for skills that were already loaded
  const loadedSkillNames = new Set(loadedSkillIds);
  const filtered = suggestions.filter((s) => !loadedSkillNames.has(s.name));

  return {
    suggestions: filtered,
    stats,
  };
}

/**
 * Generate skill content for a frequently-used tool.
 */
function generateToolSkillContent(toolName: string, count: number): string {
  return `# ${toolName} Workflow Pattern

Auto-captured from session: tool "${toolName}" was used ${count} times.

## When to use this skill
- When the task involves ${toolName} operations
- When ${toolName} is needed repeatedly in a workflow

## Pattern
This skill provides guidance for efficient ${toolName} usage based on observed patterns.

## Usage
\`\`\`
Invoke ${toolName} with the required parameters.
\`\`\`

---
*Auto-captured by DMR-X skill detection. Review and refine before relying on this.*
`;
}

/**
 * Detect similar structured responses from the assistant.
 */
function detectResponseTemplates(
  messages: Array<{ role: string; content: string }>,
): Array<{ name: string; content: string; confidence: number; evidence: string; occurrences: number }> {
  const templates: Array<{ name: string; content: string; confidence: number; evidence: string; occurrences: number }> = [];

  // Group assistant messages by structural similarity (simple heuristic: first 100 chars)
  const prefixGroups = new Map<string, string[]>();
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.content) continue;
    const prefix = msg.content.slice(0, 100).trim();
    if (prefix.length < 20) continue; // skip short responses
    const group = prefixGroups.get(prefix) ?? [];
    group.push(msg.content);
    prefixGroups.set(prefix, group);
  }

  for (const [prefix, responses] of prefixGroups) {
    if (responses.length >= 2) {
      templates.push({
        name: `Response pattern: ${prefix.slice(0, 50)}...`,
        content: `# Response Template

Auto-captured: ${responses.length} similar responses detected.

## Pattern prefix
${prefix}

## Full example
${responses[0]}

---
*Auto-captured by DMR-X skill detection.*
`,
        confidence: Math.min(0.8, 0.4 + responses.length * 0.15),
        evidence: `${responses.length} responses starting with "${prefix.slice(0, 50)}"`,
        occurrences: responses.length,
      });
    }
  }

  return templates;
}

/**
 * Detect repeated sequences of tool calls.
 */
function detectWorkflowSequences(
  toolCalls: Array<{ name: string; arguments: any }>,
): Array<{ name: string; tools: string[]; occurrences: number; confidence: number }> {
  const sequences: Array<{ name: string; tools: string[]; occurrences: number; confidence: number }> = [];

  if (toolCalls.length < 4) return sequences;

  // Look for repeated sequences of length 2-4
  for (const seqLen of [2, 3, 4]) {
    const seqCounts = new Map<string, number>();

    for (let i = 0; i <= toolCalls.length - seqLen; i++) {
      const seq = toolCalls.slice(i, i + seqLen).map((tc) => tc.name);
      const key = seq.join(' → ');
      seqCounts.set(key, (seqCounts.get(key) ?? 0) + 1);
    }

    for (const [seqKey, count] of seqCounts) {
      if (count >= 2) {
        const tools = seqKey.split(' → ');
        sequences.push({
          name: `Workflow: ${tools.join(' → ')}`,
          tools,
          occurrences: count,
          confidence: Math.min(0.85, 0.5 + count * 0.1),
        });
      }
    }
  }

  return sequences;
}

/**
 * Generate skill content for a repeated workflow sequence.
 */
function generateSequenceSkillContent(tools: string[], occurrences: number): string {
  return `# Workflow Sequence: ${tools.join(' → ')}

Auto-captured from session: this sequence of ${tools.length} tools was repeated ${occurrences} times.

## Steps
${tools.map((t, i) => `${i + 1}. **${t}** — invoke as needed`).join('\n')}

## When to use
- When this sequence of operations is needed
- For repetitive multi-step workflows

---
*Auto-captured by DMR-X skill detection. Review and refine before relying on this.*
`;
}

/**
 * Persist a captured skill to the database.
 */
export async function persistCapturedSkill(
  tenantId: string,
  suggestion: SkillSuggestion,
): Promise<{ id: string; name: string } | null> {
  try {
    const skill = await agentRegistryService.createSkill(tenantId, {
      name: suggestion.name,
      description: suggestion.description,
      content: suggestion.content,
      tags: suggestion.tags,
      source: 'agent',
      pinned: false,
    });

    logger.info({ tenantId, skillId: skill.id, name: skill.name }, 'Skill auto-captured');
    return { id: skill.id, name: skill.name };
  } catch (err) {
    logger.warn({ tenantId, err, suggestion: suggestion.name }, 'Failed to persist auto-captured skill');
    return null;
  }
}
