/**
 * Shared agent admission / tool-catalog helper.
 *
 * Single home for the P1 admission semantics shared by the agent chat and
 * agent dispatch routes:
 * - policy-authorized model overrides (caller `body.model` is honored only
 *   when it matches the agent policy default or the definition preferredModel;
 *   anything else fails closed with 403 instead of routing spend the tenant
 *   never approved);
 * - finite server-side token/step caps independent of client input;
 * - required-vs-optional tool catalog resolution (missing required tools fail
 *   closed; missing optional tools resolve to the subset);
 * - single-preflight admission with an ATOMIC reserve-before-run hold
 *   (`reserveAgentRun` once; release on failure, reconcile measured actuals
 *   on success — never `reserveForDispatch` + `checkQuota` double counting,
 *   never no-reservation oversubscribe);
 * - strict unknown-pricing fail-closed (an unpriced run admits ONLY with
 *   resolved zero-price pricing or router evidence of a free-only alias
 *   resolution; a paid run without a quota service never executes; free
 *   runs pass including quota-less fixtures);
 * - one usage normalizer emitting actual prompt/completion splits so execution
 *   records never store (total, 0) again.
 *
 * Pure and dependency-free on purpose: routes inject their live quota/billing
 * boundaries, tests inject fakes.
 *
 * Exception: {@link markAdmittedAgentRequest} imports the router's trusted
 * external-accounting marker (the symbol it writes must be the SAME
 * module-private symbol the router's inference lease reads — a local copy
 * would be inert by construction).
 */
import type { UnifiedRequest } from '@dmr-x/core';
import { markTrustedExternalAccounting } from '@dmr-x/router';

export interface AgentModelPolicy {
  preferredModel?: string | null;
  modelTier?: string | null;
}

export interface AgentPricing {
  providerId: string;
  modelId: string;
  /** USD per 1k tokens (NOT cents): estimate math multiplies by 100 for cents. */
  inputPricePer1kTokens: number;
  /** USD per 1k tokens (NOT cents): estimate math multiplies by 100 for cents. */
  outputPricePer1kTokens: number;
}

export interface AgentToolDef {
  type: string;
  function: { name: string; [k: string]: unknown };
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return fallback;
}

/** Finite server-side cap on agent loop turns, independent of client input. */
export const AGENT_SERVER_MAX_STEPS = envPositiveInt('DMRX_AGENT_MAX_STEPS', 10);

/** Finite server-side ceiling on per-turn max tokens. */
export const AGENT_SERVER_MAX_TOKENS = envPositiveInt('DMRX_AGENT_MAX_TOKENS', 32000);

/** Bounded turn budget for the dispatch run:true path (was MAX_TOOL_ROUNDS). */
export const AGENT_DISPATCH_MAX_STEPS = 6;

/** Provider tool-definition limit preserved from the dispatch path. */
export const AGENT_TOOL_DEF_CAP = 30;

// ---------------------------------------------------------------------------
// Policy-authorized model overrides
// ---------------------------------------------------------------------------

export function resolveAgentModel(
  requested: string | undefined | null,
  definition: AgentModelPolicy,
  resolveDefault: () => string,
): { model: string; error?: string; status?: number } {
  const fallback = resolveDefault();
  const trimmed = (requested ?? '').trim();
  if (!trimmed) return { model: fallback };
  if (trimmed === fallback) return { model: fallback };
  if (definition.preferredModel && trimmed === definition.preferredModel) {
    return { model: trimmed };
  }
  return {
    model: fallback,
    error:
      `model override not authorized by policy: requested "${trimmed}" ` +
      `does not match the agent policy model ("${fallback}")` +
      (definition.preferredModel ? ` or preferredModel ("${definition.preferredModel}")` : ''),
    status: 403,
  };
}

// ---------------------------------------------------------------------------
// Finite server-side caps
// ---------------------------------------------------------------------------

