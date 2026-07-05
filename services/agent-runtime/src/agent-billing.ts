import { getDb } from '@dmr-x/db';

// ---------------------------------------------------------------------------
// Per-Agent Billing Service
// ---------------------------------------------------------------------------

export interface AgentCostSummary {
  agentInstanceId: string;
  agentName: string;
  totalExecutions: number;
  totalTokens: number;
  totalCostCents: number;
  avgCostPerExecution: number;
  period: { from: string; to: string };
}

export interface AgentCostBreakdown {
  byModel: Record<string, { tokens: number; costCents: number; executions: number }>;
  byDay: Record<string, { tokens: number; costCents: number; executions: number }>;
  byTool: Record<string, { executions: number; costCents: number }>;
}

export class AgentBillingService {
  /**
   * Get cost summary for a specific agent instance.
   */
  async getAgentCostSummary(
    agentInstanceId: string,
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<AgentCostSummary | null> {
    const db = getDb();

    const row = db.prepare(`
      SELECT
        ae.agent_instance_id,
        ad.name as agent_name,
        COUNT(*) as total_executions,
        SUM(ae.input_tokens + ae.output_tokens) as total_tokens,
        SUM(ae.cost_cents) as total_cost_cents
      FROM agent_executions ae
      JOIN agent_instances ai ON ae.agent_instance_id = ai.id
      JOIN agent_definitions ad ON ai.agent_definition_id = ad.id
      WHERE ae.agent_instance_id = ?
        AND ae.tenant_id = ?
        AND ae.created_at >= ?
        AND ae.created_at <= ?
      GROUP BY ae.agent_instance_id
    `).get(agentInstanceId, tenantId, from.toISOString(), to.toISOString()) as any;

    if (!row) return null;

    return {
      agentInstanceId: row.agent_instance_id,
      agentName: row.agent_name,
      totalExecutions: row.total_executions,
      totalTokens: row.total_tokens ?? 0,
      totalCostCents: row.total_cost_cents ?? 0,
      avgCostPerExecution: row.total_executions > 0
        ? Math.round((row.total_cost_cents ?? 0) / row.total_executions)
        : 0,
      period: { from: from.toISOString(), to: to.toISOString() },
    };
  }

  /**
   * Get cost breakdown for a specific agent instance.
   */
  async getAgentCostBreakdown(
    agentInstanceId: string,
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<AgentCostBreakdown> {
    const db = getDb();

    // By model
    const byModelRows = db.prepare(`
      SELECT
        model_used,
        SUM(input_tokens + output_tokens) as tokens,
        SUM(cost_cents) as cost_cents,
        COUNT(*) as executions
      FROM agent_executions
      WHERE agent_instance_id = ? AND tenant_id = ?
        AND created_at >= ? AND created_at <= ?
      GROUP BY model_used
    `).all(agentInstanceId, tenantId, from.toISOString(), to.toISOString()) as any[];

    const byModel: AgentCostBreakdown['byModel'] = {};
    for (const row of byModelRows) {
      byModel[row.model_used ?? 'unknown'] = {
        tokens: row.tokens ?? 0,
        costCents: row.cost_cents ?? 0,
        executions: row.executions,
      };
    }

    // By day
    const byDayRows = db.prepare(`
      SELECT
        DATE(created_at) as day,
        SUM(input_tokens + output_tokens) as tokens,
        SUM(cost_cents) as cost_cents,
        COUNT(*) as executions
      FROM agent_executions
      WHERE agent_instance_id = ? AND tenant_id = ?
        AND created_at >= ? AND created_at <= ?
      GROUP BY DATE(created_at)
      ORDER BY day
    `).all(agentInstanceId, tenantId, from.toISOString(), to.toISOString()) as any[];

    const byDay: AgentCostBreakdown['byDay'] = {};
    for (const row of byDayRows) {
      byDay[row.day] = {
        tokens: row.tokens ?? 0,
        costCents: row.cost_cents ?? 0,
        executions: row.executions,
      };
    }

    // By tool
    const byToolRows = db.prepare(`
      SELECT
        tools_used,
        COUNT(*) as executions,
        SUM(cost_cents) as cost_cents
      FROM agent_executions
      WHERE agent_instance_id = ? AND tenant_id = ?
        AND created_at >= ? AND created_at <= ?
        AND tools_used != '[]'
      GROUP BY tools_used
    `).all(agentInstanceId, tenantId, from.toISOString(), to.toISOString()) as any[];

    const byTool: AgentCostBreakdown['byTool'] = {};
    for (const row of byToolRows) {
      const tools: string[] = JSON.parse(row.tools_used || '[]');
      for (const tool of tools) {
        if (!byTool[tool]) byTool[tool] = { executions: 0, costCents: 0 };
        byTool[tool].executions += row.executions;
        byTool[tool].costCents += row.cost_cents ?? 0;
      }
    }

    return { byModel, byDay, byTool };
  }

  /**
   * Get cost summary for all agents in a tenant.
   */
  async getTenantAgentCosts(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<AgentCostSummary[]> {
    const db = getDb();

    const rows = db.prepare(`
      SELECT
        ae.agent_instance_id,
        ad.name as agent_name,
        COUNT(*) as total_executions,
        SUM(ae.input_tokens + ae.output_tokens) as total_tokens,
        SUM(ae.cost_cents) as total_cost_cents
      FROM agent_executions ae
      JOIN agent_instances ai ON ae.agent_instance_id = ai.id
      JOIN agent_definitions ad ON ai.agent_definition_id = ad.id
      WHERE ae.tenant_id = ?
        AND ae.created_at >= ?
        AND ae.created_at <= ?
      GROUP BY ae.agent_instance_id
      ORDER BY total_cost_cents DESC
    `).all(tenantId, from.toISOString(), to.toISOString()) as any[];

    return rows.map((row) => ({
      agentInstanceId: row.agent_instance_id,
      agentName: row.agent_name,
      totalExecutions: row.total_executions,
      totalTokens: row.total_tokens ?? 0,
      totalCostCents: row.total_cost_cents ?? 0,
      avgCostPerExecution: row.total_executions > 0
        ? Math.round((row.total_cost_cents ?? 0) / row.total_executions)
        : 0,
      period: { from: from.toISOString(), to: to.toISOString() },
    }));
  }

  /**
   * Record cost for an agent execution.
   */
  async recordExecutionCost(
    executionId: string,
    costCents: number,
  ): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE agent_executions SET cost_cents = ? WHERE id = ?')
      .run(costCents, executionId);
  }
}

export const agentBillingService = new AgentBillingService();
