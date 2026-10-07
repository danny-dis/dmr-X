import type { UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { ValidationError } from '@dmr-x/core';

export interface OutputContract {
  requiredText?: string[];
  requiredSections?: string[];
  minCharacters?: number;
}

const MAX_ITEMS = 32;
const MAX_TEXT_LENGTH = 512;
const MAX_MIN_CHARACTERS = 100_000;

function invalidContract(): never {
  throw new ValidationError('Invalid output contract');
}

export function validateOutputContract(value: unknown): OutputContract | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidContract();
  const contract = value as Record<string, unknown>;
  const result: OutputContract = {};
  for (const key of ['requiredText', 'requiredSections'] as const) {
    const entries = contract[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > MAX_ITEMS || !entries.every(entry =>
      typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_TEXT_LENGTH,
    )) invalidContract();
    result[key] = entries;
  }
  if (contract.minCharacters !== undefined) {
    const minimum = contract.minCharacters;
    if (typeof minimum !== 'number' || !Number.isSafeInteger(minimum) || minimum < 0 || minimum > MAX_MIN_CHARACTERS) invalidContract();
    result.minCharacters = minimum;
  }
  if (Object.keys(contract).some(key => !['requiredText', 'requiredSections', 'minCharacters'].includes(key))) invalidContract();
  return result;
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content
    .filter((part): part is { type: 'text'; text: string } => !!part && typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
    .map(part => part.text).join('');
  return '';
}

function isRequestedToolTurn(request: UnifiedRequest, response: UnifiedResponse): boolean {
  const calls = response.message?.tool_calls as unknown;
  if (calls === undefined || (Array.isArray(calls) && calls.length === 0)) return false;
  if (!Array.isArray(calls) || !request.tools?.length || request.tool_choice === 'none') return false;
  const requested = request.tool_choice;
  const requiredName = typeof requested === 'object' ? requested.function.name : undefined;
  const allowed = new Set(request.tools.map(tool => tool.function.name));
  const ids = new Set<string>();
  return calls.every(call => {
    if (!call || typeof call !== 'object') return false;
    const candidate = call as { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (typeof candidate.id !== 'string' || !candidate.id || ids.has(candidate.id)) return false;
    ids.add(candidate.id);
    if (candidate.type !== 'function' || typeof candidate.function?.name !== 'string' ||
        typeof candidate.function.arguments !== 'string' || !allowed.has(candidate.function.name)) return false;
    if (requiredName && candidate.function.name !== requiredName) return false;
    try {
      const argumentsValue = JSON.parse(candidate.function.arguments);
      return !!argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue);
    } catch {
      return false;
    }
  });
}

export function assertValidOutput(request: UnifiedRequest, response: UnifiedResponse): void {
  if (request.stream || request.modality !== 'llm') return;
  const toolCalls = response.message?.tool_calls as unknown;
  if (toolCalls !== undefined && (!Array.isArray(toolCalls) || toolCalls.length > 0)) {
    if (!isRequestedToolTurn(request, response)) throw new ValidationError('Invalid output');
    return;
  }
  const text = textContent(response.message?.content);
  if (!text.trim()) throw new ValidationError('Invalid output');
  if (request.response_format?.type === 'json_object') {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    } catch {
      throw new ValidationError('Invalid output');
    }
  }
  const contract = validateOutputContract(request.metadata?.outputContract);
  if (!contract) return;
  if (contract.minCharacters !== undefined && text.length < contract.minCharacters) throw new ValidationError('Invalid output');
  if (contract.requiredText?.some(required => !text.includes(required))) throw new ValidationError('Invalid output');
  if (contract.requiredSections?.some(section => !new RegExp(`(^|\\n)\\s*(?:#{1,6}\\s+)?${escapeRegExp(section)}\\s*(?=[:#\\n]|$)`, 'm').test(text))) throw new ValidationError('Invalid output');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
