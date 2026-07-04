import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';

export interface CostEntry {
  tenantId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  isFreeTier: boolean;
  timestamp: Date;
}

export interface TenantCostSummary {
  tenantId: string;
  tenantName: string;
  totalCost: number;
  freeTierCost: number;
  paidCost: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, {
    cost: number;
    requests: number;
    tokens: number;
  }>;
}

export interface CostDashboardData {
  period: {
    start: Date;
    end: Date;
  };
  totalCost: number;
  freeTierCost: number;
  paidCost: number;
  costSavings: number;
  byTenant: TenantCostSummary[];
  byProvider: Record<string, {
    cost: number;
    requests: number;
    tokens: number;
    freePercent: number;
  }>;
  dailyCosts: Array<{
    date: string;
    cost: number;
    freeCost: number;
    paidCost: number;
  }>;
}

export class CostTracker {
  recordCost(entry: CostEntry): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO cost_logs (
          tenant_id, provider_id, model_id,
          input_tokens, output_tokens,
          input_cost, output_cost, total_cost,
          is_free_tier, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.tenantId,
        entry.providerId,
        entry.modelId,
        entry.inputTokens,
        entry.outputTokens,
        entry.inputCost,
        entry.outputCost,
        entry.totalCost,
        entry.isFreeTier ? 1 : 0,
        entry.timestamp.toISOString()
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to record cost entry');
    }
  }

  getTenantCosts(tenantId: string, days: number = 30): TenantCostSummary {
    const db = getDb();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const costs = db.prepare(`
      SELECT
        provider_id,
        model_id,
        SUM(total_cost) as total_cost,
        SUM(CASE WHEN is_free_tier = 1 THEN total_cost ELSE 0 END) as free_cost,
        SUM(CASE WHEN is_free_tier = 0 THEN total_cost ELSE 0 END) as paid_cost,
        COUNT(*) as requests,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM cost_logs
      WHERE tenant_id = ? AND timestamp > ?
      GROUP BY provider_id, model_id
      ORDER BY total_cost DESC
    `).all(tenantId, start) as any[];

    const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId) as any;

    const byProvider: Record<string, { cost: number; requests: number; tokens: number }> = {};
    let totalCost = 0;
    let freeTierCost = 0;
    let paidCost = 0;
    let totalRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const cost of costs) {
      totalCost += cost.total_cost;
      freeTierCost += cost.free_cost;
      paidCost += cost.paid_cost;
      totalRequests += cost.requests;
      totalInputTokens += cost.input_tokens;
      totalOutputTokens += cost.output_tokens;

      if (!byProvider[cost.provider_id]) {
        byProvider[cost.provider_id] = { cost: 0, requests: 0, tokens: 0 };
      }
      byProvider[cost.provider_id].cost += cost.total_cost;
      byProvider[cost.provider_id].requests += cost.requests;
      byProvider[cost.provider_id].tokens += cost.input_tokens + cost.output_tokens;
    }

    return {
      tenantId,
      tenantName: tenant?.name ?? 'Unknown',
      totalCost,
      freeTierCost,
      paidCost,
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      byProvider,
    };
  }

  getDashboardData(days: number = 30): CostDashboardData {
    const db = getDb();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();

    // Total costs
    const totals = db.prepare(`
      SELECT
        SUM(total_cost) as total_cost,
        SUM(CASE WHEN is_free_tier = 1 THEN total_cost ELSE 0 END) as free_cost,
        SUM(CASE WHEN is_free_tier = 0 THEN total_cost ELSE 0 END) as paid_cost,
        COUNT(*) as requests,
        SUM(input_tokens + output_tokens) as tokens
      FROM cost_logs
      WHERE timestamp > ?
    `).get(start) as any;

    // Costs by tenant
    const byTenant = db.prepare(`
      SELECT
        tenant_id,
        SUM(total_cost) as total_cost,
        SUM(CASE WHEN is_free_tier = 1 THEN total_cost ELSE 0 END) as free_cost,
        COUNT(*) as requests,
        SUM(input_tokens + output_tokens) as tokens
      FROM cost_logs
      WHERE timestamp > ?
      GROUP BY tenant_id
      ORDER BY total_cost DESC
      LIMIT 20
    `).all(start) as any[];

    // Costs by provider
    const byProvider = db.prepare(`
      SELECT
        provider_id,
        SUM(total_cost) as total_cost,
        COUNT(*) as requests,
        SUM(input_tokens + output_tokens) as tokens,
        SUM(CASE WHEN is_free_tier = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as free_percent
      FROM cost_logs
      WHERE timestamp > ?
      GROUP BY provider_id
      ORDER BY total_cost DESC
    `).all(start) as any[];

    // Daily costs
    const dailyCosts = db.prepare(`
      SELECT
        DATE(timestamp) as date,
        SUM(total_cost) as cost,
        SUM(CASE WHEN is_free_tier = 1 THEN total_cost ELSE 0 END) as free_cost,
        SUM(CASE WHEN is_free_tier = 0 THEN total_cost ELSE 0 END) as paid_cost
      FROM cost_logs
      WHERE timestamp > ?
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `).all(start) as any[];

    // Enrich tenant data with names
    const enrichedByTenant: TenantCostSummary[] = byTenant.map(t => {
      const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(t.tenant_id) as any;
      return {
        tenantId: t.tenant_id,
        tenantName: tenant?.name ?? 'Unknown',
        totalCost: t.total_cost,
        freeTierCost: t.free_cost,
        paidCost: t.total_cost - t.free_cost,
        totalRequests: t.requests,
        totalInputTokens: 0,
        totalOutputTokens: t.tokens,
        byProvider: {},
      };
    });

    return {
      period: { start: new Date(start), end: new Date(end) },
      totalCost: totals?.total_cost ?? 0,
      freeTierCost: totals?.free_cost ?? 0,
      paidCost: totals?.paid_cost ?? 0,
      costSavings: totals?.free_cost ?? 0,  // Free tier = savings
      byTenant: enrichedByTenant,
      byProvider: Object.fromEntries(byProvider.map(p => [p.provider_id, {
        cost: p.total_cost,
        requests: p.requests,
        tokens: p.tokens,
        freePercent: p.free_percent ?? 0,
      }])),
      dailyCosts: dailyCosts.map(d => ({
        date: d.date,
        cost: d.cost,
        freeCost: d.free_cost,
        paidCost: d.paid_cost,
      })),
    };
  }
}

// Singleton instance
let instance: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!instance) {
    instance = new CostTracker();
  }
  return instance;
}
