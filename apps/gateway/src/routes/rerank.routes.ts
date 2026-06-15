import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { ValidationError } from '@dmr-x/core';
import { decrypt, logger } from '@dmr-x/utils';

// Rerank request schema. Mirrors the shape the OpenAI / Cohere / Jina
// rerank endpoints accept so existing client SDKs can call us without
// translation.
const RerankRequestSchema = z.object({
  model: z.string().optional(),
  query: z.string().min(1),
  documents: z.array(z.string()).min(1).max(1000),
  top_n: z.number().int().positive().optional().default(10),
});

const PROVIDER_NAME = 'cohere';

// Token-overlap Jaccard scorer. Intentionally basic — Cohere is the
// production path; this is here so the route never 5xxs on a missing
// provider and the playground / SDKs can demo the wire shape offline.
function localRerank(query: string, documents: string[], topN: number) {
  const qTokens = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  const scored = documents.map((doc, index) => {
    const dTokens = new Set(doc.toLowerCase().split(/\W+/).filter(Boolean));
    let intersect = 0;
    for (const t of qTokens) if (dTokens.has(t)) intersect++;
    const union = qTokens.size + dTokens.size - intersect;
    return {
      index,
      relevance_score: union > 0 ? intersect / union : 0,
      document: doc,
    };
  });
  scored.sort((a, b) => b.relevance_score - a.relevance_score);
  return scored.slice(0, topN);
}

interface CohereRerankHit {
  index: number;
  relevance_score: number;
}

async function cohereRerank(
  baseUrl: string,
  apiKey: string,
  model: string,
  query: string,
  documents: string[],
  topN: number,
) {
  const res = await fetch(`${baseUrl}/rerank`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, query, documents, top_n: topN }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Cohere rerank failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { results: CohereRerankHit[] };
  return data.results.map((r) => ({ ...r, document: documents[r.index] }));
}

export async function rerankRoutes(server: FastifyInstance): Promise<void> {
  server.post('/rerank', async (request) => {
    const parsed = RerankRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const body = parsed.data;

    // Try Cohere first — look up the configured provider, decrypt its
    // API key (stored encrypted in config.apiKey, same pattern as
    // /admin/providers/test), and forward to the upstream endpoint.
    const db = getDb();
    const cohereRow = db
      .prepare('SELECT base_url, config FROM providers WHERE name = ? AND is_healthy = 1')
      .get(PROVIDER_NAME) as { base_url?: string | null; config?: string | null } | undefined;

    let cohereKey: string | null = null;
    let cohereBaseUrl: string | null = null;
    if (cohereRow) {
      cohereBaseUrl = cohereRow.base_url || 'https://api.cohere.com';
      const cfg = cohereRow.config ? JSON.parse(cohereRow.config) : {};
      const stored = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
      cohereKey = stored ? decrypt(stored) : null;
    }

    const model = body.model || 'rerank-english-v3.0';
    let results: Array<{ index: number; relevance_score: number; document?: string }>;
    let usedFallback = false;

    if (cohereBaseUrl && cohereKey) {
      try {
        results = await cohereRerank(cohereBaseUrl, cohereKey, model, body.query, body.documents, body.top_n);
      } catch (err) {
        logger.warn({ err }, 'Cohere rerank failed, falling back to local scorer');
        usedFallback = true;
        results = localRerank(body.query, body.documents, body.top_n);
      }
    } else {
      usedFallback = true;
      results = localRerank(body.query, body.documents, body.top_n);
    }

    return {
      id: crypto.randomUUID(),
      model,
      results,
      fallback: usedFallback,
    };
  });
}
