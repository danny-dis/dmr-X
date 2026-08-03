import { agentRegistryService } from '@dmr-x/agent-registry';
import { generateRequestId } from '@dmr-x/utils';
import type { AgentDefinition } from '@dmr-x/agent-registry';
import type { AgentRuntimeService } from './agent-runtime.js';

// ---------------------------------------------------------------------------
// Subagent delegation (isolation boundary)
//
// Borrowed from Vercel EVE's declared-subagent model, but scoped down to a
// SINGLE-SHOT, TOOLLESS task hand-off (see the note below on why this is not
// yet the full model). A subagent is a specialist with its own definition;
// when the parent delegates to it, the child runs in a FRESH, ISOLATED
// session:
//   - brand-new conversation history (parent's messages are NOT visible),
//   - its own system prompt (built from its own definition + skills),
//   - exactly ONE model completion (no tool calls, no ReAct loop) whose text
//     is returned as the child's answer.
//
// IMPORTANT — this does NOT narrow to the subagent's `allowedTools` today:
// the child is never given a `tools` array at all, so it cannot call ANY
// tool, regardless of what `allowedTools` declares. If a subagent's job
// requires calling tools, delegation is currently the wrong primitive for it.
// This is a deliberate, documented limitation (not a bug) — building a real
// bounded tool-calling loop here would require threading executable tool
// handlers from the gateway (apps/gateway/src/routes/tools.routes.ts) down
// into this service, which `services/*` is not allowed to depend on
// (packages/core has the shared types; apps/gateway is the only place the
// handlers and the ReAct loop live). Narrowing + a real loop should be
// implemented at the call site in tools.routes.ts's `delegate` handler
// instead, passing an execute callback + tool defs into `runSubagent`.
//
// This is a HARD isolation boundary: the child inherits nothing from the
// parent except (optionally) the task message it was handed. Multiple
// delegates run concurrently (the route awaits them with Promise.all).
// ---------------------------------------------------------------------------

export interface DelegateResult {
  ok: boolean;
  name: string;
  output: string;
  error?: string;
  model?: string;
}

/**
 * Resolve a subagent definition by id, name, or "<parentName>/<subName>",
 * scoped to the parent's tenant. Returns null when no match.
 */
export async function resolveSubagent(
  tenantId: string,
  parent: AgentDefinition,
  ref: string,
): Promise<AgentDefinition | null> {
  let candidates: AgentDefinition[] = [];
  if (typeof agentRegistryService.listDefinitions === 'function') {
    const res = await agentRegistryService.listDefinitions(tenantId, {
      page: 1,
      limit: 1000,
    });
    candidates = res.items;
  }

  const norm = ref.toLowerCase();
  const subName = norm.includes('/') ? norm.split('/').pop()! : norm;

  const hit = candidates.find((d: AgentDefinition) => {
    if (d.tenantId !== tenantId) return false;
    return (
      d.id.toLowerCase() === norm ||
      d.name.toLowerCase() === norm ||
      d.name.toLowerCase() === subName
    );
  });

  // The resolved subagent must NOT be the parent itself.
  if (!hit || hit.id === parent.id) return null;
  return hit;
}

/**
 * Run a delegated subagent in an isolated session.
 */
export async function runSubagent(args: {
  parent: AgentDefinition;
  subagent: AgentDefinition;
  message: string;
  tenantId: string;
  router: any;
  runtime: AgentRuntimeService;
  outputSchema?: Record<string, unknown>;
}): Promise<DelegateResult> {
  const { parent, subagent, message, tenantId, router, runtime } = args;

  // 1. Build an ISOLATED instance + context for the child. The child gets
  //     its own instance (fresh history); parent history is NOT carried over.
  const instance = await agentRegistryService.createInstance(tenantId, {
    agentDefinitionId: subagent.id,
    configOverride: { delegatedBy: parent.id, isolated: true },
  });
  if (!instance) {
    return { ok: false, name: subagent.name, output: '', error: 'Failed to spawn subagent instance' };
  }

  const context = await runtime.loadContext(instance.id, tenantId);
  if (!context) {
    return { ok: false, name: subagent.name, output: '', error: 'Failed to load subagent context' };
  }

  // NOTE: this is single-shot and TOOLLESS (see module docstring above) — the
  // child is not given `subagent.allowedTools` here on purpose; there is no
  // tool-calling loop to narrow. Do not resurrect a `childTools` computation
  // without also wiring an execute path and a bounded loop for it.
  const model = runtime.resolveModel(subagent);
  const systemPrompt = await runtime.buildSystemPrompt(subagent, 0, []);

  // 2. Single-shot task mode: one fresh conversation, run to completion.
  const requestId = generateRequestId();
  try {
    const { response } = await router.route(
      {
        modality: 'llm',
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: undefined,
        max_tokens: undefined,
        stream: false,
        metadata: { requestId, tenant: { id: tenantId, name: tenantId } },
      },
      { path: '/v1/agents/delegate' },
    );

    const output =
      typeof response.message?.content === 'string' ? response.message.content : '';
    return { ok: true, name: subagent.name, output, model: response.modelId };
  } catch (err) {
    const message2 = err instanceof Error ? err.message : String(err);
    return { ok: false, name: subagent.name, output: '', error: message2 };
  }
}
