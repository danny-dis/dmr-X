import type { Tokenizer, Message } from './types.js';

const OVERHEAD_PER_MESSAGE = 4;

/**
 * Anthropic tokenizer - uses a heuristic approximation since the official
 * tokenizer is not publicly available as an npm package.
 * This uses a more accurate heuristic based on Claude's tokenization patterns.
 */
export class AnthropicTokenizer implements Tokenizer {
  family = 'anthropic';

  countTokens(text: string): number {
    let count = 0;
    let i = 0;

    while (i < text.length) {
      const code = text.charCodeAt(i);

      // CJK characters
      if (code >= 0x4e00 && code <= 0x9fff) {
        count += 1;
        i++;
      }
      // Whitespace sequences
      else if (code === 32 || code === 10 || code === 13 || code === 9) {
        count += 0.5;
        i++;
        while (i < text.length && [32, 10, 13, 9].includes(text.charCodeAt(i))) {
          i++;
        }
      }
      // Other characters - ~3.5 chars per token
      else {
        count += 1 / 3.5;
        i++;
      }
    }

    return Math.ceil(count);
  }

  countMessageTokens(messages: Message[]): number {
    let tokens = 0;
    for (const msg of messages) {
      tokens += OVERHEAD_PER_MESSAGE;
      if (typeof msg.content === 'string') {
        tokens += this.countTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            tokens += this.countTokens(block.text);
          } else if (block.type === 'image') {
            tokens += 1000;
          }
        }
      }
    }
    return tokens;
  }
}
