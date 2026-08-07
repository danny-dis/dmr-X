import { randomUUID } from 'node:crypto';
import { jobStore, type CreateTaskInput, type Job, type JobTask } from './job.store.js';
import { findCycles, findMissingDependencies } from './job-scheduler.js';

// ---------------------------------------------------------------------------
// Job planner
//
// The pure, testable core of turning a job brief ("build me a 2D platformer
// game") into a task graph: building the planning prompt that asks a model
// to decompose the brief, and parsing + validating whatever the model
// returns. The actual LLM call happens elsewhere and is NOT this module's
// concern — this module never makes a network call, never touches an LLM
// client, and is free of side effects except for `materializePlan`, which
// persists an already-validated plan through JobStore.
//
// A plan here is a list of `PlannedTask`s joined by plan-LOCAL `ref` labels
// (t1, t2, ...) that the model invents. Those refs are not database ids.
// Only after `validatePlan` reports a clean bill does `materializePlan` map
// each ref onto a freshly generated database id — that mapping is the whole
// point of persisting a plan.
//
// Mirrors the conventions of job-scheduler.ts / job-board.ts: pure functions
// over plain data, defensive parsing that never throws, deterministic
// ordering, and inputs never mutated.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** An agent instance the model may pick from when planning. */
export interface AgentSummary {
  instanceId: string;
  name: string;
  description?: string;
  category?: string;
}

/** A single task in a model-produced plan, keyed by a plan-local ref. */
export interface PlannedTask {
  ref: string; // plan-local identifier the LLM invents, e.g. 't1'
  title: string;
  description: string;
  deliverable?: string;
  acceptance?: string;
  dependsOn: string[]; // refs of other PlannedTasks, NOT database ids
  suggestedAgent?: string; // an instanceId from the provided AgentSummary list
}

