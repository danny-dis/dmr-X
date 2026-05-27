export { Router, type RouterConfig } from './router.service.js';
export { classifyTask, type ClassifyOptions } from './classifier/task-classifier.js';
export { detectModality } from './classifier/modality-detector.js';
export { extractCapabilities } from './classifier/capability-extractor.js';
export { runPipeline, type PipelineInput, type PipelineOutput } from './pipeline/pipeline.js';
export { capabilityFilter } from './pipeline/capability-filter.js';
export { availabilityFilter } from './pipeline/availability-filter.js';
export { costLatencyScorer } from './pipeline/cost-latency-scorer.js';
export { finalSelector } from './pipeline/final-selector.js';
export { executeWithFallback, type AdapterExecutor } from './fallback/fallback-executor.js';
export { TaskDecomposer, SpecialistRouter, CompositeExecutor, type SubTask, type DecomposedTask, type CompositeResult } from './decomposer/index.js';
export { ThompsonSampler, calculateReward } from './bandit/thompson-sampler.js';
export { RewardUpdater, type RequestRecord } from './bandit/reward-updater.js';
//# sourceMappingURL=index.d.ts.map