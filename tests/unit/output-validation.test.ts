import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../packages/core/src/types/errors.js';
import { validateOutputContract, assertValidOutput } from '../../services/router/src/output-validation.js';

const request = (metadata: Record<string, unknown> = {}) => ({
  modality: 'llm', stream: false, metadata, messages: [{ role: 'user', content: 'test' }],
}) as any;
const response = (content: unknown, extra: Record<string, unknown> = {}) => ({
  modality: 'llm', requestId: 'r', providerId: 'p', modelId: 'm', latencyMs: 1,
  message: { role: 'assistant', content }, ...extra,
}) as any;

describe('output validation', () => {
  it('accepts only JSON objects for json_object mode', () => {
    expect(() => assertValidOutput({ ...request(), response_format: { type: 'json_object' } }, response('{"ok":true}'))).not.toThrow();
    for (const value of ['', '[]', '"text"', '```json\n{}\n```']) {
      expect(() => assertValidOutput({ ...request(), response_format: { type: 'json_object' } }, response(value))).toThrow(/invalid output/i);
    }
  });

  it('validates bounded explicit contracts and rejects invalid caller contracts', () => {
    const contract = { requiredText: ['alpha'], requiredSections: ['Summary'], minCharacters: 20 };
    expect(() => validateOutputContract(contract)).not.toThrow();
    expect(() => assertValidOutput(request({ outputContract: contract }), response('Summary\nalpha and sufficient content'))).not.toThrow();
    expect(() => assertValidOutput(request({ outputContract: contract }), response('alpha'))).toThrow(/invalid output/i);
    expect(() => validateOutputContract({ minCharacters: Infinity })).toThrow(ValidationError);
    expect(() => validateOutputContract({ requiredText: [''] })).toThrow(ValidationError);
  });

  it('accepts declared tool calls with default or auto choice and enforces forced names', () => {
    const tools = [{ type: 'function', function: { name: 'lookup' } }];
    const toolResponse = response('', { message: { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } });
    expect(() => assertValidOutput({ ...request(), tools }, toolResponse)).not.toThrow();
    expect(() => assertValidOutput({ ...request(), tool_choice: 'auto', tools }, toolResponse)).not.toThrow();
    expect(() => assertValidOutput({ ...request(), tool_choice: { type: 'function', function: { name: 'lookup' } }, tools }, toolResponse)).not.toThrow();
    expect(() => assertValidOutput({ ...request(), tool_choice: { type: 'function', function: { name: 'lookup' } }, tools }, response('', { message: { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'other', arguments: '{}' } }] } }))).toThrow(/invalid output/i);
    expect(() => assertValidOutput({ ...request(), tool_choice: 'none', tools }, toolResponse)).toThrow(/invalid output/i);
  });

  it('rejects malformed or unrequested nonempty tool arrays even with prose', () => {
    const tools = [{ type: 'function', function: { name: 'lookup' } }];
    for (const tool_calls of [
      [{ id: '1', type: 'function', function: { name: 'other', arguments: '{}' } }],
      [{ id: '1', type: 'function', function: { name: 'lookup', arguments: 'not-json' } }],
      [null],
      [{ id: '', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
      [{ id: 'same', type: 'function', function: { name: 'lookup', arguments: '{}' } }, { id: 'same', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
    ]) {
      expect(() => assertValidOutput({ ...request(), tools }, response('plausible prose', { message: { role: 'assistant', content: 'plausible prose', tool_calls } }))).toThrow(/invalid output/i);
    }
    expect(() => assertValidOutput({ ...request(), tools }, response('normal prose', { message: { role: 'assistant', content: 'normal prose', tool_calls: [] } }))).not.toThrow();
  });

  it('matches exact plain or Markdown section headings rather than paragraph mentions', () => {
    const contract = { requiredSections: ['Summary'] };
    expect(() => assertValidOutput(request({ outputContract: contract }), response('# Summary\ntext'))).not.toThrow();
    expect(() => assertValidOutput(request({ outputContract: contract }), response('## Summary\ntext'))).not.toThrow();
    expect(() => assertValidOutput(request({ outputContract: contract }), response('Summary:\ntext'))).not.toThrow();
    expect(() => assertValidOutput(request({ outputContract: contract }), response('A paragraph mentions Summary but is not a heading.'))).toThrow(/invalid output/i);
  });
});
