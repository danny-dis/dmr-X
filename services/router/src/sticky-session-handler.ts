import type { UnifiedRequest, RoutingPlan, UnifiedResponse, CandidateSet } from '@dmr-x/core';
import { keyRotationService } from '@dmr-x/quota';
import { logger } from '@dmr-x/utils';
import { trace } from '@opentelemetry/api';

import { getStickyProvider, breakStickySession } from './sticky/sticky-session.js';
import { executeWithFallback, isModelOnErrorCooldown, type AdapterExecutor } from './fallback/fallback-executor.js';
import { runPipeline, type PipelineOutput } from './pipeline/pipeline.js';
import { classifyTask, type ClassifyOptions } from './classifier/task-classifier.js';
import type { TaskProfile } from '@dmr-x/core';
import { planStayOrSwitch } from './planner/ev-planner.js';
import type { ThompsonSampler } from './bandit/thompson-sampler.js';
import type { RouterConfig, Router } from './router.service.js';

export interface StickySessionHandlerParams {
  request: UnifiedRequest;
  options: ClassifyOptions & { requestId?: string };
  candidates: CandidateSet;
  adapterExecutor: AdapterExecutor | null;
  config: RouterConfig;
  thompsonSampler: ThompsonSampler;
  router: Router;
  conversationHash: string | undefined;
  modelTarget: { providerName?: string; modelId: string };
  /** Pre-computed estimated tokens for the request (avoids re-computing in the handler) */
  estimatedTokens?: number;
}

/**
 * Result returned by the sticky session handler.
 *
 * - `used: true` → the handler executed the request using the sticky pin.
 * - `used: false` with `pipelineResult` → the handler ran the pipeline for the
 *   planner's STAY/SWITCH comparison and decided to SWITCH. The caller can
 *   reuse this result instead of running the pipeline a second time (which
 *   would repeat the same classify → filter → score → select work).
 * - `used: false` without `pipelineResult` → no sticky pin existed or it was
 *   broken before any pipeline ran; the caller runs the pipeline normally.
 */
export type StickySessionHandlerResult =
  | { used: true; result: { plan: RoutingPlan; response: UnifiedResponse } }
  | { used: false; pipelineResult?: PipelineOutput; taskProfile?: TaskProfile };

function extractPrompt(request: UnifiedRequest): string {
  if (request.messages) {
    return request.messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
  }
  return request.prompt || '';
}

