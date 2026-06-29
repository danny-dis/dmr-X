import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

/**
 * Tag-based routing strategy.
 *
 * Routes requests based on tags attached to the request metadata.
 * Tags are matched against provider/model metadata tags.
 *
 * Example usage:
 *   - Request tag "premium" → routes to providers tagged "premium"
 *   - Request tag "eu-only" → routes to providers tagged "eu-only"
 *   - Request tag "fast" → routes to providers tagged "fast"
 */

interface TagConfig {
  /** Tags to match (all must match for a provider to be eligible) */
  tags: string[];
  /** Match mode: 'all' = all tags must match, 'any' = at least one tag must match */
  matchMode?: 'all' | 'any';
}

/**
 * Match candidates by tags from request metadata.
 *
 * @param candidates - Available providers
 * @param tags - Tags from request metadata
 * @param matchMode - 'all' requires all tags, 'any' requires at least one
 * @returns Filtered candidates matching the tags
 */
export function filterByTags(
  candidates: CandidateSet,
  tags: string[],
  matchMode: 'all' | 'any' = 'all',
): CandidateSet {
  if (!tags || tags.length === 0) return candidates;

  const lowerTags = tags.map(t => t.toLowerCase());

  return candidates.filter((c) => {
    const providerTags = ((c as any).tags as string[] || []).map(t => t.toLowerCase());
    if (providerTags.length === 0) return false;

    if (matchMode === 'all') {
      return lowerTags.every(t => providerTags.includes(t));
    }
    // 'any' mode
    return lowerTags.some(t => providerTags.includes(t));
  });
}

/**
 * Select provider using tag-based filtering.
 * If tags match, select from filtered set; otherwise use full candidate set.
 */
export function selectByTags(
  candidates: CandidateSet,
  tags: string[],
  matchMode: 'all' | 'any' = 'all',
): SelectedProvider | null {
  if (!tags || tags.length === 0) {
    // No tags → fall back to first healthy candidate
    if (candidates.length === 0) return null;
    const c = candidates[0];
    return {
      providerId: c.providerId,
      modelId: c.modelId,
      adapterType: c.providerName,
      score: c.qualityScore,
    };
  }

  const filtered = filterByTags(candidates, tags, matchMode);

  if (filtered.length === 0) {
    logger.debug({ tags, matchMode }, 'No candidates matched tags, falling back to all');
    // Fall back to full candidate set
    if (candidates.length === 0) return null;
    const c = candidates[0];
    return {
      providerId: c.providerId,
      modelId: c.modelId,
      adapterType: c.providerName,
      score: c.qualityScore,
    };
  }

  // Select best from filtered set (by quality score)
  const sorted = [...filtered].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
  const selected = sorted[0];

  logger.debug(
    {
      providerId: selected.providerId,
      modelId: selected.modelId,
      tags,
      matchMode,
      matchedCount: filtered.length,
    },
    'Tag-based routing selected',
  );

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}
