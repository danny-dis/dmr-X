import type { FastifyReply } from 'fastify';

export interface CostMetrics {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  isFreeTier: boolean;
  latencyMs: number;
  compressionSaved?: number;
}

/**
 * Add cost and usage headers to response.
 * Pattern: X-DMRX-* (equivalent to OmniRoute's X-OmniRoute-* headers)
 */
export function addCostHeaders(reply: FastifyReply, metrics: CostMetrics): void {
  reply.header('X-DMRX-Provider', metrics.providerId);
  reply.header('X-DMRX-Model', metrics.modelId);
  reply.header('X-DMRX-Input-Tokens', String(metrics.inputTokens));
  reply.header('X-DMRX-Output-Tokens', String(metrics.outputTokens));
  reply.header('X-DMRX-Total-Tokens', String(metrics.inputTokens + metrics.outputTokens));
  reply.header('X-DMRX-Input-Cost', metrics.inputCost.toFixed(6));
  reply.header('X-DMRX-Output-Cost', metrics.outputCost.toFixed(6));
  reply.header('X-DMRX-Total-Cost', metrics.totalCost.toFixed(6));
  reply.header('X-DMRX-Free-Tier', String(metrics.isFreeTier));
  reply.header('X-DMRX-Latency-Ms', String(metrics.latencyMs));

  if (metrics.compressionSaved && metrics.compressionSaved > 0) {
    reply.header('X-DMRX-Compression-Saved', String(metrics.compressionSaved));
  }
}

/**
 * Extract cost metrics from response body and request context.
 */
export function extractCostMetrics(
  body: any,
  providerId: string,
  modelId: string,
  latencyMs: number,
  compressionSaved?: number
): CostMetrics {
  const usage = body?.usage ?? {};
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;

  // Estimate costs (would use actual pricing in production)
  const inputCost = 0; // placeholder
  const outputCost = 0; // placeholder
  const totalCost = inputCost + outputCost;

  return {
    providerId,
    modelId,
    inputTokens,
    outputTokens,
    inputCost,
    outputCost,
    totalCost,
    isFreeTier: totalCost === 0,
    latencyMs,
    compressionSaved,
  };
}
