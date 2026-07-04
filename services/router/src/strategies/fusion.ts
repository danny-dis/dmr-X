import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

export interface FusionPanel {
  primary: SelectedProvider;
  panel: SelectedProvider[];
  judge?: SelectedProvider;
}

/**
 * Fusion routing strategy.
 * Fans out to a panel of models, then selects a judge to synthesize
 * one answer from the panel responses.
 *
 * Returns the primary model. The caller should use the panel for
 * parallel execution and the judge for synthesis.
 */
export function selectFusionPanel(
  candidates: CandidateSet,
  panelSize: number = 3
): { selected: SelectedProvider; panel: SelectedProvider[] } | null {
  if (candidates.length === 0) return null;

  // Sort by quality score descending
  const sorted = [...candidates].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));

  // Pick top N for the panel (diverse — try different providers)
  const panel: SelectedProvider[] = [];
  const usedProviders = new Set<string>();

  for (const c of sorted) {
    if (panel.length >= panelSize) break;
    // Prefer diverse providers, but allow same provider if needed
    if (!usedProviders.has(c.providerId) || panel.length < 2) {
      panel.push({
        providerId: c.providerId,
        modelId: c.modelId,
        adapterType: c.providerName,
        score: c.qualityScore,
      });
      usedProviders.add(c.providerId);
    }
  }

  if (panel.length === 0) return null;

  // Primary is the highest-scored model
  const primary = panel[0];

  logger.debug(
    { panel: panel.map(p => `${p.providerId}/${p.modelId}`) },
    'Fusion routing selected panel',
  );

  return { selected: primary, panel };
}
