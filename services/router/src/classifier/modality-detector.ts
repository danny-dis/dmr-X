import type { Modality } from '@dmr-x/core';
import { MODALITY_ENDPOINTS } from '@dmr-x/core';

export function detectModality(path: string): Modality {
  const modality = MODALITY_ENDPOINTS[path];
  if (!modality) {
    throw new Error(`Unknown API path: ${path}`);
  }
  return modality;
}
