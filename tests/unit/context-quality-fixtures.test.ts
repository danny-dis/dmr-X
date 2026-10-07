import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressionService, type CompressionEngine } from '../../apps/gateway/src/services/compression.js';

// Deterministic ingress-fidelity fixtures, not model-answer or load benchmarks.
vi.mock('@dmr-x/db', () => ({ getDb: vi.fn(() => { throw new Error('Fixture database deliberately unavailable'); }) }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());

const padding = 'Background material that does not replace the actual policy. '.repeat(600);
const constraint = 'CASE-0007: Do NOT deploy unless approval A-019 is present. Keep version v2.03, not v2.3.';
const instructions = 'Hifadhi masharti haya. Ne déployez pas sans accord. 不要删除证据。 Preserve sources and exact identifiers.';

describe('release context-retention fixtures', () => {
  for (const engine of ['caveman', 'rtk', 'comment-strip'] as CompressionEngine[]) {
    for (const position of ['beginning', 'middle', 'end'] as const) {
      it(`${engine} preserves the ${position} constraint in a long current request`, async () => {
        vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({
          enabled: true, reversible: false, minTokensToCompress: 1, engine, proxyUrl: 'http://localhost:8787',
        });
        const content = position === 'beginning' ? constraint + padding + padding
          : position === 'middle' ? padding + constraint + padding : padding + padding + constraint;
        const messages = [
          { role: 'system', content: instructions, name: 'policy' },
          { role: 'developer', content: 'Return all requested sections; keep source IDs exactly as supplied.' },
          { role: 'assistant', content: 'An ordinary historical explanation. '.repeat(20), name: 'history' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'call-A-019', type: 'function', function: { name: 'approval', arguments: '{"id":"A-019"}' } }] },
          { role: 'tool', tool_call_id: 'call-A-019', content: '{"approved":false,"source":"EVIDENCE-004"}' },
          { role: 'user', content: [{ type: 'text', text: 'Prior screenshot evidence.' }, { type: 'image_url', image_url: { url: 'https://fixtures.invalid/evidence.png' } }] },
          { role: 'user', content },
        ];
        const original = structuredClone(messages);
        const { compressed } = await compressionService.compressPrompt(messages);
        expect(messages).toEqual(original);
        expect(compressed).toHaveLength(original.length);
        for (const index of [0, 1, 3, 4, 5, 6]) expect(compressed[index]).toEqual(original[index]);
        expect(compressed[2].name).toBe('history');
        expect(compressed[6].content).toBe(content);
        expect(String(compressed[6].content)).toContain(constraint);
      });
    }
  }
});
