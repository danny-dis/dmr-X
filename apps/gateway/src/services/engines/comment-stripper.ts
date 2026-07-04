/**
 * Code-aware comment removal engine.
 * Strips comments from source code while preserving:
 * - String literals (single, double, template)
 * - Regular expressions
 * - Comments inside strings
 * - Multi-line comments
 */

export interface CommentStripResult {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  saved: number;
  commentsRemoved: number;
}

export interface CommentStripOptions {
  /** Remove single-line comments (default: true) */
  removeSingleLine?: boolean;
  /** Remove multi-line comments (default: true) */
  removeMultiLine?: boolean;
  /** Remove JSDoc/docblock comments (default: false) */
  removeDocblocks?: boolean;
  /** Languages to process (default: auto-detect) */
  language?: SupportedLanguageOrAuto;
}

export type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java'
  | 'c'
  | 'cpp'
  | 'rust'
  | 'go'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'css'
  | 'html'
  | 'sql'
  | 'shell';

type SupportedLanguageOrAuto = SupportedLanguage | 'auto';

const DEFAULT_OPTIONS: Required<CommentStripOptions> = {
  removeSingleLine: true,
  removeMultiLine: true,
  removeDocblocks: false,
  language: 'auto',
};

export function stripComments(input: string, options?: CommentStripOptions): CommentStripResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalTokens = estimateTokens(input);

  const lang: SupportedLanguage = opts.language === 'auto' ? detectLanguage(input) : opts.language;

  let result = input;
  let commentsRemoved = 0;

  // Process the code to find and remove comments while preserving strings
  const segments = tokenizeCode(result, lang);

  const processed = segments.map(segment => {
    if (segment.type === 'comment') {
      // Check if it's a docblock
      if (segment.content.startsWith('/**') && !opts.removeDocblocks) {
        return segment.content;
      }

      // Check comment type
      if (segment.content.startsWith('//') && !opts.removeSingleLine) {
        return segment.content;
      }
      if (segment.content.startsWith('/*') && !opts.removeMultiLine) {
        return segment.content;
      }

      commentsRemoved++;
      return '';  // Remove the comment
    }
    return segment.content;
  });

  result = processed.join('');

  // Clean up empty lines left by removed comments
  result = result.replace(/\n{3,}/g, '\n\n');

  const compressedTokens = estimateTokens(result);

  return {
    compressed: result,
    originalTokens,
    compressedTokens,
    saved: originalTokens - compressedTokens,
    commentsRemoved,
  };
}

interface TokenSegment {
  type: 'code' | 'string' | 'comment' | 'regex';
  content: string;
}

function tokenizeCode(code: string, lang: SupportedLanguage): TokenSegment[] {
  const segments: TokenSegment[] = [];
  let i = 0;

  const stringDelimiters = getStringDelimiters(lang);
  const commentStarters = getCommentStarters(lang);

  while (i < code.length) {
    // Check for string literals
    const stringMatch = matchString(code, i, stringDelimiters);
    if (stringMatch) {
      segments.push({ type: 'string', content: stringMatch.content });
      i += stringMatch.content.length;
      continue;
    }

    // Check for regex literals (JS/TS only)
    if ((lang === 'javascript' || lang === 'typescript') && code[i] === '/') {
      const regexMatch = matchRegex(code, i);
      if (regexMatch) {
        segments.push({ type: 'regex', content: regexMatch.content });
        i += regexMatch.content.length;
        continue;
      }
    }

    // Check for comments
    const commentMatch = matchComment(code, i, commentStarters);
    if (commentMatch) {
      segments.push({ type: 'comment', content: commentMatch.content });
      i += commentMatch.content.length;
      continue;
    }

    // Regular code character
    // Accumulate consecutive code characters
    let codeEnd = i + 1;
    while (codeEnd < code.length) {
      const nextChar = code[codeEnd];
      if (stringDelimiters.includes(nextChar) || commentStarters.some(s => code.startsWith(s, codeEnd))) {
        break;
      }
      if ((lang === 'javascript' || lang === 'typescript') && nextChar === '/') {
        // Check if it's a regex or comment
        const peek = code[codeEnd + 1];
        if (peek === '/' || peek === '*') break;
      }
      codeEnd++;
    }

    segments.push({ type: 'code', content: code.slice(i, codeEnd) });
    i = codeEnd;
  }

  return segments;
}

function matchString(code: string, pos: number, delimiters: string[]): { content: string } | null {
  const char = code[pos];
  if (!delimiters.includes(char)) return null;

  // Template literals can span multiple lines
  if (char === '`') {
    let end = pos + 1;
    while (end < code.length) {
      if (code[end] === '\\') {
        end += 2;  // Skip escaped character
        continue;
      }
      if (code[end] === '`') {
        return { content: code.slice(pos, end + 1) };
      }
      end++;
    }
    return { content: code.slice(pos) };  // Unterminated
  }

  // Single/double quoted strings (single line)
  let end = pos + 1;
  while (end < code.length) {
    if (code[end] === '\\') {
      end += 2;  // Skip escaped character
      continue;
    }
    if (code[end] === char) {
      return { content: code.slice(pos, end + 1) };
    }
    end++;
  }

  return { content: code.slice(pos) };  // Unterminated
}

