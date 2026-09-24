/**
 * Request Requirement Vector — Issue #15 P0 Routing.
 *
 * Declares what a request needs from a provider/model. The router scores
 * candidates against this vector to find the cheapest-acceptable, free-first,
 * or highest-quality-per-dollar option.
 */

export type RequirementAxis =
  | 'llm'
  | 'vision'
  | 'code'
  | 'audio'
  | 'video'
  | 'embedding'
  | 'reranking'
  | 'moderation';

export type BudgetPolicy =
  | 'free_only'
  | 'free_first'
  | 'cheapest_acceptable'
  | 'quality_per_dollar'
  | 'unconstrained';

export type LatencyBudget =
  | 'realtime'     // < 500ms
  | 'interactive'  // < 2s
  | 'batch';       // no hard constraint

export interface RequestRequirementVector {
  /** Capability axes required (all must be satisfied). */
  axes: RequirementAxis[];

  /** Minimum context window tokens needed. */
  contextWindow?: number;

  /** Maximum acceptable latency tier. */
  latencyBudget?: LatencyBudget;

  /** Economic policy — drives the objective selector. */
  budgetPolicy: BudgetPolicy;

  /** Hard cost ceiling in cents/1k tokens. Unconstrained = Infinity. */
  maxCostPer1k?: number;

  /** Privacy: fail-closed if true — unknown PII routing returns no candidate. */
  failClosedPii?: boolean;

  /** Allowed provider IDs (empty = all allowed). */
  providerAllowlist?: string[];

  /** Required provider capabilities (e.g., 'streaming', 'function_calling'). */
  requiredCapabilities?: string[];
}

export const DEFAULT_REQUIREMENT_VECTOR: RequestRequirementVector = {
  axes: ['llm'],
  budgetPolicy: 'unconstrained',
  latencyBudget: 'interactive',
};

export function isValidRequirementVector(v: RequestRequirementVector): boolean {
  if (!v.axes || v.axes.length === 0) return false;
  if (!v.budgetPolicy) return false;
  if (v.maxCostPer1k !== undefined && v.maxCostPer1k < 0) return false;
  return true;
}

export function describeRequirementVector(v: RequestRequirementVector): string {
  const parts: string[] = [];
  parts.push(`axes=[${v.axes.join(',')}]`);
  parts.push(`budget=${v.budgetPolicy}`);
  if (v.latencyBudget) parts.push(`latency=${v.latencyBudget}`);
  if (v.maxCostPer1k !== undefined) parts.push(`maxCost=${v.maxCostPer1k}c`);
  if (v.failClosedPii) parts.push('pii=fail-closed');
  if (v.contextWindow) parts.push(`ctx=${v.contextWindow}`);
  return parts.join(' ');
}
