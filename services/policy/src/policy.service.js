import { getPool } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
export class PolicyService {
    /**
     * Filter candidates based on tenant policies
     */
    async filterByPolicy(candidates, tenantId, taskProfile) {
        const policies = await this.getPolicies(tenantId);
        if (policies.length === 0) {
            return candidates; // No policies = allow all
        }
        let filtered = candidates;
        for (const policy of policies) {
            if (!policy.isActive)
                continue;
            for (const rule of policy.rules) {
                filtered = this.applyRule(filtered, rule, taskProfile);
            }
        }
        return filtered;
    }
    applyRule(candidates, rule, taskProfile) {
        switch (rule.type) {
            case 'provider_allowlist':
                return this.applyProviderAllowlist(candidates, rule.config.providers);
            case 'provider_blocklist':
                return this.applyProviderBlocklist(candidates, rule.config.providers);
            case 'model_blocklist':
                return this.applyModelBlocklist(candidates, rule.config.models);
            case 'cost_limit':
                return this.applyCostLimit(candidates, rule.config.maxCostPerToken);
            case 'data_residency':
                return this.applyDataResidency(candidates, rule.config.regions);
            default:
                logger.warn({ ruleType: rule.type }, 'Unknown policy rule type');
                return candidates;
        }
    }
    applyProviderAllowlist(candidates, allowedProviders) {
        if (!allowedProviders || allowedProviders.length === 0)
            return candidates;
        return candidates.filter((c) => allowedProviders.includes(c.providerName));
    }
    applyProviderBlocklist(candidates, blockedProviders) {
        if (!blockedProviders || blockedProviders.length === 0)
            return candidates;
        return candidates.filter((c) => !blockedProviders.includes(c.providerName));
    }
    applyModelBlocklist(candidates, blockedModels) {
        if (!blockedModels || blockedModels.length === 0)
            return candidates;
        return candidates.filter((c) => !blockedModels.includes(c.modelId));
    }
    applyCostLimit(candidates, maxCostPerToken) {
        if (!maxCostPerToken)
            return candidates;
        return candidates.filter((c) => {
            const cost = c.costPerInputToken || c.costPerImage || 0;
            return cost <= maxCostPerToken;
        });
    }
    applyDataResidency(candidates, allowedRegions) {
        if (!allowedRegions || allowedRegions.length === 0)
            return candidates;
        // For now, we don't have region data on providers
        // This is a placeholder for future implementation
        return candidates;
    }
    async getPolicies(tenantId) {
        const pool = getPool();
        const result = await pool.query(`SELECT id, tenant_id, name, rules, is_active
       FROM policies
       WHERE tenant_id = $1 AND is_active = true`, [tenantId]);
        return result.rows.map((row) => ({
            id: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            rules: row.rules || [],
            isActive: row.is_active,
        }));
    }
    /**
     * Create a new policy
     */
    async createPolicy(tenantId, name, rules) {
        const pool = getPool();
        const result = await pool.query(`INSERT INTO policies (tenant_id, name, rules)
       VALUES ($1, $2, $3)
       RETURNING *`, [tenantId, name, JSON.stringify(rules)]);
        const row = result.rows[0];
        return {
            id: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            rules: row.rules,
            isActive: row.is_active,
        };
    }
    /**
     * Update a policy
     */
    async updatePolicy(policyId, updates) {
        const pool = getPool();
        const setClauses = [];
        const values = [];
        let paramIndex = 1;
        if (updates.name !== undefined) {
            setClauses.push(`name = $${paramIndex++}`);
            values.push(updates.name);
        }
        if (updates.rules !== undefined) {
            setClauses.push(`rules = $${paramIndex++}`);
            values.push(JSON.stringify(updates.rules));
        }
        if (updates.isActive !== undefined) {
            setClauses.push(`is_active = $${paramIndex++}`);
            values.push(updates.isActive);
        }
        if (setClauses.length > 0) {
            values.push(policyId);
            await pool.query(`UPDATE policies SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`, values);
        }
    }
}
export const policyService = new PolicyService();
//# sourceMappingURL=policy.service.js.map