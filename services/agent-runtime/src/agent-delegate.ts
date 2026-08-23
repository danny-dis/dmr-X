import { agentRegistryService, getDefinitionByName } from '@dmr-x/agent-registry';
import { generateRequestId } from '@dmr-x/utils';
import type { AgentDefinition } from '@dmr-x/agent-registry';
import type { AgentRuntimeService } from './agent-runtime.js';

// ---------------------------------------------------------------------------
// Subagent delegation (isolation boundary)
//
// Borrowed from Vercel EVE's declared-subagent model. A subagent is a
// specialist with its own definition; when the parent delegates to it, the
// child runs in a FRESH, ISOLATED session:
//   - brand-new conversation history (parent's messages are NOT visible),
//   - its own system prompt (built from its own definition + skills).
//
// The child runs either:
//   - a SINGLE-SHOT completion (default), or
//   - a SMALL bounded tool-calling loop when the call site passes `toolLoop`
//     AND the subagent declares non-empty `allowedTools`. `services/*` cannot
//     import executable handlers from apps/gateway, so the call site
//     (apps/gateway/src/routes/tools.routes.ts's `delegate` handler) threads
//     them in as generic tool defs + an execute callback; this module stays
//     dependency-free and just narrows the advertised tools to
//     allowedTools ∩ provided.
//
// This is still a HARD isolation boundary: the child inherits nothing from the
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
 *
 * Uses a single tenant-scoped lookup instead of listing all definitions.
 */
export async function resolveSubagent(
  tenantId: string,
  parent: AgentDefinition,
  ref: string,
): Promise<AgentDefinition | null> {
  // Extract subname from "parentName/subName" syntax
  const norm = ref.toLowerCase();
  const subName = norm.includes('/') ? norm.split('/').pop()! : norm;

  // Try direct lookup by ref first (id or name), scoped to tenant
  const direct = await getDefinitionByName(tenantId, ref);
  if (direct && direct.id !== parent.id) return direct;

  // If ref contained a "/", try by the subName portion
  if (subName !== norm) {
    const bySubName = await getDefinitionByName(tenantId, subName);
    if (bySubName && bySubName.id !== parent.id) return bySubName;
  }

  return null;
}

/**
 * Optional bounded tool-calling loop handed to the child by the call site.
 * Generic on purpose: services/* must not depend on apps/gateway, so the
 * executable handlers arrive as opaque defs + a callback.
 */
export interface SubagentToolLoop {
  /** LLM-facing tool definitions (OpenAI `tools` wire shape). */
  tools: any[];
  /** Hard cap on model turns in the child's loop. */
  maxSteps: number;
  /** Execute one tool call; resolves to any value (stringified into the transcript). */
  execute: (tc: { id: string; name: string; arguments: string }) => Promise<unknown>;
}

/**
 * Run a delegated subagent in an isolated session.
 *
 * With `toolLoop` provided AND the subagent declaring non-empty
 * `allowedTools`, runs a bounded ReAct-style loop (advertised tools narrowed
 * to allowedTools ∩ toolLoop.tools); otherwise falls back to the single-shot
 * completion.
 */
export async function runSubagent(args: {
  parent: AgentDefinition;
  subagent: AgentDefinition;
  message: string;
  tenantId: string;
  router: any;
  runtime: AgentRuntimeService;
  outputSchema?: Record<string, unknown>;
  toolLoop?: SubagentToolLoop;
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

  // NOTE: the child's advertised tools are narrowed to
  // allowedTools ∩ toolLoop.tools. When no toolLoop is passed, or the child
  // declares no allowedTools, this stays empty and we take the single-shot
  // path below (unchanged behaviour).
  const model = runtime.resolveModel(subagent);
  const systemPrompt = await runtime.buildSystemPrompt(subagent, 0, []);

  const allowedNames = new Set(
    (Array.isArray(subagent.allowedTools) ? subagent.allowedTools : [])
      .map((n: unknown) => String(n).trim().toLowerCase())
      .filter(Boolean),
  );
  const childTools =
    args.toolLoop && allowedNames.size > 0
      ? (args.toolLoop.tools ?? []).filter(
          (d: any) =>
            d?.function?.name && allowedNames.has(String(d.function.name).toLowerCase()),
        )
      : [];

  // 2a. Bounded tool-calling loop (only when executable tools were threaded in).
  if (args.toolLoop && childTools.length > 0) {
    const maxSteps = Math.max(1, Math.floor(args.toolLoop.maxSteps));
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];
    let bestOutput = '';
    let lastModel: string | undefined;
    try {
      for (let step = 0; step < maxSteps; step++) {
        const requestId = generateRequestId();
        const { response } = await router.route(
          {
            modality: 'llm',
            model,
            messages,
            tools: childTools,
            temperature: undefined,
            max_tokens: undefined,
            stream: false,
            metadata: { requestId, tenant: { id: tenantId, name: tenantId } },
          },
          { path: '/v1/agents/delegate' },
        );
        lastModel = response.modelId;
        const content =
          typeof response.message?.content === 'string' ? response.message.content : '';
        if (content) bestOutput = content;

        const wireCalls: any[] = response.message?.tool_calls ?? [];
        if (wireCalls.length === 0) break; // final prose — done

        messages.push(response.message);
        // Normalize OpenAI wire shape to the flat callback shape.
        const calls = wireCalls.map((tc: any) => ({
          id: String(tc.id ?? tc.function?.name ?? ''),
          name: String(tc.function?.name ?? tc.name ?? ''),
          arguments:
            typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments ?? tc.arguments ?? {}),
        }));

        const settled = await Promise.allSettled(calls.map((tc) => args.toolLoop!.execute(tc)));
        settled.forEach((s, i) => {
          let payload: string;
          if (s.status === 'rejected') {
            payload = JSON.stringify({
              error: s.reason instanceof Error ? s.reason.message : String(s.reason),
            });
          } else {
            const v: any = s.value;
            payload =
              v && typeof v === 'object' && 'error' in v && v.error != null
                ? JSON.stringify({ error: v.error?.message ?? String(v.error) })
                : JSON.stringify(v && typeof v === 'object' && 'result' in v ? v.result : v);
          }
          messages.push({ role: 'tool', tool_call_id: calls[i].id, content: payload });
        });
      }
      return { ok: true, name: subagent.name, output: bestOutput, model: lastModel };
    } catch (err) {
      const message2 = err instanceof Error ? err.message : String(err);
      // No output yet → hard failure; otherwise return what we have, noting the error.
      if (!bestOutput) {
        return { ok: false, name: subagent.name, output: '', error: message2 };
      }
      return { ok: true, name: subagent.name, output: bestOutput, model: lastModel, error: message2 };
    }
  }

  // 2b. Single-shot task mode (default): one fresh conversation, run to completion.
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
