/**
 * Tool Invocation Policy Engine for DMR-X
 *
 * Evaluates tool calls against policies before execution.
 * Supports per-tenant, per-tool policies with approval workflows.
 *
 * Based on Archestra's tool-invocation.ts pattern but deterministic (no LLM).
 */

import { getDb } from '@dmr-x/db';
import { createLogger } from '@dmr-x/utils';
import crypto from 'node:crypto';

const logger = createLogger('mcp-server:tool-policy');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicyAction = 'allow' | 'deny' | 'require_approval';

export interface ToolInvocationPolicy {
  id: string;
  tenant_id: string;
  tool_name: string;
  action: PolicyAction;
  /** JSON conditions for matching tool input */
  conditions?: string;
  priority: number;
  description?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface PolicyEvaluationContext {
  tenant_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  request_id?: string;
  user_id?: string;
  ip_address?: string;
}

export interface PolicyEvaluationResult {
  /** Whether the tool call is allowed */
  allowed: boolean;
  /** The action taken */
  action: PolicyAction;
  /** The policy that matched (if any) */
  policy?: ToolInvocationPolicy;
  /** Reason for denial/approval requirement */
  reason?: string;
}

export interface PolicyBlockResult {
  refusalMessage: string;
  contentMessage: string;
  reason: string;
  blockedToolName: string;
}

// ---------------------------------------------------------------------------
// Policy Engine
// ---------------------------------------------------------------------------

export class ToolInvocationPolicyEngine {
  /**
   * Evaluate a tool call against policies
   */
  evaluate(context: PolicyEvaluationContext): PolicyEvaluationResult {
    const db = getDb();

    // Get tenant-specific policies (sorted by priority descending)
    const tenantPolicies = db.prepare(`
      SELECT * FROM tool_invocation_policies
      WHERE tenant_id = ? AND tool_name = ? AND is_active = 1
      ORDER BY priority DESC
    `).all(context.tenant_id, context.tool_name) as unknown as ToolInvocationPolicy[];

    // Get global policies (tenant_id = '*')
    const globalPolicies = db.prepare(`
      SELECT * FROM tool_invocation_policies
      WHERE tenant_id = '*' AND tool_name = ? AND is_active = 1
      ORDER BY priority DESC
    `).all(context.tool_name) as unknown as ToolInvocationPolicy[];

    // Evaluate tenant policies first (sorted by priority desc), then global (sorted by priority desc)
    const allPolicies = [
      ...tenantPolicies.sort((a, b) => b.priority - a.priority),
      ...globalPolicies.sort((a, b) => b.priority - a.priority),
    ];

    for (const policy of allPolicies) {
      if (this.matchesPolicy(policy, context)) {
        // Log the evaluation
        this.logEvaluation(context, policy.action, policy.id);

        return {
          allowed: policy.action === 'allow',
          action: policy.action,
          policy,
          reason: policy.description || `Policy ${policy.action}: ${policy.tool_name}`,
        };
      }
    }

    // No policy matched - default to allow (permissive by default)
    this.logEvaluation(context, 'allow', undefined);

    return {
      allowed: true,
      action: 'allow',
    };
  }

  /**
   * Evaluate multiple tool calls in batch (more efficient)
   */
  evaluateBatch(
    contexts: PolicyEvaluationContext[]
  ): Map<number, PolicyEvaluationResult> {
    const results = new Map<number, PolicyEvaluationResult>();

    for (let i = 0; i < contexts.length; i++) {
      results.set(i, this.evaluate(contexts[i]));
    }

    return results;
  }

  /**
   * Check if a policy matches the given context
   */
  private matchesPolicy(
    policy: ToolInvocationPolicy,
    context: PolicyEvaluationContext
  ): boolean {
    // Tool name matching (supports wildcards)
    if (!this.matchToolName(policy.tool_name, context.tool_name)) {
      return false;
    }

    // If no conditions, policy matches all inputs
    if (!policy.conditions) {
      return true;
    }

    // Evaluate conditions
    try {
      const conditions = JSON.parse(policy.conditions);
      return this.evaluateConditions(conditions, context.tool_input);
    } catch (err) {
      logger.warn({ err, policyId: policy.id }, 'Failed to parse policy conditions');
      return false;
    }
  }

  /**
   * Match tool name with wildcard support
   */
  private matchToolName(pattern: string, toolName: string): boolean {
    if (pattern === '*') return true;
    if (pattern === toolName) return true;

    // Support glob patterns
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      );
      return regex.test(toolName);
    }

