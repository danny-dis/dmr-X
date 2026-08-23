import { ProviderUnavailableError, ValidationError } from '@dmr-x/core';
import { BadGatewayError, ServiceUnavailableError } from '@dmr-x/utils';
import type { UnifiedRequest, RoutingPlan, UnifiedResponse, FreeTierStrategy, ProviderPreferences, ProviderModel } from '@dmr-x/core';
import type { CandidateSet } from '@dmr-x/core';
import type { PolicyService } from '@dmr-x/policy';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import { keyRotationService } from '@dmr-x/quota';
import { logger } from '@dmr-x/utils';
import { trace, SpanStatusCode } from '@opentelemetry/api';

import { ThompsonSampler, calculateReward } from './bandit/thompson-sampler.js';
import { ClusterScorer } from './cluster/cluster-scorer.js';
import { classifyTask, type ClassifyOptions } from './classifier/task-classifier.js';
import { CompositeExecutor } from './decomposer/composite-executor.js';
import { SpecialistRouter } from './decomposer/specialist-router.js';
import { TaskDecomposer } from './decomposer/task-decomposer.js';
import { WorkerPoolFanout } from './decomposer/worker-pool-fanout.js';
import { executeWithFallback, executeWithHedging, isModelOnErrorCooldown, type AdapterExecutor } from './fallback/fallback-executor.js';
import { HandoverSummarizer, type SummarizationExecutor } from './handover/handover-summarizer.js';
import { isMetaModel, resolveMetaModel } from './meta-models.js';
import { getGuardrailEngine, type GuardrailEngine } from './guardrails/guardrail-engine.js';

import { runPipeline, runDeterministicFilters, runPipelineFromFiltered } from './pipeline/pipeline.js';
import { hashConversation, setStickyProvider } from './sticky/sticky-session.js';
import { handleStickySession } from './sticky-session-handler.js';

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
  enablePlanner?: boolean; // Enable STAY vs SWITCH planner (borrowed from workweave/router)
  enableHandover?: boolean; // Enable handover summarization on model switches
  rateLimitService?: RateLimitService;
  quotaService?: QuotaService;
  policyService?: PolicyService;
  freeTierStrategy?: FreeTierStrategy;
  /** Default cost filter for meta-model aliases ('all' or 'free'). Overridden by per-request x-cost-filter header. */
  metaModelCostFilter?: 'free' | 'all';
  onProviderSuccess?: (providerId: string) => void;
  onProviderFailure?: (providerId: string) => void;
  /** Executor for handover summarization (provides the LLM call) */
  summarizationExecutor?: SummarizationExecutor;
}

/**
 * Brief backoff applied before retrying a request that failed with an
 * upstream 5xx (502/503). Bursts of 502s from a flapping provider usually
 * clear within a second; a short wait lets the circuit-breaker/cooldown
 * reset so the retry lands on a healthy candidate instead of re-hitting
 * the same failing one.
 */
const UPSTREAM_5XX_BACKOFF_MS = 800;

/**
 * An upstream 5xx (BadGateway 502 / ServiceUnavailable 503) is transient and
 * retryable — unlike a 4xx (bad request/auth) which is the caller's fault.
 * Without this, a burst of provider 502s cascaded straight to the caller
 * (Chimera saw `needs_user` and stalled) instead of being retried across the
 * healthy candidate pool. ProviderUnavailableError is already retried by the
 * caller; this covers the parallel path where the adapter surfaces a raw
 * HttpError subclass.
 */
function isRetryable5xx(error: unknown): boolean {
  if (error instanceof BadGatewayError || error instanceof ServiceUnavailableError) return true;
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return typeof status === 'number' && status >= 500 && status !== 501;
}

export class Router {
  private candidates: CandidateSet = [];
  private adapterExecutor: AdapterExecutor | null = null;
  private taskDecomposer: TaskDecomposer;
  private specialistRouter: SpecialistRouter;
  private compositeExecutor: CompositeExecutor | null = null;
  private thompsonSampler: ThompsonSampler;
  private clusterScorer: ClusterScorer;
  private workerPool: WorkerPoolFanout | null = null;
  private handoverSummarizer: HandoverSummarizer;
  private enablePlanner: boolean;
  private enableHandover: boolean;
  private guardrailEngine: GuardrailEngine;

