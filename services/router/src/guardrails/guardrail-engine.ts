import { logger } from '@dmr-x/utils';
import type {
  GuardrailPlugin,
  GuardrailCheckContext,
  GuardrailCheckResult,
  GuardrailViolation,
} from './guardrail-plugin.interface.js';
import { RegexGuardrailPlugin, type RegexGuardrailConfig } from './plugins/regex-guardrail.js';
import { WebhookGuardrailPlugin, type WebhookGuardrailConfig } from './plugins/webhook-guardrail.js';
import { ModerationApiGuardrailPlugin, type ModerationApiGuardrailConfig } from './plugins/moderation-api-guardrail.js';

export interface GuardrailEngineConfig {
  /** Enable input guardrails (default: true) */
  enableInput: boolean;
  /** Enable output guardrails (default: false) */
  enableOutput: boolean;
  /** Global action on detection: 'block' | 'flag' | 'log' (default: 'flag') */
  onDetection: 'block' | 'flag' | 'log';
}

// Re-export types for backward compatibility
export type { GuardrailViolation } from './guardrail-plugin.interface.js';

export interface GuardrailResult {
  allowed: boolean;
  violations: GuardrailViolation[];
  flaggedContent?: string;
}

const DEFAULT_ENGINE_CONFIG: GuardrailEngineConfig = {
  enableInput: true,
  enableOutput: false,
  onDetection: 'flag',
};

/**
 * Guardrail engine — plugin-based architecture for input and output protection.
 *
 * Supports:
 * - Built-in regex guardrails (PII, injection, content filtering)
 * - External webhook guardrails (custom services)
 * - Moderation API guardrails (OpenAI, Anthropic, Google)
 * - Per-tenant plugin configuration
 * - Input and output scanning
 *
 * @example
 * ```ts
 * const engine = new GuardrailEngine();
 *
 * // Add plugins
 * engine.addPlugin(new RegexGuardrailPlugin({ enablePII: true, enableInjection: true }));
 * engine.addPlugin(new WebhookGuardrailPlugin('custom', { url: 'https://...' }));
 *
 * // Check input
 * const result = await engine.checkInput('Hello world', { requestId: '123' });
 *
 * // Check output
 * const outputResult = await engine.checkOutput('Response text', { requestId: '123' });
 * ```
 */
export class GuardrailEngine {
  private config: GuardrailEngineConfig;
  private plugins: GuardrailPlugin[] = [];
  private tenantPlugins: Map<string, GuardrailPlugin[]> = new Map();

