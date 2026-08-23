import type { UnifiedRequest, RoutingPlan, UnifiedResponse, CandidateSet, FallbackStep } from '@dmr-x/core';
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

/**
 * Build the sticky plan's fallback chain.
 *
 * The chain used to be empty (`chain: []`), which made any transient failure
 * on the pinned model a hard fail-to-client even though hundreds of healthy
 * candidates were available. The pin stays PRIMARY; this chain only catches
 * its transients. Ordering encodes same-model affinity:
 *
 *   1. The SAME `modelId` on OTHER providers (and other candidates on the
 *      pinned provider, i.e. fresh keys of the same pool) — a failure that is
 *      provider-specific should not change the conversation's brain.
 *   2. Then the best model per DISTINCT other provider (mirroring
 *      `buildFallbackChain`'s diversity rule), so one bad upstream cannot
 *      burn the whole chain.
 *
 * Only when every same-model route AND every diverse alternate fails does the
 * conversation switch models — and even then the caller re-pins whatever
 * actually served the response.
 */
function buildStickyFallbackChain(
  stickyProviderId: string,
  stickyModelId: string,
  candidates: CandidateSet,
): FallbackStep[] {
  const healthy = candidates.filter(
    (c) => c.isHealthy &&
      !(c.providerId === stickyProviderId && c.modelId === stickyModelId),
  );

  // Same model, different provider — preserves the conversation's brain.
  const sameModel = healthy.filter((c) => c.modelId === stickyModelId);

  // Different model on the pinned provider — fresh keys / capacity of the
  // same pool before going cross-provider.
  const sameProviderOtherModel = healthy.filter(
    (c) => c.providerId === stickyProviderId && c.modelId !== stickyModelId,
  );

  // Best model per distinct OTHER provider — survives a pinned-provider-wide
  // outage instead of burning all slots on one upstream.
  const seenProviders = new Set<string>([stickyProviderId]);
  const diverse: typeof sameModel = [];
  for (const model of healthy) {
    if (model.modelId === stickyModelId) continue; // already in sameModel
    if (seenProviders.has(model.providerId)) continue;
    seenProviders.add(model.providerId);
    diverse.push(model);
  }

  const ordered = [...sameModel, ...sameProviderOtherModel.slice(0, 2), ...diverse];

  return ordered.slice(0, 8).map((model, index) => ({
    provider: {
      providerId: model.providerId,
      modelId: model.modelId,
      adapterType: model.providerName,
      score: model.qualityScore,
    },
    trigger: index === 0 ? ('timeout' as const) : ('error' as const),
    waitMs: index === 0 ? 1000 : 0,
  }));
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
    logger.warn(
      { providerId: sticky.providerId, modelId: sticky.modelId },
      'Sticky session broken — pinned model is on error cooldown'
    );
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

    // Planner-aware sticky session decision — but only when the pin looks
    // SUSPECT. The planner comparison runs classify + the full scoring
    // pipeline on EVERY stuck turn, roughly doubling per-request work just to
    // confirm what the fast path already knows. A healthy pin (no recent 429
    // penalties) has already survived the health/rate-limit/cooldown checks
    // above, so skip the comparison and serve from the pin directly; its
    // fallback chain (built below) catches transients. Any penalty point —
    // meaning the pinned model 429'd recently — marks the pin suspect and the
    // comparison runs once. Penalty decay (-1 point / 2min) flips the pin back
    // to clean automatically, so the planner still gets periodic say after
    // any rough patch rather than never.
    const pinPenaltyPoints = config.rateLimitService.getPenaltyPoints(sticky.providerId, sticky.modelId);
    const pinIsSuspect = pinPenaltyPoints > 0;

    if (enablePlanner && pinIsSuspect) {
      logger.debug(
        { providerId: sticky.providerId, modelId: sticky.modelId, pinPenaltyPoints },
        'Sticky pin is suspect — running planner STAY/SWITCH comparison'
      );
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

    // If we're still in sticky mode (planner said STAY, planner skipped
    // because the pin was clean, or planner disabled)
    if (!enablePlanner || !pinIsSuspect || (await getStickyProvider(conversationHash, config.rateLimitService, freeTierStrategy, () => false))) {
      // Re-verify the pin is not on an error cooldown before the fast path
      // re-calls a dead model: the planner's pipeline run above can be slow
      // enough that the pinned model enters cooldown between the first check
      // and this point, and getStickyProvider only checks rate limits, not
      // the error cooldown.
      if (isModelOnErrorCooldown(sticky.providerId, sticky.modelId)) {
        logger.warn(
          { providerId: sticky.providerId, modelId: sticky.modelId },
          'Sticky session broken — pinned model is on error cooldown'
        );
        await breakStickySession(conversationHash, 'Pinned model is on error cooldown');
        return { used: false };
      }

      logger.info(
        { providerId: sticky.providerId, modelId: sticky.modelId },
        'Using sticky session'
      );

      if (!adapterExecutor) {
        throw new Error('No adapter executor configured');
      }

      const plan: RoutingPlan = {
        primary: { providerId: sticky.providerId, modelId: sticky.modelId, adapterType: 'sticky', score: 1 },
        // The pin stays primary; this chain only catches its transient
        // failures (same-model-first affinity — see the builder above).
        chain: buildStickyFallbackChain(sticky.providerId, sticky.modelId, candidates),
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
        // routing. With the fallback chain attached this now only happens when
        // the pin AND every same-model/diverse alternate failed together.
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
      // Same-model-first fallback chain (mirrors the rate-limit branch above).
      chain: buildStickyFallbackChain(sticky.providerId, sticky.modelId, candidates),
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
