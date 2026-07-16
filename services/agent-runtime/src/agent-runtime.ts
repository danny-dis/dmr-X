import { agentRegistryService, type AgentDefinition, type AgentInstance } from '@dmr-x/agent-registry';
import { billingService } from '@dmr-x/billing';
import { getDb } from '@dmr-x/db';
import { agentMemoryManager } from '@dmr-x/memory';
import { logger } from '@dmr-x/utils';
import { skillLoader } from './skill-loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentExecutionContext {
  instanceId: string;
  definition: AgentDefinition;
  instance: AgentInstance;
  requestId: string;
  tenantId: string;
}

export interface AgentTurnResult {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    error?: string;
  }>;
  model: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
}

export interface AgentChatOptions {
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime Service
// ---------------------------------------------------------------------------

export class AgentRuntimeService {
  /**
   * Load an agent execution context from a deployed instance.
   */
  async loadContext(instanceId: string, tenantId: string): Promise<AgentExecutionContext | null> {
    const instance = await agentRegistryService.getInstance(instanceId);
    if (!instance || instance.tenantId !== tenantId || instance.status !== 'active') {
      return null;
    }

    const definition = await agentRegistryService.getDefinition(instance.agentDefinitionId);
    if (!definition) return null;

    return {
      instanceId,
      definition,
      instance,
      requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
    };
  }

  /**
   * Build the system prompt for an agent, incorporating its definition.
   *
   * Skills use PROGRESSIVE DISCLOSURE (borrowed from Vercel EVE): each
   * declared skill's *description* is always advertised as a one-line hint,
   * but only the bodies of skills in `loadedSkillIds` are inlined into the
   * prompt. The model calls the `load_skill` tool to add a skill's body to
   * `loadedSkillIds` mid-run. This avoids bloating every turn with every
   * skill's full content.
   */
  async buildSystemPrompt(
    definition: AgentDefinition,
    turn?: number,
    loadedSkillIds: string[] = [],
  ): Promise<string> {
    const parts: string[] = [];

    // 1. Identity block
    if (definition.humanName) {
      parts.push(`You are ${definition.humanName} (also known as ${definition.name}).`);
    } else {
      parts.push(`You are ${definition.name}.`);
    }

    // 2. Personality
    if (definition.personality) {
      parts.push(`Personality: ${definition.personality}`);
    }

    // 3. Configured system prompt
    if (definition.systemPrompt) {
      parts.push(definition.systemPrompt);
    }

    // 4. Skills — progressive disclosure
    const skillIds: string[] = (definition.skills ?? []).filter(Boolean);
    if (skillIds.length > 0) {
      // 4a. Always advertise each skill's description as a hint.
      const adverts = skillLoader.advertise(definition.tenantId, skillIds);
      const advertSection = skillLoader.advertismentSection(adverts);
      if (advertSection) parts.push(advertSection);

      // 4b. Inline ONLY the bodies of skills that have been explicitly loaded.
      const loaded = skillIds.filter((id) =>
        loadedSkillIds.includes(id) || loadedSkillIds.includes(id.toLowerCase()),
      );
      if (loaded.length > 0) {
        const skillBlocks = skillLoader.resolveBody
          ? loaded
              .map((id) => {
                const s = skillLoader.resolveBody(definition.tenantId, id);
                return s ? `## Skill: ${s.name}\n${s.description ? s.description + '\n' : ''}${s.content}` : null;
              })
              .filter(Boolean as unknown as (x: string | null) => x is string)
          : [];
        if (skillBlocks.length > 0) {
          parts.push(`Loaded skills:\n\n${skillBlocks.join('\n\n')}`);
        }
      }
    }

    // 4.5. Skill Capture nudge (opt-in; purely instructional, non-fatal)
    if (definition.skillNudgeInterval && definition.skillNudgeInterval > 0) {
      const ownedSkillNames = this.resolveSkills(definition.tenantId, definition.skills ?? [])
        .map((s) => s.name);
      const ownedList = ownedSkillNames.length > 0 ? ownedSkillNames.join(', ') : 'none yet';
      parts.push(
        `Skill Capture: Every ${definition.skillNudgeInterval} turns, consider whether anything reusable was ` +
        `learned that is worth capturing as a skill, or refining an existing one. ` +
        `Skills you currently possess: ${ownedList}. ` +
        `You may create new skills via the skill_create tool or refine existing (non-pinned) ones via skill_patch.`,
      );

      // STRONG/ACTIONABLE nudge — only on hard turn counter multiples of the interval.
      // When `turn` is undefined (e.g. single-shot dispatch), never show this.
      if (
        turn !== undefined &&
        turn > 0 &&
        turn % definition.skillNudgeInterval === 0
      ) {
        parts.push(
          `SKILL-CAPTURE TURN: now is the moment to act. If anything reusable was learned this session, call ` +
          `skill_create to capture it, or skill_patch to refine an existing (non-pinned) skill. ` +
          `If nothing is worth saving, continue normally.`,
        );
      }
    }

    // 4.75. Relevant memory (non-fatal; fallback to nothing on any failure)
    try {
      const memories = await agentMemoryManager.prefetchForPrompt(
        definition.tenantId,
        definition.id ?? definition.name,
      );
      if (memories && memories.trim().length > 0) {
        parts.push(`Relevant memory:\n\n${memories}`);
      }
    } catch {
      // Memory prefetch is best-effort; never block the run on it.
    }

    // 5. Tool constraints
    if (definition.allowedTools.length > 0) {
      parts.push(`You have access to these tools: ${definition.allowedTools.join(', ')}. Only use the tools listed here.`);
    } else {
      parts.push('You do not have access to any tools. Respond based on your knowledge alone.');
    }

    // 6. Verify-on-stop self-check nudge (opt-in)
    if (definition.verifyOnStop) {
      parts.push(
        'Before finishing, perform a self-check: verify your final answer is correct, complete, and free ' +
        'of errors or unresolved steps. If something is wrong, fix it before responding.',
      );
    }

    return parts.join('\n\n');
  }