  constructor(config?: Partial<GuardrailEngineConfig>) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
  }

  /**
   * Add a guardrail plugin.
   */
  addPlugin(plugin: GuardrailPlugin): void {
    this.plugins.push(plugin);
    this.plugins.sort((a, b) => a.priority - b.priority);
    logger.info({ plugin: plugin.name, priority: plugin.priority }, 'Added guardrail plugin');
  }

  /**
   * Remove a guardrail plugin by name.
   */
  removePlugin(name: string): void {
    this.plugins = this.plugins.filter(p => p.name !== name);
    logger.info({ plugin: name }, 'Removed guardrail plugin');
  }

  /**
   * Add a plugin for a specific tenant (overrides global plugins for that tenant).
   */
  addTenantPlugin(tenantId: string, plugin: GuardrailPlugin): void {
    const plugins = this.tenantPlugins.get(tenantId) || [];
    plugins.push(plugin);
    plugins.sort((a, b) => a.priority - b.priority);
    this.tenantPlugins.set(tenantId, plugins);
  }

  /**
   * Get plugins for a specific tenant (falls back to global plugins).
   */
  private getPlugins(tenantId?: string): GuardrailPlugin[] {
    if (tenantId) {
      const tenantSpecific = this.tenantPlugins.get(tenantId);
      if (tenantSpecific && tenantSpecific.length > 0) {
        return tenantSpecific;
      }
    }
    return this.plugins;
  }

  /**
   * Check input content (user → LLM).
   */
  async checkInput(
    content: string,
    context: Omit<GuardrailCheckContext, 'direction'>,
  ): Promise<GuardrailResult> {
    if (!this.config.enableInput) {
      return { allowed: true, violations: [] };
    }

    const fullContext: GuardrailCheckContext = { ...context, direction: 'input' };
    return this.runPlugins(content, fullContext);
  }

  /**
   * Check output content (LLM → user).
   */
  async checkOutput(
    content: string,
    context: Omit<GuardrailCheckContext, 'direction'>,
  ): Promise<GuardrailResult> {
    if (!this.config.enableOutput) {
      return { allowed: true, violations: [] };
    }

    const fullContext: GuardrailCheckContext = { ...context, direction: 'output' };
    return this.runPlugins(content, fullContext);
  }

  /**
   * Check whether any plugins are registered for this tenant.
   * Use this as a fast-path check before calling checkMessages to avoid
   * the overhead of message serialization + span creation when no plugins
   * are configured.
   */
  hasPlugins(tenantId?: string): boolean {
    const plugins = this.getPlugins(tenantId);
    return plugins.length > 0;
  }

  /**
   * Check multiple messages (e.g., a conversation).
   */
  async checkMessages(
    messages: Array<{ role: string; content: string }>,
    context: Omit<GuardrailCheckContext, 'direction'>,
    direction: 'input' | 'output' = 'input',
  ): Promise<GuardrailResult> {
    if ((direction === 'input' && !this.config.enableInput) ||
        (direction === 'output' && !this.config.enableOutput)) {
      return { allowed: true, violations: [] };
    }

    const fullContext: GuardrailCheckContext = { ...context, direction };
    const plugins = this.getPlugins(context.tenantId);

    // Fast-path: no plugins registered → nothing to check, return immediately
    if (plugins.length === 0) {
      return { allowed: true, violations: [] };
    }

    const allViolations: GuardrailViolation[] = [];

    for (const plugin of plugins) {
      try {
        if (plugin.checkMessages) {
          const result = await plugin.checkMessages(messages, fullContext);
          allViolations.push(...result.violations);
        } else {
          // Fall back to checking each message individually
          for (const msg of messages) {
            const result = await plugin.check(msg.content, fullContext);
            allViolations.push(...result.violations);
          }
        }
      } catch (err) {
        logger.warn({ plugin: plugin.name, error: String(err) }, 'Guardrail plugin failed');
      }
    }

    return this.determineResult(allViolations);
  }

  /**
   * Run all plugins on content.
   */
  private async runPlugins(
    content: string,
    context: GuardrailCheckContext,
  ): Promise<GuardrailResult> {
    const plugins = this.getPlugins(context.tenantId);
    const allViolations: GuardrailViolation[] = [];
    let maskedContent: string | undefined;

    for (const plugin of plugins) {
      try {
        const result = await plugin.check(content, context);
        allViolations.push(...result.violations);

        // Use masked content from first plugin that provides it
        if (result.maskedContent && !maskedContent) {
          maskedContent = result.maskedContent;
        }

        // Short-circuit on block action if plugin returns not allowed
        if (this.config.onDetection === 'block' && !result.allowed) {
          break;
        }
      } catch (err) {
        logger.warn({ plugin: plugin.name, error: String(err) }, 'Guardrail plugin failed');
      }
    }

    return this.determineResult(allViolations, maskedContent);
  }

  /**
   * Determine final result based on violations and action config.
   */
  private determineResult(
    violations: GuardrailViolation[],
    maskedContent?: string,
  ): GuardrailResult {
    const hasHighSeverity = violations.some(v => v.severity === 'high');

    let allowed = true;
    if (this.config.onDetection === 'block') {
      allowed = violations.length === 0;
    } else if (this.config.onDetection === 'flag') {
      allowed = !hasHighSeverity;
    }

    if (violations.length > 0) {
      logger.warn({
        violationCount: violations.length,
        violationTypes: violations.map(v => v.type),
        onDetection: this.config.onDetection,
      }, 'Guardrail violations detected');
    }

    return {
      allowed,
      violations,
      flaggedContent: maskedContent,
    };
  }

  /**
   * Update engine config at runtime.
   */
  updateConfig(config: Partial<GuardrailEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current engine config.
   */
  getConfig(): GuardrailEngineConfig {
    return { ...this.config };
  }

  /**
   * Get all registered plugins.
   */
  getPluginsList(): Array<{ name: string; priority: number }> {
    return this.plugins.map(p => ({ name: p.name, priority: p.priority }));
  }

  /**
   * Cleanup all plugins.
   */
  async dispose(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.dispose) {
        await plugin.dispose();
      }
    }
    this.plugins = [];
    this.tenantPlugins.clear();
  }
}

// Singleton
let instance: GuardrailEngine | null = null;

/**
 * Get or create the singleton guardrail engine.
 * Configures with default regex plugin if no plugins are registered.
 */
export function getGuardrailEngine(): GuardrailEngine {
  if (!instance) {
    instance = new GuardrailEngine();

    // Add default regex plugin for backward compatibility
    const regexPlugin = new RegexGuardrailPlugin({
      enablePII: true,
      enableInjection: true,
      enableContentFiltering: false,
      maxContentLength: 100000,
    });
    instance.addPlugin(regexPlugin);
  }
  return instance;
}

// Factory functions for creating configured engines
export function createGuardrailEngine(config: {
  engine?: Partial<GuardrailEngineConfig>;
  regex?: Partial<RegexGuardrailConfig>;
  webhooks?: Array<{ name: string; config: WebhookGuardrailConfig; priority?: number }>;
  moderation?: ModerationApiGuardrailConfig;
}): GuardrailEngine {
  const engine = new GuardrailEngine(config.engine);

  // Add regex plugin
  engine.addPlugin(new RegexGuardrailPlugin(config.regex));

  // Add webhook plugins
  if (config.webhooks) {
    for (const { name, config: webhookConfig, priority } of config.webhooks) {
      engine.addPlugin(new WebhookGuardrailPlugin(name, webhookConfig, priority));
    }
  }

  // Add moderation API plugin
  if (config.moderation) {
    engine.addPlugin(new ModerationApiGuardrailPlugin(config.moderation));
  }

  return engine;
}

// Re-export plugins for convenience
export { RegexGuardrailPlugin } from './plugins/regex-guardrail.js';
export type { RegexGuardrailConfig } from './plugins/regex-guardrail.js';
export { WebhookGuardrailPlugin } from './plugins/webhook-guardrail.js';
export type { WebhookGuardrailConfig } from './plugins/webhook-guardrail.js';
export { ModerationApiGuardrailPlugin } from './plugins/moderation-api-guardrail.js';
export type { ModerationApiGuardrailConfig, ModerationProvider } from './plugins/moderation-api-guardrail.js';
export type { GuardrailPlugin, GuardrailCheckContext, GuardrailCheckResult } from './guardrail-plugin.interface.js';
