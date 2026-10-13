/** Catalog entries alone do not imply that any provider can serve inference. */
export function hasUsableProviders(catalog: { data?: unknown[] } | undefined, health?: unknown): boolean {
  const state = health as { checks?: { candidates?: { status?: string } } } | undefined;
  return Boolean(catalog?.data?.length) && state?.checks?.candidates?.status === 'ok';
}
