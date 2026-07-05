import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * OpenRouter adapter — access 300+ models via single API key.
 * Uses OpenAI-compatible API at openrouter.ai/api/v1.
 *
 * Free tier: 25+ free models with :free suffix, 20 RPM, 50 req/day.
 * Paid: pass-through pricing + 5.5% platform fee.
 * No platform-level rate limits on paid models (upstream throttling applies).
 *
 * Env: OPENROUTER_API_KEY
 */
export class OpenRouterAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'openrouter';

  constructor() {
    super('openrouter');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://openrouter.ai/api/v1',
      apiKey: (config.apiKey as string) || process.env.OPENROUTER_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      // --- Frontier models ---
      { modelId: 'openai/gpt-4o', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'json_mode'] },
      { modelId: 'openai/gpt-4o-mini', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'anthropic/claude-sonnet-4', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      { modelId: 'anthropic/claude-3.5-sonnet', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'anthropic/claude-3-haiku', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'google/gemini-2.5-flash', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'google/gemini-2.0-flash', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      // --- xAI ---
      { modelId: 'x-ai/grok-4-1-fast-reasoning', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      { modelId: 'x-ai/grok-4', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      // --- Open source ---
      { modelId: 'meta-llama/llama-3.3-70b-instruct', modality: 'llm', capabilities: ['chat', 'tool_use'] },
      { modelId: 'meta-llama/llama-3.1-70b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'deepseek/deepseek-chat', modality: 'llm', capabilities: ['chat', 'tool_use'] },
      { modelId: 'deepseek/deepseek-r1', modality: 'llm', capabilities: ['chat', 'reasoning'] },
      { modelId: 'qwen/qwen3-coder-480b-a35b', modality: 'llm', capabilities: ['chat', 'tool_use', 'reasoning'] },
      { modelId: 'mistralai/mistral-large', modality: 'llm', capabilities: ['chat', 'tool_use'] },
      // --- Free tier models (:free suffix) ---
      { modelId: 'meta-llama/llama-3.3-70b-instruct:free', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'qwen/qwen3-coder-480b-a35b:free', modality: 'llm', capabilities: ['chat', 'tool_use'] },
      { modelId: 'deepseek/deepseek-chat:free', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'google/gemini-2.0-flash-exp:free', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'mistralai/mistral-7b-instruct:free', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'nousresearch/hermes-3-llama-3.1-405b:free', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