export async function handleStickySession(
  params: StickySessionHandlerParams
): Promise<StickySessionHandlerResult> {
  const { request, options, candidates, adapterExecutor, config, thompsonSampler, router, conversationHash, modelTarget, estimatedTokens: providedTokens } = params;

  if (!conversationHash) return { used: false };

  const freeTierStrategy = (request as any).metadata?.freeTierStrategy || config.freeTierStrategy;
  const effectiveFreeTierStrategy = freeTierStrategy;
  const requestId = options.requestId || (request as any).metadata?.requestId;
  const tenantId = (request as any).metadata?.tenant?.id;
  const enablePlanner = config.enablePlanner !== false;
  // Use provided token estimate or fall back to computing it
  const estimatedTokens = providedTokens ?? (() => {
    const prompt = extractPrompt(request);
    const maxTokens = request.max_tokens || 4096;
    return Math.ceil(prompt.length / 4) + maxTokens;
  })();

  const sticky = await getStickyProvider(
    conversationHash,
    config.rateLimitService,
    freeTierStrategy,
    (providerId, modelId) => {
      const candidate = candidates.find(c => c.providerId === providerId && c.modelId === modelId);
      if (!candidate) return false;
      if (candidate.pricingTier) {
        return candidate.pricingTier === 'free' || candidate.pricingTier === 'free_with_limits';
      }
      return candidate.costPerInputToken === 0 && candidate.costPerOutputToken === 0;
    }
  );

  if (!sticky) return { used: false };

  // A pinned model that is on an error cooldown (404/410, bad auth, overload)
  // must not be re-called: the sticky plan carries no fallback chain, so the
  // request would hard-fail with 502 instead of being routed normally.
  if (isModelOnErrorCooldown(sticky.providerId, sticky.modelId)) {
    await breakStickySession(conversationHash, 'Pinned model is on error cooldown');
    return { used: false };
  }

  // Check if sticky provider is still in candidates and healthy
  const stickyCandidate = candidates.find(
    (c) => c.providerId === sticky.providerId && c.modelId === sticky.modelId && c.isHealthy
  );

  if (!stickyCandidate) return { used: false };

  // Check rate limits before using sticky provider
  if (config.rateLimitService) {
    const check = config.rateLimitService.checkLimit(sticky.providerId, sticky.modelId, estimatedTokens);
    if (!check.allowed) {
      // Break sticky session and fall through to normal routing
      await breakStickySession(conversationHash, `Rate limited: ${check.reason}`);
      return { used: false };
    }

    // Planner-aware sticky session decision
    if (enablePlanner) {
      // Run the routing pipeline to get a fresh decision for comparison.
      // This result is also returned to the caller so it can be reused
      // (avoiding a redundant pipeline run) when the planner decides SWITCH.
      const taskProfile = classifyTask(request, options);
      const pipelineResult = await runPipeline({
        taskProfile,
        candidates,
        epsilon: config.epsilon ?? 0.05,
        rateLimitService: config.rateLimitService,
        quotaService: config.quotaService,
        policyService: config.policyService,
        tenantId,
        estimatedTokens,
        freeTierStrategy: effectiveFreeTierStrategy,
        thompsonSampler,
      });

      // Get the fresh decision's cost info
      const freshCandidate = candidates.find(
        c => c.providerId === pipelineResult.selected.providerId && c.modelId === pipelineResult.selected.modelId
      );

      if (freshCandidate) {
        const plannerResult = planStayOrSwitch({
          pinnedModel: {
            id: sticky.modelId,
            providerId: sticky.providerId,
            tier: { level: 'mid', quality: stickyCandidate.qualityScore || 0.5, costPer1K: (stickyCandidate.costPerInputToken || 0) + (stickyCandidate.costPerOutputToken || 0) },
            costPer1K: (stickyCandidate.costPerInputToken || 0) + (stickyCandidate.costPerOutputToken || 0),
            cacheWarm: true,
          },
          freshDecision: {
            id: pipelineResult.selected.modelId,
            providerId: pipelineResult.selected.providerId,
            tier: { level: 'mid', quality: freshCandidate.qualityScore || 0.5, costPer1K: (freshCandidate.costPerInputToken || 0) + (freshCandidate.costPerOutputToken || 0) },
            costPer1K: (freshCandidate.costPerInputToken || 0) + (freshCandidate.costPerOutputToken || 0),
          },
          estimatedTokens,
          remainingTurns: 5, // Estimate remaining turns
          summarizationAvailable: !!config.summarizationExecutor,
          summarizationCost: 0, // Will be computed if summarization is triggered
        });

        logger.info(
          {
            decision: plannerResult.decision,
            reason: plannerResult.reason,
            pinnedModel: sticky.modelId,
            freshModel: pipelineResult.selected.modelId,
          },
          'Planner decision'
        );

        // If planner says SWITCH, break sticky and return the pipeline result
        // so the caller can reuse it instead of running the pipeline again.
        if (plannerResult.decision === 'SWITCH') {
          await breakStickySession(conversationHash, `Planner: ${plannerResult.reason}`);
          return { used: false, pipelineResult, taskProfile };
        }
      }
    }

    // If we're still in sticky mode (planner said STAY or planner disabled)
    if (!enablePlanner || (await getStickyProvider(conversationHash, config.rateLimitService, freeTierStrategy, () => false))) {
      logger.info(
        { providerId: sticky.providerId, modelId: sticky.modelId },
        'Using sticky session'
      );

      if (!adapterExecutor) {
        throw new Error('No adapter executor configured');
      }

      const plan: RoutingPlan = {
        primary: { providerId: sticky.providerId, modelId: sticky.modelId, adapterType: 'sticky', score: 1 },
        chain: [],
        timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
        maxRetries: 1,
      };

      if (options.planOnly) {
        return { used: true, result: { plan, response: { modelId: plan.primary.modelId, providerId: plan.primary.providerId, modality: request.modality || 'llm', requestId: '', latencyMs: 0 } } };
      }

      try {
        const response = await executeWithFallback(plan, request, adapterExecutor, {
          rateLimitService: config.rateLimitService,
          quotaService: config.quotaService,
          tenantId,
          requestId,
          onSuccess: config.onProviderSuccess,
          onFailure: config.onProviderFailure,
          keyRotationService,
        });
        return { used: true, result: { plan, response } };
      } catch (error) {
        // Break sticky session on provider failure and fall through to normal
        // routing. The pin is an optimisation, not a contract — the plan built
        // here has no fallback chain, so rethrowing turned one dead pinned
        // model into a hard 502 even though the full candidate pool was
        // healthy. Every other exit from this function degrades the same way.
        await breakStickySession(conversationHash, `Provider failed: ${error instanceof Error ? error.message : 'unknown'}`);
        return { used: false };
      }
    }
  } else {
    logger.info(
      { providerId: sticky.providerId, modelId: sticky.modelId },
      'Using sticky session'
    );

    if (!adapterExecutor) {
      throw new Error('No adapter executor configured');
    }

    const plan: RoutingPlan = {
      primary: { providerId: sticky.providerId, modelId: sticky.modelId, adapterType: 'sticky', score: 1 },
      chain: [],
      timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
      maxRetries: 1,
    };

    if (options.planOnly) {
      return { used: true, result: { plan, response: { modelId: plan.primary.modelId, providerId: plan.primary.providerId, modality: request.modality || 'llm', requestId: '', latencyMs: 0 } } };
    }

    try {
      const response = await executeWithFallback(plan, request, adapterExecutor, {
        rateLimitService: config.rateLimitService,
        quotaService: config.quotaService,
        tenantId,
        requestId,
        onSuccess: config.onProviderSuccess,
        onFailure: config.onProviderFailure,
        keyRotationService,
      });
      return { used: true, result: { plan, response } };
    } catch (error) {
      // Break sticky session on provider failure and fall through to normal
      // routing (see the rationale on the equivalent branch above).
      await breakStickySession(conversationHash, `Provider failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return { used: false };
    }
  }

  return { used: false };
}
