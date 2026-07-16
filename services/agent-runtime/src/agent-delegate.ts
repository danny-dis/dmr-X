import { agentRegistryService } from '@dmr-x/agent-registry';
import { generateRequestId } from '@dmr-x/utils';
import type { AgentDefinition } from '@dmr-x/agent-registry';
import type { AgentRuntimeService } from './agent-runtime.js';

// ---------------------------------------------------------------------------
// Subagent delegation (isolation boundary)
//
// Borrowed from Vercel EVE's declared-subagent model. A subagent is a
// SPECIALIST with its own definition; when the parent delegates to it, the
// child runs in a FRESH, ISOLATED session:
//   - brand-new conversation history (parent's messages are NOT visible),
//   - tool surface NARROWED to the subagent's own `allowedTools`,
//   - its own system prompt (built from its own definition + skills),
//   - runs to completion in a single call (task mode) and returns a result.
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

  // 2. Narrow the tool surface to the child's OWN allowedTools (isolation).
  const childTools = subagent.allowedTools ?? [];
  const model = runtime.resolveModel(subagent);
  const systemPrompt = await runtime.buildSystemPrompt(subagent, 0, []);

  // 3. Single-shot task mode: one fresh conversation, run to completion.
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