/** Result of parsing a model response: either a plan or a precise error. */
export type PlanParseResult =
  | { ok: true; tasks: PlannedTask[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the instruction text that asks a model to decompose `job.brief` into
 * a dependency-ordered plan of tasks. Lists the available agents so the
 * model can pick one per task, and demands a single JSON object of shape
 * `{ "tasks": [...] }` with the PlannedTask fields. When `agents` is empty,
 * the prompt says so explicitly and instructs that `suggestedAgent` be
 * omitted from every task.
 */
export function buildPlanPrompt(job: Job, agents: AgentSummary[]): string {
  const lines: string[] = [];
  lines.push(
    'You are the planning stage of a multi-agent system. Decompose the job brief into a ' +
      'dependency-ordered plan of tasks, and assign each task to the best available agent.',
  );
  lines.push('');

  lines.push('JOB BRIEF');
  lines.push(`<<<${job.brief}>>>`);
  lines.push('');

  if (agents.length === 0) {
    lines.push('AVAILABLE AGENTS');
    lines.push('None. Do not assign agents: omit the "suggestedAgent" field from every task.');
  } else {
    lines.push('AVAILABLE AGENTS (set "suggestedAgent" to one of these instanceIds)');
    for (const agent of agents) {
      const bits = [agent.name];
      if (agent.description && agent.description !== '') bits.push(agent.description);
      if (agent.category && agent.category !== '') bits.push(`category: ${agent.category}`);
      lines.push(`- instanceId: ${agent.instanceId} | ${bits.join(' | ')}`);
    }
  }
  lines.push('');

  lines.push('RESPONSE FORMAT');
  lines.push(
    'Return exactly one JSON object. No prose, no explanations, no markdown fences, no code ' +
      'blocks, no trailing text. The object must have this shape:',
  );
  lines.push('');
  lines.push('{ "tasks": [');
  lines.push(
    '  { "ref": "t1", "title": "...", "description": "...", "deliverable": "...", ' +
      '"acceptance": "...", "dependsOn": ["t0"], "suggestedAgent": "..." }',
  );
  lines.push('] }');
  lines.push('');

  lines.push('FIELD SEMANTICS');
  lines.push('- ref: a plan-local identifier you invent (e.g. "t1", "t2"). It is NOT a database id and must be unique within this response.');
  lines.push('- title: short, imperative description of the task.');
  lines.push('- description: what to do and why.');
  lines.push('- deliverable (optional): the artifact this task produces.');
  lines.push('- acceptance (optional): the definition of done.');
  lines.push('- dependsOn: array of "ref" values of tasks that must finish first. It must reference only "ref" values defined in this same response. Omit it (or use []) when the task has no dependencies.');
  lines.push('- suggestedAgent: the instanceId of the agent that should run this task. It must come from the AVAILABLE AGENTS list, or be omitted.');
  if (agents.length === 0) {
    lines.push('- No agents are available, so every task must omit "suggestedAgent".');
  }
  lines.push('');
  lines.push('RULES');
  lines.push('- Every task needs a non-empty "ref" and "title".');
  lines.push('- Do not invent agents: "suggestedAgent" must be an instanceId listed above, or be omitted.');
  lines.push('- Respond with the JSON only.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parsing model output
// ---------------------------------------------------------------------------

// A markdown fenced block, with or without a language tag (e.g. ```json).
// `[^\r\n]*` absorbs the tag and any text up to the end of the opening line,
// so both ```json\n{...} and ```json {..} forms are captured.
const FENCE_RE = /```[^\r\n]*\r?\n?([\s\S]*?)```/g;

// Sentinel distinguishing "parse failed" from any legal JSON value.
const PARSE_FAIL: unique symbol = Symbol('parse-fail');

/**
 * Parse a model response into tasks. Robust by design — real models ignore
 * formatting instructions constantly — so this accepts:
 *   - clean JSON:                          {"tasks":[...]}
 *   - JSON in a markdown fence, with or without a json language tag
 *   - JSON with prose before and/or after  (the outermost balanced {...}
 *     object is extracted)
 *   - a bare top-level array of tasks
 * Returns `{ ok: false, error }` for anything unparseable or malformed.
 * NEVER throws on any input: empty string, null-ish text, deeply nested
 * junk, or a multi-megabyte blob all funnel into the same guarded path.
 */
export function parsePlanResponse(raw: string): PlanParseResult {
  try {
    // The signature says string, but callers are sloppy; guard anyway. The
    // rest of this function must never rely on the input being sane.
    const text = raw == null ? '' : String(raw).trim();

    const decoded = decodeJson(text);
    if (decoded === undefined) {
      return { ok: false, error: 'response did not contain parseable JSON' };
    }

    // Accept either { "tasks": [...] } or a bare array of task objects.
    const tasksValue: unknown = Array.isArray(decoded)
      ? decoded
      : isRecord(decoded)
        ? decoded.tasks
        : undefined;

    if (tasksValue === undefined) {
      return {
        ok: false,
        error: `expected a JSON object with a "tasks" array, got ${describe(decoded)}`,
      };
    }
    if (!Array.isArray(tasksValue)) {
      return { ok: false, error: `"tasks" must be an array of tasks, got ${describe(tasksValue)}` };
    }
    if (tasksValue.length === 0) {
      return { ok: false, error: '"tasks" must contain at least one task' };
    }

    const tasks: PlannedTask[] = [];
    const seenRefs = new Map<string, number>();
    for (let index = 0; index < tasksValue.length; index++) {
      const item = tasksValue[index];
      const where = `tasks[${index}]`;
      if (!isRecord(item)) {
        return { ok: false, error: `${where} is not an object` };
      }

      const ref = typeof item.ref === 'string' ? item.ref.trim() : '';
      if (ref === '') {
        return { ok: false, error: `${where} is missing a non-empty string "ref"` };
      }
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (title === '') {
        return { ok: false, error: `${where} (ref "${ref}") is missing a non-empty string "title"` };
      }
      const prior = seenRefs.get(ref);
      if (prior !== undefined) {
        return {
          ok: false,
          error: `duplicate task ref "${ref}" (tasks[${prior}] and ${where})`,
        };
      }
      seenRefs.set(ref, index);

      const dependsOn = coerceDependsOn(item.dependsOn);
      if (dependsOn === null) {
        return {
          ok: false,
          error: `${where} (ref "${ref}") "dependsOn" must be an array of strings`,
        };
      }

      // Only the known fields are copied out; unknown junk fields are
      // dropped rather than passed through.
      tasks.push({
        ref,
        title,
        description: toOptionalString(item.description) ?? '',
        deliverable: toOptionalString(item.deliverable),
        acceptance: toOptionalString(item.acceptance),
        dependsOn,
        suggestedAgent: toOptionalString(item.suggestedAgent),
      });
    }

    return { ok: true, tasks };
  } catch (err) {
    // Last-resort backstop. Nothing above should throw, but the contract is
    // absolute: this function never throws.
    return { ok: false, error: `failed to parse plan response: ${errorMessage(err)}` };
  }
}

/**
 * Best-effort decode of a model response into a JSON value, or undefined.
 * Tries, in order: the whole trimmed text, the content of each markdown
 * fenced block, then every outermost balanced {...} object found in the
 * text (and in each fence). When several balanced objects parse, one that
 * looks like the requested shape (`{ tasks: [...] }`) wins over the first
 * that parses at all.
 */
function decodeJson(text: string): unknown {
  if (text === '') return undefined;

  // 1. The whole (trimmed) response may already be the JSON.
  const direct = tryParseJson(text);
  if (direct !== PARSE_FAIL) return direct;

  // 2. JSON inside markdown fenced blocks.
  for (const content of fencedBlocks(text)) {
    const parsed = tryParseJson(content);
    if (parsed !== PARSE_FAIL) return parsed;
  }

  // 3. The outermost balanced {...} object, with prose before and/or after.
  const candidates = balancedObjects(text);
  for (const content of fencedBlocks(text)) {
    candidates.push(...balancedObjects(content));
  }
  let firstParsed: unknown = PARSE_FAIL;
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed === PARSE_FAIL) continue;
    if (firstParsed === PARSE_FAIL) firstParsed = parsed;
    if (isRecord(parsed) && Array.isArray(parsed.tasks)) return parsed;
  }
  return firstParsed === PARSE_FAIL ? undefined : firstParsed;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return PARSE_FAIL;
  }
}

function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const match of text.matchAll(FENCE_RE)) {
    const content = match[1];
    if (content !== undefined && content.trim() !== '') blocks.push(content);
  }
  return blocks;
}

