import type { UnifiedRequest, TaskProfile } from '@dmr-x/core';
export interface ClassifyOptions {
    path: string;
    qualityTarget?: 'frontier' | 'balanced' | 'economy';
    priority?: number;
}
export declare function classifyTask(request: UnifiedRequest, options: ClassifyOptions): TaskProfile;
//# sourceMappingURL=task-classifier.d.ts.map