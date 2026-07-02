import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Agent RBAC Permissions
// ---------------------------------------------------------------------------

export type AgentPermission =
  | 'agent:create'
  | 'agent:read'
  | 'agent:update'
  | 'agent:delete'
  | 'agent:deploy'
  | 'agent:chat'
  | 'agent:publish'
  | 'agent:install'
  | 'agent:rate'
  | 'agent:billing:read'
  | 'agent:analytics:read';

export interface AgentRole {
  id: string;
  name: string;
  permissions: AgentPermission[];
}

// Default roles
export const AGENT_ROLES: Record<string, AgentRole> = {
  admin: {
    id: 'admin',
    name: 'Admin',
    permissions: [
      'agent:create', 'agent:read', 'agent:update', 'agent:delete',
      'agent:deploy', 'agent:chat', 'agent:publish', 'agent:install',
      'agent:rate', 'agent:billing:read', 'agent:analytics:read',
    ],
  },
  developer: {
    id: 'developer',
    name: 'Developer',
    permissions: [
      'agent:create', 'agent:read', 'agent:update', 'agent:delete',
      'agent:deploy', 'agent:chat', 'agent:publish', 'agent:install',
      'agent:rate', 'agent:analytics:read',
    ],
  },
  user: {
    id: 'user',
    name: 'User',
    permissions: [
      'agent:read', 'agent:chat', 'agent:install', 'agent:rate',
    ],
  },
  viewer: {
    id: 'viewer',
    name: 'Viewer',
    permissions: [
      'agent:read', 'agent:analytics:read',
    ],
  },
};

// ---------------------------------------------------------------------------
// Permission Service
// ---------------------------------------------------------------------------

export class AgentPermissionService {
  /**
   * Check if a user/role has a specific permission.
   */
  hasPermission(role: string, permission: AgentPermission): boolean {
    const agentRole = AGENT_ROLES[role];
    if (!agentRole) return false;
    return agentRole.permissions.includes(permission);
  }

  /**
   * Get all permissions for a role.
   */
  getRolePermissions(role: string): AgentPermission[] {
    const agentRole = AGENT_ROLES[role];
    return agentRole?.permissions ?? [];
  }

  /**
   * Get all available roles.
   */
  getRoles(): AgentRole[] {
    return Object.values(AGENT_ROLES);
  }

  /**
   * Middleware-style permission check.
   * Returns true if allowed, false if denied.
   */
  checkPermission(
    tenantRole: string | undefined,
    permission: AgentPermission,
    resourceTenantId?: string,
    requestTenantId?: string,
  ): boolean {
    // If no role, deny
    if (!tenantRole) return false;

    // Check base permission
    if (!this.hasPermission(tenantRole, permission)) return false;

    // For cross-tenant operations, verify tenant match
    if (resourceTenantId && requestTenantId && resourceTenantId !== requestTenantId) {
      // Only admins can access cross-tenant resources
      return tenantRole === 'admin';
    }

    return true;
  }
}

export const agentPermissionService = new AgentPermissionService();
