import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Free-tier savings
// ---------------------------------------------------------------------------
//
// What this replaces: `/admin/cost/dashboard` reported
//
//   SUM(CASE WHEN estimated_cost = 0 THEN estimated_cost ELSE 0 END) AS free_cost
//
// as `costSavings`. That expression sums zero over the rows where cost is
// zero, so it is structurally always 0.00 — not an approximation, an identity.
// `/admin/free-tier/summary` reported `estimated_tokens_saved`, which is a
// token count with no price attached and so cannot answer "how much money did
// the free tier save me".
//
// The honest question is counterfactual: *what would this traffic have cost on
// a paid model?* That needs a reference price, and a reference price is a
// judgement call — so this module computes one explicitly and returns the basis
// alongside the number, so the UI can say "$47.20 vs. gpt-4o-mini pricing"
// rather than presenting an unexplained figure as fact.

/** Cost per 1k tokens for a model that could have served the same request. */
interface ReferencePrice {
  providerId: string;
  modelId: string;
  displayName: string | null;
  capabilityTier: string | null;
  inputCostPer1k: number;
  outputCostPer1k: number;
}

export interface SavingsBreakdownRow {
  providerId: string;
  providerName: string | null;
  modelId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costAvoidedUsd: number;
  referenceModel: string | null;
}

export interface SavingsResult {
  periodDays: number;
  from: string;
  to: string;
  costAvoidedUsd: number;
  freeRequests: number;
  freeTokens: number;
  byProvider: SavingsBreakdownRow[];
  byModel: SavingsBreakdownRow[];
  daily: Array<{ date: string; costAvoidedUsd: number; tokens: number; requests: number }>;
  basis: {
    method: string;
    referenceModels: Array<{ capabilityTier: string; model: string; inputCostPer1k: number; outputCostPer1k: number }>;
    /** Set when no paid model exists to price against. */
    warning: string | null;
  };
}

/**
 * Cheapest paid model per capability tier, plus a global fallback.
 *
 * "Cheapest" is deliberate. A savings figure should be the *conservative*
 * one — the least a user could plausibly have paid to get equivalent work
 * done. Pricing against an expensive model would inflate the number.
 *
 * Models with zero on both sides are excluded: `input_cost_per_1k` is
 * `REAL NOT NULL DEFAULT 0`, so an unpriced model is indistinguishable from a
 * free one at the column level, and treating unpriced rows as $0 paid models
 * would make every reference price zero.
 */
