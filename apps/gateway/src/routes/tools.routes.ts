import { ValidationError, normalizeAllowedTools, type UnifiedRequest, type ToolCall } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { memoryService } from '@dmr-x/memory';
import { sandboxService } from '@dmr-x/sandbox';
import { skillService } from '@dmr-x/agent-registry';
import { recordDataAccess, sanitizeArgsSummary, agentRuntimeService, skillLoader, jobStore } from '@dmr-x/agent-runtime';
import { resolveSubagent, runSubagent } from '@dmr-x/agent-runtime';
import {
  generateRequestId,
  executeTool,
  findToolByName,
  type Tool as SDKTool,
  type ParsedToolCall,
  logger,
} from '@dmr-x/utils';
import { writeSSE } from '../lib/sse.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ChatMessageSchema, ToolSchema, ToolCallSchema } from './shared-schemas.js';
import { parseQualityTarget } from '../utils/quality-target.js';

// ---------------------------------------------------------------------------
// Tool catalog cache (SDK + MCP combined)
// ---------------------------------------------------------------------------
interface ToolCatalogCache {
  tools: any[];
  ts: number;
  source: 'live' | 'fallback' | 'mcp-down';
}
let _toolCatalogCache: ToolCatalogCache | null = null;
const TOOL_CATALOG_TTL_MS = 60 * 1000; // 60s cache

// MCP server config (same as admin route)
const MCP_HOST = process.env.DMRX_MCP_HOST || '127.0.0.1';
const MCP_PORT = parseInt(process.env.DMRX_MCP_PORT || '47114', 10);
const MCP_URL = `http://${MCP_HOST}:${MCP_PORT}/tools`;

/** Invalidate the tool catalog cache. Call after registering a new tool. */
export function invalidateToolCatalog(): void {
  _toolCatalogCache = null;
}