  constructor(private readonly config: RouterConfig = {}) {
    this.taskDecomposer = new TaskDecomposer();
    this.specialistRouter = new SpecialistRouter();
    // Wire the bandit to the rate-limit penalty signal so arms that keep
    // 429ing are demoted in selection (see ThompsonSampler.adjustByQualityTarget).
    this.thompsonSampler = new ThompsonSampler(undefined, undefined, (p, m) => this.config.rateLimitService?.getPenaltyPoints(p, m) ?? 0);
    this.clusterScorer = new ClusterScorer();
    this.handoverSummarizer = new HandoverSummarizer();
    this.guardrailEngine = getGuardrailEngine();
    this.enablePlanner = config.enablePlanner !== false; // Default enabled
    this.enableHandover = config.enableHandover !== false; // Default enabled
    // Initialize cluster scorer asynchronously
    this.clusterScorer.initialize().catch(err => {
      logger.warn({ error: String(err) }, 'Cluster scorer initialization failed');
    });
  }

  /**
   * Return the internal ThompsonSampler instance. Used by the RewardUpdater
   * to train the bandit on request outcomes.
   */
  getSampler(): ThompsonSampler {
    return this.thompsonSampler;
  }

  /**
   * Return the cluster scorer instance. Available for pipeline integration.
   */
  getClusterScorer(): ClusterScorer {
    return this.clusterScorer;
  }

  /**
   * Return the guardrail engine instance. Allows adding/removing plugins.
   */
  getGuardrailEngine(): GuardrailEngine {
    return this.guardrailEngine;
  }

  /**
   * Replace the guardrail engine (e.g., for per-tenant configuration).
   */
  setGuardrailEngine(engine: GuardrailEngine): void {
    this.guardrailEngine = engine;
  }

  setCandidates(candidates: CandidateSet): void {
    this.candidates = candidates;
  }

