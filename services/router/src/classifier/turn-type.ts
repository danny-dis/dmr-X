import type { UnifiedRequest, Message } from '@dmr-x/core';

export type TurnType =
  | 'tool_use'
  | 'code_gen'
  | 'q_a'
  | 'creative'
  | 'summarization'
  | 'translation'
  | 'data_analysis'
  | 'general';

const CODE_KEYWORDS = new Set([
  'function', 'class', 'import', 'export', 'const', 'let', 'var',
  'def', 'return', 'if', 'else', 'for', 'while', 'try', 'catch',
  'async', 'await', 'interface', 'type', 'enum', 'struct',
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE TABLE',
  'docker', 'kubernetes', 'nginx', 'git', 'npm', 'pip',
  'implement', 'refactor', 'debug', 'fix the bug', 'write code',
  'write a script', 'write a function', 'write a class',
]);

const CREATIVE_KEYWORDS = new Set([
  'write a story', 'write a poem', 'creative', 'fiction',
  'narrative', 'dialogue', 'screenplay', 'script',
  'compose', 'draft', 'brainstorm', 'idea',
]);

const SUMMARY_KEYWORDS = new Set([
  'summarize', 'summary', 'tldr', 'tldr;', 'brief',
  'key points', 'main points', 'overview', 'recap',
  'condense', 'shorten',
]);

const TRANSLATION_KEYWORDS = new Set([
  'translate', 'translation', 'in french', 'in spanish',
  'in german', 'in japanese', 'in chinese', 'in korean',
  'in arabic', 'in hindi', 'in portuguese', 'in italian',
]);

const DATA_KEYWORDS = new Set([
  'analyze', 'analysis', 'chart', 'graph', 'plot',
  'statistics', 'regression', 'correlation', 'dataset',
  'csv', 'json', 'data', 'metrics', 'kpi',
]);

export function detectTurnType(request: UnifiedRequest): TurnType {
  if (request.modality !== 'llm' || !request.messages) {
    return 'general';
  }

  // Tool use: if tools are defined and the last user message references them
  if (request.tools && request.tools.length > 0) {
    const lastUserMsg = findLastUserMessage(request);
    if (lastUserMsg) {
      const toolNames = request.tools.map(t => t.function?.name?.toLowerCase() || '').filter(Boolean);
      const content = getMessageText(lastUserMsg).toLowerCase();
      // If user mentions a tool name or says "use" / "call" / "run"
      if (toolNames.some(name => content.includes(name)) ||
          /\b(use|call|run|execute|invoke)\b/.test(content)) {
        return 'tool_use';
      }
    }
    // Default to tool_use if tools are present (strong signal)
    return 'tool_use';
  }

  const text = getAllUserText(request).toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Code generation: strong code signals
  const codeScore = countMatches(text, CODE_KEYWORDS);
  if (codeScore >= 2 || (codeScore >= 1 && hasCodeBlocks(request))) {
    return 'code_gen';
  }

  // Translation
  const translationScore = countMatches(text, TRANSLATION_KEYWORDS);
  if (translationScore >= 1) {
    return 'translation';
  }

  // Summarization
  const summaryScore = countMatches(text, SUMMARY_KEYWORDS);
  if (summaryScore >= 1 && wordCount > 50) {
    return 'summarization';
  }

  // Data analysis
  const dataScore = countMatches(text, DATA_KEYWORDS);
  if (dataScore >= 2) {
    return 'data_analysis';
  }

  // Creative writing
  const creativeScore = countMatches(text, CREATIVE_KEYWORDS);
  if (creativeScore >= 1) {
    return 'creative';
  }

  // Q&A: short question with a question mark
  if (wordCount <= 30 && text.includes('?')) {
    return 'q_a';
  }

  // Single-sentence questions
  if (request.messages.length <= 2 && wordCount <= 20) {
    return 'q_a';
  }

  return 'general';
}

function findLastUserMessage(request: UnifiedRequest): Message | undefined {
  if (!request.messages) return undefined;
  for (let i = request.messages.length - 1; i >= 0; i--) {
    if (request.messages[i].role === 'user') {
      return request.messages[i];
    }
  }
  return undefined;
}

function getMessageText(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p: any): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p: any) => p.text)
      .join('\n');
  }
  return '';
}

function getAllUserText(request: UnifiedRequest): string {
  if (!request.messages) return '';
  return request.messages
    .filter(m => m.role === 'user')
    .map(m => getMessageText(m))
    .join('\n');
}

function hasCodeBlocks(request: UnifiedRequest): boolean {
  if (!request.messages) return false;
  return request.messages.some(m => {
    const text = getMessageText(m);
    return /```[\s\S]*```/.test(text);
  });
}

function countMatches(text: string, keywords: Set<string>): number {
  let count = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      count++;
    }
  }
  return count;
}
