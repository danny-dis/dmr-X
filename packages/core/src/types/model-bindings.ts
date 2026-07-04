import { ProviderModel, ModelBinding, BindingEntry, SelectedProvider } from './routing.js';

/**
 * Resolve all unique (providerId, modelId) pairs from a model's bindings.
 * This is used by the registry to expand a multi-binding model into
 * individual routing candidates.
 */
export function resolveBindingTargets(model: ProviderModel): { providerId: string; modelId: string }[] {
  if (!model.bindings) {
    return [{ providerId: model.providerId, modelId: model.modelId }];
  }

  const targets: { providerId: string; modelId: string }[] = [];

  // Add primary
  targets.push({
    providerId: model.bindings.primary.providerId,
    modelId: model.bindings.primary.modelId,
  });

  // Add fallbacks (deduplicated)
  for (const fb of model.bindings.fallbacks) {
    const exists = targets.some(t => t.providerId === fb.providerId && t.modelId === fb.modelId);
    if (!exists) {
      targets.push({ providerId: fb.providerId, modelId: fb.modelId });
    }
  }

  return targets;
}

/**
 * Get the next binding to try after a failure.
 * If crossBindingFailover is enabled and all retries are exhausted,
 * this returns the next binding in the chain.
 */
export function getNextBinding(
  failedProviderId: string,
  failedModelId: string,
  bindings: ModelBinding,
): BindingEntry | null {
  if (!bindings.crossBindingFailover) return null;

  const allBindings = [bindings.primary, ...bindings.fallbacks];
  const currentIndex = allBindings.findIndex(
    b => b.providerId === failedProviderId && b.modelId === failedModelId
  );

  if (currentIndex === -1 || currentIndex >= allBindings.length - 1) {
    return null;
  }

  return allBindings[currentIndex + 1];
}
