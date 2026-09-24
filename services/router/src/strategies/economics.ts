/**
 * Economic Objectives — Issue #15 P0 Economics.
 *
 * Explicit pure selectors for budget-aware routing. Each selector takes
 * candidates + requirements and returns the best match.
 */

import type { BudgetPolicy } from '@dmr-x/core';

export interface CostableCandidate {
  providerId: string;
  modelId: string;
  costPer1kInputTokens: number;  // cents
  costPer1kOutputTokens: number; // cents
  isFree: boolean;
  qualityScore?: number;       // 0-1, higher is better
}

export interface EconomicsResult {
  selected: CostableCandidate[];
  objective: string;
  rejected: Array<{ candidate: CostableCandidate; reason: string }>;
}

export function selectByEconomics(
  candidates: CostableCandidate[],
  budgetPolicy: BudgetPolicy,
  maxCostPer1k = Infinity,
): EconomicsResult {
  const rejected: EconomicsResult['rejected'] = [];
  let selected: CostableCandidate[];
  let objective: string;

  switch (budgetPolicy) {
    case 'free_only': {
      objective = 'free_only: zero paid selections';
      selected = candidates.filter((c) => {
        if (!c.isFree) {
          rejected.push({ candidate: c, reason: 'not free' });
          return false;
        }
        return true;
      });
      break;
    }
    case 'free_first': {
      objective = 'free_first: prefer free, paid fallback allowed';
      const free = candidates.filter((c) => c.isFree);
      if (free.length > 0) {
        selected = free;
        rejected.push(...candidates.filter((c) => !c.isFree).map((c) => ({ candidate: c, reason: 'free alternatives exist' })));
      } else {
        selected = candidates.sort((a, b) => totalCost(a) - totalCost(b));
      }
      break;
    }
    case 'cheapest_acceptable': {
      objective = 'cheapest_acceptable: minimize cost under budget';
      const affordable = candidates.filter((c) => {
        const cost = totalCost(c);
        if (cost > maxCostPer1k) {
          rejected.push({ candidate: c, reason: `exceeds budget (${cost} > ${maxCostPer1k})` });
          return false;
        }
        return true;
      });
      selected = affordable.sort((a, b) => totalCost(a) - totalCost(b));
      break;
    }
    case 'quality_per_dollar': {
      objective = 'quality_per_dollar: maximize quality/cost ratio';
      selected = candidates
        .filter((c) => {
          if (!c.isFree && totalCost(c) > maxCostPer1k) {
            rejected.push({ candidate: c, reason: 'exceeds budget' });
            return false;
          }
          return true;
        })
        .map((c) => ({
          ...c,
          _qp: c.isFree ? (c.qualityScore ?? 0.5) * 100 : (c.qualityScore ?? 0.5) / Math.max(0.01, totalCost(c)),
        }))
        .sort((a, b) => (b as any)._qp - (a as any)._qp)
        .map(({ _qp, ...c }) => c as CostableCandidate);
      break;
    }
    case 'unconstrained':
    default: {
      objective = 'unconstrained: all candidates eligible';
      selected = candidates;
      break;
    }
  }

  return { selected, objective, rejected };
}

function totalCost(c: CostableCandidate): number {
  return (c.costPer1kInputTokens + c.costPer1kOutputTokens) / 2;
}
