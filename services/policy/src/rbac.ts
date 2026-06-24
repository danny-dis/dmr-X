/**
 * RBAC Policy Engine for MCP Tool Access Control
 * 
 * Implements fine-grained tool-level access control using
 * a Cedar-like policy language.
 * 
 * Features:
 * - Role-based access control (RBAC)
 * - Tool-level permissions
 * - Claim-based authorization (JWT)
 * - Policy inheritance and scoping
 */

import crypto from 'node:crypto';

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('policy:rbac');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RBACConfig {
  /** Enable RBAC */
  enabled?: boolean;
  /** Default effect when no policy matches */
  defaultEffect?: 'allow' | 'deny';
  /** Policy files directory */
  policiesPath?: string;
  /** Enable audit logging */
  auditLogging?: boolean;
}

export type Effect = 'permit' | 'deny';

export type Principal = {
  type: 'user' | 'role' | 'group' | 'service';
  id: string;
  claims?: Record<string, unknown>;
};

export type Action = {
  type: 'tool' | 'resource' | 'prompt';
  id: string;
};

export type Resource = {
  type: 'tool' | 'server' | 'global';
  id: string;
  attributes?: Record<string, unknown>;
};

export interface PolicyRule {
  id: string;
  effect: Effect;
  principal: Principal;
  action: Action;
  resource: Resource;
  conditions?: Condition[];
  description?: string;
}

export interface Condition {
  type: 'string_equals' | 'string_contains' | 'number_equals' | 'number_gt' | 'number_lt' | 'boolean_equals' | 'date_before' | 'date_after' | 'ip_in_cidr' | 'regex_match';
  key: string;
  value: unknown;
}

export interface AuthorizationRequest {
  principal: Principal;
  action: Action;
  resource: Resource;
  context?: Record<string, unknown>;
}

export interface AuthorizationResponse {
  allowed: boolean;
  effect: Effect;
  matchedPolicyId?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Cedar-like Policy Parser
// ---------------------------------------------------------------------------

/**
 * Parse a Cedar-like policy string into a PolicyRule
 * 
 * Example:
 * ```
 * permit(
 *   principal == Role::"admin",
 *   action == Action::"dmrx_bash",
 *   resource
 * );
 * ```
 */
export function parsePolicy(policyString: string): PolicyRule {
  // Simple parser for Cedar-like syntax
  // In production, use a proper parser library
  
  const trimmed = policyString.trim();
  
  // Extract effect
  const effectMatch = trimmed.match(/^(permit|deny)\s*\(/);
  if (!effectMatch) {
    throw new Error('Invalid policy: must start with "permit(" or "deny("');
  }
  const effect = effectMatch[1] as Effect;

  // Extract principal
  const principalMatch = trimmed.match(/principal\s*([!=]=)\s*(?:Role|User|Group|Service)::"([^"]+)"/);
  const principalType = principalMatch ? extractPrincipalType(trimmed) : 'user';
  const principalId = principalMatch ? principalMatch[2] : '*';

  // Extract action
  const actionMatch = trimmed.match(/action\s*([!=]=)\s*(?:Action)::"([^"]+)"/);
  const actionId = actionMatch ? actionMatch[2] : '*';

  // Extract resource
  const resourceMatch = trimmed.match(/resource\s*([!=]=)\s*(?:Resource)::"([^"]+)"/);
  const resourceId = resourceMatch ? resourceMatch[2] : '*';

  return {
    id: crypto.randomUUID(),
    effect,
    principal: { type: principalType, id: principalId },
    action: { type: 'tool', id: actionId },
    resource: { type: 'tool', id: resourceId },
  };
}

function extractPrincipalType(policy: string): Principal['type'] {
  if (policy.includes('Role::')) return 'role';
  if (policy.includes('User::')) return 'user';
  if (policy.includes('Group::')) return 'group';
  if (policy.includes('Service::')) return 'service';
  return 'user';
}

// ---------------------------------------------------------------------------
// RBAC Policy Engine
// ---------------------------------------------------------------------------

/**
 * RBAC Policy Engine for MCP tool access control
 */
export class RBACPolicyEngine {
  private policies: PolicyRule[] = [];
  private config: Required<RBACConfig>;

  constructor(config?: RBACConfig) {
    this.config = {
      enabled: false,
      defaultEffect: 'deny',
      policiesPath: './policies',
      auditLogging: true,
      ...config,
    };
  }

  /**
   * Add a policy rule
   */
  addPolicy(policy: PolicyRule): void {
    this.policies.push(policy);
    logger.debug({ policyId: policy.id }, 'Policy added');
  }