function matchRegex(code: string, pos: number): { content: string } | null {
  // Simple regex detection - not perfect but good enough
  // A regex starts with / and ends with / followed by optional flags
  if (code[pos] !== '/') return null;

  // Check if this is likely a regex (not division)
  // Simple heuristic: after certain tokens, / is division
  const before = code.slice(0, pos).trimEnd();
  if (before.length > 0) {
    const lastChar = before[before.length - 1];
    if ('])'.includes(lastChar)) return null;  // After ] or ) it's division
    if (/\w/.test(lastChar) && !/\b(var|let|const|return|typeof|instanceof|in|of|case|throw|new|delete|void|delete)\s*$/.test(before)) {
      // After identifier that's not a keyword, likely division
      return null;
    }
  }

  let end = pos + 1;
  let inClass = false;
  while (end < code.length) {
    if (code[end] === '\\') {
      end += 2;
      continue;
    }
    if (code[end] === '[') inClass = true;
    if (code[end] === ']') inClass = false;
    if (code[end] === '/' && !inClass) {
      // Check for flags
      end++;
      while (end < code.length && /[gimsuy]/.test(code[end])) {
        end++;
      }
      return { content: code.slice(pos, end) };
    }
    end++;
  }

  return null;
}

function matchComment(code: string, pos: number, starters: string[]): { content: string } | null {
  for (const starter of starters) {
    if (!code.startsWith(starter, pos)) continue;

    if (starter === '//' || starter === '#') {
      // Single line comment
      const end = code.indexOf('\n', pos);
      if (end === -1) return { content: code.slice(pos) };
      return { content: code.slice(pos, end) };
    }

    if (starter === '/*') {
      // Multi-line comment
      const end = code.indexOf('*/', pos + 2);
      if (end === -1) return { content: code.slice(pos) };
      return { content: code.slice(pos, end + 2) };
    }

    if (starter === '<!--') {
      // HTML comment
      const end = code.indexOf('-->', pos + 4);
      if (end === -1) return { content: code.slice(pos) };
      return { content: code.slice(pos, end + 3) };
    }

    if (starter === '--') {
      // SQL comment
      const end = code.indexOf('\n', pos);
      if (end === -1) return { content: code.slice(pos) };
      return { content: code.slice(pos, end) };
    }

    if (starter === '\"\"\"' || starter === "'''") {
      // Python docstring
      const end = code.indexOf(starter, pos + 3);
      if (end === -1) return { content: code.slice(pos) };
      return { content: code.slice(pos, end + 3) };
    }
  }

  return null;
}

function getStringDelimiters(lang: SupportedLanguage): string[] {
  switch (lang) {
    case 'python':
      return ['"', "'"];
    case 'ruby':
      return ['"', "'", '`'];
    case 'shell':
      return ['"', "'", '`'];
    default:
      return ['"', "'", '`'];
  }
}

function getCommentStarters(lang: SupportedLanguage): string[] {
  switch (lang) {
    case 'javascript':
    case 'typescript':
      return ['//', '/*'];
    case 'python':
      return ['#', '"""', "'''"];
    case 'java':
    case 'c':
    case 'cpp':
    case 'swift':
    case 'kotlin':
      return ['//', '/*'];
    case 'rust':
    case 'go':
      return ['//', '/*'];
    case 'ruby':
      return ['#'];
    case 'php':
      return ['//', '#', '/*'];
    case 'css':
      return ['/*'];
    case 'html':
      return ['<!--'];
    case 'sql':
      return ['--', '#'];
    case 'shell':
      return ['#'];
    default:
      return ['//', '#', '/*', '--'];
  }
}

function detectLanguage(code: string): SupportedLanguage {
  // Simple heuristic detection
  if (/^\s*(import|export)\s+.*from\s+['"]/.test(code) || /:\s*(string|number|boolean|any)\b/.test(code)) {
    return 'typescript';
  }
  if (/^\s*(def|class|import)\s+.*:/.test(code) && /^\s*#/.test(code)) {
    return 'python';
  }
  if (/^\s*(fn|let|mut|impl|struct)\s+/.test(code)) {
    return 'rust';
  }
  if (/^\s*(func|package|import)\s+/.test(code)) {
    return 'go';
  }
  if (/^\s*(public|private|protected)\s+class\s+/.test(code)) {
    return 'java';
  }
  if (/<html|<div|<script/i.test(code)) {
    return 'html';
  }
  if (/^\s*(CREATE|SELECT|INSERT|UPDATE|DELETE)\s+/i.test(code)) {
    return 'sql';
  }
  return 'javascript';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
