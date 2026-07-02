import type { FastifyRequest, FastifyReply } from 'fastify';

import { agentPermissionService, type AgentPermission } from '@dmr-x/agent-registry';

// ---------------------------------------------------------------------------
// Agent RBAC Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware that checks if the current tenant has the required agent permission.
 *
 * Tenant roles are resolved from the tenant object attached by auth middleware.
 * Falls back to 'viewer' if no role is set.
 */
export function requireAgentPermission(permission: AgentPermission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = (request as any).tenant;
    if (!tenant) {
      return reply.code(401).send({ error: { message: 'Unauthorized' } });
    }

    const role = tenant.role ?? 'viewer';

    if (!agentPermissionService.checkPermission(role, permission)) {
      return reply.code(403).send({
        error: {
          message: 'Forbidden',
          detail: `Role "${role}" does not have permission "${permission}"`,
        },
      });
    }
  };
}

/**
 * Convenience middleware factory for common agent operations.
 */
export const agentPermissions = {
  create: () => requireAgentPermission('agent:create'),
  read: () => requireAgentPermission('agent:read'),
  update: () => requireAgentPermission('agent:update'),
  delete: () => requireAgentPermission('agent:delete'),
  deploy: () => requireAgentPermission('agent:deploy'),
  chat: () => requireAgentPermission('agent:chat'),
  publish: () => requireAgentPermission('agent:publish'),
  install: () => requireAgentPermission('agent:install'),
  rate: () => requireAgentPermission('agent:rate'),
  billingRead: () => requireAgentPermission('agent:billing:read'),
  analyticsRead: () => requireAgentPermission('agent:analytics:read'),
};