/**
 * Collect every OUTERMOST balanced `{...}` substring in `text`, in order of
 * appearance. Braces inside quoted spans are ignored so JSON string values
 * like `{"a":"}"}` are not mis-cut. Purely iterative — no recursion — so a
 * megabyte of junk cannot blow the stack.
 */
function balancedObjects(text: string): string[] {
  const objects: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const end = matchBalanced(text, i);
    if (end === -1) continue;
    objects.push(text.slice(i, end + 1));
    i = end; // skip past the whole object; inner braces are not separate candidates
  }
  return objects;
}

/**
 * Index of the `}` closing the `{` at `openIndex`, or -1 when unbalanced.
 * Quotes are skipped so braces inside JSON strings do not affect depth.
 */
function matchBalanced(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '"') {
      i = skipQuoted(text, i);
      continue;
    }
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index just past the `"` that closes the quoted span starting at `start`. */
function skipQuoted(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i += 1; // skip the escaped character
    } else if (text[i] === '"') {
      return i + 1;
    }
  }
  return text.length;
}

/**
 * Normalize a task's `dependsOn` field: absent -> [] (default); an array ->
 * kept as strings (non-string junk entries dropped, matching the coercion
 * convention in job-board.ts), trimmed, empty entries removed; anything else
 * -> null, meaning "reject".
 */
