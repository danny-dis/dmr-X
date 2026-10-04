import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  agentRegistryService,
  isSystemAgentName,
} from '@dmr-x/agent-registry';
import { agentRuntimeService } from '@dmr-x/agent-runtime';
import { createInitialState, generateRequestId, logger } from '@dmr-x/utils';
import { getRegisteredToolDefinitions, normalizeAllowedTools } from './tools.routes.js';
import type { Router } from '@dmr-x/router';
import { resolveMetaModel } from '@dmr-x/router';
import { billingService } from '@dmr-x/billing';
import { runAgentChatLoop } from './agent-chat-loop.js';
import {
  resolveAgentModel,
  clampAgentTokens,
  estimateAgentRunTokens,
  aliasFreeEvidence,
  resolveAgentToolCatalog,
  buildDispatchLoopInput,
  preflightModelRun,
  releaseAgentHold,
  settleAgentRun,
} from '../lib/agent-admission.js';

// ---------------------------------------------------------------------------
// Meta-agent dispatcher
//
// Lets an EXTERNAL agent address a DMR-X subagent by INTENT rather than by its
// UUID. Given a task (and optional category/tags), it scores all active
// subagent instances for the caller's tenant and picks the best match. With
// `run: true` it forwards the task straight to the chosen subagent in one shot.
// ---------------------------------------------------------------------------

