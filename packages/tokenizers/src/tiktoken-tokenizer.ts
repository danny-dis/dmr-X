import type { Tokenizer, Message } from './types.js';
import { HeuristicTokenizer } from './heuristic-tokenizer.js';
import { logger } from '@dmr-x/utils';

const OVERHEAD_PER_MESSAGE = 4;
const fallback = new HeuristicTokenizer();

export class TiktokenTokenizer implements Tokenizer {
  private encoding: any = null;
  private encodingName: string;
  private loadPromise: Promise<void> | null = null;
  family: string;

  constructor(family: string, encodingName: string) {
    this.family = family;
    this.encodingName = encodingName;
  }

  private loadEncoding(): Promise<void> {
    if (this.encoding) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const { encoding_for_model } = await import('tiktoken');
        try {
          this.encoding = encoding_for_model(this.encodingName);
        } catch {
          const tiktoken = await import('tiktoken');
          this.encoding = (tiktoken as any)[this.encodingName]?.();
          if (!this.encoding) {
            throw new Error(`Unknown encoding: ${this.encodingName}`);
          }
        }
      } catch (err) {
        logger.warn({ err, encoding: this.encodingName }, 'Failed to load tiktoken, using heuristic fallback');
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  countTokens(text: string): number {
    if (!this.encoding) {
      return fallback.countTokens(text);
    }
    const tokens = this.encoding.encode(text);
    return tokens.length;
  }

  countMessageTokens(messages: Message[]): number {
    let tokens = 0;
    for (const msg of messages) {
      tokens += OVERHEAD_PER_MESSAGE;
      if (typeof msg.content === 'string') {
        tokens += this.countTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            tokens += this.countTokens(block.text);
          } else if (block.type === 'image') {
            tokens += 1000;
          }
        }
      }
    }
    return tokens;
  }

  async initialize(): Promise<void> {
    await this.loadEncoding();
  }
}