export function clampAgentSteps(requested?: number | null): number {
  const fallback = Math.min(AGENT_SERVER_MAX_STEPS, 50);
  if (requested == null || !Number.isFinite(requested)) return fallback;
  return Math.max(1, Math.min(Math.floor(requested), AGENT_SERVER_MAX_STEPS, 50));
}

export function clampAgentTokens(requested?: number | null): number {
  if (requested == null) return AGENT_SERVER_MAX_TOKENS;
  if (!Number.isFinite(requested)) return AGENT_SERVER_MAX_TOKENS;
  return Math.max(1, Math.min(Math.floor(requested), AGENT_SERVER_MAX_TOKENS));
}

/**
 * Totale run estimate for admission: per-turn token cap x turn budget.
 * A multi-turn run can spend up to `maxSteps` full turns, so admission must
 * hold the whole run — never an arbitrary single-turn constant.
 */
export function estimateAgentRunTokens(perTurnCap: number, maxSteps: number): number {
  const perTurn =
    Number.isFinite(perTurnCap) && perTurnCap > 0 ? Math.floor(perTurnCap) : AGENT_SERVER_MAX_TOKENS;
  const steps = Number.isFinite(maxSteps) && maxSteps > 0 ? Math.floor(maxSteps) : 1;
  return perTurn * steps;
}

/**
 * Conservative whole-run cost estimate in CENTS. Pricing is USD per 1k
 * tokens, so cents = (tokens / 1000) * (in + out USD/1k) * 100. The whole
 * estimate is priced as both prompt and completion (over-estimate) so
 * admission never under-prices a run.
 */
export function estimateAgentCostCents(
  pricing: AgentPricing | null | undefined,
  totalTokens: number,
): number {
  if (!pricing) return 0;
  const per1k = (pricing.inputPricePer1kTokens ?? 0) + (pricing.outputPricePer1kTokens ?? 0);
  if (!(per1k > 0) || !(totalTokens > 0)) return 0;
  return Math.ceil((totalTokens / 1000) * per1k * 100);
}

// ---------------------------------------------------------------------------
// Required-vs-optional tool catalog
// ---------------------------------------------------------------------------

/**
 * Split normalized tool names into required vs optional. The `optional:`
 * prefix (or a trailing `?`) marks a best-effort capability; every other
 * explicitly requested name is required and a missing required tool must fail
 * the invocation closed instead of running with a silently narrowed subset.
 */
export function splitRequiredOptional(names: string[]): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    if (name.toLowerCase().startsWith('optional:')) {
      const inner = name.slice('optional:'.length).trim();
      if (inner && !optional.includes(inner) && !required.includes(inner)) optional.push(inner);
    } else if (name.endsWith('?')) {
      const inner = name.slice(0, -1).trim();
      if (inner && !optional.includes(inner) && !required.includes(inner)) optional.push(inner);
    } else if (!required.includes(name) && !optional.includes(name)) {
      required.push(name);
    }
  }
  return { required, optional };
}

export function resolveAgentToolCatalog(
  requestedNames: string[],
  getDefs: (names?: string[]) => AgentToolDef[],
): {
  defs: AgentToolDef[];
  missing: string[];
  requiredMissing: string[];
  optionalMissing: string[];
  resolved: string[];
} {
  if (!requestedNames || requestedNames.length === 0) {
    const defs = getDefs();
    return {
      defs,
      missing: [],
      requiredMissing: [],
      optionalMissing: [],
      resolved: defs.map((d) => d?.function?.name).filter(Boolean),
    };
  }
  const { required, optional } = splitRequiredOptional(requestedNames);
  const defs = getDefs([...required, ...optional]);
  const resolvedSet = new Set(defs.map((d) => d?.function?.name).filter(Boolean) as string[]);
  const requiredMissing = required.filter((n) => !resolvedSet.has(n));
  const optionalMissing = optional.filter((n) => !resolvedSet.has(n));
  return {
    defs,
    missing: [...requiredMissing, ...optionalMissing],
    requiredMissing,
    optionalMissing,
    resolved: [...resolvedSet],
  };
}

