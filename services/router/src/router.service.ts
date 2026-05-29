import type { UnifiedRequest, RoutingPlan, UnifiedResponse, FreeTierStrategy, ProviderPreferences } from '@dmr-x/core';
import { ProviderUnavailableError } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import type { PolicyService } from '@dmr-x/policy';
import { classifyTask, type ClassifyOptions } from './classifier/task-classifier.js';
import { runPipeline } from './pipeline/pipeline.js';
import { executeWithFallback, type AdapterExecutor } from './fallback/fallback-executor.js';
import { hashConversation, getStickyProvider, setStickyProvider, breakStickySession } from './sticky/sticky-session.js';
import { TaskDecomposer } from './decomposer/task-decomposer.js';
import { SpecialistRouter } from './decomposer/specialist-router.js';
import { CompositeExecutor } from './decomposer/composite-executor.js';
import { isMetaModel, resolveMetaModel } from './meta-models.js';
import { ThompsonSampler } from './bandit/thompson-sampler.js';
import type { CandidateSet } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

export interface RouterConfig {
  epsilon?: number;
  defaultQualityTarget?: 'frontier' | 'balanced' | 'economy';
  enableDecomposition?: boolean; // Enable task decomposition for complex prompts
  decompositionThreshold?: number; // Min prompt length to trigger decomposition
  rateLimitService?: RateLimitService;
  quotaService?: QuotaService;
  policyService?: PolicyService;
  freeTierStrategy?: FreeTierStrategy;
}

export class Router {
  private candidates: CandidateSet = [];
  private adapterExecutor: AdapterExecutor | null = null;
  private taskDecomposer: TaskDecomposer;
  private specialistRouter: SpecialistRouter;
  private compositeExecutor: CompositeExecutor | null = null;
  private thompsonSampler: ThompsonSampler;

  constructor(private readonly config: RouterConfig = {}) {
    this.taskDecomposer = new TaskDecomposer();
    this.specialistRouter = new SpecialistRouter();
    this.thompsonSampler = new ThompsonSampler();
  }

  setCandidates(candidates: CandidateSet): void {
    this.candidates = candidates;
  }

  setAdapterExecutor(executor: AdapterExecutor): void {
    this.adapterExecutor = executor;
    this.compositeExecutor = new CompositeExecutor(this.specialistRouter, executor);
  }