  /**
   * Resolve an agent's linked skills by id or name, scoped to its tenant.
   * Thin wrapper over the shared SkillLoader (progressive disclosure).
   */
  private resolveSkills(tenantId: string, skillRefs: string[]): { name: string; description: string; content: string }[] {
    return skillRefs.map((ref) => skillLoader.resolveBody(tenantId, ref)).filter(Boolean) as {
      name: string;
      description: string;
      content: string;
    }[];
  }

  /**
   * Determine which model to use for this agent.
   */
  resolveModel(definition: AgentDefinition): string {
    if (definition.preferredModel) {
      return definition.preferredModel;
    }

    // Fallback based on model tier
    switch (definition.modelTier) {
      case 'premium': return 'auto-smart';
      case 'budget': return 'auto-fast';
      default: return 'auto';
    }
  }

  /**
   * Record an execution result for tracking and billing.
   * Calculates actual cost from model pricing via the billing service.
   */
  async recordExecution(
    context: AgentExecutionContext,
    input: string,
    output: string,
    toolsUsed: string[],
    modelUsed: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    status: 'success' | 'error' = 'success',
    error?: string,
    providerId?: string,
  ): Promise<void> {
    // Calculate cost from model pricing
    let costCents = 0;
    if (inputTokens > 0 || outputTokens > 0) {
      const resolvedProvider = providerId ?? this.extractProvider(modelUsed);
      const resolvedModel = this.extractModel(modelUsed);

      if (resolvedProvider && resolvedModel) {
        try {
          const pricing = await billingService.getModelPricing(resolvedProvider, resolvedModel);
          if (pricing) {
            costCents = billingService.calculateCost(inputTokens, outputTokens, pricing);
          }
        } catch (err) {
          logger.warn({ modelUsed, error: err }, 'Failed to calculate agent execution cost');
        }
      }
    }

    await agentRegistryService.recordExecution({
      agentInstanceId: context.instanceId,
      tenantId: context.tenantId,
      input,
      output,
      toolsUsed,
      modelUsed,
      inputTokens,
      outputTokens,
      costCents,
      durationMs,
      status,
      error,
    });
  }

  /**
   * Extract provider ID from a model string like "openai/gpt-4o" or "gpt-4o".
   */
  private extractProvider(model: string): string | null {
    if (model.includes('/')) {
      return model.split('/')[0];
    }
    // Common model-to-provider mappings
    if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('gemini-')) return 'google';
    if (model.startsWith('deepseek-')) return 'deepseek';
    return null;
  }

  /**
   * Extract model ID from a model string like "openai/gpt-4o" or "gpt-4o".
   */
  private extractModel(model: string): string {
    if (model.includes('/')) {
      return model.split('/').slice(1).join('/');
    }
    return model;
  }

}

export const agentRuntimeService = new AgentRuntimeService();
