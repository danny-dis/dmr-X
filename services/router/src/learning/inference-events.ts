// services/router/src/learning/inference-events.ts
export type InferenceEventType =
  | 'request_started'
  | 'candidate_selected'
  | 'reservation_created'
  | 'provider_started'
  | 'first_token'
  | 'provider_completed'
  | 'reservation_reconciled'
  | 'rate_limit_observed'
  | 'provider_failed'
  | 'fallback_selected'
  | 'request_completed';

export interface InferenceEvent {
  type: InferenceEventType;
  providerId: string;
  modelId: string;
  success?: boolean;
  latencyMs?: number;
  ttftMs?: number;
  tokensUsed?: number;
  error?: string;
}

type EventHandler = (event: InferenceEvent) => void;

export class InferenceEventEmitter {
  private handlers = new Map<InferenceEventType, EventHandler[]>();
  private observations = new Map<string, { successes: number; failures: number; lastDecay: number }>();

  on(event: InferenceEventType, handler: EventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  emit(event: InferenceEvent): void {
    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) handler(event);

    // Update learning state
    if (event.type === 'request_completed') {
      this.recordOutcome(event.providerId, event.modelId, event.success ?? false);
    }
  }

  private recordOutcome(providerId: string, modelId: string, success: boolean): void {
    const key = `${providerId}:${modelId}`;
    let obs = this.observations.get(key);
    if (!obs) {
      obs = { successes: 0, failures: 0, lastDecay: Date.now() };
      this.observations.set(key, obs);
    }
    if (success) obs.successes++;
    else obs.failures++;
  }

  getSuccessProbability(providerId: string, modelId: string): number {
    const key = `${providerId}:${modelId}`;
    const obs = this.observations.get(key);
    if (!obs) return 0.5; // unknown = 0.5
    const total = obs.successes + obs.failures;
    if (total === 0) return 0.5;
    return obs.successes / total;
  }
}