import type { Tokenizer, Message } from './types.js';
import { HeuristicTokenizer } from './heuristic-tokenizer.js';
import { TiktokenTokenizer } from './tiktoken-tokenizer.js';
import { AnthropicTokenizer } from './anthropic-tokenizer.js';
import { getTokenizerFamily } from './model-map.js';
import { logger } from '@dmr-x/utils';

const tokenizerCache = new Map<string, Tokenizer>();
const heuristic = new HeuristicTokenizer();

export class TokenizerRegistry {
  /**
   * Get a tokenizer for the given model.
   * Returns a cached instance if available, otherwise creates a new one.
   */
  get(model: string): Tokenizer {
    const { family, encoding } = getTokenizerFamily(model);

    const cacheKey = family;
    if (tokenizerCache.has(cacheKey)) {
      return tokenizerCache.get(cacheKey)!;
    }

    let tokenizer: Tokenizer;

    switch (family) {
      case 'o200k_base':
      case 'cl100k_base':
      case 'p50k_base':
      case 'r50k_base':
        tokenizer = new TiktokenTokenizer(family, encoding || family);
        break;
      case 'anthropic':
        tokenizer = new AnthropicTokenizer();
        break;
      default:
        tokenizer = heuristic;
        break;
    }

    tokenizerCache.set(cacheKey, tokenizer);
    logger.debug({ model, family }, 'Tokenizer resolved');

    return tokenizer;
  }

  /**
   * Count tokens for a model and messages.
   */
  countTokens(model: string, text: string): number {
    return this.get(model).countTokens(text);
  }

  /**
   * Count message tokens for a model.
   */
  countMessageTokens(model: string, messages: Message[]): number {
    return this.get(model).countMessageTokens(messages);
  }

  /**
   * Get all available tokenizer families.
   */
  getFamilies(): string[] {
    return ['o200k_base', 'cl100k_base', 'p50k_base', 'r50k_base', 'anthropic', 'heuristic'];
  }
}

export const tokenizerRegistry = new TokenizerRegistry();
