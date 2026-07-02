import { describe, it, expect } from 'vitest';

import {
  agentPermissionService,
  AGENT_ROLES,
  type AgentPermission,
} from '../../services/agent-registry/src/agent-permissions.js';

describe('agent-permissions', () => {
  describe('hasPermission', () => {
    it('admin should have all permissions', () => {
      const allPermissions: AgentPermission[] = [
        'agent:create', 'agent:read', 'agent:update', 'agent:delete',
        'agent:deploy', 'agent:chat', 'agent:publish', 'agent:install',
        'agent:rate', 'agent:billing:read', 'agent:analytics:read',
      ];

      for (const perm of allPermissions) {
        expect(agentPermissionService.hasPermission('admin', perm)).toBe(true);
      }
    });

    it('viewer should only have read and analytics', () => {
      expect(agentPermissionService.hasPermission('viewer', 'agent:read')).toBe(true);
      expect(agentPermissionService.hasPermission('viewer', 'agent:analytics:read')).toBe(true);
      expect(agentPermissionService.hasPermission('viewer', 'agent:create')).toBe(false);
      expect(agentPermissionService.hasPermission('viewer', 'agent:delete')).toBe(false);
      expect(agentPermissionService.hasPermission('viewer', 'agent:deploy')).toBe(false);
    });

    it('user should be able to chat and install', () => {
      expect(agentPermissionService.hasPermission('user', 'agent:chat')).toBe(true);
      expect(agentPermissionService.hasPermission('user', 'agent:install')).toBe(true);
      expect(agentPermissionService.hasPermission('user', 'agent:create')).toBe(false);
      expect(agentPermissionService.hasPermission('user', 'agent:publish')).toBe(false);
    });

    it('developer should be able to create, deploy, and publish', () => {
      expect(agentPermissionService.hasPermission('developer', 'agent:create')).toBe(true);
      expect(agentPermissionService.hasPermission('developer', 'agent:deploy')).toBe(true);
      expect(agentPermissionService.hasPermission('developer', 'agent:publish')).toBe(true);
      expect(agentPermissionService.hasPermission('developer', 'agent:billing:read')).toBe(false);
    });

    it('unknown role should have no permissions', () => {
      expect(agentPermissionService.hasPermission('unknown', 'agent:read')).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('should allow admin to create', () => {
      expect(agentPermissionService.checkPermission('admin', 'agent:create')).toBe(true);
    });

    it('should deny viewer create', () => {
      expect(agentPermissionService.checkPermission('viewer', 'agent:create')).toBe(false);
    });

    it('should deny when no role', () => {
      expect(agentPermissionService.checkPermission(undefined, 'agent:read')).toBe(false);
    });

    it('should deny cross-tenant access for non-admin', () => {
      expect(
        agentPermissionService.checkPermission('developer', 'agent:read', 'other-tenant', 'my-tenant')
      ).toBe(false);
    });

    it('should allow admin cross-tenant access', () => {
      expect(
        agentPermissionService.checkPermission('admin', 'agent:read', 'other-tenant', 'my-tenant')
      ).toBe(true);
    });
  });

  describe('getRoles', () => {
    it('should return 4 roles', () => {
      const roles = agentPermissionService.getRoles();
      expect(roles).toHaveLength(4);
      expect(roles.map((r) => r.id)).toEqual(
        expect.arrayContaining(['admin', 'developer', 'user', 'viewer'])
      );
    });
  });

  describe('getRolePermissions', () => {
    it('admin should have more permissions than viewer', () => {
      const adminPerms = agentPermissionService.getRolePermissions('admin');
      const viewerPerms = agentPermissionService.getRolePermissions('viewer');
      expect(adminPerms.length).toBeGreaterThan(viewerPerms.length);
    });

    it('unknown role should return empty', () => {
      expect(agentPermissionService.getRolePermissions('nonexistent')).toEqual([]);
    });
  });
});