// ---------------------------------------------------------------------------
// Model identity + preflight admission (single preflight, no double reserve)
// ---------------------------------------------------------------------------

export function splitModelId(model: string): { providerId: string | null; modelId: string } {
  const text = String(model ?? '');
  const slash = text.indexOf('/');
  if (slash > 0) {
    return { providerId: text.slice(0, slash), modelId: text.slice(slash + 1) };
  }
  return { providerId: null, modelId: text };
}

export type PreflightResult =
  | { admitted: true; holdId?: string; estimatedCostCents?: number; isFree?: boolean; freeOnly?: boolean }
  | { admitted: false; reason: string; status: number };

export interface AgentQuotaBoundary {
  checkQuota(tenantId: string, providerId: string, tokens: number, costDollars: number): Promise<unknown>;
  reserveAgentRun?(
    tenantId: string,
    providerKey: string,
    estimatedTokens: number,
    estimatedCostCents: number,
    opts?: { requestId?: string; ttlMs?: number; modelId?: string },
  ): Promise<{ ok: boolean; holdId?: string; reason?: string; status?: number }>;
  releaseAgentHold?(holdId: string): Promise<unknown>;
  settleAgentHold?(
    holdId: string,
    actual: { tokens: number; costDollars: number },
    context?: { tenantId: string; providerKey: string; modelId?: string },
  ): Promise<unknown>;
}

/**
 * Mark an ADMITTED agent run's outbound request as trusted external accounting.
 *
 * A run admitted through `reserveAgentRun` already owns a tenant reservation
 * (`holdId`) and reconciles it via `settleAgentRun`. The inference lease the
 * router takes around every dispatch must therefore pass
 * `options.externalAccounting` so the quota core does not debit the tenant a
 * second time for the same inference — the capacity/admission half of the
 * lease still runs normally.
 *
 * Requires a real `holdId`: an admission that reserved nothing (legacy
 * checkQuota-only boundaries) is never granted the marker.
 */
export function markAdmittedAgentRequest(
  request: UnifiedRequest | undefined | null,
  holdId?: string,
): boolean {
  if (!holdId || !request) return false;
  return markTrustedExternalAccounting(request);
}

/**
 * One-call preflight for a model run: pricing lookup, strict free/paid
 * decision, then an ATOMIC reserve-before-run through the quota service.
 *
 * - `estimatedTokens` is the WHOLE-run estimate (per-turn cap x maxSteps).
 * - Bare aliases with no pricing admit ONLY with `resolveAliasFree` router
 *   evidence proving a free-only resolution; otherwise they fail closed
 *   with 402 before any quota boundary is touched.
 * - A paid run with no quota service fails closed (402). A free run with no
 *   quota service admits (quota-less strict-free fixture compatibility).
 * - With a reserving quota service, admission holds the whole-run estimate
 *   atomically and returns `holdId` for release-on-failure / settle-on-success.
 *   Legacy checkQuota-only boundaries get exactly one read-only check.
 */
