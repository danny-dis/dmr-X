import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type { CandidateSet, TaskProfile } from '@dmr-x/core';
import { getProviderTemplate } from '@dmr-x/registry';
import crypto from 'node:crypto';

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

export class PolicyService {
  /**
   * Filter candidates based on tenant policies
   */
  async filterByPolicy(
    candidates: CandidateSet,
    tenantId: string,
    taskProfile: TaskProfile
  ): Promise<CandidateSet> {
    const policies = await this.getPolicies(tenantId);

    if (policies.length === 0) {
      return candidates; // No policies = allow all
    }

    let filtered = candidates;

    for (const policy of policies) {
      if (!policy.isActive) continue;

      for (const rule of policy.rules) {
        filtered = this.applyRule(filtered, rule, taskProfile);
      }
    }

    return filtered;
  }

  private applyRule(
    candidates: CandidateSet,
    rule: PolicyRule,
    taskProfile: TaskProfile
  ): CandidateSet {
    switch (rule.type) {
      case 'provider_allowlist':
        return this.applyProviderAllowlist(candidates, rule.config.providers as string[]);

      case 'provider_blocklist':
        return this.applyProviderBlocklist(candidates, rule.config.providers as string[]);

      case 'model_blocklist':
        return this.applyModelBlocklist(candidates, rule.config.models as string[]);

      case 'cost_limit':
        return this.applyCostLimit(candidates, rule.config.maxCostPerToken as number);

      case 'data_residency':
        return this.applyDataResidency(candidates, rule.config.regions as string[]);

      default:
        logger.warn({ ruleType: rule.type }, 'Unknown policy rule type');
        return candidates;
    }
  }

  private applyProviderAllowlist(candidates: CandidateSet, allowedProviders: string[]): CandidateSet {
    if (!allowedProviders || allowedProviders.length === 0) return candidates;
    return candidates.filter((c) => allowedProviders.includes(c.providerName));
  }

  private applyProviderBlocklist(candidates: CandidateSet, blockedProviders: string[]): CandidateSet {
    if (!blockedProviders || blockedProviders.length === 0) return candidates;
    return candidates.filter((c) => !blockedProviders.includes(c.providerName));
  }

  private applyModelBlocklist(candidates: CandidateSet, blockedModels: string[]): CandidateSet {
    if (!blockedModels || blockedModels.length === 0) return candidates;
    return candidates.filter((c) => !blockedModels.includes(c.modelId));
  }

  private applyCostLimit(candidates: CandidateSet, maxCostPerToken: number): CandidateSet {
    if (!maxCostPerToken) return candidates;
    return candidates.filter((c) => {
      const cost = c.costPerInputToken ?? c.costPerImage ?? 0;
      return cost <= maxCostPerToken;
    });
  }

  private applyDataResidency(candidates: CandidateSet, allowedRegions: string[]): CandidateSet {
    if (!allowedRegions || allowedRegions.length === 0) return candidates;

    return candidates.filter((c) => {
      const template = getProviderTemplate(c.providerName);
      const region = template?.region || 'global';
      return allowedRegions.includes(region);
    });
  }

  private async getPolicies(tenantId: string): Promise<Policy[]> {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, tenant_id, name, rules, is_active
       FROM policies
       WHERE tenant_id = ? AND is_active = 1`
    ).all(tenantId) as any[];

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
  async createPolicy(tenantId: string, name: string, rules: PolicyRule[]): Promise<Policy> {
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO policies (id, tenant_id, name, rules)
       VALUES (?, ?, ?, ?)`
    ).run(id, tenantId, name, JSON.stringify(rules));

    const row = db.prepare('SELECT * FROM policies WHERE id = ?').get(id) as any;
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
  async updatePolicy(policyId: string, updates: Partial<Policy>): Promise<void> {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

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
      db.prepare(
        `UPDATE policies SET ${setClauses.join(', ')}, updated_at = datetime('now') WHERE id = ?`
      ).run(...values);
    }
  }
}

export const policyService = new PolicyService();
