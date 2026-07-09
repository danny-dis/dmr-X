import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { agentRegistryService } from '@dmr-x/agent-registry';
import { agentRuntimeService } from '@dmr-x/agent-runtime';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { Router } from '@dmr-x/router';

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

/**
 * Score an agent definition against a task + hints.
 * category match +3, each tag overlap +2, each keyword in name/description +1.
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
    score += 3;
  }
  if (tags && tags.length > 0) {
    for (const t of tags) {
      if (tagSet.has(t.toLowerCase())) score += 2;
    }
  }
  const haystack = `${def.name} ${def.description ?? ''}`.toLowerCase();
  const keywords = task.toLowerCase().split(/\s+/).filter((k) => k.length > 2);
  for (const kw of keywords) {
    if (haystack.includes(kw)) score += 1;
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

    // Gather all active subagent instances for this tenant.
    let instances: any[];
    try {
      instances = await agentRegistryService.listInstances(tenant.id);
    } catch (err) {
      logger.error({ err }, 'agent-dispatch: failed to list instances');
      return reply.code(500).send({ error: { message: 'Failed to list subagents' } });
    }
    const active = instances.filter((i) => i.status === 'active');

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
    for (const instance of active) {
      const def = await agentRegistryService.getDefinition(instance.agentDefinitionId);
      if (!def) continue;
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

    // run:true → one-shot forward to the chosen subagent.
    const router = (server as any).router as Router;
    const model = agentRuntimeService.resolveModel(definition);
    const systemPrompt = agentRuntimeService.buildSystemPrompt(definition);
    const reqId = generateRequestId();
    const userMessages =
      body.messages && body.messages.length > 0
        ? body.messages
        : [{ role: 'user' as const, content: body.task }];
    const messages = [{ role: 'system' as const, content: systemPrompt }, ...userMessages];

    const unifiedRequest = {
      modality: 'llm' as const,
      model,
      messages: messages as any,
      temperature: body.temperature,
      max_tokens: body.maxTokens,
      stream: false,
      metadata: { requestId: reqId, tenant },
    };

    try {
      const { response } = await router.route(unifiedRequest, { path: '/v1/agentic/dispatch' });
      const content = typeof response.message?.content === 'string' ? response.message.content : '';
      return reply.send({
        instanceId: instance.id,
        name: definition.name,
        category: definition.category,
        tags: definition.tags,
        confidence: lowConfidence ? 'low' : 'high',
        content,
        model: response.modelId,
        usage: response.usage,
      });
    } catch (err) {
      logger.error({ err }, 'agent-dispatch: run failed');
      return reply.code(502).send({
        error: { message: 'Subagent execution failed', instanceId: instance.id },
      });
    }
  });
}
