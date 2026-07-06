import { EventEmitter } from 'node:events';

/**
 * System-wide event bus for DMR-X.
 * Enables decoupling between services (e.g. Discovery -> Benchmarking -> Router).
 */
export const eventBus = new EventEmitter();

/**
 * Standard event names for the system
 */
export const SystemEvents = {
  // Triggered when a new model is found on a provider's /v1/models endpoint
  MODEL_DISCOVERED: 'model:discovered',
  
  // Triggered when a model is registered in the database
  MODEL_REGISTERED: 'model:registered',
  
  // Triggered when a benchmark run is completed
  BENCHMARK_COMPLETED: 'benchmark:completed',
  
  // Triggered when a model's Elo rating is updated
  ELO_UPDATED: 'elo:updated',
  
  // Triggered when human feedback is received from the playground
  PLAYGROUND_FEEDBACK: 'playground:feedback',

  // Triggered when a benchmark regression is detected
  BENCHMARK_REGRESSION: 'benchmark:regression',

  // Triggered when a human validates a judge's decision
  BENCHMARK_VALIDATED: 'benchmark:validated',

  // Triggered when inter-rater reliability is computed
  JUDGE_RELIABILITY_UPDATED: 'judge:reliability:updated',
} as const;
