import { describe, it, expect } from 'vitest';
import { StreamingPolicy } from '../../services/router/src/streaming/streaming-policy.js';

describe('StreamingPolicy', () => {
  it('classifies disconnect before first token as retryable', () => {
    const policy = new StreamingPolicy();
    expect(policy.classifyDisconnect({ ttftMs: null, bytesReceived: 0 })).toBe('retryable');
  });

  it('classifies disconnect after partial output as non-retryable', () => {
    const policy = new StreamingPolicy();
    expect(policy.classifyDisconnect({ ttftMs: 500, bytesReceived: 1000 })).toBe('non-retryable');
  });

  it('reserves expected output tokens', () => {
    const policy = new StreamingPolicy();
    const reservation = policy.reserveOutput({ maxTokens: 2048, estimatedOutputTokens: 1024 });
    expect(reservation.reserved).toBe(2048);
  });
});