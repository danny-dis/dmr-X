import type { Tokenizer, Message } from './types.js';

const OVERHEAD_PER_MESSAGE = 4;

export class HeuristicTokenizer implements Tokenizer {
  family = 'heuristic';

  countTokens(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x4e00 && code <= 0x9fff) {
        count += 1;
      } else {
        count += 0.25;
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