export async function preflightModelRun(args: {
  model: string;
  estimatedTokens: number;
  maxSteps?: number;
  tenantId: string;
  requestId?: string;
  getPricing: (providerId: string, modelId: string) => Promise<AgentPricing | null>;
  /** Router evidence that a bare alias currently resolves free-only. */
  resolveAliasFree?: () => boolean | Promise<boolean>;
  quotaService?: AgentQuotaBoundary;
  /**
   * The outbound unified request for this run. When supplied AND the
   * reservation produced a `holdId`, it is stamped as trusted external
   * accounting so the router's inference lease does not debit twice.
   */
  request?: UnifiedRequest;
}): Promise<PreflightResult> {
  const { providerId, modelId } = splitModelId(args.model);
  let pricing: AgentPricing | null = null;
  try {
    pricing = providerId ? await args.getPricing(providerId, modelId) : null;
  } catch {
    pricing = null;
  }
  let isFree = isFreeAgentModel(args.model, pricing);
  if (!pricing && !providerId && !isFree && args.resolveAliasFree) {
    try {
      if (await args.resolveAliasFree()) isFree = true;
    } catch {
      /* evidence unavailable — stay fail-closed */
    }
  }
  const estimatedCostCents = estimateAgentCostCents(pricing, args.estimatedTokens);
  if (!pricing && !isFree) {
    return {
      admitted: false,
      reason: 'unknown model pricing for paid run — failing closed (no admission without measurable spend)',
      status: 402,
    };
  }
  if (!args.quotaService) {
    // Quota-less environments admit strict-free runs only (test fixtures,
    // free-only deployments); paid runs fail closed without a budget guard.
    if (isFree) return { admitted: true, estimatedCostCents, isFree, freeOnly: true };
    return {
      admitted: false,
      reason: 'paid run requires a quota service — failing closed (no budget guard available)',
      status: 402,
    };
  }
  const providerKey = providerId ?? 'agent';
  if (args.quotaService.reserveAgentRun) {
    const held = await args.quotaService.reserveAgentRun(
      args.tenantId,
      providerKey,
      args.estimatedTokens,
      estimatedCostCents,
      args.requestId ? { requestId: args.requestId, modelId } : { modelId },
    );
    if (!held.ok) {
      return {
        admitted: false,
        reason: held.reason ?? 'quota/budget admission rejected',
        status: held.status === 402 ? 402 : 429,
      };
    }
    markAdmittedAgentRequest(args.request, held.holdId);
    return { admitted: true, holdId: held.holdId, estimatedCostCents, isFree, freeOnly: isFree };
  }
  try {
    await args.quotaService.checkQuota(
      args.tenantId,
      providerKey,
      args.estimatedTokens,
      estimatedCostCents / 100,
    );
    return { admitted: true, estimatedCostCents, isFree, freeOnly: isFree };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'quota exceeded';
    return {
      admitted: false,
      reason: `quota/budget admission rejected: ${message}`,
      status: 429,
    };
  }
}

/**
 * Router evidence that a bare alias currently resolves free-only.
 * Runs the alias ranker with a `free` cost filter over live candidates:
 * non-empty means the alias admits on a free pool right now (preserves free
 * auto agents); null/empty/unknown alias means no evidence (fail closed).
 * Pure against injected boundaries — routes pass `router.getCandidates` and
 * the router's `resolveMetaModel`; tests pass fakes.
 */
export function aliasFreeEvidence(
  model: string,
  getCandidates: () => unknown,
  resolveMetaModelFn: (alias: string, candidates: unknown, filter: 'free') => { resolved?: unknown[] } | null,
): () => Promise<boolean> {
  return async () => {
    try {
      if (model.includes('/')) return false;
      const candidates = getCandidates() as unknown[];
      if (!candidates || candidates.length === 0) return false;
      const out = resolveMetaModelFn(model, candidates, 'free');
      return !!out && Array.isArray(out.resolved) && out.resolved.length > 0;
    } catch {
      return false;
    }
  };
}

/**
 * Release a preflight hold after a failed run (records nothing).
 * No-op when there is no hold or the boundary cannot release.
 */
export async function releaseAgentHold(
  quotaService: AgentQuotaBoundary | undefined,
  holdId: string | undefined,
): Promise<void> {
  if (!quotaService?.releaseAgentHold || !holdId) return;
  try {
    await quotaService.releaseAgentHold(holdId);
  } catch {
    /* release best-effort; expiry bounds the damage */
  }
}