/** Fetch live tool catalog from MCP server, with cache */
async function fetchToolCatalog(): Promise<ToolCatalogCache> {
  if (_toolCatalogCache && Date.now() - _toolCatalogCache.ts < TOOL_CATALOG_TTL_MS) {
    return _toolCatalogCache;
  }

  const sdkDefs = getRegisteredToolDefinitions();
  const sdkTools = sdkDefs.map((t) => ({
    type: 'function',
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
    source: 'sdk' as const,
  }));

  let mcpTools: any[] = [];
  let source: 'live' | 'fallback' | 'mcp-down' = 'live';
  try {
    const headers: Record<string, string> = {};
    if (process.env.DMRX_MCP_API_KEY) {
      headers.Authorization = `Bearer ${process.env.DMRX_MCP_API_KEY}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(MCP_URL, { signal: controller.signal, headers });
    clearTimeout(timer);
    if (res.ok) {
      const data: any = await res.json();
      if (data.tools && Array.isArray(data.tools)) {
        mcpTools = data.tools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.params || { type: 'object', properties: {} },
          },
          source: t.source || ('mcp' as const),
        }));
      }
    } else {
      source = 'mcp-down';
    }
  } catch {
    source = 'mcp-down';
  }

  const allTools = [...sdkTools, ...mcpTools];
  _toolCatalogCache = { tools: allTools, ts: Date.now(), source };
  return _toolCatalogCache;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: {
    requestId: string;
    tenant?: { id: string; name: string };
    /**
     * Conversation/session id. When present, the coding-tool sandbox is keyed
     * on this instead of `requestId` so every turn of a (possibly resumed)
     * conversation shares one workspace. Absent for one-off tool calls that
     * have no conversation (e.g. direct /tools/execute), which fall back to
     * `requestId`.
     */
    conversationId?: string;
  },
) => Promise<unknown> | unknown;

const toolHandlers = new Map<string, ToolHandler>();

/**
 * LLM-facing tool definitions (OpenAI `function` schema). Registered alongside
 * each handler so that callers — such as the subagent chat loop — can present
 * the model with real tool schemas instead of sending `tools: undefined`.
 */
export interface RegisteredToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const toolDefinitions = new Map<string, RegisteredToolDefinition>();

/**
 * Register a tool handler together with its LLM-facing schema. The schema is
 * used to build the `tools` array the model receives; the handler performs the
 * actual execution when the model emits a tool call.
 */
export function registerToolHandler(
  name: string,
  handler: ToolHandler,
  definition?: Partial<RegisteredToolDefinition['function']>,
): void {
  toolHandlers.set(name, handler);
  toolDefinitions.set(name, {
    type: 'function',
    function: {
      name,
      description: definition?.description ?? `Tool: ${name}`,
      parameters: definition?.parameters ?? { type: 'object', properties: {} },
    },
  });
  invalidateToolCatalog();
}

/**
 * Return LLM-facing tool definitions for the given tool names. Unknown names
 * are skipped (never fatal). Pass no names to get every registered tool.
 */
export function getRegisteredToolDefinitions(names?: string[]): RegisteredToolDefinition[] {
  const wanted = names ?? [...toolDefinitions.keys()];
  return wanted
    .map((n) => toolDefinitions.get(n))
    .filter((d): d is RegisteredToolDefinition => Boolean(d));
}

export { normalizeAllowedTools };

/**
 * Register only an LLM-facing schema for a tool whose handler was registered
 * (via `registerToolHandler`) elsewhere. Safe to call multiple times; the last
 * definition wins. Used by the coding-tool block, which registers handlers and
 * schemas in separate passes.
 */
export function registerToolDefinition(
  name: string,
  def: Partial<RegisteredToolDefinition['function']>,
): void {
  toolDefinitions.set(name, {
    type: 'function',
    function: {
      name,
      description: def.description ?? `Tool: ${name}`,
      parameters: def.parameters ?? { type: 'object', properties: {} },
    },
  });
}

/** Convert registered tool handlers to SDK Tool objects */
function getRegisteredSDKTools(): SDKTool[] {
  const tools: SDKTool[] = [];
  for (const [name, handler] of toolHandlers) {
    tools.push({
      function: {
        name,
        execute: async (args: Record<string, unknown>, context?: unknown) => {
          return handler(args, context as any);
        },
      },
    });
  }
  return tools;
}

// ponytail: lazily cache the SDK tools array; rebuild only when a handler is
// added (toolHandlers.size changes). No invalidation needed while tools are
// only ever added at boot — add a content hash if tools can be removed/replaced.
let _sdkTools: SDKTool[] | null = null;
let _sdkToolsLen = -1;
function getRegisteredSDKToolsCached(): SDKTool[] {
  if (_sdkTools && toolHandlers.size === _sdkToolsLen) return _sdkTools;
  _sdkTools = getRegisteredSDKTools();
  _sdkToolsLen = toolHandlers.size;
  return _sdkTools;
}

/** Execute a tool call using the SDK executor with fallback to direct handler lookup */
async function executeToolCall(
  tc: ToolCall,
  context: {
    requestId: string;
    tenant?: { id: string; name: string };
    agentDefinition?: { id: string; name: string; tenantId: string; allowedTools: string[] };
    router?: any;
    loadedSkills?: string[];
    conversationId?: string;
  },
): Promise<{ tool_call_id: string; tool_name: string; result: unknown; error?: { message: string } }> {
  const tools = getRegisteredSDKToolsCached();
  const parsedCall: ParsedToolCall = {
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments || '{}'),
  };

  const tool = findToolByName(tools, tc.function.name);
  if (!tool) {
    return {
      tool_call_id: tc.id,
      tool_name: tc.function.name,
      result: null,
      error: { message: `No handler registered for tool "${tc.function.name}"` },
    };
  }

  // Compliance: record a tamper-evident data-access audit entry. Fire-and-forget
  // and fully best-effort — audit failure must never break the tool result.
  void recordDataAccess({
    tenantId: context.tenant?.id ?? 'anonymous',
    requestId: context.requestId ?? 'unknown',
    agentId: (context as any).agentId,
    tool: tc.function.name,
    argsSummary: sanitizeArgsSummary(parsedCall.arguments),
    ts: Date.now(),
  }).catch(() => { /* audit best-effort */ });

  try {
    const result = await executeTool(tool, parsedCall, { ...context, numberOfTurns: 0 });
    return {
      tool_call_id: tc.id,
      tool_name: tc.function.name,
      result: result.result,
      error: result.error ? { message: String(result.error) } : undefined,
    };
  } catch (error) {
    logger.error({ err: error, tool: tc.function.name }, 'Tool execution error');
    return {
      tool_call_id: tc.id,
      tool_name: tc.function.name,
      result: null,
      error: { message: 'Tool execution failed' },
    };
  }
}

export { executeToolCall };

// ---------------------------------------------------------------------------
// Built-in tool handlers: sandbox code execution + memory RAG
// ---------------------------------------------------------------------------

/** Maximum time in ms to wait for a sandbox job. */
const SANDBOX_MAX_WAIT_MS = 30_000;

/**
 * Register built-in tool handlers for sandbox code execution and memory.
 * Called once during server initialisation.
 */
export function registerBuiltinToolHandlers(): void {
  registerSkillToolHandlers();
  registerLoadSkillToolHandler();
  registerDelegateToolHandler();
  registerJobBoardToolHandler();

  // ---- execute_code --------------------------------------------------------
  registerToolHandler(
    'execute_code',
    async (args, context) => {
    const { language, code, timeoutMs } = args as {
      language?: string;
      code: string;
      timeoutMs?: number;
    };

    if (!code || typeof code !== 'string') {
      return { error: 'code is required and must be a string' };
    }

    try {
      // Run in the SAME per-conversation workspace the file tools use, so code
      // executed here can see files read_file/write_file just operated on
      // (and vice versa), and so it cannot reach the source tree or gateway
      // secrets by inheriting the gateway process's own cwd.
      const workspaceDir = resolveSandboxDir(context.tenant?.id, workspaceKeyFor(context));
      const job = await sandboxService.submit({
        language: language || 'python',
        code,
        timeoutMs,
        tenantId: context.tenant?.id,
        workspaceDir,
      });

      // If the job completed synchronously (e.g. resource check failed), return immediately
      if (job.status !== 'queued' && job.status !== 'running') {
        return {
          jobId: job.id,
          status: job.status,
          output: job.output,
          error: job.error,
          durationMs: job.durationMs,
          language: job.language,
        };
      }

      // Wait for the job to finish via event (no polling)
      const result = await new Promise<{ status: string; output: string | null; error: string | null; durationMs: number | null }>((resolve) => {
        const onComplete = ({ id, status }: { id: string; status: string }) => {
          if (id !== job.id) return;
          sandboxService.removeListener('jobComplete', onComplete);
          clearTimeout(timer);
          const final = sandboxService.getById(id);
          resolve({
            status: final?.status ?? status,
            output: final?.output ?? null,
            error: final?.error ?? null,
            durationMs: final?.durationMs ?? null,
          });
        };

        sandboxService.on('jobComplete', onComplete);

        const timer = setTimeout(() => {
          sandboxService.removeListener('jobComplete', onComplete);
          resolve({ status: 'timeout', output: null, error: 'Sandbox execution timed out', durationMs: null });
        }, SANDBOX_MAX_WAIT_MS);
      });

      return {
        jobId: job.id,
        status: result.status,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs,
        language: job.language,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, tool: 'execute_code' }, 'Sandbox tool error');
      return { error: message };
    }
  },
    {
      description: 'Execute code in a sandboxed runtime. Supports multiple languages (python, node, bun, deno). Returns stdout, stderr, and exit code.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Language to execute (python, node, bun, deno). Defaults to python.' },
          code: { type: 'string', description: 'Source code to execute.' },
          timeoutMs: { type: 'number', description: 'Optional execution timeout in milliseconds.' },
        },
        required: ['code'],
      },
    },
  );

  // ---- remember ------------------------------------------------------------
  registerToolHandler(
    'remember',
    async (args, context) => {
    const { content, namespace, retentionDays, metadata } = args as {
      content: string;
      namespace?: string;
      retentionDays?: number;
      metadata?: Record<string, unknown>;
    };

    if (!content || typeof content !== 'string') {
      return { error: 'content is required and must be a string' };
    }

    try {
      const tenantId = context.tenant?.id ?? 'anonymous';
      const item = await memoryService.create({
        tenantId,
        content,
        namespace,
        source: 'agent',
        retentionDays,
        metadata,
      });
      return { id: item.id, namespace: item.namespace, createdAt: item.createdAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, tool: 'remember' }, 'Memory tool error');
      return { error: message };
    }
  },
    {
      description: 'Persist a memory item for later recall. Useful for storing facts, decisions, or context the agent should remember across turns.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The content to remember.' },
          namespace: { type: 'string', description: 'Optional namespace to group related memories.' },
          retentionDays: { type: 'number', description: 'Optional number of days before the memory expires.' },
          metadata: { type: 'object', description: 'Optional structured metadata.' },
        },
        required: ['content'],
      },
    },
  );

  // ---- recall --------------------------------------------------------------
  registerToolHandler(
    'recall',
    async (args, context) => {
    const { query, namespace, limit, minScore } = args as {
      query: string;
      namespace?: string;
      limit?: number;
      minScore?: number;
    };

    if (!query || typeof query !== 'string') {
      return { error: 'query is required and must be a string' };
    }

    try {
      const tenantId = context.tenant?.id;
      const results = await memoryService.search({
        tenantId,
        query,
        namespace,
        limit,
        minScore,
      });
      return {
        results: results.map((r) => ({
          id: r.id,
          content: r.content,
          namespace: r.namespace,
          score: r.score,
          source: r.source,
          createdAt: r.createdAt,
        })),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, tool: 'recall' }, 'Memory recall error');
      return { error: message };
    }
  },
    {
      description: 'Search stored memories by semantic similarity to a query. Returns ranked results with content and score.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language query to search for.' },
          namespace: { type: 'string', description: 'Optional namespace to restrict the search.' },
          limit: { type: 'number', description: 'Optional max number of results.' },
          minScore: { type: 'number', description: 'Optional minimum relevance score (0-1).' },
        },
        required: ['query'],
      },
    },
  );

  logger.info('Registered built-in tool handlers: execute_code, remember, recall');
}

/**
 * Contract for the tenant-scoped skill service methods exposed by the
 * `@dmr-x/agent-registry` sibling service. The gateway only depends on this
 * narrow surface so it does not need to import the service's DB internals.
 */
interface SkillServiceContract {
  createSkillFromAgent(
    tenantId: string,
    input: { name: string; description?: string; content: string; tags?: string[]; pinned?: boolean },
  ): Promise<{ id: string; name: string }>;
  patchSkillContent(
    id: string,
    tenantId: string,
    patch: { oldString: string; newString: string },
  ): Promise<{ id: string; name: string }>;
}

// The real `skillService` carries the full SkillService surface; narrow it to
// the contract the gateway relies on for tool execution.
const skillSvc = skillService as unknown as SkillServiceContract;

/**
 * Register the `delegate` tool (subagent isolation boundary).
 *
 * Borrowed from Vercel EVE's declared-subagent model, but currently a
 * SINGLE-SHOT, TOOLLESS hand-off rather than the full model: when the model
 * calls `delegate`, the named subagent runs in a FRESH, ISOLATED session
 * (its own conversation — parent history NOT visible — and its own system
 * prompt), makes exactly ONE completion call, and returns that text as its
 * answer. Result is returned to the parent; the parent never sees the
 * child's intermediate steps (there are none — there is no ReAct loop here).
 *
 * IMPORTANT: the child is NOT given any tools, so `subagent.allowedTools` is
 * not consulted by this path today — it is not narrowed, it is simply unused.
 * Only delegate self-contained, tool-free reasoning/drafting tasks to a
 * subagent; anything requiring file/shell/code access must be done by the
 * parent directly. See `services/agent-runtime/src/agent-delegate.ts` for the
 * full rationale and what a real bounded tool-calling loop would require.
 *
 * Requires the running agent's definition + the router in the tool context
 * (`context.agentDefinition`, `context.router`); an agentic loop that
 * supports delegation must supply them (the agent chat loop does).
 */
export function registerJobBoardToolHandler(): void {
  registerToolHandler(
    'create_job_task',
    async (args, context) => {
      const tenantId = context?.tenant?.id;
      if (!tenantId) return { error: 'No tenant context' };

      const { jobId, title, description, deliverable, dependsOnTaskIds } = args as {
        jobId?: unknown;
        title?: unknown;
        description?: unknown;
        deliverable?: unknown;
        dependsOnTaskIds?: unknown;
      };
      if (typeof jobId !== 'string' || !jobId) return { error: 'jobId is required' };
      if (typeof title !== 'string' || !title.trim()) return { error: 'title is required' };

      const job = jobStore.getJob(tenantId, jobId);
      if (!job) return { error: `Job ${jobId} not found` };
      // Only open jobs accept new work — no spawning tasks into a delivered
      // or cancelled job where they would never run.
      if (['cancelled', 'delivered', 'failed'].includes(job.status)) {
        return { error: `Job is ${job.status} and cannot accept new tasks` };
      }

      const existing = jobStore.listTasks(tenantId, jobId);
      // ponytail: flat cap on dynamic tasks per job; raise if real plans need more.
      const MAX_DYNAMIC_TASKS = 20;
      if (existing.length >= MAX_DYNAMIC_TASKS) {
        return { error: `Job already has ${MAX_DYNAMIC_TASKS} tasks — escalate to a human instead of adding more` };
      }

      // Dependencies must reference REAL task ids on THIS job. A dangling dep
      // would deadlock the scheduler (readyTasks never fires it).
      const knownIds = new Set(existing.map((t) => t.id));
      const deps = Array.isArray(dependsOnTaskIds)
        ? (dependsOnTaskIds as unknown[]).filter((d): d is string => typeof d === 'string')
        : [];
      const unknownDeps = deps.filter((d) => !knownIds.has(d));
      if (unknownDeps.length > 0) {
        return { error: `dependsOnTaskIds contains unknown task ids: ${unknownDeps.join(', ')}` };
      }
      // A cycle can't be created by pointing at EXISTING tasks from a NEW one,
      // so no cycle check is needed here.

      const crypto = await import('crypto');
      const created = jobStore.createTask({
        id: crypto.randomUUID(),
        jobId,
        parentTaskId: null,
        seq: existing.length + 1,
        title: title.trim(),
        description: typeof description === 'string' && description.trim() ? description.trim() : null,
        deliverable: typeof deliverable === 'string' && deliverable.trim() ? deliverable.trim() : null,
        dependsOn: deps,
        status: 'pending',
      } as any);

      const log = Array.isArray(job.decisionLog) ? (job.decisionLog as unknown[]) : [];
      jobStore.updateJob(tenantId, jobId, {
        decisionLog: [
          ...log,
          {
            at: new Date().toISOString(),
            by: (context as any).agentDefinition?.name ?? 'agent',
            action: 'create_task',
            taskId: created.id,
            title: created.title,
            dependsOn: deps,
          },
        ],
      });

      return {
        taskId: created.id,
        status: created.status,
        note: 'Task added to the job board. The runner picks up unblocked pending tasks on its next pass.',
      };
    },
    {
      description:
        'Add a new task to an existing multi-agent job board when you discover work the current plan does not cover. The job runner assigns and executes it automatically. Use sparingly: only for genuinely required follow-up work you cannot do yourself.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The job this task belongs to (given in your task message).' },
          title: { type: 'string', description: 'Short imperative task title.' },
          description: { type: 'string', description: 'What the next agent needs to know to complete it.' },
          deliverable: { type: 'string', description: 'What "done" looks like for this task.' },
          dependsOnTaskIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional ids of tasks that must complete before this one runs.',
          },
        },
        required: ['jobId', 'title'],
      },
    },
  );
}

/**
 * Register the `delegate` tool.
 *
 * Delegation runs a NAMED subagent in a fully isolated session: fresh system
 * prompt (from the subagent's own definition), fresh conversation, one user
 * message (the task), exactly ONE completion call, and returns that text as its
 * answer. Result is returned to the parent; the parent never sees the
 * child's intermediate steps (there are none — there is no ReAct loop here).
 *
 * IMPORTANT: the child is NOT given any tools, so `subagent.allowedTools` is
 * not consulted by this path today — it is not narrowed, it is simply unused.
 * Only delegate self-contained, tool-free reasoning/drafting tasks to a
 * subagent; anything requiring file/shell/code access must be done by the
 * parent directly. See `services/agent-runtime/src/agent-delegate.ts` for the
 * full rationale and what a real bounded tool-calling loop would require.
 *
 * Requires the running agent's definition + the router in the tool context
 * (`context.agentDefinition`, `context.router`); an agentic loop that
 * supports delegation must supply them (the agent chat loop does).
 */
export function registerDelegateToolHandler(): void {
  registerToolHandler(
    'delegate',
    async (args, context) => {
      const tenantId = context?.tenant?.id;
      if (!tenantId) return { error: 'No tenant context' };
      const parent = (context as any).agentDefinition as
        | { id: string; name: string; tenantId: string; allowedTools: string[] }
        | undefined;
      const router = (context as any).router as Router | undefined;
      if (!parent) return { error: 'delegate requires an agent context (parent definition)' };
      if (!router) return { error: 'delegate requires a router in the tool context' };

      const { agent, message, output_schema } = args as {
        agent?: unknown;
        message?: unknown;
        output_schema?: Record<string, unknown>;
      };
      if (typeof agent !== 'string' || !agent) return { error: 'agent (subagent name/id) is required' };
      if (typeof message !== 'string' || !message) return { error: 'message is required' };

      const subagent = await resolveSubagent(tenantId, parent as any, agent);
      if (!subagent) {
        return { error: `No subagent found matching "${agent}"` };
      }

      // Thread a bounded tool loop into the child: defs come from the same
      // registered catalog agent-chat uses (getRegisteredToolDefinitions),
      // narrowed by the SUBAGENT's allowedTools; execution reuses
      // executeToolCall with the child's definition so its own narrowing and
      // audit apply. Without declared allowedTools the child stays single-shot.
      const allowedSubTools = normalizeAllowedTools((subagent as any).allowedTools);
      const requestId = generateRequestId();
      const childConversationId = generateRequestId(); // fresh isolated transcript for the child

      try {
        const result = await runSubagent({
          parent: parent as any,
          subagent,
          message,
          tenantId,
          router,
          runtime: agentRuntimeService,
          outputSchema: output_schema,
          ...(allowedSubTools.length > 0
            ? {
                toolLoop: {
                  tools: getRegisteredToolDefinitions(allowedSubTools).slice(0, 30), // provider tool-def cap (see agent-dispatch)
                  maxSteps: Number(process.env.DMRX_SUBAGENT_MAX_STEPS) || 5,
                  execute: async (
                    tc: { id: string; name: string; arguments: string },
                  ): Promise<unknown> => {
                    const allowed = new Set(allowedSubTools.map((n: string) => n.toLowerCase()));
                    if (!allowed.has(String(tc.name).toLowerCase())) {
                      return {
                        error: {
                          message: `Tool "${tc.name}" is not in subagent "${subagent.name}" allowedTools`,
                        },
                      };
                    }
                    return executeToolCall(
                      {
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.arguments },
                      },
                      {
                        requestId,
                        tenant: { id: tenantId, name: tenantId },
                        agentDefinition: subagent as any,
                        router,
                        loadedSkills: [],
                        conversationId: childConversationId,
                      },
                    );
                  },
                },
              }
            : {}),
        });
        if (!result.ok) return { error: result.error ?? 'subagent failed' };
        return {
          name: result.name,
          output: result.output,
          model: result.model,
        };
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        logger.error({ err: m, tool: 'delegate', subagent: subagent.name }, 'delegate tool error');
        return { error: m };
      }
    },
    {
      description:
        'Delegate a self-contained, TOOL-FREE task to a named subagent. The subagent runs in an isolated session with its own system prompt; it cannot see this conversation and CANNOT call any tools (single-shot text answer only). Returns the subagent\'s final answer. Use for independent reasoning/drafting/analysis work, not for anything requiring file, shell, or code access.',
      parameters: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Name or id of the subagent to delegate to.' },
          message: { type: 'string', description: 'The complete task description for the subagent. Do not include sensitive data the child should not see.' },
          output_schema: { type: 'object', description: 'Optional JSON schema the subagent\'s answer should conform to.' },
        },
        required: ['agent', 'message'],
      },
    },
  );
}

/**
 * Register the `load_skill` tool (progressive disclosure).
 *
 * Borrowed from Vercel EVE's SKILL.md / load_skill model. The agent's
 * skill *descriptions* are always advertised in the system prompt as hints,
 * but their *bodies* are only pulled in when the model calls this tool
 * by skill name. The body is returned in the tool result (so it enters
 * context for the current turn) and the skill id is appended to
 * `context.loadedSkills` so subsequent turns re-inline it from the
 * skill store rather than re-fetching.
 */
export function registerLoadSkillToolHandler(): void {
  registerToolHandler(
    'load_skill',
    async (args, context) => {
      const tenantId = context?.tenant?.id;
      if (!tenantId) return { error: 'No tenant context' };
      const { skill } = args as { skill?: unknown };
      if (typeof skill !== 'string' || !skill) {
        return { error: 'skill (name or id) is required' };
      }
      try {
        const resolved = skillLoader.resolveBody(tenantId, skill);
        if (!resolved) return { error: `No skill found matching "${skill}"` };
        // Record for subsequent-turn re-inlining (progressive disclosure).
        if (Array.isArray((context as any).loadedSkills) &&
            !(context as any).loadedSkills.includes(resolved.name)) {
          (context as any).loadedSkills.push(resolved.name);
        }
        return {
          name: resolved.name,
          description: resolved.description,
          content: resolved.content,
        };
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        logger.error({ err: m, tool: 'load_skill' }, 'load_skill error');
        return { error: m };
      }
    },
    {
      description:
        'Load a skill\'s full procedure into context by name. Skills are advertised as hints; call this when a task matches one to read its complete instructions. The body is returned for the current turn.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'Name or id of the skill to load.' },
        },
        required: ['skill'],
      },
    },
  );
}

/**
 * Register tenant-scoped skill tool handlers. These operate on the
 * `skillService` (provided by `@dmr-x/agent-registry`) and are always
 * tenant-scoped: a missing tenant context yields `{ error: 'No tenant context' }`.
 */
export function registerSkillToolHandlers(): void {
  // ---- skill_create --------------------------------------------------------
  registerToolHandler(
    'skill_create',
    async (args, context) => {
    const tenantId = context?.tenant?.id;
    if (!tenantId) {
      return { error: 'No tenant context' };
    }

    const { name, description, content, tags, pinned } = args as {
      name?: unknown;
      description?: unknown;
      content?: unknown;
      tags?: unknown;
      pinned?: unknown;
    };

    if (typeof name !== 'string' || !name) {
      return { error: 'name is required' };
    }
    if (typeof content !== 'string' || !content) {
      return { error: 'content is required' };
    }

    try {
      const skill = await skillSvc.createSkillFromAgent(tenantId, {
        name,
        description: typeof description === 'string' ? description : undefined,
        content,
        tags: Array.isArray(tags) ? (tags.filter((t) => typeof t === 'string') as string[]) : undefined,
        pinned: typeof pinned === 'boolean' ? pinned : undefined,
      });
      return { ok: true, skill: { id: skill.id, name: skill.name } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, tool: 'skill_create', tenantId }, 'Skill create tool error');
      return { error: message };
    }
  },
    {
      description: 'Capture a reusable skill (procedure/knowledge) for this tenant. Persists the skill so it can be inlined into future agent runs.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique skill name.' },
          description: { type: 'string', description: 'Optional short description.' },
          content: { type: 'string', description: 'The skill content/markdown body.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
          pinned: { type: 'boolean', description: 'Mark as pinned (protected from auto-patch).' },
        },
        required: ['name', 'content'],
      },
    },
  );

  // ---- skill_patch ---------------------------------------------------------
  registerToolHandler(
    'skill_patch',
    async (args, context) => {
    const tenantId = context?.tenant?.id;
    if (!tenantId) {
      return { error: 'No tenant context' };
    }

    const { id, oldString, newString } = args as {
      id?: unknown;
      oldString?: unknown;
      newString?: unknown;
    };

    if (typeof id !== 'string' || !id) {
      return { error: 'id is required' };
    }
    if (typeof oldString !== 'string' || !oldString) {
      return { error: 'oldString is required' };
    }
    if (typeof newString !== 'string') {
      return { error: 'newString is required' };
    }

    try {
      const skill = await skillSvc.patchSkillContent(id, tenantId, { oldString, newString });
      return { ok: true, skill: { id: skill.id, name: skill.name } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, tool: 'skill_patch', tenantId }, 'Skill patch tool error');
      return { error: message };
    }
  },
    {
      description: 'Refine an existing (non-pinned) skill by replacing an exact string in its content.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The skill id to patch.' },
          oldString: { type: 'string', description: 'Exact substring to find and replace.' },
          newString: { type: 'string', description: 'Replacement string.' },
        },
        required: ['id', 'oldString', 'newString'],
      },
    },
  );

  logger.info('Registered skill tool handlers: skill_create, skill_patch');
}

// ---------------------------------------------------------------------------
// Coding agent tool handlers (file system + shell)
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Agent } from 'undici';

import { validateBaseUrlForSSRF } from './admin-ssrf.js';

const execAsync = promisify(exec);

/**
 * Root directory under which each (tenant, request) pair gets an isolated
 * sandbox directory. This keeps concurrent subagents using the coding tools
 * from clobbering each other's files. Falls back to a tmp dir if unset.
 */
const CODING_SANDBOX_ROOT = process.env.DMRX_CODING_SANDBOX_ROOT || path.join(os.tmpdir(), 'dmrx-coding');
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB limit for reads/writes
export { MAX_FILE_SIZE };
const SHELL_TIMEOUT_MS = 30_000; // 30s default for shell commands

/**
 * Allowlist of executables the `bash` coding tool may invoke. Replaces the
 * previous blocklist, which was trivially bypassable. Kept at module scope so
 * it can be unit-tested and shared with `isBashCommandAllowed`.
 */
export const ALLOWED_BASH_COMMANDS = new Set([
  // Version control
  'git',
  // Package managers
  'npm', 'npx', 'yarn', 'pnpm', 'bun',
  // Runtime execution
  'node', 'bun', 'deno', 'python', 'python3',
  // File operations (safe subset)
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'rg',
  'mkdir', 'cp', 'mv', 'touch',
  // Build tools
  'tsc', 'esbuild', 'vite', 'webpack',
  // Testing
  'jest', 'vitest', 'mocha',
  // Process info
  'ps', 'top', 'uptime', 'date',
  // Disk info
  'df', 'du', 'stat',
]);

/**
 * Validate that a bash command only invokes allowlisted executables. Every
 * statement segment (split on ; && || | and newlines) must resolve to an
 * allowlisted binary; command substitution, backgrounding, and redirects to
 * system paths are blocked.
 */
/**
 * Binaries that can execute arbitrary code from a string argument. The
 * allowlist intentionally includes these (they're needed for builds/tests),
 * but ONLY for their standard invocation — never with a code-execution flag.
 * `node -e`, `python -c`, `bun x`, and `npx` all bypass the allowlist's
 * intent by running attacker-supplied code instead of a project script.
 *
 * C1 — without this, any tenant key yields arbitrary code execution on the
 * gateway host via the bash tool.
 */
const ARBITRARY_CODE_FLAGS: { binary: string; pattern: RegExp; flag: string }[] = [
  { binary: 'node', pattern: /node\s+(-e|--eval|-p|--print)\s/, flag: '-e/--eval/-p/--print' },
  { binary: 'python', pattern: /python3?\s+-[cm]\s/, flag: '-c/-m' },
  { binary: 'python3', pattern: /python3?\s+-[cm]\s/, flag: '-c/-m' },
  { binary: 'bun', pattern: /bun\s+(x|run)\s+/, flag: 'x/run' },
  { binary: 'deno', pattern: /deno\s+(eval|run)\s/, flag: 'eval/run' },
  { binary: 'npx', pattern: /npx\s+/, flag: 'npx (downloads + runs arbitrary packages)' },
];

export function isBashCommandAllowed(command: string): { allowed: boolean; reason?: string } {
  const trimmed = command.trim();

  // Block command substitution patterns
  if (/\$\(|`[^`]*`|\$\{/.test(trimmed)) {
    return { allowed: false, reason: 'Command substitution not allowed' };
  }

  // Block arbitrary-code-execution flags on runtime binaries. The allowlist
  // includes node/python/bun/deno/npx for legitimate build/test use, but
  // `node -e 'require("child_process").exec(...)'` would otherwise pass —
  // any tenant key could run arbitrary code on the host via the bash tool.
  for (const { binary, pattern, flag } of ARBITRARY_CODE_FLAGS) {
    const firstWord = trimmed.split(/\s+/)[0]?.split('/').pop() || '';
    if (firstWord === binary && pattern.test(trimmed)) {
      return { allowed: false, reason: `'${binary}' flag '${flag}' allows arbitrary code execution and is blocked` };
    }
  }

  // Split into statement segments on ; && || | and newlines. Every segment
  // must validate, otherwise `cmd1; cmd2` or `cmd1 && cmd2` could smuggle a
  // non-allowlisted second command through.
  const segments = trimmed
    .split(/[;\n]|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const segment of segments) {
    const firstWord = segment.split(/\s+/)[0]?.split('/').pop() || '';
    if (!ALLOWED_BASH_COMMANDS.has(firstWord)) {
      return { allowed: false, reason: `Command '${firstWord}' not in allowlist` };
    }
  }

  // Block background execution
  if (trimmed.endsWith('&')) {
    return { allowed: false, reason: 'Background execution not allowed' };
  }

  // Block redirects to sensitive paths
  if (/[>>]+\s*(\/etc|\/proc|\/sys|\/dev)/.test(trimmed)) {
    return { allowed: false, reason: 'Redirects to system paths not allowed' };
  }

  return { allowed: true };
}

/**
 * Content-level deny-list of clearly destructive shell patterns. The allowlist
 * (above) already restricts which binaries may run; this is a secondary guard
 * against obviously dangerous arguments/content that slip past the allowlist
 * (e.g. an allowlisted `curl` piped into `sh`). Non-fatal: returns a reason
 * string instead of throwing. Keep patterns defensive, not over-broad.
 */
const DANGEROUS_BASH_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+-rf\s+\//, reason: 'Recursive delete of filesystem root' },
  { pattern: /\bmkfs\./, reason: 'Filesystem format command' },
  { pattern: /\bdd\s+if=/, reason: 'Raw disk write via dd' },
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'Fork bomb' },
  { pattern: /\bchmod\s+-R\s+0+\s+\//, reason: 'Recursive chmod 000 on root' },
  { pattern: /\b(curl|wget)\b[^\n|]*\| *[a-z]*sh\b/, reason: 'Piping remote script into shell' },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: 'Redirect overwrite of block device' },
  { pattern: /\b(curl|wget)\b.*\s+(--upload-file|--data)\b.*\/etc\//, reason: 'Writing to /etc via curl/wget' },
];

/** Returns the reason a command is dangerous, or null if it passes. */
export function isDangerousBashCommand(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

/**
 * Resolve (and create) the per-(tenant, workspaceKey) isolated sandbox
 * directory. `workspaceKey` is the conversation id for agent chat turns (so
 * every turn of a conversation — including across /resume calls — shares one
 * workspace) or the request id for one-off tool calls that have no
 * conversation. Different conversations (and different one-off requests)
 * still get their own directory, so parallel subagent runs cannot collide.
 */
function resolveSandboxDir(tenantId?: string, workspaceKey?: string): string {
  const tenant = tenantId || 'anonymous';
  const key = workspaceKey || 'default';
  const dir = path.join(CODING_SANDBOX_ROOT, tenant, key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Pick the sandbox workspace key from a tool-handler context: prefer the
 * conversation id (shared across all turns/resumes of a session) and fall
 * back to the request id for one-off tool calls with no conversation.
 */
function workspaceKeyFor(context?: { requestId?: string; conversationId?: string }): string | undefined {
  const raw = context?.conversationId || context?.requestId;
  if (!raw) return undefined;
  // Sanitize: replace invalid filename characters with underscore
  // Windows prohibits: < > : " / \ | ? *
  return raw.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * Remove a resolved sandbox directory, if it exists.
 * No-throw: errors (e.g. ENOENT when the dir was never created) are ignored.
 */
export function cleanupSandboxDir(tenantId?: string, workspaceKey?: string): void {
  try {
    const dir = resolveSandboxDir(tenantId, workspaceKey);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.debug({ err, tenantId, workspaceKey }, 'cleanupSandboxDir failed (ignored)');
    }
  }
}

/**
 * Remove sandbox directories under the workspace root that are older than
 * `maxAgeMs` (default 1 hour). Only deletes dirs directly under a tenant
 * subdirectory; all errors are ignored. Intended to be called at startup.
 */
export function sweepStaleSandboxes(maxAgeMs = 60 * 60 * 1000): void {
  try {
    const now = Date.now();
    if (!fs.existsSync(CODING_SANDBOX_ROOT)) return;
    for (const tenant of fs.readdirSync(CODING_SANDBOX_ROOT, { withFileTypes: true })) {
      if (!tenant.isDirectory()) continue;
      const tenantDir = path.join(CODING_SANDBOX_ROOT, tenant.name);
      try {
        for (const req of fs.readdirSync(tenantDir, { withFileTypes: true })) {
          if (!req.isDirectory()) continue;
          try {
            const dir = path.join(tenantDir, req.name);
            const stat = fs.statSync(dir);
            if (now - stat.mtimeMs > maxAgeMs) {
              fs.rmSync(dir, { recursive: true, force: true });
            }
          } catch {
            /* ignore per-request errors */
          }
        }
      } catch {
        /* ignore per-tenant errors */
      }
    }
  } catch (err) {
    logger.debug({ err }, 'sweepStaleSandboxes failed (ignored)');
  }
}

/**
 * Validate and resolve a file path, ensuring it stays within the workspace.
 * Uses fs.realpathSync() to resolve symlinks before validation,
 * preventing symlink-based path traversal attacks.
 *
 * `workspaceKey` should be the conversation id when the call is part of an
 * agent conversation (see `workspaceKeyFor`), falling back to the request id
 * for one-off tool calls.
 *
 * @throws Error if path is outside workspace or contains null bytes
 */
export function safePath(filePath: string, tenantId?: string, workspaceKey?: string): string {
  // Block null bytes (can bypass path checks on some systems)
  if (filePath.includes('\0')) {
    throw new Error('Path contains invalid characters');
  }

  // Root every path inside the per-(tenant, workspaceKey) isolated sandbox dir.
  const workspace = resolveSandboxDir(tenantId, workspaceKey);
  const resolved = path.resolve(workspace, filePath);

  // Try to resolve symlinks if the path exists
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    // Path doesn't exist yet (e.g., for write_file) - validate parent directory
    const parentDir = path.dirname(resolved);
    try {
      realPath = fs.realpathSync(parentDir);
      // Append the filename since it doesn't exist yet
      realPath = path.join(realPath, path.basename(resolved));
    } catch {
      // Parent doesn't exist either - use resolved path but still validate prefix
      realPath = resolved;
    }
  }

  // Normalize path separators for cross-platform comparison
  const normalizedWorkspace = workspace.replace(/\\/g, '/');
  const normalizedReal = realPath.replace(/\\/g, '/');

  // M2 — containment: require a trailing separator so workspace /sandbox/req1
  // does NOT also admit /sandbox/req11. Without it, startsWith passes paths
  // that merely share a prefix with the workspace dir.
  if (normalizedReal !== normalizedWorkspace && !normalizedReal.startsWith(normalizedWorkspace + '/')) {
    throw new Error('Path outside workspace');
  }

  return realPath;
}

// ---------------------------------------------------------------------------
// web_fetch / web_search — LLM-driven web access tools
// ---------------------------------------------------------------------------
//
// An LLM picks the URL, so these are server-side request forgery primitives:
// EVERY outbound fetch MUST go through validateBaseUrlForSSRF() and the
// returned pinned `lookup` must be wired into undici's Agent dispatcher, so
// the outbound connection can only reach the IP that was validated. Redirects
// are followed manually (`redirect: 'manual'`) and each hop is re-validated,
// capped at 3. Response bodies are streamed with a 2MB cap and the extracted
// text is trimmed to ~20k chars so a hostile page cannot blow the agent's
// context budget. Failures return `{ error }` — never throw; the agent loop
// reports tool errors back to the model for self-correction.

const WEB_FETCH_TIMEOUT_MS = 10_000; // 10s hard timeout per request
const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024; // 2MB streamed body cap
const WEB_FETCH_MAX_CHARS = 20_000; // ~20k chars of extracted text
const WEB_FETCH_MAX_REDIRECTS = 3; // re-validated redirect hops

/** Strip <script>/<style> blocks, then tags, then collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a URL with SSRF validation on the initial URL and on every redirect
 * hop (max 3). The connection is pinned to the validated IP via the lookup
 * returned by validateBaseUrlForSSRF, closing the DNS-rebinding window.
 * Returns the Response for a non-redirect status, or null when the redirect
 * chain exceeded the cap. Throws for blocked destinations (private IPs,
 * non-http(s) schemes, unresolvable hosts).
 */
async function fetchValidated(urlStr: string, signal: AbortSignal): Promise<Response | null> {
  let current = urlStr;
  for (let hop = 0; ; hop++) {
    const v = await validateBaseUrlForSSRF(current);
    const dispatcher = new Agent({ connect: { lookup: v.lookup } });
    const res = await fetch(v.url, { dispatcher, redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      // Manual redirect: re-validate the next hop before following it.
      if (hop >= WEB_FETCH_MAX_REDIRECTS) return null;
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, v.url).toString();
      continue;
    }
    return res;
  }
}

/**
 * Stream a response body, aborting past the 2MB cap so an oversized body is
 * truncated rather than buffered whole. Returns the (possibly partial) text.
 */
async function readBodyCapped(res: Response): Promise<{ text: string; truncated: boolean; bytes: number }> {
  if (!res.body) {
    const text = await res.text();
    return { text, truncated: false, bytes: Buffer.byteLength(text, 'utf-8') };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      // Cap check BEFORE retaining the chunk: the over-limit chunk is
      // discarded, so `bytes` stays bounded by the cap and the body is
      // truncated rather than buffered whole.
      if (bytes + value.byteLength > WEB_FETCH_MAX_BYTES) {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      bytes += value.byteLength;
      chunks.push(value);
    }
  }
  const buf = Buffer.concat(chunks);
  return { text: buf.toString('utf-8'), truncated, bytes };
}

export function registerCodingToolHandlers(): void {
  // ---- read_file -----------------------------------------------------------
  registerToolHandler('read_file', async (args, context) => {
    const { path: filePath, offset, limit } = args as {
      path: string;
      offset?: number;
      limit?: number;
    };

    if (!filePath || typeof filePath !== 'string') {
      return { error: 'path is required' };
    }

    try {
      const fullPath = safePath(filePath, context?.tenant?.id, workspaceKeyFor(context));
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        return { error: `File too large (${stat.size} bytes, max ${MAX_FILE_SIZE})` };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      const start = (offset ?? 1) - 1;
      const end = limit ? start + limit : lines.length;
      const selected = lines.slice(start, end);

      return {
        content: selected.join('\n'),
        totalLines,
        startLine: start + 1,
        endLine: Math.min(end, totalLines),
        truncated: end < lines.length,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- write_file ----------------------------------------------------------
  registerToolHandler('write_file', async (args, context) => {
    const { path: filePath, content } = args as {
      path: string;
      content: string;
    };

    if (!filePath || typeof filePath !== 'string') {
      return { error: 'path is required' };
    }
    if (content === undefined || typeof content !== 'string') {
      return { error: 'content is required' };
    }

    try {
      const fullPath = safePath(filePath, context?.tenant?.id, workspaceKeyFor(context));
      if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
        return { error: `File too large (${Buffer.byteLength(content, 'utf-8')} bytes, max ${MAX_FILE_SIZE})` };
      }
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      const stat = fs.statSync(fullPath);
      return { path: filePath, bytes: stat.size, lines: content.split('\n').length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- edit_file -----------------------------------------------------------
  registerToolHandler('edit_file', async (args, context) => {
    const { path: filePath, oldString, newString } = args as {
      path: string;
      oldString: string;
      newString: string;
    };

    if (!filePath || typeof filePath !== 'string') {
      return { error: 'path is required' };
    }
    if (!oldString || typeof oldString !== 'string') {
      return { error: 'oldString is required' };
    }
    if (newString === undefined || typeof newString !== 'string') {
      return { error: 'newString is required' };
    }

    try {
      const fullPath = safePath(filePath, context?.tenant?.id, workspaceKeyFor(context));
      let content = fs.readFileSync(fullPath, 'utf-8');

      const count = content.split(oldString).length - 1;
      if (count === 0) {
        return { error: `oldString not found in ${filePath}` };
      }
      if (count > 1) {
        return { error: `Found ${count} matches for oldString. Provide more context to make it unique.` };
      }

      content = content.replace(oldString, newString);
      fs.writeFileSync(fullPath, content, 'utf-8');

      return { path: filePath, replaced: 1, lines: content.split('\n').length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- list_files ----------------------------------------------------------
  registerToolHandler('list_files', async (args, context) => {
    const { path: dirPath, pattern, recursive } = args as {
      path?: string;
      pattern?: string;
      recursive?: boolean;
    };

    try {
      const fullPath = safePath(dirPath || '.', context?.tenant?.id, workspaceKeyFor(context));
      const results: string[] = [];

      function walk(dir: string, prefix: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
          if (entry.isDirectory()) {
            results.push(`${rel}/`);
            if (recursive) walk(path.join(dir, entry.name), rel);
          } else {
            if (!pattern || entry.name.includes(pattern)) {
              results.push(rel);
            }
          }
        }
      }

      walk(fullPath, '');
      return { files: results.slice(0, 200), total: results.length, truncated: results.length > 200 };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- bash ----------------------------------------------------------------
  // Allowlist + validation live at module scope (ALLOWED_BASH_COMMANDS and
  // isBashCommandAllowed) so they can be unit-tested. Delegating here keeps
  // the handler body unchanged.

  registerToolHandler('bash', async (args, context) => {
    const { command, timeoutMs, cwd } = args as {
      command: string;
      timeoutMs?: number;
      cwd?: string;
    };

    if (!command || typeof command !== 'string') {
      return { error: 'command is required' };
    }

    // Validate command against allowlist
    const validation = isBashCommandAllowed(command);
    if (!validation.allowed) {
      return { error: `Command rejected: ${validation.reason}. Use execute_code for unrestricted execution.` };
    }

    // Secondary content-level guard against clearly destructive patterns.
    const dangerousReason = isDangerousBashCommand(command);
    if (dangerousReason) {
      return { error: `Command blocked by safety policy: ${dangerousReason}` };
    }

    try {
      const workspaceKey = workspaceKeyFor(context);
      const workDir = cwd ? safePath(cwd, context?.tenant?.id, workspaceKey) : resolveSandboxDir(context?.tenant?.id, workspaceKey);
      const timeout = timeoutMs ?? SHELL_TIMEOUT_MS;

      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        // SECURITY: Use stripped environment
        env: {
          HOME: '/tmp',
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          LANG: process.env.LANG || 'en_US.UTF-8',
        },
      });

      return { stdout, stderr: stderr || '', exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        exitCode: err.code ?? 1,
        error: err.message,
      };
    }
  });

  // ---- search_files --------------------------------------------------------
  registerToolHandler('search_files', async (args, context) => {
    const { pattern: searchPattern, path: dirPath, include } = args as {
      pattern: string;
      path?: string;
      include?: string;
    };

    if (!searchPattern || typeof searchPattern !== 'string') {
      return { error: 'pattern is required' };
    }

    try {
      const fullPath = safePath(dirPath || '.', context?.tenant?.id, workspaceKeyFor(context));
      const results: Array<{ file: string; line: number; text: string }> = [];

      function walk(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
          const fullPath2 = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath2);
          } else {
            if (include && !entry.name.includes(include)) continue;
            try {
              const content = fs.readFileSync(fullPath2, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(searchPattern)) {
                  const rel = path.relative(fullPath, fullPath2);
                  results.push({ file: rel, line: i + 1, text: lines[i].trim() });
                  if (results.length >= 100) return;
                }
              }
            } catch {
              // Skip binary/unreadable files
            }
          }
        }
      }

      walk(fullPath);
      return { matches: results, total: results.length, truncated: results.length >= 100 };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- web_fetch -----------------------------------------------------------
  registerToolHandler('web_fetch', async (args) => {
    const { url } = args as { url?: string };
    if (!url || typeof url !== 'string') {
      return { error: 'url is required' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      let res: Response | null;
      try {
        res = await fetchValidated(url, controller.signal);
      } catch (err) {
        // SSRF rejection / DNS failure / bad scheme — surfaced as a normal
        // tool error, never a throw.
        return { error: err instanceof Error ? err.message : String(err) };
      }
      if (!res) {
        return { error: `Too many redirects (max ${WEB_FETCH_MAX_REDIRECTS})` };
      }
      const { text, truncated, bytes } = await readBodyCapped(res);
      const plain = htmlToText(text);
      const cut = plain.length > WEB_FETCH_MAX_CHARS;

      // A 200 is NOT proof of success. Redirect-prone doc hosts (Anthropic's
      // docs.anthropic.com -> platform.claude.com is the canonical example)
      // answer a dead slug with a cross-host 302 to a Next.js error shell that
      // carries a plausible <title> and hundreds of KB of chrome. An agent that
      // only sees `status` and `text` reads that shell as real content and cites
      // a page that does not exist.
      //
      // So report the FINAL url and whether we were redirected, and flag the
      // known error-shell markers. These are hints, not verdicts — the agent
      // decides, but it can no longer be fooled silently.
      const finalUrl = res.url || url;
      let redirected = false;
      try {
        redirected = new URL(finalUrl).href !== new URL(url).href;
      } catch {
        redirected = finalUrl !== url;
      }
      const crossHost = (() => {
        try {
          return new URL(finalUrl).host !== new URL(url).host;
        } catch {
          return false;
        }
      })();

      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim().slice(0, 200);
      const shellMarkers: string[] = [];
      if (/__next_error__/.test(text)) shellMarkers.push('__next_error__');
      if (title && /\b(not found|page not found|404)\b/i.test(title)) {
        shellMarkers.push(`title="${title}"`);
      }
      if (plain.length < 200) shellMarkers.push(`only ${plain.length} chars of text`);

      return {
        url,
        finalUrl,
        redirected,
        crossHostRedirect: crossHost,
        status: res.status,
        contentType: res.headers.get('content-type') ?? undefined,
        title,
        text: cut ? plain.slice(0, WEB_FETCH_MAX_CHARS) : plain,
        truncated: truncated || cut,
        truncatedReason: cut
          ? `text truncated at ${WEB_FETCH_MAX_CHARS} characters`
          : truncated
            ? `body truncated at ${WEB_FETCH_MAX_BYTES} bytes`
            : undefined,
        bytes,
        // Present ONLY when something looks wrong despite a 2xx.
        suspectedErrorShell: shellMarkers.length > 0 ? shellMarkers : undefined,
        suspectedErrorShellHint:
          shellMarkers.length > 0
            ? 'This looks like an error/placeholder page despite the HTTP status. Treat the content as unreliable and try a variant URL instead of citing it.'
            : undefined,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  });

  // ---- web_search ----------------------------------------------------------
  registerToolHandler('web_search', async (args) => {
    const { query, count } = args as { query?: string; count?: number };
    const apiKey = process.env.DMRX_SEARCH_API_KEY;
    if (!apiKey) {
      return { error: 'web_search unavailable: DMRX_SEARCH_API_KEY not configured' };
    }
    if (!query || typeof query !== 'string') {
      return { error: 'query is required' };
    }
    const provider = (process.env.DMRX_SEARCH_PROVIDER || 'brave').toLowerCase();
    if (provider !== 'brave') {
      return { error: `web_search unavailable: unsupported provider '${provider}' (supported: brave)` };
    }

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(Math.max(Math.trunc(count ?? 5), 1), 20)));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      // Same SSRF treatment as web_fetch: validate the endpoint, pin the
      // connection to the validated IP, and re-validate any redirect hop.
      let res: Response | null;
      try {
        res = await fetchValidated(url.toString(), controller.signal);
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
      if (!res) {
        return { error: `Too many redirects (max ${WEB_FETCH_MAX_REDIRECTS})` };
      }
      const { text, truncated, bytes } = await readBodyCapped(res);
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON response — leave results empty; rawText below still surfaces
        // the API's own message instead of fabricating results.
      }
      const raw = parsed?.web?.results ?? parsed?.results ?? parsed?.items;
      const results: Array<{ title: string; url: string; snippet: string }> = Array.isArray(raw)
        ? raw.slice(0, 10).map((r: any) => ({
            title: String(r.title ?? r.name ?? ''),
            url: String(r.url ?? r.link ?? ''),
            snippet: String(r.description ?? r.snippet ?? r.content ?? ''),
          }))
        : [];
      return {
        query,
        provider,
        results,
        total: results.length,
        truncated,
        rawText: results.length === 0 && text ? text.slice(0, WEB_FETCH_MAX_CHARS) : undefined,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  });

  registerToolDefinition('read_file', {
    description: 'Read a text file from the agent sandbox, optionally a slice of lines. Returns content with line offsets.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file.' },
        offset: { type: 'number', description: '1-based start line (default 1).' },
        limit: { type: 'number', description: 'Max number of lines to return.' },
      },
      required: ['path'],
    },
  });
  registerToolDefinition('write_file', {
    description: 'Write content to a file in the agent sandbox, creating parent directories as needed. Overwrites existing files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  });
  registerToolDefinition('edit_file', {
    description: 'Replace the first exact occurrence of a string in a file. The oldString must be unique within the file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file.' },
        oldString: { type: 'string', description: 'Exact text to find.' },
        newString: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'oldString', 'newString'],
    },
  });
  registerToolDefinition('list_files', {
    description: 'List files under a directory in the agent sandbox. Optionally filter by name and recurse.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to list (default ".").' },
        pattern: { type: 'string', description: 'Optional substring filter on file names.' },
        recursive: { type: 'boolean', description: 'Recurse into subdirectories.' },
      },
    },
  });
  registerToolDefinition('bash', {
    description: 'Run a shell command from an allowlisted set of executables (git, node, python, ls, etc.) in the agent sandbox. Returns stdout/stderr/exitCode.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run (allowlisted binaries only).' },
        timeoutMs: { type: 'number', description: 'Optional timeout in ms (default 30000).' },
        cwd: { type: 'string', description: 'Optional working directory relative to the sandbox.' },
      },
      required: ['command'],
    },
  });
  registerToolDefinition('search_files', {
    description: 'Search file contents for a substring across the agent sandbox. Returns matching file/line/text.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Substring to search for.' },
        path: { type: 'string', description: 'Directory to search (default ".").' },
        include: { type: 'string', description: 'Optional file-name filter.' },
      },
      required: ['pattern'],
    },
  });
  registerToolDefinition('web_fetch', {
    description:
      'Fetch a URL and return its readable text (HTML stripped to plain text, capped at 20k chars). ' +
      'SSRF-protected: private/loopback/link-local hosts and redirects to them are refused. ' +
      'Returns status, finalUrl, redirected, crossHostRedirect, title and bytes. ' +
      'IMPORTANT: a 200 does NOT mean the page exists — dead doc URLs often 302 to another host and ' +
      'serve an error shell with a plausible title. Check finalUrl and suspectedErrorShell; when it is ' +
      'set, do NOT cite the content, try a variant URL instead. If you do not know the exact URL, ' +
      'guess the canonical one and fetch it (see the url-hunting-recovery skill) — do not fetch a ' +
      "search engine's results page, it returns no usable links.",
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
      },
      required: ['url'],
    },
  });
  registerToolDefinition('web_search', {
    description: 'Search the web via a search API (requires DMRX_SEARCH_API_KEY). Returns ranked results with title/url/snippet.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        count: { type: 'number', description: 'Max results (default 5, max 20).' },
      },
      required: ['query'],
    },
  });

  logger.info('Registered coding tool handlers: read_file, write_file, edit_file, list_files, bash, search_files, web_fetch, web_search');
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// POST /v1/tools/execute
const ToolExecuteRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema).min(1),
  tools: z.array(ToolSchema).min(1),
  tool_choice: z.any().optional(),
  tool_call: ToolCallSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional().default(false),
});