  /**
   * Route a request - handles both simple and composite tasks
   */
  async route(
    request: UnifiedRequest,
    options: ClassifyOptions
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
    options: ClassifyOptions
  ): Promise<{ plan: RoutingPlan; response: UnifiedResponse }> {
    // Step 0: Check for sticky session
    const messages = request.messages || [];
    const conversationHash = hashConversation(messages);
    const freeTierStrategy = (request as any).metadata?.freeTierStrategy || this.config.freeTierStrategy;

    if (conversationHash) {
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

              try {
                const response = await executeWithFallback(plan, request, this.adapterExecutor, {
                  rateLimitService: this.config.rateLimitService,
                  quotaService: this.config.quotaService,
                  tenantId: (request as any).metadata?.tenant?.id,
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

            const response = await executeWithFallback(plan, request, this.adapterExecutor, {
              rateLimitService: this.config.rateLimitService,
              quotaService: this.config.quotaService,
              tenantId: (request as any).metadata?.tenant?.id,
            });

            return { plan, response };
          }
        }
      }
    }

    // Step 1: Classify the task
    const taskProfile = classifyTask(request, options);
    logger.debug({ taskProfile }, 'Task classified');

    // Step 1.5: Resolve meta-model aliases to filtered candidates
    let pipelineCandidates = this.candidates;
    let metaModelFilteredFree = false;
    if (request.model && isMetaModel(request.model)) {
      const resolution = resolveMetaModel(request.model, this.candidates);
      if (resolution) {
        logger.info({ metaModel: request.model, candidateCount: resolution.resolved.length }, 'Resolved meta-model');
        pipelineCandidates = resolution.resolved;
        // Flag when meta-model already filtered to free-only (skip redundant pipeline filtering)
        if (request.model === 'free' || request.model.startsWith('free-')) {
          metaModelFilteredFree = true;
        }
      }
    }

    // Step 2: Run the routing pipeline
    const tenantId = (request as any).metadata?.tenant?.id;
    const providerPreferences: ProviderPreferences | undefined = request.metadata?.providerPreferences;

    // If strategy is 'direct' and an order list exists, force the first provider
    if (providerPreferences?.strategy === 'direct' && providerPreferences.order?.length) {
      const directCandidate = pipelineCandidates.find(
        (c) => c.providerId === providerPreferences.order![0] && c.isHealthy
      );
      if (directCandidate) {
        const plan: RoutingPlan = {
          primary: { providerId: directCandidate.providerId, modelId: directCandidate.modelId, adapterType: directCandidate.providerName, score: 1 },
          chain: [],
          timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
          maxRetries: 0,
        };
        if (!this.adapterExecutor) throw new Error('No adapter executor configured');
        const response = await executeWithFallback(plan, request, this.adapterExecutor, { rateLimitService: this.config.rateLimitService, quotaService: this.config.quotaService, tenantId });
        return { plan, response };
      }
    }

    // Step 3: Execute with fallback
    if (!this.adapterExecutor) {
      throw new Error('No adapter executor configured');
    }

    let pipelineResult;
    try {
      pipelineResult = await runPipeline({
        taskProfile,
        candidates: pipelineCandidates,
        epsilon: this.config.epsilon ?? 0.05,
        rateLimitService: this.config.rateLimitService,
        quotaService: this.config.quotaService,
        policyService: this.config.policyService,
        tenantId,
        estimatedTokens: this.estimateTokens(request),
        freeTierStrategy,
        providerPreferences,
        metaModelFilteredFree,
        thompsonSampler: this.thompsonSampler,
      });
    } catch (error) {
      if (error instanceof ProviderUnavailableError && error.retryAfter) {
        const waitMs = Math.min(error.retryAfter, 3000);
        logger.info({ waitMs }, 'All providers temporarily unavailable, retrying after wait');
        await new Promise(resolve => setTimeout(resolve, waitMs));
        pipelineResult = await runPipeline({
          taskProfile,
          candidates: pipelineCandidates,
          epsilon: this.config.epsilon ?? 0.05,
          rateLimitService: this.config.rateLimitService,
          quotaService: this.config.quotaService,
          policyService: this.config.policyService,
          tenantId,
          estimatedTokens: this.estimateTokens(request),
          freeTierStrategy,
          providerPreferences,
          metaModelFilteredFree,
          thompsonSampler: this.thompsonSampler,
        });
      } else {
        throw error;
      }
    }

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

    // Step 3: Execute with fallback
    if (!this.adapterExecutor) {
      throw new Error('No adapter executor configured');
    }

    const response = await executeWithFallback(plan, request, this.adapterExecutor, {
      rateLimitService: this.config.rateLimitService,
      quotaService: this.config.quotaService,
      tenantId,
    });

    // Step 4: Set sticky session for this conversation
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

    // Step 1.5: Resolve meta-model aliases
    let compositeCandidates = this.candidates;
    if (request.model && isMetaModel(request.model)) {
      const resolution = resolveMetaModel(request.model, this.candidates);
      if (resolution) {
        logger.info({ metaModel: request.model, candidateCount: resolution.resolved.length }, 'Resolved meta-model for composite');
        compositeCandidates = resolution.resolved;
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

    // Check for multiple task indicators
    const taskIndicators = [
      'frontend', 'backend', 'database', 'api', 'ui', 'server',
      'test', 'deploy', 'docker', 'component', 'schema',
      'react', 'vue', 'node', 'python', 'sql',
    ];

    const lowerPrompt = prompt.toLowerCase();
    const matchCount = taskIndicators.filter((ind) => lowerPrompt.includes(ind)).length;

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
   * Estimate token count for rate-limit checking.
   * Uses ~4 chars/token heuristic (same as FreeLLMAPI).
   */
  private estimateTokens(request: UnifiedRequest): number {
    const prompt = this.extractPrompt(request);
    const maxTokens = request.max_tokens || 4096;
    return Math.ceil(prompt.length / 4) + maxTokens;
  }
}