/**
 * Preflight one agent run through the existing quota boundary exactly once.
 * Unknown paid pricing fails closed BEFORE any quota interaction (402), so a
 * run with unmeasurable spend can never reach a provider. Quota rejection
 * maps to 429. Success performs no reservation itself — settlement happens via
 * the existing `recordUsage` boundary after the run.
 */
export async function preflightAgentAdmission(args: {
  pricing: AgentPricing | null | undefined;
  isFree: boolean;
  estimatedCostCents: number;
  checkQuota: () => Promise<unknown>;
}): Promise<PreflightResult> {
  if (!args.pricing && !args.isFree) {
    return {
      admitted: false,
      reason: 'unknown model pricing for paid run — failing closed (no admission without measurable spend)',
      status: 402,
    };
  }
  try {
    await args.checkQuota();
    return { admitted: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'quota exceeded';
    return {
      admitted: false,
      reason: `quota/budget admission rejected: ${message}`,
      status: 429,
    };
  }
}

// ---------------------------------------------------------------------------
// Usage normalization (actual prompt/completion settlement)
// ---------------------------------------------------------------------------

export function sumLoopUsage(
  allSteps: Array<{ message?: { usage?: Record<string, unknown> } }>,
): { promptTokens: number; completionTokens: number; totalTokens: number; cost: number } {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let cost = 0;
  for (const step of allSteps ?? []) {
    const usage = step?.message?.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    const prompt = Number(usage.prompt_tokens ?? 0) || 0;
    const completion = Number(usage.completion_tokens ?? 0) || 0;
    const total = Number(usage.total_tokens ?? 0) || 0;
    const stepCost = Number((usage as any).cost ?? (usage as any).total_cost ?? 0) || 0;
    promptTokens += prompt;
    completionTokens += completion;
    totalTokens += total > 0 ? total : prompt + completion;
    cost += stepCost;
  }
  return { promptTokens, completionTokens, totalTokens, cost };
}

// ---------------------------------------------------------------------------
// Dispatch -> shared loop input builder
// ---------------------------------------------------------------------------

export function buildDispatchLoopInput(args: {
  task: string;
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemPrompt: string;
  agentToolDefs: AgentToolDef[];
}): {
  messages: Array<{ role: string; content: string }>;
  maxSteps: number;
  agentToolDefs: AgentToolDef[];
} {
  const userMessages =
    args.messages && args.messages.length > 0 ? args.messages : [{ role: 'user' as const, content: args.task }];
  return {
    messages: [{ role: 'system', content: args.systemPrompt }, ...userMessages] as Array<{
      role: string;
      content: string;
    }>,
    maxSteps: AGENT_DISPATCH_MAX_STEPS,
    agentToolDefs: (args.agentToolDefs ?? []).slice(0, AGENT_TOOL_DEF_CAP),
  };
}

// ---------------------------------------------------------------------------
// Route wiring: preflight + settlement through EXISTING boundaries
// ---------------------------------------------------------------------------

/**
 * Free-run evidence for one model. Resolved zero-price pricing is free.
 * Anything else is paid-or-unknown: a bare alias (no provider pin, e.g.
 * `auto`) with no resolvable pricing FAILS CLOSED downstream (the router
 * resolves `auto` through the full paid pool by default, so assuming free
 * admits unmeasurable spend). Callers may supply router evidence
 * (`resolveAliasFree`) proving the alias currently resolves to a free-only
 * pool — that is the only way an unpriced alias admits.
 */
export function isFreeAgentModel(model: string, pricing: AgentPricing | null | undefined): boolean {
  if (pricing) {
    return (pricing.inputPricePer1kTokens ?? 0) <= 0 && (pricing.outputPricePer1kTokens ?? 0) <= 0;
  }
  return false;
}

export interface AgentUsageSums {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Measured run cost in USD (loop `totalCost` / `costUsd` units). */
  cost: number;
}

/**
 * Settle one finished run through the EXISTING usage boundaries with the
 * actual measured prompt/completion split. Durable settlement failures propagate
 * so callers cannot mistake a rolled-back ledger for successful accounting.
 * The legacy no-settlement boundary remains best-effort for compatibility.
 * Returns the sums for the execution record.
 *
 * - Bare-alias runs settle too (provider key `agent`): measured tokens/cost
 *   are never dropped to zero just because the model has no provider pin.
 * - Loop cost is USD: quota `recordUsage` takes dollars (it converts to
 *   cents itself), so no `/100` here.
 * - With a `holdId` and a settling boundary, the hold is reconciled against
 *   the measured actuals exactly once (no estimate + actual double count).
 */
export async function settleAgentRun(args: {
  tenantId: string;
  model: string;
  allSteps: Array<{
    message?: { usage?: Record<string, unknown> };
    /** Provider/model actually returned by the router for this step. */
    providerId?: string;
    modelId?: string;
  }>;
  requestId: string;
  /** Loop-measured sums (preferred). Falls back to normalizing allSteps. */
  sums?: AgentUsageSums;
  /** Preflight hold to reconcile (release happens separately on failure). */
  holdId?: string;
  quotaService?: {
    recordUsage(tenantId: string, providerId: string, tokens: number, costDollars: number): Promise<unknown>;
    settleAgentHold?(
      holdId: string,
      actual: { tokens: number; costDollars: number },
      context?: { tenantId: string; providerKey: string; modelId?: string; promptTokens?: number; completionTokens?: number },
    ): Promise<unknown>;
    releaseAgentHold?(holdId: string): Promise<unknown>;
  };
  billingService?: {
    recordUsage(input: {
      tenantId: string;
      providerId: string;
      modelId: string;
      inputTokens: number;
      outputTokens: number;
      requestId: string;
    }): Promise<unknown>;
  };
}): Promise<AgentUsageSums> {
  const sums = args.sums ?? sumLoopUsage(args.allSteps);
  const { providerId: requestedProviderId, modelId: requestedModelId } = splitModelId(args.model);
  const actualStep = [...(args.allSteps ?? [])]
    .reverse()
    .find((step) => step?.providerId || step?.modelId);
  const providerKey = actualStep?.providerId ?? requestedProviderId ?? 'agent';
  const modelId = actualStep?.modelId ?? requestedModelId;
  if (args.quotaService?.settleAgentHold) {
    await args.quotaService.settleAgentHold(args.holdId ?? args.requestId, {
      tokens: sums.totalTokens, costDollars: sums.cost,
    }, {
      tenantId: args.tenantId, providerKey, modelId,
      promptTokens: sums.promptTokens, completionTokens: sums.completionTokens,
    });
    return sums;
  }
  try {
    if (args.billingService) {
      await args.billingService.recordUsage({
        tenantId: args.tenantId,
        providerId: providerKey,
        modelId,
        inputTokens: sums.promptTokens,
        outputTokens: sums.completionTokens,
        requestId: args.requestId,
      });
    }
  } catch {
    /* settlement best-effort */
  }
  try {
    if (args.quotaService) {
      if (args.holdId && args.quotaService.settleAgentHold) {
        await args.quotaService.settleAgentHold(args.holdId, {
          tokens: sums.totalTokens,
          costDollars: sums.cost,
        }, {
          tenantId: args.tenantId,
          providerKey,
          modelId,
        });
      } else {
        await args.quotaService.recordUsage(args.tenantId, providerKey, sums.totalTokens, sums.cost);
        // Legacy boundary with no settle support: the hold (if any) was
        // reserved but never reconciled — release it now that actuals are
        // recorded, so quota is not pinned until expiry.
        if (args.holdId && args.quotaService.releaseAgentHold) {
          try {
            await args.quotaService.releaseAgentHold(args.holdId);
          } catch {
            /* release best-effort */
          }
        }
      }
    }
  } catch {
    /* settlement best-effort */
  }
  return sums;
}
