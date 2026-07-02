export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
}

export type ContentBlock = TextBlock | ImageBlock;

export interface Message {
  role: string;
  content: string | ContentBlock[];
}

export interface Tokenizer {
  /** Tokenizer family name (e.g., 'o200k_base', 'cl100k_base', 'anthropic') */
  family: string;

  /** Count tokens in a plain text string */
  countTokens(text: string): number;

  /** Count tokens in an array of messages (includes message overhead) */
  countMessageTokens(messages: Message[]): number;
}
