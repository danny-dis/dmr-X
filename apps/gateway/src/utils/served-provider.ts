/**
 * Resolve the provider UUID that actually served a response — not the one
 * the router planned to use.
 *
 * Root cause of the Requests/Routing pages showing the wrong provider next
 * to the model that answered: the adapter's `response.providerId` is the
 * provider's NAME (e.g. "google"), while `request_logs.selected_provider`
 * (and the plan/candidate objects) are keyed by the DB provider UUID — the
 * same UUID-vs-name split `resolveServedCandidate` in
 * `services/router/src/router.service.ts` already resolves for sticky
 * sessions and bandit reward attribution. The non-streaming chat handler
 * below used to hard-code `plan.primary.providerId` for telemetry, so any
 * request that fell back to a different provider recorded the ORIGINAL
 * (failed) provider's UUID paired with the model that actually responded.
 * This mirrors that same resolution for the telemetry write path.
 */
export function resolveServedProviderId(
  plan: {
    primary: { providerId: string; modelId: string; adapterType: string };
    chain: Array<{ provider: { providerId: string; modelId: string; adapterType: string } }>;
  },
  response: { providerId?: string; modelId?: string } | null | undefined,
): string {
  if (!response) return plan.primary.providerId;
  const servedModelId = response.modelId || plan.primary.modelId;
  const candidates = [plan.primary, ...plan.chain.map((step) => step.provider)];
  const match =
    candidates.find(
      (c) => c.modelId === servedModelId && (c.providerId === response.providerId || c.adapterType === response.providerId),
    ) ?? candidates.find((c) => c.modelId === servedModelId);
  return match?.providerId ?? plan.primary.providerId;
}
