/**
 * Maps model name patterns to tokenizer families.
 * Checked in order - first match wins.
 */
export const MODEL_TOKENIZER_MAP: Array<{ pattern: RegExp; family: string; encoding?: string }> = [
  // OpenAI models
  { pattern: /^gpt-4o/, family: 'o200k_base', encoding: 'gpt-4o' },
  { pattern: /^gpt-4-turbo/, family: 'cl100k_base', encoding: 'gpt-4-turbo' },
  { pattern: /^gpt-4/, family: 'cl100k_base', encoding: 'gpt-4' },
  { pattern: /^gpt-3\.5-turbo/, family: 'cl100k_base', encoding: 'gpt-3.5-turbo' },
  { pattern: /^gpt-3\.5/, family: 'p50k_base', encoding: 'gpt-3.5' },
  { pattern: /^text-davinci/, family: 'p50k_base', encoding: 'text-davinci-002' },
  { pattern: /^text-embedding/, family: 'cl100k_base', encoding: 'text-embedding-ada-002' },
  { pattern: /^o1/, family: 'o200k_base', encoding: 'gpt-4o' },
  { pattern: /^o3/, family: 'o200k_base', encoding: 'gpt-4o' },

  // Anthropic models
  { pattern: /^claude-/, family: 'anthropic' },

  // Google models
  { pattern: /^gemini/, family: 'heuristic' },

  // Default fallback
  { pattern: /.*/, family: 'heuristic' },
];

export function getTokenizerFamily(model: string): { family: string; encoding?: string } {
  for (const entry of MODEL_TOKENIZER_MAP) {
    if (entry.pattern.test(model)) {
      return { family: entry.family, encoding: entry.encoding };
    }
  }
  return { family: 'heuristic' };
}
