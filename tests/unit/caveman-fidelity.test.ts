import { describe, expect, it } from 'vitest';
import { compressCaveman } from '../../apps/gateway/src/services/engines/caveman.js';

describe('Caveman fidelity safeguards', () => {
  it.each([
    'In the event that approval is missing, do not deploy.',
    'Prior to deletion, back up the database. Subsequent to approval, continue.',
    'This is literally the identifier actually, not a filler word.',
    'Return exactly "do not change this" without abbreviations.',
    '```python\nif ready:\n    print("actually do not change!!")\n```',
    '{"because":"actually", "note":"do not change"}',
  ])('does not rewrite meaning or literals by default: %s', (input) => {
    const result = compressCaveman(input);
    expect(result.compressed).toBe(input);
    expect(result.saved).toBe(0);
  });
});
