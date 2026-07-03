/**
 * Prompt Library Service — manages L1B3RT4S prompts for DMR-X.
 *
 * Provides:
 * - List all prompts (grouped by provider)
 * - Get prompts for specific provider
 * - Get prompt content
 * - Preview prompt with sample input
 * - Search prompts by tag/category
 */

import { logger } from '@dmr-x/utils';
import { parseMkdFile } from './prompt-parser.js';
import type { PromptEntry, PromptCategory, PromptPreviewRequest, PromptPreviewResponse } from './types.js';
import L1B3RT4S_PROMPTS from './prompts.json';

export class PromptLibrary {
  private prompts: Map<string, PromptEntry> = new Map();
  private promptsByProvider: Map<string, PromptEntry[]> = new Map();
  private promptsByCategory: Map<string, PromptEntry[]> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Parse all embedded prompts
    for (const [provider, content] of Object.entries(L1B3RT4S_PROMPTS)) {
      const entries = parseMkdFile(content, provider, provider.toLowerCase());
      for (const entry of entries) {
        this.prompts.set(entry.id, entry);
        
        // Index by provider
        const providerPrompts = this.promptsByProvider.get(provider) || [];
        providerPrompts.push(entry);
        this.promptsByProvider.set(provider, providerPrompts);
        
        // Index by category
        const categoryPrompts = this.promptsByCategory.get(entry.category) || [];
        categoryPrompts.push(entry);
        this.promptsByCategory.set(entry.category, categoryPrompts);
      }
    }

    this.initialized = true;
    logger.info({ count: this.prompts.size, providers: this.promptsByProvider.size }, 'PromptLibrary initialized');
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('PromptLibrary not initialized. Call initialize() first.');
    }
  }

  /**
   * List all prompts with optional filters
   */
  list(options?: {
    provider?: string;
    category?: string;
    tag?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): { prompts: PromptEntry[]; total: number } {
    this.assertInitialized();

    let results = Array.from(this.prompts.values());

    // Apply filters
    if (options?.provider) {
      results = results.filter(p => 
        p.provider.toLowerCase() === options.provider!.toLowerCase()
      );
    }

    if (options?.category) {
      results = results.filter(p => p.category === options.category);
    }

    if (options?.tag) {
      results = results.filter(p => p.tags.includes(options.tag!));
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      results = results.filter(p =>
        p.title.toLowerCase().includes(searchLower) ||
        p.description.toLowerCase().includes(searchLower) ||
        p.content.toLowerCase().includes(searchLower)
      );
    }

    const total = results.length;

    // Apply pagination
    if (options?.offset) {
      results = results.slice(options.offset);
    }
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return { prompts: results, total };
  }

  /**
   * Get prompts for a specific provider
   */
  getByProvider(provider: string): PromptEntry[] {
    this.assertInitialized();
    return this.promptsByProvider.get(provider.toUpperCase()) || [];
  }

  /**
   * Get a single prompt by ID
   */
  getById(id: string): PromptEntry | undefined {
    this.assertInitialized();
    return this.prompts.get(id);
  }

  /**
   * Get all categories with counts
   */
  getCategories(): PromptCategory[] {
    this.assertInitialized();

    const categories: PromptCategory[] = [];
    for (const [category, prompts] of this.promptsByCategory) {
      // Group by provider within category
      const providers = new Set(prompts.map(p => p.provider));
      for (const provider of providers) {
        const providerPrompts = prompts.filter(p => p.provider === provider);
        categories.push({
          id: `${provider.toLowerCase()}-${category}`,
          name: `${provider} ${category}`,
          provider,
          count: providerPrompts.length,
        });
      }
    }

    return categories.sort((a, b) => b.count - a.count);
  }

  /**
   * Get all available providers
   */
  getProviders(): string[] {
    this.assertInitialized();
    return Array.from(this.promptsByProvider.keys()).sort();
  }

  /**
   * Preview a prompt with sample input
   */
  preview(request: PromptPreviewRequest): PromptPreviewResponse | null {
    this.assertInitialized();

    const prompt = this.prompts.get(request.prompt_id);
    if (!prompt) return null;

    const sampleInput = request.sample_input || "How do I write a simple program?";
    const preview = `${prompt.content}\n\n---\n\nUser: ${sampleInput}`;

    return {
      prompt_id: prompt.id,
      prompt_content: prompt.content,
      preview,
    };
  }

  /**
   * Get prompt content for use in chat
   */
  getContent(id: string): string | null {
    this.assertInitialized();
    const prompt = this.prompts.get(id);
    return prompt?.content || null;
  }

  /**
   * Search prompts by text
   */
  search(query: string, limit = 10): PromptEntry[] {
    this.assertInitialized();
    return this.list({ search: query, limit }).prompts;
  }

  /**
   * Get stats about the library
   */
  getStats(): {
    totalPrompts: number;
    providers: number;
    categories: number;
    promptsByProvider: Record<string, number>;
    promptsByCategory: Record<string, number>;
  } {
    this.assertInitialized();

    const promptsByProvider: Record<string, number> = {};
    for (const [provider, prompts] of this.promptsByProvider) {
      promptsByProvider[provider] = prompts.length;
    }

    const promptsByCategory: Record<string, number> = {};
    for (const [category, prompts] of this.promptsByCategory) {
      promptsByCategory[category] = prompts.length;
    }

    return {
      totalPrompts: this.prompts.size,
      providers: this.promptsByProvider.size,
      categories: this.promptsByCategory.size,
      promptsByProvider,
      promptsByCategory,
    };
  }

  dispose(): void {
    this.prompts.clear();
    this.promptsByProvider.clear();
    this.promptsByCategory.clear();
    this.initialized = false;
  }
}

// Singleton instance
let instance: PromptLibrary | null = null;

export function getPromptLibrary(): PromptLibrary {
  if (!instance) {
    instance = new PromptLibrary();
  }
  return instance;
}
