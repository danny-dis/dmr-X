import type { CandidateSet, TaskProfile } from '@dmr-x/core';
export interface PolicyRule {
    type: 'provider_allowlist' | 'provider_blocklist' | 'model_blocklist' | 'cost_limit' | 'data_residency';
    config: Record<string, unknown>;
}
export interface Policy {
    id: string;
    tenantId: string;
    name: string;
    rules: PolicyRule[];
    isActive: boolean;
}
export declare class PolicyService {
    /**
     * Filter candidates based on tenant policies
     */
    filterByPolicy(candidates: CandidateSet, tenantId: string, taskProfile: TaskProfile): Promise<CandidateSet>;
    private applyRule;
    private applyProviderAllowlist;
    private applyProviderBlocklist;
    private applyModelBlocklist;
    private applyCostLimit;
    private applyDataResidency;
    private getPolicies;
    /**
     * Create a new policy
     */
    createPolicy(tenantId: string, name: string, rules: PolicyRule[]): Promise<Policy>;
    /**
     * Update a policy
     */
    updatePolicy(policyId: string, updates: Partial<Policy>): Promise<void>;
}
export declare const policyService: PolicyService;
//# sourceMappingURL=policy.service.d.ts.map