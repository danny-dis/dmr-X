import { ProviderUnavailableError } from '@dmr-x/core';
import type { UnifiedRequest, RoutingPlan, UnifiedResponse, FreeTierStrategy, ProviderPreferences, ProviderModel } from '@dmr-x/core';
import type { CandidateSet } from '@dmr-x/core';
import type { PolicyService } from '@dmr-x/policy';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import { logger } from '@dmr-x/utils';
import { trace, SpanStatusCode } from '@opentelemetry/api';

import { ThompsonSampler } from './bandit/thompson-sampler.js';
import { classifyTask, type ClassifyOptions } from './classifier/task-classifier.js';
import { CompositeExecutor } from './decomposer/composite-executor.js';
import { SpecialistRouter } from './decomposer/specialist-router.js';
import { TaskDecomposer } from './decomposer/task-decomposer.js';
import { WorkerPoolFanout } from './decomposer/worker-pool-fanout.js';
import { executeWithFallback, type AdapterExecutor } from './fallback/fallback-executor.js';
import { isMetaModel, resolveMetaModel } from './meta-models.js';
import { runPipeline } from './pipeline/pipeline.js';
import { hashConversation, getStickyProvider, setStickyProvider, breakStickySession } from './sticky/sticky-session.js';

// The router shares the gateway's tracer instance (see services/telemetry/src/tracer.ts).
// The OTel API resolves this lazily through the global provider, so it is always
// safe to call tracer.startActiveSpan(...) — pre-SDK, the spans go to a no-op
// provider and incur only the cost of one context lookup.
const tracer = trace.getTracer('dmr-x-gateway', '0.5.0');

export interface RouterConfig {
  epsilon?: number;
  defaultQualityTarget?: 'frontier' | 'balanced' | 'economy';
  enableDecomposition?: boolean; // Enable task decomposition for complex prompts
  decompositionThreshold?: number; // Min prompt length to trigger decomposition
  rateLimitService?: RateLimitService;
  quotaService?: QuotaService;
  policyService?: PolicyService;
  freeTierStrategy?: FreeTierStrategy;
  /** Default cost filter for meta-model aliases ('all' or 'free'). Overridden by per-request x-cost-filter header. */
  metaModelCostFilter?: 'free' | 'all';
  onProviderSuccess?: (providerId: string) => void;
  onProviderFailure?: (providerId: string) => void;
}

export class Router {
  private candidates: CandidateSet = [];
  private adapterExecutor: AdapterExecutor | null = null;
  private taskDecomposer: TaskDecomposer;
  private specialistRouter: SpecialistRouter;
  private compositeExecutor: CompositeExecutor | null = null;
  private thompsonSampler: ThompsonSampler;
  private workerPool: WorkerPoolFanout | null = null;

  constructor(private readonly config: RouterConfig = {}) {
    this.taskDecomposer = new TaskDecomposer();
    this.specialistRouter = new SpecialistRouter();
    this.thompsonSampler = new ThompsonSampler();
  }

  /**
   * Return the internal ThompsonSampler instance. Used by the RewardUpdater
   * to train the bandit on request outcomes.
   */
  getSampler(): ThompsonSampler {
    return this.thompsonSampler;
  }

  setCandidates(candidates: CandidateSet): void {
    this.candidates = candidates;
  }

  getCandidateCount(): number {
    return this.candidates.length;
  }

  /**
   * Return the profile for a specific provider/model pair from the current
   * candidate set. Used to retrieve quality scores and costs for reward
   * calculation.
   */
  getCandidate(providerId: string, modelId: string): ProviderModel | undefined {
    return this.candidates.find(
      (c) => c.providerId === providerId && c.modelId === modelId
    );
  }

  setAdapterExecutor(executor: AdapterExecutor): void {
    this.adapterExecutor = executor;
    // Wire the WorkerPoolFanout opt-in: when DMRX_WORKER_POOL_FANOUT=true the
    // gateway registers itself as a worker and tracks every parallel sub-task
    // as a WorkerJob in the SQLite `worker_jobs` table (and the /v1/admin/workers API).
    this.workerPool = new WorkerPoolFanout(executor, {
      enabled: process.env.DMRX_WORKER_POOL_FANOUT === 'true',
    });
    this.compositeExecutor = new CompositeExecutor(
      this.specialistRouter,
      executor,
      this.workerPool,
    );
    if (process.env.DMRX_WORKER_POOL_FANOUT === 'true') {
      logger.info('WorkerPoolFanout enabled (DMRX_WORKER_POOL_FANOUT=true)');
    }
  }

