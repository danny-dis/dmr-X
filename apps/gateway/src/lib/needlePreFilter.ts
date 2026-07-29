/**
 * needlePreFilter — cheap first-stage tool pre-router.
 *
 * POSTs the query + tools to the local Needle router (services/needle-router,
 * bound at localhost:8011) and returns the subset of input tools that Needle
 * matched. NEVER throws: any failure returns `undefined` so the caller falls
 * back to the full tool list.
 *
 * Needle is an OPTIMISATION — it trims the tool list before the real model
 * sees it. It is never load-bearing, so it gets a hard latency budget: on CPU
 * the checkpoint takes ~45-55 s per call, and because the call had no timeout
 * that latency landed on every agentic turn carrying two or more tools. A
 * pre-filter that costs a minute to save a few hundred prompt tokens is a
 * large net loss, so anything over the budget is abandoned and the caller
 * proceeds with the full tool list.
 *
 * Tune with:
 *   DMRX_NEEDLE_TIMEOUT_MS   budget in ms (default 1500, 0 disables the filter)
 *   DMRX_NEEDLE_URL          override the endpoint
 */

import { logger } from '@dmr-x/utils';

const DEFAULT_NEEDLE_URL = 'http://localhost:8011/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 1500;

function timeoutMs(): number {
  const raw = process.env.DMRX_NEEDLE_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export async function needlePreFilter(
  tools: any[] | undefined,
  query: string,
  topK = 5,
): Promise<any[] | undefined> {
  const budget = timeoutMs();
  // Explicitly disabled — skip the network call entirely.
  if (budget === 0) return tools;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  const start = Date.now();

  try {
    if (!tools || tools.length < 2) {
      return tools;
    }

    const res = await fetch(process.env.DMRX_NEEDLE_URL || DEFAULT_NEEDLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'needle',
        messages: [{ role: 'user', content: query }],
        tools,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return undefined;
    }

    const data = (await res.json()) as any;
    const matched: string[] = [];
    const toolCalls = data?.choices?.[0]?.message?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const name = tc?.function?.name;
        if (name && !matched.includes(name)) {
          matched.push(name);
        }
      }
    }

    if (matched.length === 0) {
      return undefined;
    }

    const matchedSet = new Set(matched);
    const narrowed = tools.filter(
      (t) => t?.function?.name && matchedSet.has(t.function.name),
    );

    return narrowed.slice(0, topK);
  } catch (err) {
    // Abort is the expected path when Needle is slower than its budget, and
    // it is logged at debug so a slow-but-working Needle does not spam warn.
    if ((err as { name?: string })?.name === 'AbortError') {
      logger.debug(
        { budgetMs: budget, elapsedMs: Date.now() - start, toolCount: tools?.length },
        'Needle pre-filter exceeded its latency budget — using the full tool list',
      );
    }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