// POST /v1/tools/loop
const ToolLoopRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema).min(1),
  tools: z.array(ToolSchema).min(1),
  tool_choice: z.any().optional(),
  max_steps: z.number().int().positive().max(50).optional().default(10),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Helper: convert to UnifiedRequest
// ---------------------------------------------------------------------------

function toUnifiedRequest(
  body: {
    model: string;
    messages: unknown[];
    tools?: unknown[];
    tool_choice?: unknown;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
  },
  requestId: string,
  tenant?: { id: string; name: string },
): UnifiedRequest {
  return {
    modality: 'llm',
    model: body.model,
    messages: body.messages as any,
    tools: body.tools as any,
    tool_choice: body.tool_choice as any,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    stream: body.stream ?? false,
    metadata: { requestId, tenant },
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function toolsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /v1/tools
   *
   * Returns the combined tool catalog: SDK handlers (13 native tools)
   * plus MCP-aggregated tools (50+ from services/mcp-server). Cached
   * for 60s, proxies MCP server when available.
   *
   * Response format (OpenAI-compatible):
   * {
   *   "tools": [
   *     { "type": "function", "function": { "name": "...", "description": "...", "parameters": {...} }, "source": "sdk|mcp" },
   *     ...
   *   ],
   *   "total": 63,
   *   "source": "live|mcp-down",
   *   "cached_at": 1786963464000
   * }
   *
   * The Gemini and Anthropic converters can both derive their native tool
   * format from this — OpenAI uses it directly, Gemini maps function_declarations,
   * Anthropic maps to their tool schema.
   */
  server.get('/tools', async () => {
    const catalog = await fetchToolCatalog();
    return {
      tools: catalog.tools,
      total: catalog.tools.length,
      source: catalog.source,
      cached_at: catalog.ts,
    };
  });

  /**
   * GET /tools/sdk
   *
   * Returns only the SDK (native) tools — no MCP dependency.
   */
  server.get('/tools/sdk', async () => {
    const defs = getRegisteredToolDefinitions();
    const tools = defs.map((t) => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
      source: 'sdk' as const,
    }));
    return { tools, total: tools.length };
  });

  /**
   * GET /v1/tools/mcp
   *
   * Returns only the MCP-aggregated tools.
   */
  server.get('/tools/mcp', async () => {
    const catalog = await fetchToolCatalog();
    const tools = catalog.tools.filter((t: any) => t.source === 'mcp' || t.source === 'external');
    return { tools, total: tools.length, source: catalog.source };
  });

  /**
   * POST /tools/execute
   *
   * Executes a single tool call. Two modes:
   * 1. With tool_call: Executes the specific tool call against registered handlers.
   * 2. Without tool_call: Sends request to the model via the router, which may
   *    return tool_calls. If it does, executes them via registered handlers.
   *
   * Returns the model message and any tool execution results.
   * Supports streaming via SSE.
   */
  server.post('/tools/execute', async (request, reply) => {
    const parsed = ToolExecuteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const tenant = (request as any).tenant;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    // Mode 1: Direct tool call execution
    if (body.tool_call) {
      const toolCall = body.tool_call;
      const handler = toolHandlers.get(toolCall.function.name);

      if (!handler) {
        reply.status(404);
        (server as any).recordTelemetryEvent?.({
          level: 'warning',
          service: 'gateway',
          message: `No handler registered for tool "${toolCall.function.name}"`,
          metadata: {
            path: request.url,
            tool: toolCall.function.name,
            requestId,
          },
        });
        return {
          error: {
            message: `No handler registered for tool "${toolCall.function.name}"`,
            type: 'tool_not_found',
            code: 'tool_not_found',
          },
        };
      }

      try {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await handler(args, { requestId, tenant });
        return {
          id: requestId,
          object: 'tool.result',
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          result,
        };
      } catch (error) {
        logger.error({ err: error, requestId, tool: toolCall.function.name }, 'Tool execution failed');
        (server as any).recordTelemetryEvent?.({
          level: 'error',
          service: 'gateway',
          message: error instanceof Error ? error.message : 'Tool execution failed',
          metadata: {
            path: request.url,
            tool: toolCall.function.name,
            requestId,
          },
        });
        reply.status(500);
        return {
          id: requestId,
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          error: { message: 'Tool execution failed' },
        };
      }
    }

    // Mode 2: Model request with tool support
    const unifiedRequest = toUnifiedRequest(body, requestId, tenant);

    const { response } = await router.route(unifiedRequest, {
      path: '/v1/tools/execute',
      qualityTarget,
    });

    // Check if the model returned tool_calls
    const toolCalls = response.message?.tool_calls ?? [];
    const toolResults: Array<{
      tool_call_id: string;
      tool_name: string;
      result: unknown;
      error?: { message: string };
    }> = [];

    if (toolCalls.length > 0) {
      // Execute tool calls using SDK executor
      const executionPromises = toolCalls.map((tc: ToolCall) =>
        executeToolCall(tc, { requestId, tenant }),
      );

      const settled = await Promise.allSettled(executionPromises);
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          toolResults.push(s.value);
        } else {
          logger.error({ err: s.reason, requestId }, 'Tool execution rejected');
          toolResults.push({
            tool_call_id: 'unknown',
            tool_name: 'unknown',
            result: null,
            error: { message: 'Tool execution failed' },
          });
        }
      }
    }

    if (body.stream) {
      // Streaming response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // Stream the model response
      writeSSE(reply, 'message', {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: response.modelId,
        choices: [
          {
            index: 0,
            message: response.message,
            finish_reason: response.finishReason,
          },
        ],
        usage: response.usage,
      });

      // Stream tool results if any
      if (toolResults.length > 0) {
        writeSSE(reply, 'tool_results', {
          id: requestId,
          object: 'tool.results',
          results: toolResults,
        });
      }

      writeSSE(reply, 'done', '[DONE]');
      reply.raw.end();
      return reply;
    }

    // Non-streaming response
    return {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.modelId,
      choices: [
        {
          index: 0,
          message: response.message,
          finish_reason: response.finishReason,
        },
      ],
      usage: response.usage,
      tool_results: toolResults.length > 0 ? toolResults : undefined,
    };
  });

  /**
   * POST /tools/loop
   *
   * Runs a multi-turn tool execution loop:
   *   request -> extract tool calls -> execute -> send results -> repeat
   *
   * The loop continues until:
   * - The model stops calling tools
   * - max_steps is reached
   * - All tool calls have no registered handlers
   *
   * Supports streaming via SSE with tool_execution events for each step.
   */
  server.post('/tools/loop', async (request, reply) => {
    const parsed = ToolLoopRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const tenant = (request as any).tenant;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);
    const maxSteps = body.max_steps;

    // Build message history that we'll accumulate across turns
    const messages = [...body.messages] as any[];
    const allToolResults: Array<{
      step: number;
      tool_calls: any[];
      results: any[];
    }> = [];

    if (body.stream) {
      // Streaming response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        for (let step = 0; step < maxSteps; step++) {
          const unifiedRequest = toUnifiedRequest(
            { ...body, messages, stream: false },
            requestId,
            tenant,
          );

          const { response } = await router.route(unifiedRequest, {
            path: '/v1/tools/loop',
            qualityTarget,
          });

          const toolCalls = response.message?.tool_calls ?? [];

          // Stream the model response for this step
          writeSSE(reply, 'step', {
            step,
            object: 'chat.completion',
            id: requestId,
            created: Math.floor(Date.now() / 1000),
            model: response.modelId,
            choices: [
              {
                index: 0,
                message: response.message,
                finish_reason: response.finishReason,
              },
            ],
            usage: response.usage,
          });

          // If no tool calls, we're done
          if (toolCalls.length === 0) {
            break;
          }

          // Execute tool calls using SDK executor
          const executionPromises = toolCalls.map((tc: ToolCall) =>
            executeToolCall(tc, { requestId, tenant }),
          );
          const settled = await Promise.allSettled(executionPromises);
          const stepResults = settled
            .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof executeToolCall>>> => s.status === 'fulfilled')
            .map((s) => s.value);

          allToolResults.push({ step, tool_calls: toolCalls, results: stepResults });

          // Log tool execution errors
          const errorResults = stepResults.filter(r => r.error);
          if (errorResults.length > 0) {
            logger.warn({ count: errorResults.length, total: stepResults.length }, 'Some tool executions had errors');
          }

          // Stream tool execution results
          writeSSE(reply, 'tool_results', {
            step,
            results: stepResults,
          });

          // Build tool result messages for the next turn
          const assistantMessage = { ...response.message };
          messages.push(assistantMessage);

          for (const tr of stepResults) {
            messages.push({
              role: 'tool',
              tool_call_id: tr.tool_call_id,
              content: tr.error
                ? JSON.stringify({ error: tr.error.message })
                : JSON.stringify(tr.result),
            });
          }
        }
      } catch (error) {
        logger.error({ err: error, requestId }, 'Agentic streaming error');
        (server as any).recordTelemetryEvent?.({
          level: 'error',
          service: 'gateway',
          message: error instanceof Error ? error.message : 'Tools loop streaming error',
          trace_id: requestId,
          metadata: {
            path: request.url,
            model: body.model,
            requestId,
          },
        });
        writeSSE(reply, 'error', { error: { message: 'Stream failed' } });
      }

      writeSSE(reply, 'done', '[DONE]');
      reply.raw.end();
      return reply;
    }

    // Non-streaming response
    for (let step = 0; step < maxSteps; step++) {
        const unifiedRequest = toUnifiedRequest(
          { ...body, messages, stream: false },
          requestId,
          tenant,
        );

        const { response } = await router.route(unifiedRequest, {
          path: '/v1/tools/loop',
          qualityTarget,
        });

        const toolCalls = response.message?.tool_calls ?? [];

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          return {
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: response.modelId,
            choices: [
              {
                index: 0,
                message: response.message,
                finish_reason: response.finishReason,
              },
            ],
            usage: response.usage,
            steps_completed: step + 1,
            all_tool_results: allToolResults,
          };
        }

        // Execute tool calls using SDK executor
        const executionPromises = toolCalls.map((tc: ToolCall) =>
          executeToolCall(tc, { requestId, tenant }),
        );
        const settled = await Promise.allSettled(executionPromises);
        const stepResults = settled
          .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof executeToolCall>>> => s.status === 'fulfilled')
          .map((s) => s.value);

        allToolResults.push({ step, tool_calls: toolCalls, results: stepResults });

        // Log tool execution errors using SDK orchestrator helpers
        const nonStreamingErrors = stepResults.filter(r => r.error);
        if (nonStreamingErrors.length > 0) {
          logger.warn({ count: nonStreamingErrors.length, total: stepResults.length }, 'Some tool executions had errors');
        }

        // Build tool result messages for the next turn
        const assistantMessage = { ...response.message };
        messages.push(assistantMessage);

        for (const tr of stepResults) {
          messages.push({
            role: 'tool',
            tool_call_id: tr.tool_call_id,
            content: tr.error
              ? JSON.stringify({ error: tr.error.message })
              : JSON.stringify(tr.result),
          });
        }
      }

      // If we exhausted all steps
      return {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Tool loop reached maximum steps.' },
            finish_reason: 'length',
          },
        ],
        steps_completed: maxSteps,
        all_tool_results: allToolResults,
      };
  });
}