function coerceDependsOn(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const deps: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const dep = entry.trim();
    if (dep !== '') deps.push(dep);
  }
  return deps;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Short, content-free description of a value for error messages. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length} item(s)`;
  switch (typeof value) {
    case 'string':
      return `a string (${value.length} chars)`;
    case 'object':
      return 'an object';
    default:
      return typeof value;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message !== '') return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a parsed plan. Returns a list of human-readable problems — empty
 * when the plan is sound. Detects dangling `dependsOn` refs and dependency
 * cycles (including a task depending on itself) by REUSING
 * `findMissingDependencies` and `findCycles` from job-scheduler.ts on a
 * throwaway JobTask-shaped view of the plan; the graph algorithms are never
 * reimplemented here.
 */
export function validatePlan(tasks: PlannedTask[]): string[] {
  const problems: string[] = [];

  if (tasks.length === 0) {
    problems.push('plan has no tasks');
    return problems;
  }

  // Duplicate refs would collapse onto one database id in materializePlan,
  // so they are rejected here even though parsePlanResponse already filters
  // them out of model output.
  const seenRefs = new Set<string>();
  for (const task of tasks) {
    if (task.ref === '') {
      problems.push('plan contains a task with an empty ref');
    } else if (seenRefs.has(task.ref)) {
      problems.push(`duplicate task ref "${task.ref}"`);
    }
    seenRefs.add(task.ref);
  }

  const graphTasks = tasks.map(toGraphTask);

  for (const miss of findMissingDependencies(graphTasks)) {
    problems.push(`task "${miss.taskId}" depends on missing ref(s): ${miss.missing.join(', ')}`);
  }
  for (const cycle of findCycles(graphTasks)) {
    problems.push(
      cycle.length === 1
        ? `task "${cycle[0]}" depends on itself`
        : `dependency cycle: ${cycle.join(' -> ')}`,
    );
  }

  return problems;
}

/**
 * The minimal JobTask-shaped view of a PlannedTask the scheduler's pure
 * graph functions read (id, seq, dependsOn). A full, typed JobTask is built
 * so no casts are needed; only the fields findCycles / findMissingDependencies
 * touch carry real data.
 */
function toGraphTask(task: PlannedTask, index: number): JobTask {
  return {
    id: task.ref,
    jobId: '',
    seq: index + 1,
    title: task.title,
    description: null,
    deliverable: null,
    acceptance: null,
    assignedAgentDefId: null,
    assignedAgentVersion: null,
    assignedInstanceId: null,
    sessionId: null,
    assignedModel: null,
    status: 'pending',
    dependsOn: task.dependsOn,
    attempt: 0,
    output: null,
    createdAt: '',
    updatedAt: '',
  };
}

// ---------------------------------------------------------------------------
// Materialization (persisting a validated plan)
// ---------------------------------------------------------------------------

/**
 * Persist a validated plan as real `job_tasks` rows and return them in plan
 * order. `validatePlan` runs first and an Error listing every problem is
 * thrown if the plan is invalid — a broken plan is never written. Each task
 * gets a fresh database id (`crypto.randomUUID()`), `seq` assigned in plan
 * order starting at 1, and `dependsOn` translated from plan refs into the
 * generated database ids — that ref -> id mapping is the whole point, and it
 * is built up front so every task's dependencies resolve before any row is
 * inserted. `suggestedAgent` becomes `assignedInstanceId`. `tenantId` is
 * part of the public contract so callers stay tenant-scoped; persistence
 * itself needs only `jobId` (JobStore scopes reads by tenant on lookup).
 */
export function materializePlan(
  tenantId: string,
  jobId: string,
  tasks: PlannedTask[],
): JobTask[] {
  const problems = validatePlan(tasks);
  if (problems.length > 0) {
    throw new Error(`cannot materialize invalid plan: ${problems.join('; ')}`);
  }

  // Plan refs -> real database ids. All refs are known here because
  // validatePlan above rejected any dangling dependency.
  const refToId = new Map<string, string>();
  for (const task of tasks) {
    refToId.set(task.ref, randomUUID());
  }

  const created: JobTask[] = [];
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];

    const id = refToId.get(task.ref);
    if (id === undefined) {
      // Unreachable after validatePlan (every ref was declared above). Guard
      // anyway — never write a plan with a task that has no id.
      throw new Error(`cannot materialize plan: task ref "${task.ref}" has no generated id`);
    }

    const input: CreateTaskInput = {
      id,
      jobId,
      seq: index + 1,
      title: task.title,
      description: task.description === '' ? null : task.description,
      deliverable: task.deliverable ?? null,
      acceptance: task.acceptance ?? null,
      assignedInstanceId: task.suggestedAgent ?? null,
      dependsOn: task.dependsOn.map((ref) => {
        const depId = refToId.get(ref);
        if (depId === undefined) {
          // Also unreachable after validatePlan; guards against ever writing
          // a half-mapped dependency list.
          throw new Error(
            `cannot materialize plan: task "${task.ref}" depends on unknown ref "${ref}"`,
          );
        }
        return depId;
      }),
    };

    created.push(jobStore.createTask(input));
  }

  return created;
}