  /**
   * Shutdown the router and its components.
   * Drains the worker pool if it was enabled.
   */
  shutdown(): void {
    if (this.workerPool) {
      this.workerPool.shutdown();
    }
  }

  /**
   * Route a request - handles both simple and composite tasks
   */
  async route(
    request: UnifiedRequest,
    options: ClassifyOptions & { requestId?: string }
  ): Promise<{ plan: RoutingPlan; response: UnifiedResponse }> {
    // Check if decomposition is enabled and the prompt is complex enough
    const shouldDecompose = this.config.enableDecomposition !== false &&
      this.isComplexPrompt(request) &&
      this.compositeExecutor;

    if (shouldDecompose) {
      return this.routeComposite(request, options);
    }

    return this.routeSimple(request, options);
  }

  /**
   * Route a simple (non-decomposed) request
   */
  private async routeSimple(
    request: UnifiedRequest,
    options: ClassifyOptions & { requestId?: string }
  ): Promise<{ plan: RoutingPlan; response: UnifiedResponse }> {
    // Resolve requestId from options or from request metadata
    const requestId = options.requestId || (request as any).metadata?.requestId;
    // Step 0: Check for sticky session
    const messages = request.messages || [];
    const conversationHash = hashConversation(messages);
    const freeTierStrategy = (request as any).metadata?.freeTierStrategy || this.config.freeTierStrategy;

    // Parse an optional `providerName/modelId` prefix out of the requested
    // model. The prefix is only honored when it names a known provider —
    // model ids legitimately contain slashes (e.g. `qwen/qwen3-coder`), so an
    // unrecognised prefix is left intact as part of the model id.
    const modelTarget = this.parseModelTarget(request.model);

    // An explicit provider pin bypasses sticky sessions: the caller asked for
    // a specific provider, so a previously-stuck different provider must not win.
    if (conversationHash && !modelTarget.providerName) {
      const sticky = await getStickyProvider(
        conversationHash,
        this.config.rateLimitService,
        freeTierStrategy,
        (providerId, modelId) => {
          const candidate = this.candidates.find(c => c.providerId === providerId && c.modelId === modelId);
          return candidate ? candidate.costPerInputToken === 0 && candidate.costPerOutputToken === 0 : false;
        }
      );
      if (sticky) {
        // Check if sticky provider is still in candidates and healthy
        const stickyCandidate = this.candidates.find(
          (c) => c.providerId === sticky.providerId && c.modelId === sticky.modelId && c.isHealthy
        );

        if (stickyCandidate) {
          // Check rate limits before using sticky provider
          if (this.config.rateLimitService) {
            const check = this.config.rateLimitService.checkLimit(sticky.providerId, sticky.modelId, this.estimateTokens(request));
            if (!check.allowed) {
              // Break sticky session and fall through to normal routing
              await breakStickySession(conversationHash, `Rate limited: ${check.reason}`);
            } else {
              logger.info(
                { providerId: sticky.providerId, modelId: sticky.modelId },
                'Using sticky session'
              );

              if (!this.adapterExecutor) {
                throw new Error('No adapter executor configured');
              }

              const plan: RoutingPlan = {
                primary: { providerId: sticky.providerId, modelId: sticky.modelId, adapterType: 'sticky', score: 1 },
                chain: [],
                timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
                maxRetries: 1,
              };

              if (options.planOnly) {
                return { plan, response: { modelId: plan.primary.modelId, providerId: plan.primary.providerId, modality: request.modality || 'llm', requestId: '', latencyMs: 0 } };
              }

              try {
                const response = await executeWithFallback(plan, request, this.adapterExecutor, {
                  rateLimitService: this.config.rateLimitService,
                  quotaService: this.config.quotaService,
                  tenantId: (request as any).metadata?.tenant?.id,
                  requestId,
                  onSuccess: this.config.onProviderSuccess,
                  onFailure: this.config.onProviderFailure,
                });
                return { plan, response };
              } catch (error) {
                // Break sticky session on provider failure
                await breakStickySession(conversationHash, `Provider failed: ${error instanceof Error ? error.message : 'unknown'}`);
                throw error;
              }
            }
          } else {
            logger.info(
              { providerId: sticky.providerId, modelId: sticky.modelId },
              'Using sticky session'
            );

            if (!this.adapterExecutor) {
              throw new Error('No adapter executor configured');
            }

            const plan: RoutingPlan = {
              primary: { providerId: sticky.providerId, modelId: sticky.modelId, adapterType: 'sticky', score: 1 },
              chain: [],
              timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
              maxRetries: 1,
            };

            if (options.planOnly) {
              return { plan, response: { modelId: plan.primary.modelId, providerId: plan.primary.providerId, modality: request.modality || 'llm', requestId: '', latencyMs: 0 } };
            }

            try {
              const response = await executeWithFallback(plan, request, this.adapterExecutor, {
                rateLimitService: this.config.rateLimitService,
                quotaService: this.config.quotaService,
                tenantId: (request as any).metadata?.tenant?.id,
                requestId,
                onSuccess: this.config.onProviderSuccess,
                onFailure: this.config.onProviderFailure,
              });
              return { plan, response };
            } catch (error) {
              // Break sticky session on provider failure
              await breakStickySession(conversationHash, `Provider failed: ${error instanceof Error ? error.message : 'unknown'}`);
              throw error;
            }
          }
        }
      }
    }

    // Step 1: Classify the task (router.classify span)
    const taskProfile = tracer.startActiveSpan('router.classify', (span) => {
      try {
        const profile = classifyTask(request, options);
        span.setAttribute('router.modality', profile.modality);
        span.setAttribute('router.quality_target', profile.qualityTarget);
        span.setAttribute('router.capability_count', profile.capabilities.length);
        if (requestId) span.setAttribute('request.id', requestId);
        logger.debug({ taskProfile: profile }, 'Task classified');
        return profile;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });

    // Step 1.5: Resolve meta-model aliases to filtered candidates
    // (still inside the classify stage semantically — keeps the trace tidy
    // because meta-model resolution is a sub-step of "what is this request?".)
    // When the caller pins a provider explicitly, constrain the candidate pool
    // to that provider before any selection or scoring happens.
    const scopedCandidates = modelTarget.providerName
      ? this.candidates.filter(c => c.providerName === modelTarget.providerName)
      : this.candidates;
    let pipelineCandidates = scopedCandidates;
    // Cost filter: per-request header overrides router-level env var default
    const costFilterOverride = (request as any).metadata?.costFilter as 'free' | 'all' | undefined
      || this.config.metaModelCostFilter;

    let metaModelFilteredFree = false;
    if (modelTarget.modelId && isMetaModel(modelTarget.modelId)) {
      const resolution = resolveMetaModel(modelTarget.modelId, scopedCandidates, costFilterOverride);
      if (resolution) {
        logger.info({ metaModel: modelTarget.modelId, candidateCount: resolution.resolved.length, costFilter: resolution.costFilter }, 'Resolved meta-model');
        pipelineCandidates = resolution.resolved;
        // Flag when meta-model filtered to free-only (skip redundant pipeline filtering)
        if (resolution.costFilter === 'free')
          metaModelFilteredFree = true;
      } else {
        logger.warn({ metaModel: modelTarget.modelId, totalCandidates: scopedCandidates.length }, 'Meta-model resolved to zero candidates');
        throw new ProviderUnavailableError(
          scopedCandidates.map(c => `${c.providerId}/${c.modelId}`),
          0
        );
      }
    }

    // Step 1.6: Direct model selection — if the user picked a specific model, route to it
    // Step 2: provider-preference direct strategy.
    // Both branches are wrapped in the `router.select_candidates` span so
    // the trace shows "we picked a model" as one logical step regardless
    // of which branch was taken.
    const tenantId = (request as any).metadata?.tenant?.id;
    const directSelection = tracer.startActiveSpan('router.select_candidates', (span) => {
      try {
        span.setAttribute('router.candidate_pool_size', pipelineCandidates.length);
        span.setAttribute('router.is_meta_model', modelTarget.modelId ? isMetaModel(modelTarget.modelId) : false);
        if (modelTarget.modelId && !isMetaModel(modelTarget.modelId)) {
          // pipelineCandidates is already scoped to the pinned provider (if any),
          // so this exact-match is naturally constrained to that provider.
          const directMatch = pipelineCandidates.find(
            (c) => c.modelId === modelTarget.modelId && c.isHealthy
          );
          if (directMatch) {
            span.setAttribute('router.selection', 'direct_model');
            span.setAttribute('router.selected_provider', directMatch.providerId);
            span.setAttribute('router.selected_model', directMatch.modelId);
            logger.info({ model: modelTarget.modelId, provider: directMatch.providerName }, 'Direct model selection');
            return {
              providerId: directMatch.providerId,
              modelId: directMatch.modelId,
              adapterType: directMatch.providerName,
              score: 1,
            } as const;
          }
        }
        const providerPreferences: ProviderPreferences | undefined = request.metadata?.providerPreferences;
        if (providerPreferences?.strategy === 'direct' && providerPreferences.order?.length) {
          const directCandidate = pipelineCandidates.find(
            (c) => c.providerId === providerPreferences.order![0] && c.isHealthy
          );
          if (directCandidate) {
            span.setAttribute('router.selection', 'direct_strategy');
            span.setAttribute('router.selected_provider', directCandidate.providerId);
            span.setAttribute('router.selected_model', directCandidate.modelId);
            return {
              providerId: directCandidate.providerId,
              modelId: directCandidate.modelId,
              adapterType: directCandidate.providerName,
              score: 1,
            } as const;
          }
        }
        span.setAttribute('router.selection', 'pipeline');
        return null;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });

    if (directSelection) {
      // We picked a specific provider above — bypass the scoring pipeline
      // and go straight to execution.
      const plan: RoutingPlan = {
        primary: { ...directSelection, score: 1 },
        chain: [],
        timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
        maxRetries: 1,
      };
      if (options.planOnly) {
        return { plan, response: { modelId: plan.primary.modelId, providerId: plan.primary.providerId, modality: request.modality || 'llm', requestId: '', latencyMs: 0 } };
      }
      if (!this.adapterExecutor) throw new Error('No adapter executor configured');
      const response = await this.executePlan(plan, request, tenantId, requestId);
      return { plan, response };
    }

    // Step 3: Score candidates by running the routing pipeline
    if (!this.adapterExecutor) {
      throw new Error('No adapter executor configured');
    }

    const providerPreferences: ProviderPreferences | undefined = request.metadata?.providerPreferences;
    const effectiveFreeTierStrategy = (request as any).metadata?.freeTierStrategy || this.config.freeTierStrategy;
    const pipelineResult = await tracer.startActiveSpan('router.score', async (span) => {
      try {
        span.setAttribute('router.candidate_pool_size', pipelineCandidates.length);
        span.setAttribute('router.quality_target', taskProfile.qualityTarget);
        let result;
        try {
          result = await runPipeline({
            taskProfile,
            candidates: pipelineCandidates,
            epsilon: this.config.epsilon ?? 0.05,
            rateLimitService: this.config.rateLimitService,
            quotaService: this.config.quotaService,
            policyService: this.config.policyService,
            tenantId,
            estimatedTokens: this.estimateTokens(request),
            freeTierStrategy: effectiveFreeTierStrategy,
            providerPreferences,
            metaModelFilteredFree,
            thompsonSampler: this.thompsonSampler,
          });
        } catch (error) {
          if (error instanceof ProviderUnavailableError && error.retryAfter) {
            const waitMs = Math.min(error.retryAfter, 3000);
            logger.info({ waitMs }, 'All providers temporarily unavailable, retrying after wait');
            span.addEvent('router.retry_after_wait', { 'wait_ms': waitMs });
            await new Promise(resolve => setTimeout(resolve, waitMs));
            result = await runPipeline({
              taskProfile,
              candidates: pipelineCandidates,
              epsilon: this.config.epsilon ?? 0.05,
              rateLimitService: this.config.rateLimitService,
              quotaService: this.config.quotaService,
              policyService: this.config.policyService,
              tenantId,
              estimatedTokens: this.estimateTokens(request),
              freeTierStrategy: effectiveFreeTierStrategy,
              providerPreferences,
              metaModelFilteredFree,
              thompsonSampler: this.thompsonSampler,
            });
          } else {
            throw error;
          }
        }
        span.setAttribute('router.selected_provider', result.selected.providerId);
        span.setAttribute('router.selected_model', result.selected.modelId);
        span.setAttribute('router.fallback_count', result.chain.length);
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });

    const plan: RoutingPlan = {
      primary: pipelineResult.selected,
      chain: pipelineResult.chain,
      timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
      maxRetries: 3,
    };

    logger.info(
      { primary: plan.primary, fallbackCount: plan.chain.length },
      'Routing plan created'
    );

    // If planOnly, return just the plan without executing
    if (options.planOnly) {
      return {
        plan,
        response: { modelId: plan.primary.modelId, providerId: plan.primary.providerId, modality: request.modality || 'llm', requestId: '', latencyMs: 0 },
      };
    }

    // Step 4: Execute the plan with adapter fallback
    const response = await tracer.startActiveSpan('router.execute', async (span) => {
      try {
        span.setAttribute('router.selected_provider', plan.primary.providerId);
        span.setAttribute('router.selected_model', plan.primary.modelId);
        span.setAttribute('router.fallback_count', plan.chain.length);
        if (!this.adapterExecutor) throw new Error('No adapter executor configured');
        const res = await executeWithFallback(plan, request, this.adapterExecutor, {
          rateLimitService: this.config.rateLimitService,
          quotaService: this.config.quotaService,
          tenantId,
          requestId,
          onSuccess: this.config.onProviderSuccess,
          onFailure: this.config.onProviderFailure,
        });
        span.setAttribute('router.used_provider', res.providerId);
        return res;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });

    // Step 5: Set sticky session for this conversation
    if (conversationHash) {
      // Get RPM for TTL adjustment if rate limit service is available
      let rateLimitRpm: number | undefined;
      if (this.config.rateLimitService) {
        const check = this.config.rateLimitService.checkLimit(plan.primary.providerId, plan.primary.modelId, 0);
        // Extract RPM from reason string if rate-limited, otherwise use a default
        if (!check.allowed && check.reason) {
          const rpmMatch = check.reason.match(/RPM limit \((\d+)\)/);
          if (rpmMatch) rateLimitRpm = parseInt(rpmMatch[1], 10);
        }
      }

      await setStickyProvider(
        conversationHash,
        plan.primary.providerId,
        plan.primary.modelId,
        undefined,
        rateLimitRpm
      );
    }

    return { plan, response };
  }

  /**
   * Execute a routing plan that has already been finalised (used by both
   * the direct-model branch and the scored branch). Wrapped in its own
   * `router.execute` span so a trace makes the "this plan was executed"
   * step explicit regardless of which branch produced it.
   */
  private async executePlan(
    plan: RoutingPlan,
    request: UnifiedRequest,
    tenantId: string | undefined,
    requestId: string | undefined,
  ): Promise<UnifiedResponse> {
    return tracer.startActiveSpan('router.execute', async (span) => {
      try {
        span.setAttribute('router.selected_provider', plan.primary.providerId);
        span.setAttribute('router.selected_model', plan.primary.modelId);
        span.setAttribute('router.fallback_count', plan.chain.length);
        if (!this.adapterExecutor) throw new Error('No adapter executor configured');
        const res = await executeWithFallback(plan, request, this.adapterExecutor, {
          rateLimitService: this.config.rateLimitService,
          quotaService: this.config.quotaService,
          tenantId,
          requestId,
          onSuccess: this.config.onProviderSuccess,
          onFailure: this.config.onProviderFailure,
        });
        span.setAttribute('router.used_provider', res.providerId);
        return res;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Route a composite (decomposed) request
   */
  private async routeComposite(
    request: UnifiedRequest,
    options: ClassifyOptions
  ): Promise<{ plan: RoutingPlan; response: UnifiedResponse }> {
    logger.info('Decomposing complex prompt into sub-tasks');

    // Step 1: Decompose the prompt
    const decomposed = this.taskDecomposer.decompose(request);

    logger.info(
      { subTaskCount: decomposed.subTasks.length, requiresOrchestration: decomposed.requiresOrchestration },
      'Task decomposed'
    );

    // Step 1.5: Resolve meta-model aliases (honoring any explicit provider pin)
    const compositeModelTarget = this.parseModelTarget(request.model);
    const compositeScoped = compositeModelTarget.providerName
      ? this.candidates.filter(c => c.providerName === compositeModelTarget.providerName)
      : this.candidates;
    let compositeCandidates = compositeScoped;
    const compositeCostFilterOverride = (request as any).metadata?.costFilter as 'free' | 'all' | undefined
      || this.config.metaModelCostFilter;
    if (compositeModelTarget.modelId && isMetaModel(compositeModelTarget.modelId)) {
      const resolution = resolveMetaModel(compositeModelTarget.modelId, compositeScoped, compositeCostFilterOverride);
      if (resolution) {
        logger.info({ metaModel: compositeModelTarget.modelId, candidateCount: resolution.resolved.length, costFilter: resolution.costFilter }, 'Resolved meta-model for composite');
        compositeCandidates = resolution.resolved;
      } else {
        logger.warn({ metaModel: compositeModelTarget.modelId, totalCandidates: compositeScoped.length }, 'Meta-model resolved to zero candidates (composite)');
        throw new ProviderUnavailableError(
          compositeScoped.map(c => `${c.providerId}/${c.modelId}`),
          0
        );
      }
    }

    // Step 2: Execute via composite executor
    const freeTierStrategy = (request as any).metadata?.freeTierStrategy || this.config.freeTierStrategy;
    const result = await this.compositeExecutor!.execute(
      decomposed,
      compositeCandidates,
      request,
      options.qualityTarget || this.config.defaultQualityTarget || 'balanced',
      freeTierStrategy
    );

    // Log model assignments
    for (const [subTaskId, model] of result.modelAssignments) {
      logger.info({ subTaskId, model }, 'Sub-task assigned');
    }

    // Create a synthetic plan for the composite result
    const plan: RoutingPlan = {
      primary: {
        providerId: 'dmr-x-composite',
        modelId: 'multi-model',
        adapterType: 'composite',
        score: 1,
      },
      chain: [],
      timeoutMs: decomposed.executionPlan.estimatedDurationMs,
      maxRetries: 1,
    };

    return { plan, response: result.aggregatedResponse };
  }

  /**
   * Check if a prompt is complex enough to warrant decomposition
   */
  private isComplexPrompt(request: UnifiedRequest): boolean {
    const prompt = this.extractPrompt(request);
    const threshold = this.config.decompositionThreshold || 100;

    if (prompt.length < threshold) {
      return false;
    }

    // Check for multiple task indicators (use word boundaries to avoid false positives)
    const taskIndicators = [
      'frontend', 'backend', 'database', 'api', 'ui', 'server',
      'test', 'deploy', 'docker', 'component', 'schema',
      'react', 'vue', 'node', 'python', 'sql',
    ];

    const lowerPrompt = prompt.toLowerCase();
    const matchCount = taskIndicators.filter((ind) => {
      const regex = new RegExp(`\\b${ind}\\b`, 'i');
      return regex.test(lowerPrompt);
    }).length;

    // If 2+ task types mentioned, it's a composite task
    return matchCount >= 2;
  }

  private extractPrompt(request: UnifiedRequest): string {
    if (request.messages) {
      return request.messages
        .filter((m) => m.role === 'user')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n');
    }
    return request.prompt || '';
  }

  /**
   * Parse an optional `providerName/modelId` prefix from the requested model.
   *
   * The prefix is only treated as a provider pin when it matches a known
   * provider name in the current candidate set. Model ids legitimately contain
   * slashes (e.g. `qwen/qwen3-coder`, `meta-llama/llama-3.1-8b`), so an
   * unrecognised prefix is left as part of the model id and routed normally.
   *
   * Examples (assuming `pollinations` and `openrouter-free` are known providers):
   *   "pollinations/openai-fast"          → { providerName: "pollinations", modelId: "openai-fast" }
   *   "openrouter-free/qwen/qwen3-coder"  → { providerName: "openrouter-free", modelId: "qwen/qwen3-coder" }
   *   "qwen/qwen3-coder"                  → { modelId: "qwen/qwen3-coder" }  (qwen is not a provider)
   *   "auto-smart"                        → { modelId: "auto-smart" }
   */
  private parseModelTarget(model: string | undefined): { providerName?: string; modelId: string } {
    if (!model) return { modelId: '' };
    const slash = model.indexOf('/');
    if (slash <= 0) return { modelId: model };
    const providerName = model.slice(0, slash);
    const rest = model.slice(slash + 1);
    if (rest && this.candidates.some(c => c.providerName === providerName)) {
      return { providerName, modelId: rest };
    }
    return { modelId: model };
  }

  /**
   * Estimate token count for rate-limit checking.
   * Uses ~4 chars/token heuristic (same as FreeLLMAPI).
   */
  private estimateTokens(request: UnifiedRequest): number {
    const prompt = this.extractPrompt(request);
    const maxTokens = request.max_tokens || 4096;
    return Math.ceil(prompt.length / 4) + maxTokens;
  }
}
