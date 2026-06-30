import type { Tokenizer, Message } from './types.js';

const OVERHEAD_PER_MESSAGE = 4;

export class TiktokenTokenizer implements Tokenizer {
  private encoding: any = null;
  private encodingName: string;
  family: string;

  constructor(family: string, encodingName: string) {
    this.family = family;
    this.encodingName = encodingName;
  }

  private async loadEncoding(): Promise<void> {
    if (this.encoding) return;

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
      throw new Error(`Failed to load tiktoken encoding '${this.encodingName}': ${err}`);
    }
  }

  countTokens(text: string): number {
    if (!this.encoding) {
      return this.heuristicCount(text);
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

  private heuristicCount(text: string): number {
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
}
