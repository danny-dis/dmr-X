import { describe, it, expect } from 'vitest';
import { InferenceEventEmitter } from '../../services/router/src/learning/inference-events.js';

describe('InferenceEventEmitter', () => {
  it('emits structured events', () => {
    const emitter = new InferenceEventEmitter();
    const events: string[] = [];
    emitter.on('request_completed', () => events.push('completed'));
    emitter.emit({ type: 'request_started', providerId: 'p1', modelId: 'm1' });
    emitter.emit({ type: 'request_completed', providerId: 'p1', modelId: 'm1', success: true });
    expect(events).toEqual(['completed']);
  });

  it('derives success probability with decay', () => {
    const emitter = new InferenceEventEmitter();
    for (let i = 0; i < 10; i++) {
      emitter.emit({ type: 'request_completed', providerId: 'p1', modelId: 'm1', success: true });
    }
    const prob = emitter.getSuccessProbability('p1', 'm1');
    expect(prob).toBeGreaterThan(0.9);
  });
});