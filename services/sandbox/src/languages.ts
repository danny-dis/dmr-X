export const SUPPORTED_LANGUAGES: Record<string, { name: string; extension: string; command: string }> = {
  python: { name: 'Python', extension: '.py', command: 'python3' },
  python3: { name: 'Python 3', extension: '.py', command: 'python3' },
  node: { name: 'Node.js', extension: '.js', command: 'node' },
  javascript: { name: 'JavaScript', extension: '.js', command: 'node' },
  js: { name: 'JS', extension: '.js', command: 'node' },
  // SECURITY: bash/sh removed — they provide unrestricted OS access
  deno: { name: 'Deno', extension: '.ts', command: 'deno' },
  bun: { name: 'Bun', extension: '.ts', command: 'bun' },
};

/** Set of allowed language identifiers for validation. */
export const ALLOWED_LANGUAGES = new Set(Object.keys(SUPPORTED_LANGUAGES));

export function isLanguageSupported(language: string): boolean {
  return ALLOWED_LANGUAGES.has(language);
}

export function getLanguageInfo(language: string) {
  return SUPPORTED_LANGUAGES[language] || null;
}
