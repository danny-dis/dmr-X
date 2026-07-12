/**
 * needlePreFilter — cheap first-stage tool pre-router.
 *
 * POSTs the query + tools to the local Needle router (services/needle-router,
 * bound at localhost:8011) and returns the subset of input tools that Needle
 * matched. NEVER throws: any failure returns `undefined` so the caller falls
 * back to the full tool list.
 */

const NEEDLE_URL = 'http://localhost:8011/v1/chat/completions';

export async function needlePreFilter(
  tools: any[] | undefined,
  query: string,
  topK = 5,
): Promise<any[] | undefined> {
  try {
    if (!tools || tools.length < 2) {
      return tools;
    }

    const res = await fetch(NEEDLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'needle',
        messages: [{ role: 'user', content: query }],
        tools,
      }),
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
  } catch {
    return undefined;
  }
}