  /**
   * Return the current candidate set. Used by the streaming chat route to
   * force-inject healthy fallbacks when a meta-model selection yields an empty
   * fallback chain — guarantees a failed primary always has somewhere to fall
   * back to before any token reaches the client (DMR-X smooth-flow contract).
   */
  getCandidates(): CandidateSet {
    return this.candidates;
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

  /**
   * Resolve the candidate that ACTUALLY served a response. `response.providerId`
   * is the adapter/provider NAME (e.g. "google"), while candidates/plans are
   * keyed by the DB provider UUID, so it must be resolved back to a candidate
   * rather than compared directly — see the sticky-session comment in
   * `routeSimple` for the failure mode this avoids.
   */
  private resolveServedCandidate(response: UnifiedResponse, fallbackModelId: string): ProviderModel | undefined {
    const servedModelId = response.modelId || fallbackModelId;
    return (
      this.candidates.find(
        (c) => c.modelId === servedModelId &&
          (c.providerId === response.providerId || c.providerName === response.providerId)
      ) ?? this.candidates.find((c) => c.modelId === servedModelId)
    );
  }

  /**
   * Train the Thompson sampler's posterior on this request's outcome. This is
   * the reward loop that was previously missing entirely — every arm sat at
   * its alpha=1/beta=1 prior forever, so selection degenerated into an argmax
   * over the deterministic quality/cost/latency score.
   *
   * On success, the reward is attributed to whichever candidate ACTUALLY
   * served the response (see `resolveServedCandidate`), not `plan.primary` —
   * `executeWithFallback` may have recovered via a chain entry.
   *
   * On failure there is no response to resolve a served candidate from, so
   * `plan.primary` (the arm the router chose) eats the penalty. This is a
   * best-effort attribution: if fallback entries were also tried and failed,
   * their arms are not penalized here, since `executeWithFallback` does not
   * currently surface which chain entries were attempted with enough detail
   * (provider *and* model) to resolve them back to candidates.
   *
   * Swallows all errors — a bandit bookkeeping failure must never fail the
   * request that already succeeded or already failed for its own reason.
   */
  private recordBanditReward(
    plan: RoutingPlan,
    response: UnifiedResponse | null,
    success: boolean,
  ): void {
    try {
      const candidate = response
        ? this.resolveServedCandidate(response, plan.primary.modelId)
        : this.getCandidate(plan.primary.providerId, plan.primary.modelId);
      if (!candidate) return;

      const reward = calculateReward(
        candidate.qualityScore,
        response?.latencyMs ?? 0,
        candidate.costPerInputToken || 0,
        success,
        response?.timeToFirstTokenMs != null
          ? { firstTokenLatencyMs: response.timeToFirstTokenMs }
          : {},
      );
      this.thompsonSampler.update(candidate, reward);

      // When the request SUCCEEDED via a fallback chain entry — the served
      // candidate is not plan.primary (providerId AND modelId differ) — the
      // primary FAILED and was rescued by a fallback. Record a failure (reward 0)
      // against the primary so its bandit arm cools down and stops being picked;
      // otherwise it stays hot, keeps getting chosen as primary, fails again,
      // and every request pays for its failure before falling back.
      if (success && response) {
        const primaryCandidate = this.getCandidate(
          plan.primary.providerId,
          plan.primary.modelId,
        );
        if (
          primaryCandidate &&
          (candidate.providerId !== plan.primary.providerId ||
            candidate.modelId !== plan.primary.modelId)
        ) {
          this.thompsonSampler.update(primaryCandidate, 0);
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to record Thompson sampler reward');
    }
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
    options?: ClassifyOptions & { requestId?: string }
  ): Promise<{ plan: RoutingPlan; response: UnifiedResponse }> {
    const opts = options ?? ({ path: (request as any).path ?? '' } as ClassifyOptions & { requestId?: string });
    // Check if decomposition is enabled and the prompt is complex enough
    const shouldDecompose = this.config.enableDecomposition !== false &&
      this.isComplexPrompt(request) &&
      this.compositeExecutor;

    if (shouldDecompose) {
      return this.routeComposite(request, opts);
    }

    return this.routeSimple(request, opts);
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
    const tenantId = (request as any).metadata?.tenant?.id;
    const messages = request.messages || [];

    // Step 0: Input guardrail checks — only when plugins are configured for this tenant
    if (messages.length > 0 && this.guardrailEngine.hasPlugins(tenantId)) {
      // Map messages inside the check to avoid allocation when no guardrails are active
      const guardrailMessages = messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));

      const guardrailResult = await tracer.startActiveSpan('guardrail.input', async (span) => {
        try {
          span.setAttribute('guardrail.direction', 'input');
          if (requestId) span.setAttribute('request.id', requestId);

          const result = await this.guardrailEngine.checkMessages(
            guardrailMessages,
            { requestId, tenantId },
          );

          span.setAttribute('guardrail.violations', result.violations.length);
          span.setAttribute('guardrail.allowed', result.allowed);

          return result;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          throw err;
        } finally {
          span.end();
        }
      });

      if (!guardrailResult.allowed) {
        const reasons = guardrailResult.violations
          .map(v => v.description)
          .filter(Boolean);
        throw new ValidationError(
          `Request blocked by guardrail: ${reasons.join('; ') || 'content policy violation'}`,
          { violations: guardrailResult.violations },
        );
      }
    }

    // Step 1: Check for sticky session
    const conversationHash = hashConversation(messages, request.model);
    const freeTierStrategy = (request as any).metadata?.freeTierStrategy || this.config.freeTierStrategy;
    const effectiveFreeTierStrategy = freeTierStrategy;

    // Parse an optional `providerName/modelId` prefix out of the requested
    // model. The prefix is only honored when it names a known provider —
    // model ids legitimately contain slashes (e.g. `qwen/qwen3-coder`), so an
    // unrecognised prefix is left intact as part of the model id.
    const modelTarget = this.parseModelTarget(request.model);

    // An explicit provider pin bypasses sticky sessions: the caller asked for
    // a specific provider, so a previously-stuck different provider must not win.
    //
    // A hard provider-exclusion constraint (zdr/only/ignore) must too: the
    // sticky pin was chosen (and health-checked) under whatever preferences —
    // or lack of them — were in effect on an earlier turn, so reusing it here
    // without re-checking those preferences could silently hand this turn to
    // a provider the caller just told this call to exclude (e.g. a
    // require_privacy turn reusing a cloud pin set by an earlier, unconstrained
    // turn of the same conversation). Soft preferences (order/latency/price
    // targets) are left alone — staying on the pinned provider is the whole
    // point of stickiness for those.
    const stickyPrefs = request.metadata?.providerPreferences;
    const hasHardProviderConstraint = !!(stickyPrefs?.zdr || stickyPrefs?.only?.length || stickyPrefs?.ignore?.length);

    // Reusable pipeline result from sticky handler — when the planner decides
    // SWITCH, it returns the pipeline result it already computed so the caller
    // can reuse it instead of running the pipeline a second time.
    let stickyPipelineResult: import('./pipeline/pipeline.js').PipelineOutput | undefined;
    let stickyTaskProfile: import('@dmr-x/core').TaskProfile | undefined;

    // Pre-compute estimated tokens once and pass to both the sticky handler
    // and the pipeline to avoid redundant message iteration
    const estimatedTokens = this.estimateTokens(request);

    if (conversationHash && !modelTarget.providerName && !hasHardProviderConstraint) {
      const stickyResult = await handleStickySession({
        request, options, candidates: this.candidates,
        adapterExecutor: this.adapterExecutor, config: this.config,
        thompsonSampler: this.thompsonSampler, router: this,
        conversationHash, modelTarget, estimatedTokens,
      });
      if (stickyResult.used) return stickyResult.result;
      // Reuse the pipeline result from the sticky handler's planner decision
      if (stickyResult.pipelineResult) {
        stickyPipelineResult = stickyResult.pipelineResult;
        stickyTaskProfile = stickyResult.taskProfile;
      }
    }

    // Step 1: Classify the task (router.classify span)
    const taskProfile = stickyTaskProfile ?? tracer.startActiveSpan('router.classify', (span) => {
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

    // Drop candidates already known to be dead before anything is scored. The
    // fallback chain has always skipped them, but selection did not, so the
    // primary pick kept landing on a provider whose key had just returned 401
    // and every request paid for that attempt before falling back. Keeping the
    // pool intact when the filter would empty it matters: a cooldown is a
    // recovery window, and a stale one must never turn into "no candidates".
    const liveCandidates = pipelineCandidates.filter(
      c => !isModelOnErrorCooldown(c.providerId, c.modelId),
    );
    if (liveCandidates.length > 0 && liveCandidates.length < pipelineCandidates.length) {
      logger.info(
        { skipped: pipelineCandidates.length - liveCandidates.length, remaining: liveCandidates.length },
        'Skipped candidates on error cooldown',
      );
      pipelineCandidates = liveCandidates;
    }

    // Step 1.6: Direct model selection — if the user picked a specific model, route to it
    // Step 2: provider-preference direct strategy.
    // Both branches are wrapped in the `router.select_candidates` span so
    // the trace shows "we picked a model" as one logical step regardless
    // of which branch was taken.
    const directSelection = tracer.startActiveSpan('router.select_candidates', (span) => {
      try {
        span.setAttribute('router.candidate_pool_size', pipelineCandidates.length);
        span.setAttribute('router.is_meta_model', modelTarget.modelId ? isMetaModel(modelTarget.modelId) : false);
        if (modelTarget.modelId && !isMetaModel(modelTarget.modelId)) {
          // pipelineCandidates is already scoped to the pinned provider (if any),
          // so this exact-match is naturally constrained to that provider.
          const directMatches = pipelineCandidates.filter(
            (c) => c.modelId === modelTarget.modelId && c.isHealthy
          );
          const directMatch = directMatches[0];
          if (directMatch) {
            span.setAttribute('router.selection', 'direct_model');
            span.setAttribute('router.selected_provider', directMatch.providerId);
            span.setAttribute('router.selected_model', directMatch.modelId);
            span.setAttribute('router.direct_alternates', directMatches.length - 1);
            logger.info(
              {
                model: modelTarget.modelId,
                provider: directMatch.providerName,
                alternates: directMatches.length - 1,
              },
              'Direct model selection',
            );
            return {
              providerId: directMatch.providerId,
              modelId: directMatch.modelId,
              adapterType: directMatch.providerName,
              score: 1,
              // Every OTHER provider serving this exact model id, so the
              // pinned-model path still has somewhere to fail over to. It
              // used to build `chain: []`, which meant naming a model
              // explicitly silently opted out of failover entirely: one
              // provider hiccup 502'd the request even when three other
              // providers served the same model.
              alternates: directMatches.slice(1).map((c) => ({
                providerId: c.providerId,
                modelId: c.modelId,
                adapterType: c.providerName,
                score: 0.9,
              })),
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
      const { alternates, ...primary } = directSelection as typeof directSelection & {
        alternates?: Array<{ providerId: string; modelId: string; adapterType: string; score: number }>;
      };
      const plan: RoutingPlan = {
        primary: { ...primary, score: 1 },
        // Same model id on other healthy providers. `trigger: 'error'` matches
        // how the pipeline path builds its chain, so executeWithFallback
        // treats these identically to a scored fallback.
        chain: (alternates ?? []).map((a) => ({
          provider: a,
          trigger: 'error' as const,
          waitMs: 0,
        })),
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

    // When the sticky handler already ran the pipeline for the planner's
    // STAY/SWITCH comparison, reuse its result. The only thing that may have
    // changed since then is the taskProfile (classifyTask output) — but the
    // sticky handler used the same options, so the profile is identical.
    // The candidates set may have been narrowed by meta-model resolution or
    // provider pinning below, but for the common case (no meta-model, no pin)
    // we can skip the entire pipeline run.
    const pipelineResult = stickyPipelineResult
      ? stickyPipelineResult
      : await tracer.startActiveSpan('router.score', async (span) => {
      try {
        span.setAttribute('router.candidate_pool_size', pipelineCandidates.length);
        span.setAttribute('router.quality_target', taskProfile.qualityTarget);
        let result;

        // Run the deterministic filters once — these are pure functions of
        // candidates + taskProfile, so they can be reused across retries
        // without re-running capability/availability/circuit-breaker filters.
        const preRateLimit = runDeterministicFilters(pipelineCandidates, taskProfile, providerPreferences);

        try {
          result = await runPipelineFromFiltered({
            preRateLimit,
            taskProfile,
            epsilon: this.config.epsilon ?? 0.05,
            rateLimitService: this.config.rateLimitService,
            quotaService: this.config.quotaService,
            policyService: this.config.policyService,
            tenantId,
            estimatedTokens,
            freeTierStrategy: effectiveFreeTierStrategy,
            providerPreferences,
            metaModelFilteredFree,
            thompsonSampler: this.thompsonSampler,
          });
        } catch (error) {
          const retryable = error instanceof ProviderUnavailableError || isRetryable5xx(error);
          if (retryable) {
            // (a) Transient rate-limit cooldown: brief wait then retry the same pool.
            if (error instanceof ProviderUnavailableError && error.retryAfter) {
              const waitMs = Math.min(error.retryAfter, 3000);
              logger.info({ waitMs }, 'All providers temporarily unavailable, retrying after wait');
              span.addEvent('router.retry_after_wait', { 'wait_ms': waitMs });
              await new Promise(resolve => setTimeout(resolve, waitMs));
              // Re-run only the rate-limit + scoring stages (skip deterministic filters)
              result = await runPipelineFromFiltered({
                preRateLimit,
                taskProfile,
                epsilon: this.config.epsilon ?? 0.05,
                rateLimitService: this.config.rateLimitService,
                quotaService: this.config.quotaService,
                policyService: this.config.policyService,
                tenantId,
                estimatedTokens,
                freeTierStrategy: effectiveFreeTierStrategy,
                providerPreferences,
                metaModelFilteredFree,
                thompsonSampler: this.thompsonSampler,
              });
            } else if (isMetaModel(modelTarget.modelId ?? '') && !metaModelFilteredFree) {
              // (b) Cross-pool degradation: a meta-model's preferred pool is empty
              // (every preferred provider is flapping / cooldowned / circuit-open),
              // OR an upstream 5xx (502/503) burst wiped out the preferred pool.
              // Retry once over the full healthy candidate set so a healthy
              // alternative with matching capabilities can still serve inference
              // instead of erroring. Free-only meta-models keep their contract
              // (no paid fallback). This is the DMR-X smooth-flow guarantee.
              logger.warn(
                { metaModel: modelTarget.modelId, totalCandidates: this.candidates.length, upstream5xx: isRetryable5xx(error) },
                'Meta-model preferred pool empty/unavailable; degrading to full candidate pool'
              );
              span.addEvent('router.cross_pool_fallback', { meta_model: modelTarget.modelId });
              // Cross-pool fallback needs a different candidate set, so re-run deterministic filters
              const fallbackPreRateLimit = runDeterministicFilters(this.candidates, taskProfile, providerPreferences);
              result = await runPipelineFromFiltered({
                preRateLimit: fallbackPreRateLimit,
                taskProfile,
                epsilon: this.config.epsilon ?? 0.05,
                rateLimitService: this.config.rateLimitService,
                quotaService: this.config.quotaService,
                policyService: this.config.policyService,
                tenantId,
                estimatedTokens,
                freeTierStrategy: effectiveFreeTierStrategy,
                providerPreferences,
                metaModelFilteredFree: false,
                thompsonSampler: this.thompsonSampler,
              });
            } else {
              // (c) Upstream 5xx on a direct model (or a free meta-model that must
              // stay within its pool): brief backoff then one retry over the same
              // candidate set. Bursts of 502s usually clear within the backoff
              // window as cooldowns/circuit-breakers reset.
              const waitMs = UPSTREAM_5XX_BACKOFF_MS;
              logger.warn({ waitMs, model: modelTarget.modelId }, 'Upstream 5xx; backing off then retrying same pool');
              span.addEvent('router.upstream_5xx_backoff', { 'wait_ms': waitMs });
              await new Promise(resolve => setTimeout(resolve, waitMs));
              // Re-run only the rate-limit + scoring stages (skip deterministic filters)
              result = await runPipelineFromFiltered({
                preRateLimit,
                taskProfile,
                epsilon: this.config.epsilon ?? 0.05,
                rateLimitService: this.config.rateLimitService,
                quotaService: this.config.quotaService,
                policyService: this.config.policyService,
                tenantId,
                estimatedTokens,
                freeTierStrategy: effectiveFreeTierStrategy,
                providerPreferences,
                metaModelFilteredFree,
                thompsonSampler: this.thompsonSampler,
              });
            }
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
        const res = await executeWithHedging(plan, request, this.adapterExecutor, {
          rateLimitService: this.config.rateLimitService,
          quotaService: this.config.quotaService,
          tenantId,
          requestId,
          onSuccess: this.config.onProviderSuccess,
          onFailure: this.config.onProviderFailure,
          keyRotationService,
        });
        span.setAttribute('router.used_provider', res.providerId);
        this.recordBanditReward(plan, res, true);
        return res;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        this.recordBanditReward(plan, null, false);
        throw err;
      } finally {
        span.end();
      }
    });

    // Step 5: Set sticky session for this conversation
    if (conversationHash) {
      // Pin the provider/model that ACTUALLY served the response, not the one
      // we planned to use. When the primary fails and `executeWithFallback`
      // recovers via a chain entry, the caller still gets a 200 — but pinning
      // `plan.primary` here would poison the sticky cache with the model that
      // just died. The next turn then takes the sticky fast path, which builds
      // a chain-less plan, re-calls the dead model, and 502s instantly.
      //
      // `response.providerId` is the adapter/provider NAME (e.g. "google"),
      // while candidates and plans are keyed by the DB provider UUID, so the
      // name has to be resolved back to a UUID — a raw name would be stored
      // fine but never match a candidate on the next turn, silently disabling
      // stickiness altogether. `resolveServedCandidate` does the same
      // resolution used to attribute the Thompson sampler reward above.
      const servedModelId = response.modelId || plan.primary.modelId;
      const servedCandidate = this.resolveServedCandidate(response, plan.primary.modelId);
      const servedProviderId = servedCandidate?.providerId ?? plan.primary.providerId;

      // Get RPM for TTL adjustment if rate limit service is available
      let rateLimitRpm: number | undefined;
      if (this.config.rateLimitService) {
        const check = this.config.rateLimitService.checkLimit(servedProviderId, servedModelId, 0);
        // Extract RPM from reason string if rate-limited, otherwise use a default
        if (!check.allowed && check.reason) {
          const rpmMatch = check.reason.match(/RPM limit \((\d+)\)/);
          if (rpmMatch) rateLimitRpm = parseInt(rpmMatch[1], 10);
        }
      }

      await setStickyProvider(
        conversationHash,
        servedProviderId,
        servedModelId,
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
          keyRotationService,
        });
        span.setAttribute('router.used_provider', res.providerId);

        // Step 0.5: Output guardrail checks
        const messageContent = res.message?.content;
        if (messageContent) {
          // Convert content to string if it's an array of content parts
          const contentStr = typeof messageContent === 'string'
            ? messageContent
            : JSON.stringify(messageContent);

          const outputGuardrailResult = await tracer.startActiveSpan('guardrail.output', async (outputSpan) => {
            try {
              outputSpan.setAttribute('guardrail.direction', 'output');
              if (requestId) outputSpan.setAttribute('request.id', requestId);

              const result = await this.guardrailEngine.checkOutput(
                contentStr,
                { requestId, tenantId, providerId: res.providerId, modelId: res.modelId },
              );

              outputSpan.setAttribute('guardrail.violations', result.violations.length);
              outputSpan.setAttribute('guardrail.allowed', result.allowed);

              return result;
            } catch (err) {
              outputSpan.recordException(err as Error);
              outputSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
              throw err;
            } finally {
              outputSpan.end();
            }
          });

          if (!outputGuardrailResult.allowed) {
            throw new ProviderUnavailableError(
              [`${res.providerId}/${res.modelId}`],
              0,
            );
          }

          // Apply masked content if provided
          if (outputGuardrailResult.flaggedContent && res.message) {
            res.message.content = outputGuardrailResult.flaggedContent;
          }
        }

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

    // Step 2.5: Fallback — composite decomposition can yield an EMPTY aggregated
    // response when every sub-task fails (e.g. large prompts overflow the
    // smaller context windows of the fanned-out specialist models). Rather than
    // return a blank completion (which breaks callers like Chimera), retry the
    // ORIGINAL request as a single non-decomposed pass against one capable
    // candidate. This mirrors the behavior of meta-models that route to a single
    // model (e.g. auto-agentic) and avoids the decomposition overflow entirely.
    const aggregatedContent =
      typeof result.aggregatedResponse?.message?.content === 'string'
        ? (result.aggregatedResponse.message.content as string)
        : '';
    const allSubTasksFailed =
      result.subTaskResults.size > 0 &&
      Array.from(result.subTaskResults.values()).every((r) => !r.success);
    const someSubTasksSucceeded =
      result.subTaskResults.size > 0 &&
      Array.from(result.subTaskResults.values()).some((r) => r.success);
    // Fallback triggers when:
    // 1. All sub-tasks failed AND content is empty (original condition), OR
    // 2. Some sub-tasks succeeded but content is still empty (models returned blanks)
    const shouldFallback = (!aggregatedContent || aggregatedContent.trim().length === 0) &&
      (allSubTasksFailed || (someSubTasksSucceeded && result.subTaskResults.size > 0));
    if (shouldFallback) {
      // When every sub-task failed (typically because the decomposed sub-tasks
      // overflow the smaller context windows of the fanned-out specialist
      // models on large prompts), retry the ORIGINAL request as a single
      // non-decomposed pass. Build one plan whose primary + chain span the
      // composite's own healthy candidates AND auto-agentic's candidates (which
      // we know route to a single large-context model that succeeds on large
      // prompts). Use cost filter 'all' for the agentic tier so we don't exclude
      // its working candidates just because the original request was restricted
      // to free models. A populated chain lets executeWithFallback survive a
      // single provider 429 instead of giving up after the primary.
      const fallbackCandidatePools: ProviderModel[][] = [compositeCandidates];
      const agenticResolution = resolveMetaModel('auto-agentic', this.candidates, 'all');
      if (agenticResolution && agenticResolution.resolved.length > 0) {
        fallbackCandidatePools.push(agenticResolution.resolved);
      }

      const healthy = fallbackCandidatePools
        .flat()
        .filter((c) => c.isHealthy);
      const ordered = healthy.length > 0 ? healthy : fallbackCandidatePools.flat();
      if (ordered.length === 0) {
        logger.warn(
          { metaModel: compositeModelTarget.modelId },
          'Composite aggregation empty — no fallback candidates available'
        );
      } else {
        const [primary, ...rest] = ordered;
        const singlePassPlan: RoutingPlan = {
          primary: {
            providerId: primary.providerId,
            modelId: primary.modelId,
            adapterType: 'openai',
            score: 1,
          },
          chain: rest.map((c) => ({
            provider: { providerId: c.providerId, modelId: c.modelId, adapterType: 'openai', score: 0.9 },
            trigger: 'error' as const,
            waitMs: 0,
          })),
          timeoutMs: decomposed.executionPlan.estimatedDurationMs,
          maxRetries: 1,
        };
        logger.warn(
          {
            metaModel: compositeModelTarget.modelId,
            subTaskCount: result.subTaskResults.size,
            fallbackProvider: primary.providerId,
            fallbackModel: primary.modelId,
            chainLength: singlePassPlan.chain.length,
          },
          'Composite aggregation empty (all sub-tasks failed) — retrying as single-pass'
        );
        try {
          const singlePassResponse = await executeWithFallback(
            singlePassPlan,
            request,
            this.adapterExecutor!
          );
          if (singlePassResponse?.message?.content) {
            return { plan: singlePassPlan, response: singlePassResponse };
          }
        } catch (fallbackErr) {
          logger.error(
            { err: fallbackErr, metaModel: compositeModelTarget.modelId },
            'Single-pass fallback after empty composite also failed'
          );
        }
      }
    }

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
  /**
   * Common model-id typo/alias corrections. Applied before provider-prefix
   * parsing so that malformed ids from the UI/cache never reach an upstream
   * that would 400 on them. Space-separated "provider model" forms
   * (e.g. "tencent hy3") are rewritten to the slash form ("tencent/hy3"),
   * and known-bad bare ids are mapped to their correct upstream equivalents.
   */
  private normalizeModelId(model: string): string {
    if (!model) return model;
    const trimmed = model.trim();
    if (trimmed === '' || trimmed === 'auto') return trimmed;

    // Known bare-id corrections (exact match, case-insensitive).
    const BARE_ALIASES: Record<string, string> = {
      'codestral': 'codestral-latest',
      'codestral-large': 'codestral-latest',
      'codestral-large-latest': 'codestral-latest',
    };
    const lower = trimmed.toLowerCase();
    if (BARE_ALIASES[lower]) return BARE_ALIASES[lower];

    // Space → slash normalization for "provider model" forms where neither
    // segment contains a slash already (e.g. "tencent hy3", "xiaomi-mimo mimo-v2.5").
    if (trimmed.includes(' ') && !trimmed.includes('/')) {
      const [maybeProvider, ...restParts] = trimmed.split(/\s+/);
      const modelPart = restParts.join(' ').trim();
      if (maybeProvider && modelPart) {
        // Only rewrite if the first segment looks like a known provider prefix.
        const candidate = `${maybeProvider}/${modelPart}`;
        if (this.candidates.some(c => c.providerName === maybeProvider)) {
          return candidate;
        }
      }
    }
    return trimmed;
  }

  private parseModelTarget(model: string | undefined): { providerName?: string; modelId: string } {
    if (!model) return { modelId: '' };
    const normalized = this.normalizeModelId(model);
    if (normalized !== model) {
      // Re-parse the corrected id through the normal path.
      const parsed = this.parseModelTarget(normalized);
      return parsed;
    }
    // If the model string exactly matches a known provider slug, treat it as a provider pin
    // (e.g. model="opencode-zen" → scope to all opencode-zen models).
    if (!normalized.includes('/') && this.candidates.some(c => c.providerName === normalized)) {
      return { providerName: normalized, modelId: '' };
    }
    const slash = normalized.indexOf('/');
    if (slash <= 0) return { modelId: normalized };
    const providerName = normalized.slice(0, slash);
    const rest = normalized.slice(slash + 1);
    if (rest && this.candidates.some(c => c.providerName === providerName)) {
      // Also normalize a space-separated id inside the provider-prefixed rest
      // (e.g. "gitlawb/tencent hy3" -> "gitlawb/tencent/hy3").
      const restNormalized = rest.includes(' ') && !rest.includes('/')
        ? rest.replace(/\s+/g, '/')
        : rest;
      return { providerName, modelId: restNormalized };
    }
    return { modelId: normalized };
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