function loadReferencePrices(): { byTier: Map<string, ReferencePrice>; global: ReferencePrice | null } {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      mp.provider_id,
      mp.model_id,
      mp.display_name,
      mp.capability_tier,
      mp.input_cost_per_1k,
      mp.output_cost_per_1k
    FROM model_profiles mp
    LEFT JOIN model_classifications mc
      ON mc.provider_id = mp.provider_id AND mc.model_id = mp.model_id
    WHERE (mp.input_cost_per_1k > 0 OR mp.output_cost_per_1k > 0)
      AND COALESCE(mc.pricingTier, 'unknown') NOT IN ('free', 'free_with_limits')
      AND COALESCE(mc.verified_free, 0) = 0
    ORDER BY (mp.input_cost_per_1k + mp.output_cost_per_1k) ASC
  `).all() as any[];

  const byTier = new Map<string, ReferencePrice>();
  let global: ReferencePrice | null = null;

  for (const row of rows) {
    const price: ReferencePrice = {
      providerId: row.provider_id,
      modelId: row.model_id,
      displayName: row.display_name ?? null,
      capabilityTier: row.capability_tier ?? null,
      inputCostPer1k: Number(row.input_cost_per_1k ?? 0),
      outputCostPer1k: Number(row.output_cost_per_1k ?? 0),
    };

    // Rows arrive cheapest-first, so the first sighting of a tier is its
    // cheapest member and later ones are ignored.
    if (price.capabilityTier && !byTier.has(price.capabilityTier)) {
      byTier.set(price.capabilityTier, price);
    }
    if (!global) global = price;
  }

  return { byTier, global };
}

/**
 * Pick the reference price for a model that was served free.
 *
 * Prefers a paid model in the same capability tier — comparing a free small
 * model against a frontier model's pricing would overstate the saving — and
 * falls back to the cheapest paid model overall when the tier is unknown or
 * has no paid member.
 */
function referenceFor(
  capabilityTier: string | null,
  refs: { byTier: Map<string, ReferencePrice>; global: ReferencePrice | null },
): ReferencePrice | null {
  if (capabilityTier) {
    const tiered = refs.byTier.get(capabilityTier);
    if (tiered) return tiered;
  }
  return refs.global;
}

function costFor(inputTokens: number, outputTokens: number, ref: ReferencePrice | null): number {
  if (!ref) return 0;
  return (inputTokens / 1000) * ref.inputCostPer1k + (outputTokens / 1000) * ref.outputCostPer1k;
}

/**
 * Compute counterfactual free-tier savings over a window.
 *
 * A request counts as "saved" only when it was served at zero cost **and** the
 * model is classified free (catalog or runtime-verified). Cost alone is not
 * enough: an unpriced paid model also logs `estimated_cost = 0`, and counting
 * it would invent savings from a model the user is actually being billed for.
 * This is the ambiguity documented in services/router/src/meta-models.ts.
 */
export function computeSavings(days = 30): SavingsResult {
  const db = getDb();
  const periodDays = Math.min(Math.max(days, 1), 365);
  const from = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const refs = loadReferencePrices();

  // Per provider+model rollup of free-served traffic, carrying the capability
  // tier so each row can be priced against a like-for-like reference.
  let rows: any[] = [];
  try {
    rows = db.prepare(`
      SELECT
        rl.selected_provider              AS provider_id,
        p.name                            AS provider_name,
        rl.selected_model                 AS model_id,
        mp.capability_tier                AS capability_tier,
        COUNT(*)                          AS requests,
        COALESCE(SUM(rl.tokens_input), 0)  AS input_tokens,
        COALESCE(SUM(rl.tokens_output), 0) AS output_tokens
      FROM request_logs rl
      JOIN model_classifications mc
        ON mc.provider_id = rl.selected_provider
       AND mc.model_id   = rl.selected_model
      LEFT JOIN providers p      ON p.id = rl.selected_provider
      LEFT JOIN model_profiles mp
        ON mp.provider_id = rl.selected_provider
       AND mp.model_id   = rl.selected_model
      WHERE rl.timestamp > ?
        AND (rl.estimated_cost = 0 OR rl.estimated_cost IS NULL)
        AND (mc.has_free_tier = 1 OR mc.verified_free = 1
             OR mc.pricingTier IN ('free', 'free_with_limits'))
      GROUP BY rl.selected_provider, rl.selected_model
      ORDER BY (COALESCE(SUM(rl.tokens_input), 0) + COALESCE(SUM(rl.tokens_output), 0)) DESC
    `).all(from) as any[];
  } catch (err) {
    // A missing table in a partially-migrated database must not take down the
    // dashboard that reports on it.
    logger.warn({ err }, 'Savings query failed; reporting zero');
  }

  const byModel: SavingsBreakdownRow[] = rows.map((r) => {
    const inputTokens = Number(r.input_tokens ?? 0);
    const outputTokens = Number(r.output_tokens ?? 0);
    const ref = referenceFor(r.capability_tier ?? null, refs);

    return {
      providerId: r.provider_id,
      providerName: r.provider_name ?? null,
      modelId: r.model_id,
      requests: Number(r.requests ?? 0),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costAvoidedUsd: costFor(inputTokens, outputTokens, ref),
      referenceModel: ref ? `${ref.displayName ?? ref.modelId}` : null,
    };
  });

  // Fold model rows up to providers.
  const providerMap = new Map<string, SavingsBreakdownRow>();
  for (const row of byModel) {
    const existing = providerMap.get(row.providerId);
    if (existing) {
      existing.requests += row.requests;
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.totalTokens += row.totalTokens;
      existing.costAvoidedUsd += row.costAvoidedUsd;
    } else {
      providerMap.set(row.providerId, { ...row, modelId: '*', referenceModel: null });
    }
  }

  // Daily series. Priced with the global reference rather than per-model,
  // because grouping by day *and* model would return a row per model per day
  // and the chart only needs a single line.
  let dailyRows: any[] = [];
  try {
    dailyRows = db.prepare(`
      SELECT
        DATE(rl.timestamp)                AS date,
        COUNT(*)                          AS requests,
        COALESCE(SUM(rl.tokens_input), 0)  AS input_tokens,
        COALESCE(SUM(rl.tokens_output), 0) AS output_tokens
      FROM request_logs rl
      JOIN model_classifications mc
        ON mc.provider_id = rl.selected_provider
       AND mc.model_id   = rl.selected_model
      WHERE rl.timestamp > ?
        AND (rl.estimated_cost = 0 OR rl.estimated_cost IS NULL)
        AND (mc.has_free_tier = 1 OR mc.verified_free = 1
             OR mc.pricingTier IN ('free', 'free_with_limits'))
      GROUP BY DATE(rl.timestamp)
      ORDER BY date ASC
    `).all(from) as any[];
  } catch (err) {
    logger.warn({ err }, 'Daily savings query failed');
  }

  const daily = dailyRows.map((r) => {
    const inputTokens = Number(r.input_tokens ?? 0);
    const outputTokens = Number(r.output_tokens ?? 0);
    return {
      date: r.date,
      requests: Number(r.requests ?? 0),
      tokens: inputTokens + outputTokens,
      costAvoidedUsd: costFor(inputTokens, outputTokens, refs.global),
    };
  });

  const referenceModels = [...refs.byTier.entries()].map(([tier, ref]) => ({
    capabilityTier: tier,
    model: ref.displayName ?? ref.modelId,
    inputCostPer1k: ref.inputCostPer1k,
    outputCostPer1k: ref.outputCostPer1k,
  }));
  if (refs.global && referenceModels.length === 0) {
    referenceModels.push({
      capabilityTier: 'any',
      model: refs.global.displayName ?? refs.global.modelId,
      inputCostPer1k: refs.global.inputCostPer1k,
      outputCostPer1k: refs.global.outputCostPer1k,
    });
  }

  return {
    periodDays,
    from,
    to,
    costAvoidedUsd: byModel.reduce((s, r) => s + r.costAvoidedUsd, 0),
    freeRequests: byModel.reduce((s, r) => s + r.requests, 0),
    freeTokens: byModel.reduce((s, r) => s + r.totalTokens, 0),
    byProvider: [...providerMap.values()].sort((a, b) => b.costAvoidedUsd - a.costAvoidedUsd),
    byModel,
    daily,
    basis: {
      method:
        'Tokens served free, priced against the cheapest paid model in the same capability tier (or the cheapest paid model overall when the tier has none).',
      referenceModels,
      warning: refs.global
        ? null
        : 'No paid model with a non-zero price is configured, so there is nothing to price free usage against. Savings are reported as $0.',
    },
  };
}