    return false;
  }

  /**
   * Evaluate conditions against tool input
   */
  private evaluateConditions(
    conditions: Record<string, unknown>,
    toolInput: Record<string, unknown>
  ): boolean {
    for (const [key, expectedValue] of Object.entries(conditions)) {
      const actualValue = toolInput[key];

      if (expectedValue === null || expectedValue === undefined) {
        // Check if field exists
        if (actualValue === undefined) return false;
        continue;
      }

      if (typeof expectedValue === 'object' && expectedValue !== null) {
        // Nested condition matching
        if (typeof actualValue !== 'object' || actualValue === null) {
          return false;
        }
        if (!this.evaluateConditions(
          expectedValue as Record<string, unknown>,
          actualValue as Record<string, unknown>
        )) {
          return false;
        }
        continue;
      }

      // Simple value matching
      if (actualValue !== expectedValue) {
        return false;
      }
    }

    return true;
  }

  /**
   * Log policy evaluation for audit
   */
  private logEvaluation(
    context: PolicyEvaluationContext,
    result: string,
    policyId?: string
  ): void {
    const db = getDb();
    const id = crypto.randomUUID();
    const inputHash = this.hashInput(context.tool_input);

    try {
      db.prepare(`
        INSERT INTO tool_policy_audit_log
        (id, tenant_id, tool_name, tool_input_hash, result, policy_id, request_id, user_id, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        context.tenant_id,
        context.tool_name,
        inputHash,
        result,
        policyId || null,
        context.request_id || null,
        context.user_id || null,
        context.ip_address || null
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to log policy evaluation');
    }
  }

  /**
   * Hash tool input for deduplication
   */
  private hashInput(input: Record<string, unknown>): string {
    const str = JSON.stringify(input, Object.keys(input).sort());
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  // -------------------------------------------------------------------------
  // CRUD Operations
  // -------------------------------------------------------------------------

  /**
   * Create a new policy
   */
  createPolicy(policy: Omit<ToolInvocationPolicy, 'id' | 'created_at' | 'updated_at'>): ToolInvocationPolicy {
    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO tool_invocation_policies
      (id, tenant_id, tool_name, action, conditions, priority, description, created_by, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      policy.tenant_id,
      policy.tool_name,
      policy.action,
      policy.conditions || null,
      policy.priority,
      policy.description || null,
      policy.created_by || null,
      policy.is_active ? 1 : 0
    );

    return this.getPolicy(id)!;
  }

  /**
   * Get a policy by ID
   */
  getPolicy(id: string): ToolInvocationPolicy | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM tool_invocation_policies WHERE id = ?
    `).get(id) as any;

    return row ? this.mapRow(row) : null;
  }

  /**
   * Update a policy
   */
  updatePolicy(id: string, updates: Partial<ToolInvocationPolicy>): boolean {
    const db = getDb();
    const existing = this.getPolicy(id);
    if (!existing) return false;

    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };

    db.prepare(`
      UPDATE tool_invocation_policies
      SET action = ?, conditions = ?, priority = ?, description = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.action,
      updated.conditions || null,
      updated.priority,
      updated.description || null,
      updated.is_active ? 1 : 0,
      updated.updated_at,
      id
    );

    return true;
  }

  /**
   * Delete a policy (soft delete)
   */
  deletePolicy(id: string): boolean {
    const db = getDb();
    const result = db.prepare(`
      UPDATE tool_invocation_policies SET is_active = 0 WHERE id = ?
    `).run(id);
    return result.changes > 0;
  }

  /**
   * List policies for a tenant
   */
  listPolicies(tenantId: string, toolName?: string): ToolInvocationPolicy[] {
    const db = getDb();
    let query = `
      SELECT * FROM tool_invocation_policies
      WHERE tenant_id = ? AND is_active = 1
    `;
    const params: unknown[] = [tenantId];

    if (toolName) {
      query += ` AND tool_name = ?`;
      params.push(toolName);
    }

    query += ` ORDER BY priority DESC, tool_name`;

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(this.mapRow);
  }

  /**
   * Map database row to policy object
   */
  private mapRow(row: any): ToolInvocationPolicy {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      tool_name: row.tool_name,
      action: row.action,
      conditions: row.conditions,
      priority: row.priority,
      description: row.description,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_active: row.is_active === 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ToolInvocationPolicyEngine | null = null;

export function getToolInvocationPolicyEngine(): ToolInvocationPolicyEngine {
  if (!instance) {
    instance = new ToolInvocationPolicyEngine();
  }
  return instance;
}

/**
 * Build a policy block result for tool denial
 */
export function buildPolicyBlockResult(params: {
  toolName: string;
  toolInput: Record<string, unknown>;
  reason: string;
}): PolicyBlockResult {
  const toolArguments = JSON.stringify(params.toolInput);

  const contentMessage = `Tool "${params.toolName}" was blocked by policy: ${params.reason}`;

  return {
    refusalMessage: contentMessage,
    contentMessage,
    reason: params.reason,
    blockedToolName: params.toolName,
  };
}
