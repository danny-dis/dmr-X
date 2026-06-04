import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { getProviderTemplate } from '@dmr-x/registry';
import crypto from 'node:crypto';
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
        // NOTE: providerName is the catalog template ID (e.g., 'openai'), not the DB UUID.
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
            const cost = c.costPerInputToken ?? c.costPerImage ?? 0;
            return cost <= maxCostPerToken;
        });
    }
    applyDataResidency(candidates, allowedRegions) {
        if (!allowedRegions || allowedRegions.length === 0)
            return candidates;
        return candidates.filter((c) => {
            const template = getProviderTemplate(c.providerName);
            const region = template?.region || 'global';
            return allowedRegions.includes(region);
        });
    }
    async getPolicies(tenantId) {
        const db = getDb();
        const rows = db.prepare(`SELECT id, tenant_id, name, rules, is_active
       FROM policies
       WHERE tenant_id = ? AND is_active = 1`).all(tenantId);
        return rows.map((row) => ({
            id: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            rules: typeof row.rules === 'string' ? JSON.parse(row.rules) : (row.rules || []),
            isActive: row.is_active,
        }));
    }
    /**
     * Create a new policy
     */
    async createPolicy(tenantId, name, rules) {
        const db = getDb();
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO policies (id, tenant_id, name, rules)
       VALUES (?, ?, ?, ?)`).run(id, tenantId, name, JSON.stringify(rules));
        const row = db.prepare('SELECT * FROM policies WHERE id = ?').get(id);
        return {
            id: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            rules: typeof row.rules === 'string' ? JSON.parse(row.rules) : (row.rules || []),
            isActive: row.is_active,
        };
    }
    /**
     * Update a policy
     */
    async updatePolicy(policyId, updates) {
        const db = getDb();
        const setClauses = [];
        const values = [];
        if (updates.name !== undefined) {
            setClauses.push(`name = ?`);
            values.push(updates.name);
        }
        if (updates.rules !== undefined) {
            setClauses.push(`rules = ?`);
            values.push(JSON.stringify(updates.rules));
        }
        if (updates.isActive !== undefined) {
            setClauses.push(`is_active = ?`);
            values.push(updates.isActive ? 1 : 0);
        }
        if (setClauses.length > 0) {
            values.push(policyId);
            db.prepare(`UPDATE policies SET ${setClauses.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
        }
    }
}
export const policyService = new PolicyService();
//# sourceMappingURL=policy.service.js.map