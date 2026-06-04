import { MODALITY_ENDPOINTS } from '@dmr-x/core';
export function detectModality(path) {
    const modality = MODALITY_ENDPOINTS[path];
    if (!modality) {
        throw new Error(`Unknown API path: ${path}`);
    }
    return modality;
}
//# sourceMappingURL=modality-detector.js.map