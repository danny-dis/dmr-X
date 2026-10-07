import { describe, expect, it } from 'vitest';
import { isCacheableChatResponse } from '../../services/cache/src/response-cache-policy.js';

describe('response cache envelope validation', () => {
  it.each([
    null, undefined, 'text', 1, {},
    { choices: [null] }, { choices: [{}] },
    { content: [null], stop_reason: 'end_turn' },
  ])('rejects malformed input without throwing: %j', response => {
    expect(isCacheableChatResponse(response)).toBe(false);
  });
});
