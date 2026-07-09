import { agentRegistryService, type AgentDefinition, type AgentInstance } from '@dmr-x/agent-registry';
import { billingService } from '@dmr-x/billing';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

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
  private activeContexts = new Map<string, AgentExecutionContext>();

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

    const requestId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const context: AgentExecutionContext = {
      instanceId,
      definition,
      instance,
      requestId,
      tenantId,
    };

    this.activeContexts.set(requestId, context);
    return context;
  }

  /**
   * Build the system prompt for an agent, incorporating its definition.
   * Resolves linked skills (tenant-scoped) and inlines their markdown content.
   */
  buildSystemPrompt(definition: AgentDefinition): string {
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

    // 4. Skills (tenant-scoped, content inlined)
    const skillIds: string[] = (definition.skills ?? []).filter(Boolean);
    if (skillIds.length > 0) {
      const skillBlocks = this.resolveSkills(definition.tenantId, skillIds);
      if (skillBlocks.length > 0) {
        const skillSection = skillBlocks
          .map((s) => `## Skill: ${s.name}\n${s.description ? s.description + '\n' : ''}${s.content}`)
          .join('\n\n');
        parts.push(`Skills:\n\n${skillSection}`);
      }
    }

    // 5. Tool constraints
    if (definition.allowedTools.length > 0) {
      parts.push(`You have access to these tools: ${definition.allowedTools.join(', ')}. Only use the tools listed here.`);
    } else {
      parts.push('You do not have access to any tools. Respond based on your knowledge alone.');
    }

    return parts.join('\n\n');
  }

  /**
   * Resolve an agent's linked skills by id or name, scoped to its tenant.
   * Returns resolved skills with their markdown content. Unresolvable skill
   * references are skipped (never fatal to a run). Db access is synchronous.
   */
  private resolveSkills(tenantId: string, skillRefs: string[]): { name: string; description: string; content: string }[] {
    try {
      const db = getDb();
      const placeholders = skillRefs.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT name, description, content FROM skills
           WHERE tenant_id = ? AND (id IN (${placeholders}) OR name IN (${placeholders}))`,
        )
        .all(tenantId, ...skillRefs, ...skillRefs) as Array<{ name: string; description: string | null; content: string | null }>;
      return rows.map((r) => ({
        name: r.name,
        description: r.description ?? '',
        content: r.content ?? '',
      }));
    } catch (err) {
      logger.warn({ tenantId, skillRefs, err }, 'Failed to resolve agent skills; skipping');
      return [];
    }
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
   * Get available tools for this agent based on its allowed tools list.
   */
  getAvailableTools(definition: AgentDefinition): Array<{ name: string; description: string }> {
    // For now, return the allowed tool names as-is
    // In the future, this could filter from the MCP server's tool registry
    return definition.allowedTools.map((name) => ({
      name,
      description: `Tool: ${name}`,
    }));
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

  /**
   * Get the execution context by request ID.
   */
  getContext(requestId: string): AgentExecutionContext | undefined {
    return this.activeContexts.get(requestId);
  }

  /**
   * Remove an execution context.
   */
  removeContext(requestId: string): void {
    this.activeContexts.delete(requestId);
  }
}

export const agentRuntimeService = new AgentRuntimeService();
