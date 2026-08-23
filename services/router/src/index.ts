export { Router, type RouterConfig } from './router.service.js';
export { classifyTask, type ClassifyOptions } from './classifier/task-classifier.js';
export { detectModality } from './classifier/modality-detector.js';
export { extractCapabilities } from './classifier/capability-extractor.js';
export { runPipeline, runDeterministicFilters, runPipelineFromFiltered, type PipelineInput, type PipelineOutput } from './pipeline/pipeline.js';
export { capabilityFilter } from './pipeline/capability-filter.js';
export { availabilityFilter } from './pipeline/availability-filter.js';
export { costLatencyScorer } from './pipeline/cost-latency-scorer.js';
export { finalSelector, type ThompsonSamplerLike } from './pipeline/final-selector.js';
export { executeWithFallback, executeWithHedging, resetHedgeState, type AdapterExecutor } from './fallback/fallback-executor.js';
export { TaskDecomposer, SpecialistRouter, CompositeExecutor, type SubTask, type DecomposedTask, type CompositeResult } from './decomposer/index.js';
export { ThompsonSampler, calculateReward } from './bandit/thompson-sampler.js';
export { loadBanditArms, saveBanditArms, startBanditPersistence, BANDIT_PERSIST_INTERVAL_MS } from './bandit/persistence.js';
export { META_MODELS, isMetaModel, getMetaModel, resolveMetaModel, invalidateRankerCache, getRankerCacheStats, type MetaModelDefinition } from './meta-models.js';
export { hashConversation, breakStickySession } from './sticky/sticky-session.js';

// Routing strategies
export { selectLeastBusy, incrementInFlight, decrementInFlight } from './strategies/least-busy.js';
export { selectUsageBased, recordRequest, getUsageStats } from './strategies/usage-based.js';
export { selectLowestLatency, recordLatency, getLatencyStats } from './strategies/latency-based.js';
export { selectByTags, filterByTags } from './strategies/tag-based.js';