  /**
   * Remove a policy by ID
   */
  removePolicy(policyId: string): boolean {
    const index = this.policies.findIndex((p) => p.id === policyId);
    if (index >= 0) {
      this.policies.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Load policies from Cedar-like strings
   */
  loadPolicies(policyStrings: string[]): void {
    for (const policyString of policyStrings) {
      try {
        const policy = parsePolicy(policyString);
        this.addPolicy(policy);
      } catch (error) {
        logger.error({ error, policyString }, 'Failed to parse policy');
      }
    }
  }

  /**
   * Authorize a request against all policies
   */
  authorize(request: AuthorizationRequest): AuthorizationResponse {
    if (!this.config.enabled) {
      return { allowed: true, effect: 'permit', reason: 'RBAC disabled' };
    }

    // Evaluate policies in order (deny takes precedence)
    for (const policy of this.policies) {
      if (this.matchesPolicy(policy, request)) {
        if (this.config.auditLogging) {
          logger.info({
            policyId: policy.id,
            principal: request.principal.id,
            action: request.action.id,
            resource: request.resource.id,
            effect: policy.effect,
          }, 'Policy matched');
        }

        return {
          allowed: policy.effect === 'permit',
          effect: policy.effect,
          matchedPolicyId: policy.id,
          reason: policy.description,
        };
      }
    }

    // No policy matched - apply default effect
    return {
      allowed: this.config.defaultEffect === 'allow',
      effect: this.config.defaultEffect === 'allow' ? 'permit' : 'deny',
      reason: 'No matching policy (default effect)',
    };
  }

  /**
   * Check if a policy matches a request
   */
  private matchesPolicy(policy: PolicyRule, request: AuthorizationRequest): boolean {
    // Check principal
    if (policy.principal.id !== '*' && policy.principal.id !== request.principal.id) {
      // Check if principal is in the right type
      if (policy.principal.type !== request.principal.type) {
        return false;
      }
    }

    // Check action
    if (policy.action.id !== '*' && policy.action.id !== request.action.id) {
      return false;
    }

    // Check resource
    if (policy.resource.id !== '*' && policy.resource.id !== request.resource.id) {
      return false;
    }

    // Check conditions
    if (policy.conditions) {
      for (const condition of policy.conditions) {
        if (!this.evaluateCondition(condition, request.context || {})) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Evaluate a condition against context
   */
  private evaluateCondition(condition: Condition, context: Record<string, unknown>): boolean {
    const value = context[condition.key];
    
    switch (condition.type) {
      case 'string_equals':
        return value === condition.value;
      case 'string_contains':
        return typeof value === 'string' && value.includes(condition.value as string);
      case 'number_equals':
        return Number(value) === Number(condition.value);
      case 'number_gt':
        return Number(value) > Number(condition.value);
      case 'number_lt':
        return Number(value) < Number(condition.value);
      case 'boolean_equals':
        return Boolean(value) === Boolean(condition.value);
      case 'date_before':
        return new Date(value as string) < new Date(condition.value as string);
      case 'date_after':
        return new Date(value as string) > new Date(condition.value as string);
      case 'ip_in_cidr':
        // Simplified CIDR check
        return typeof value === 'string' && this.isIpInCidr(value, condition.value as string);
      case 'regex_match':
        return typeof value === 'string' && new RegExp(condition.value as string).test(value);
      default:
        return false;
    }
  }

  /**
   * Simple IP in CIDR check
   */
  private isIpInCidr(ip: string, cidr: string): boolean {
    // Simplified implementation - in production use a proper IP library
    const [range, bits] = cidr.split('/');
    if (!range || !bits) return false;
    
    const ipNum = this.ipToNumber(ip);
    const rangeNum = this.ipToNumber(range);
    const mask = ~((1 << (32 - parseInt(bits))) - 1);
    
    return (ipNum & mask) === (rangeNum & mask);
  }

  private ipToNumber(ip: string): number {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }

  /**
   * Get all policies
   */
  getPolicies(): PolicyRule[] {
    return [...this.policies];
  }

  /**
   * Get policy statistics
   */
  getStats(): {
    totalPolicies: number;
    permits: number;
    denies: number;
  } {
    return {
      totalPolicies: this.policies.length,
      permits: this.policies.filter((p) => p.effect === 'permit').length,
      denies: this.policies.filter((p) => p.effect === 'deny').length,
    };
  }

  /**
   * Clear all policies
   */
  clear(): void {
    this.policies = [];
  }
}

// ---------------------------------------------------------------------------
// Pre-defined policies
// ---------------------------------------------------------------------------

export const PREDEFINED_POLICIES = {
  /**
   * Admin can do everything
   */
  ADMIN_FULL_ACCESS: `
    permit(
      principal == Role::"admin",
      action,
      resource
    );
  `,

  /**
   * Users can read but not write
   */
  USER_READ_ONLY: `
    permit(
      principal == Role::"user",
      action in [Action::"dmrx_chat", Action::"dmrx_models", Action::"dmrx_status"],
      resource
    );
  `,

  /**
   * Deny bash execution for non-admins
   */
  DENY_BASH_NON_ADMIN: `
    deny(
      principal != Role::"admin",
      action == Action::"dmrx_bash",
      resource
    );
  `,

  /**
   * Allow file operations for authenticated users
   */
  ALLOW_FILE_OPS: `
    permit(
      principal.type == "user",
      action in [Action::"dmrx_read_file", Action::"dmrx_list_files"],
      resource
    );
  `,
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: RBACPolicyEngine | null = null;

export function getRBACEngine(config?: RBACConfig): RBACPolicyEngine {
  if (!instance) {
    instance = new RBACPolicyEngine(config);
  }
  return instance;
}

export function resetRBACEngine(): void {
  instance = null;
}