const DispatchRequestSchema = z.object({
  task: z.string().min(1).max(20000),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).optional(),
  stream: z.boolean().optional().default(false),
  run: z.boolean().optional().default(false),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    )
    .optional(),
  maxTokens: z.number().min(1).max(1000000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  model: z.string().max(256).optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export type DispatchCandidate = {
  instance?: any;
  definition?: any;
  score: number;
  categoryMatch: boolean;
  matchingTagCount: number;
};

/**
 * Compare two dispatch candidates to deterministically pick the best one.
 * Order: 1) higher score, 2) category match, 3) more matching tags,
 * 4) most recent activity, 5) lower load, 6) stable (first occurrence).
 * Returns a negative number if `a` should be preferred over `b`.
 */
export function compareCandidates(a: DispatchCandidate, b: DispatchCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  const aCat = a.categoryMatch ? 1 : 0;
  const bCat = b.categoryMatch ? 1 : 0;
  if (aCat !== bCat) return bCat - aCat;
  if (a.matchingTagCount !== b.matchingTagCount) return b.matchingTagCount - a.matchingTagCount;
  const aAct = Number(a.instance?.lastActivityAt ?? a.instance?.updatedAt ?? 0);
  const bAct = Number(b.instance?.lastActivityAt ?? b.instance?.updatedAt ?? 0);
  if (aAct !== bAct) return bAct - aAct;
  const aLoad = Number(a.instance?.load ?? a.instance?.currentLoad ?? Number.POSITIVE_INFINITY);
  const bLoad = Number(b.instance?.load ?? b.instance?.currentLoad ?? Number.POSITIVE_INFINITY);
  if (aLoad !== bLoad) return aLoad - bLoad;
  return 0; // stable: keep the first occurrence
}

// Small, English-only stopword list for the keyword prefilter below. This is
// not an NLP pipeline — just enough to keep short function words from adding
// uniform noise to every candidate's score.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'has', 'can', 'are', 'not', 'all', 'any', 'use',
  'with', 'that', 'this', 'from', 'was', 'were', 'been', 'have', 'had',
  'but', 'out', 'get', 'how', 'who', 'why', 'what', 'when', 'where',
  'which', 'they', 'them', 'then', 'than', 'into', 'about', 'also',
  'just', 'more', 'most', 'some', 'such', 'only', 'own', 'same', 'too',
  'very', 'will', 'would', 'could', 'should', 'via',
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

const CATEGORY_WEIGHT = 3;
const TAG_WEIGHT = 2;
// Keyword contribution is normalized to the fraction of distinct task
// keywords matched (0..1) so a verbose description can't outrank a precise
// one purely by having more text to match against. Weighted at 3 so a full
// keyword match stays roughly comparable to a category match (also 3)
// instead of being swamped by it.
const KEYWORD_WEIGHT = 3;

/**
 * Score an agent definition against a task + hints.
 * category match +CATEGORY_WEIGHT, each tag overlap +TAG_WEIGHT, plus
 * (distinct matched task keywords / distinct task keywords) * KEYWORD_WEIGHT.
 */
export function scoreDefinition(
  def: { name: string; description?: string | null; category?: string | null; tags?: string[] | null },
  task: string,
  category?: string,
  tags?: string[],
): number {
  let score = 0;
  const tagSet = new Set((def.tags ?? []).map((t) => t.toLowerCase()));

  if (category && def.category && def.category.toLowerCase() === category.toLowerCase()) {
    score += CATEGORY_WEIGHT;
  }
  if (tags && tags.length > 0) {
    for (const t of tags) {
      if (tagSet.has(t.toLowerCase())) score += TAG_WEIGHT;
    }
  }

  // Whole-word matching (not substring) so e.g. "api" doesn't match inside
  // "rapid" and "cat" doesn't match inside "concatenate". Keywords are
  // de-duplicated so repeating a word in the task can't inflate the score.
  const haystackTokens = new Set(tokenize(`${def.name} ${def.description ?? ''}`));
  const keywords = Array.from(
    new Set(tokenize(task).filter((k) => k.length > 2 && !STOPWORDS.has(k))),
  );
  if (keywords.length > 0) {
    const matched = keywords.filter((kw) => haystackTokens.has(kw)).length;
    score += (matched / keywords.length) * KEYWORD_WEIGHT;
  }
  return score;
}

export async function agentDispatchRoutes(server: FastifyInstance): Promise<void> {
  server.post('/agentic/dispatch', async (request, reply) => {
    const parsed = DispatchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }
    const body = parsed.data;
    const tenant = (request as any).tenant;
    if (!tenant?.id) {
      return reply.code(401).send({ error: { message: 'Authentication required' } });
    }

    // Gather all active subagent instances for this tenant. Filtering on
    // status in SQL also means a paused instance is never a dispatch target.
    let active: any[];
    try {
      const result = await agentRegistryService.listInstances(tenant.id, { status: 'active', accessScope: 'shared' });
      active = result.items;
    } catch (err) {
      logger.error({ err }, 'agent-dispatch: failed to list instances');
      return reply.code(500).send({ error: { message: 'Failed to list subagents' } });
    }

    if (active.length === 0) {
      return reply.code(404).send({
        error: { message: 'No active subagents found for tenant' },
      });
    }

    // Score each instance by its definition.
    const categories = new Set<string>();
    const allTags = new Set<string>();
    type Candidate = {
      instance: any;
      definition: any;
      score: number;
      categoryMatch: boolean;
      matchingTagCount: number;
    };
    const candidates: Candidate[] = [];
    // Fetch all definitions concurrently instead of one round-trip per
    // instance. `active` order is preserved so candidate ordering (and the
    // stable first-occurrence tie-break in compareCandidates) is unaffected.
    const definitions = await Promise.all(
      active.map((instance) => agentRegistryService.getDefinition(instance.agentDefinitionId)),
    );
    for (let i = 0; i < active.length; i++) {
      const instance = active[i];
      const def = definitions[i];
      if (!def) continue;
      // System-owned agents (`__`-prefixed, e.g. the Receptionist) are platform
      // plumbing: they coordinate work, they are never dispatch targets. Their
      // generic descriptions would otherwise out-score real specialists.
      if (isSystemAgentName(def.name)) continue;
      if (def.category) categories.add(def.category);
      (def.tags ?? []).forEach((t: string) => allTags.add(t));
      const score = scoreDefinition(def, body.task, body.category, body.tags);
      const tagSet = new Set((def.tags ?? []).map((t: string) => t.toLowerCase()));
      const matchingTagCount = body.tags
        ? body.tags.filter((t) => tagSet.has(t.toLowerCase())).length
        : 0;
      const categoryMatch = !!(
        body.category &&
        def.category &&
        def.category.toLowerCase() === body.category.toLowerCase()
      );
      candidates.push({ instance, definition: def, score, categoryMatch, matchingTagCount });
    }

    // Pick the best candidate. On equal top scores, resolve ties deterministically:
    // 1) category match, 2) more matching tags, 3) most recent activity /
    // lowest load if available, else stable (first occurrence wins).
    const rankCandidate = (a: Candidate, b: Candidate): number =>
      compareCandidates(a, b);

    let best: Candidate | null = null;
    for (const c of candidates) {
      if (best === null || rankCandidate(c, best) < 0) best = c;
    }

    if (!best) {
      return reply.code(404).send({
        error: {
          message: 'No matching subagent found',
          availableCategories: [...categories],
          availableTags: [...allTags],
        },
      });
    }

    // A best candidate always exists now (active.length > 0 guards above).
    // If its top score is 0 we still return it but flag low confidence instead
    // of hard-failing — only the truly-empty case (handled above) is a 404.
    const lowConfidence = best.score === 0;

    const { instance, definition } = best;

    // run:false (default) → just return the match + how to call it.
    if (!body.run) {
      return reply.send({
        matched: true,
        confidence: lowConfidence ? 'low' : 'high',
        instanceId: instance.id,
        name: definition.name,
        category: definition.category,
        tags: definition.tags,
        description: definition.description,
        suggestedUrl: `/v1/agents/${instance.id}/chat`,
        ...(lowConfidence
          ? {
              note: 'No strong match found; returning the closest active subagent. Consider refining the task, category, or tags.',
              availableCategories: [...categories],
              availableTags: [...allTags],
            }
          : {}),
      });
    }

    // run:true → resolve the instance/context and run the SHARED agent turn
    // engine (runAgentChatLoop) instead of a route-local reimplementation, so
    // chat and dispatch share identical tool-call transcript, error, budget
    // and response behavior.
    const router = (server as any).router as Router;
    const modelDecision = resolveAgentModel(body.model, definition, () =>
      agentRuntimeService.resolveModel(definition),
    );
    if (modelDecision.error) {
      return reply.code(modelDecision.status ?? 403).send({ error: { message: modelDecision.error } });
    }
    const model = modelDecision.model;
    const systemPrompt = await agentRuntimeService.buildSystemPrompt(definition, 0, [], tenant.id);
    const reqId = generateRequestId();

    const requestedTools = normalizeAllowedTools(definition.allowedTools);
    const catalog = resolveAgentToolCatalog(requestedTools, (names) =>
      names && names.length > 0 ? getRegisteredToolDefinitions(names) : getRegisteredToolDefinitions(),
    );
    if (catalog.requiredMissing.length > 0) {
      return reply.code(400).send({
        error: {
          message: `Agent requires tools that are not registered: ${catalog.requiredMissing.join(', ')}`,
          missing: catalog.missing,
          requiredMissing: catalog.requiredMissing,
          resolved: catalog.resolved,
          instanceId: instance.id,
        },
      });
    }

    const dispatchInput = buildDispatchLoopInput({
      task: body.task,
      messages: body.messages,
      systemPrompt,
      agentToolDefs: catalog.defs as any,
    });

    // Same preflight admission as the chat path: an ATOMIC whole-run hold
    // (dispatch turn budget x finite per-turn cap — the dispatch loop also
    // receives that finite cap below), unknown paid pricing fails closed
    // before any provider call, bare aliases need free-only router evidence.
    let dispatchHoldId: string | undefined;
    let dispatchFreeOnly = false;
    {
      const perTurnCap = clampAgentTokens(body.maxTokens);
      const estimatedTokens = estimateAgentRunTokens(perTurnCap, dispatchInput.maxSteps);
      const preflight = await preflightModelRun({
        model,
        estimatedTokens,
        maxSteps: dispatchInput.maxSteps,
        tenantId: tenant.id,
        requestId: reqId,
        getPricing: (providerId, modelId) => billingService.getModelPricing(providerId, modelId),
        resolveAliasFree: aliasFreeEvidence(model, () => router.getCandidates(), (alias, cands) =>
          resolveMetaModel(alias, cands as any, 'free'),
        ),
        quotaService: (server as any).quotaService,
      });
      if (!preflight.admitted) {
        const status = preflight.status === 402 ? 402 : 429;
        return reply.code(status).send({ error: { message: preflight.reason, instanceId: instance.id } });
      }
      dispatchHoldId = preflight.admitted ? preflight.holdId : undefined;
      // Bind the admission proof to the dispatch loop's model requests.
      dispatchFreeOnly = preflight.freeOnly === true;
    }

    try {
      const conversation = createInitialState(`dispatch:${reqId}`);
      conversation.messages = dispatchInput.messages as any;
      const loopContext = {
        instanceId: instance.id,
        definition,
        instance,
        tenantId: tenant.id,
        requestId: reqId,
      } as any;

      const loopResult = await runAgentChatLoop({
        conversation: conversation as any,
        maxSteps: dispatchInput.maxSteps,
        model,
        agentTools: requestedTools,
        agentToolDefs: dispatchInput.agentToolDefs as any,
        body: {
          messages: dispatchInput.messages as any,
          temperature: body.temperature,
          maxTokens: clampAgentTokens(body.maxTokens),
        },
        requestId: reqId,
        tenant,
        router,
        context: loopContext,
        stream: false,
        onStreamEvent: () => {},
        buildSystemPrompt: async () => systemPrompt,
        agentDefinition: {
          id: definition.id,
          name: definition.name,
          tenantId: tenant.id,
          allowedTools: requestedTools,
        },
        godmodeWrap: definition.godmodeWrap === true,
        freeOnly: dispatchFreeOnly,
        loadedSkillIds: [],
        runtime: agentRuntimeService,
        conversationId: `dispatch:${reqId}`,
      });

      // Settle actual measured usage against the preflight hold (reconciled
      // once) and record the execution with the real prompt/completion split.
      const settled = await settleAgentRun({
        tenantId: tenant.id,
        model,
        allSteps: loopResult.allSteps as any,
        requestId: reqId,
        sums: {
          promptTokens: loopResult.totalPromptTokens,
          completionTokens: loopResult.totalCompletionTokens,
          totalTokens: loopResult.totalTokensUsed,
          cost: loopResult.totalCost,
        },
        holdId: dispatchHoldId,
        quotaService: (server as any).quotaService,
        billingService,
      });
      dispatchHoldId = undefined;

      try {
        await agentRuntimeService.createExecution(
          loopContext,
          body.task,
          loopResult.lastResponseText,
          loopResult.allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
          model,
          settled.promptTokens,
          settled.completionTokens,
          0,
        );
      } catch (recordError) {
        logger.warn({ instanceId: instance.id, error: recordError }, 'agent-dispatch: failed to record execution');
      }

      return reply.send({
        instanceId: instance.id,
        name: definition.name,
        category: definition.category,
        tags: definition.tags,
        confidence: lowConfidence ? 'low' : 'high',
        content: loopResult.lastResponseText,
        model,
        usage: loopResult.finalUsage,
        totalTokens: loopResult.totalTokensUsed,
        steps_completed: loopResult.stepsCompleted,
        ...(loopResult.budgetExceeded ? { budget_exceeded: true, totalCost: loopResult.totalCost } : {}),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Routing failed';
      logger.error({ err, model }, 'agent-dispatch: route failed');
      return reply.code(502).send({
        error: { message: `Subagent execution failed: ${errMsg}`, instanceId: instance.id },
      });
    } finally {
      await releaseAgentHold((server as any).quotaService, dispatchHoldId);
    }
  });
}
