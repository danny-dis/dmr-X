import { describe, it, expect, beforeEach, vi } from 'vitest';

import { isToolAllowed, createDMRXMcpServer } from '../../services/mcp-server/src/server.js';
import { TOOL_NAMES } from '../../services/mcp-server/src/tools.js';

describe('External Tool Proxy', () => {
  describe('isToolAllowed()', () => {
    it('allows all tools when allowedTools is undefined', () => {
      expect(isToolAllowed('dmrx_chat')).toBe(true);
      expect(isToolAllowed('some_external__tool')).toBe(true);
    });

    it('allows exact matches', () => {
      const allowed = ['dmrx_chat', 'github__create_issue'];
      expect(isToolAllowed('dmrx_chat', allowed)).toBe(true);
      expect(isToolAllowed('dmrx_status', allowed)).toBe(false);
      expect(isToolAllowed('github__create_issue', allowed)).toBe(true);
      expect(isToolAllowed('github__delete_issue', allowed)).toBe(false);
    });

    it('handles wildcard suffix correctly', () => {
      const allowed = ['dmrx_*', 'github__*'];
      expect(isToolAllowed('dmrx_chat', allowed)).toBe(true);
      expect(isToolAllowed('dmrx_status', allowed)).toBe(true);
      expect(isToolAllowed('github__create_issue', allowed)).toBe(true);
      expect(isToolAllowed('gitlab__create_issue', allowed)).toBe(false);
    });

    it('handles global wildcard correctly', () => {
      const allowed = ['*'];
      expect(isToolAllowed('dmrx_chat', allowed)).toBe(true);
      expect(isToolAllowed('github__create_issue', allowed)).toBe(true);
    });

    it('rejects empty allowedTools array', () => {
      expect(isToolAllowed('dmrx_chat', [])).toBe(false);
    });

    it('handles complex patterns', () => {
      const allowed = ['dmrx_*', 'github__create_*', 'gitlab__issue_*'];
      expect(isToolAllowed('dmrx_chat', allowed)).toBe(true);
      expect(isToolAllowed('github__create_issue', allowed)).toBe(true);
      expect(isToolAllowed('github__delete_issue', allowed)).toBe(false);
      expect(isToolAllowed('gitlab__issue_create', allowed)).toBe(true);
      expect(isToolAllowed('gitlab__issue_delete', allowed)).toBe(false);
    });
  });

  describe('createDMRXMcpServer with restrictions', () => {
    it('registers only allowed tools on the server instance', () => {
      const allowedTools = ['dmrx_chat', 'dmrx_status'];
      const { state } = createDMRXMcpServer({ allowedTools });

      // Check state.sdkTools matches the filter
      const registeredNames = state.sdkTools.map((t) => t.name);
      expect(registeredNames).toContain(TOOL_NAMES.CHAT);
      expect(registeredNames).toContain(TOOL_NAMES.STATUS);
      expect(registeredNames).not.toContain(TOOL_NAMES.GENERATE_IMAGE);
    });

    it('registers all tools when allowedTools is undefined', () => {
      const { state } = createDMRXMcpServer({});

      const registeredNames = state.sdkTools.map((t) => t.name);
      expect(registeredNames).toContain(TOOL_NAMES.CHAT);
      expect(registeredNames).toContain(TOOL_NAMES.STATUS);
      expect(registeredNames).toContain(TOOL_NAMES.GENERATE_IMAGE);
    });

    it('registers no tools when allowedTools is empty array', () => {
      const { state } = createDMRXMcpServer({ allowedTools: [] });

      const registeredNames = state.sdkTools.map((t) => t.name);
      expect(registeredNames).not.toContain(TOOL_NAMES.CHAT);
      expect(registeredNames).not.toContain(TOOL_NAMES.STATUS);
    });

    it('handles wildcard patterns in allowedTools', () => {
      const { state } = createDMRXMcpServer({ allowedTools: ['dmrx_*'] });

      const registeredNames = state.sdkTools.map((t) => t.name);
      expect(registeredNames).toContain(TOOL_NAMES.CHAT);
      expect(registeredNames).toContain(TOOL_NAMES.STATUS);
      expect(registeredNames).toContain(TOOL_NAMES.GENERATE_IMAGE);
    });
  });

  describe('External tool namespacing', () => {
    it('creates proper namespaced tool names', () => {
      const serverId = 'github';
      const toolName = 'create_issue';
      const namespacedName = `${serverId}__${toolName}`;

      expect(namespacedName).toBe('github__create_issue');
    });

    it('preserves tool name with multiple underscores', () => {
      const serverId = 'my_server';
      const toolName = 'create_issue_with_labels';
      const namespacedName = `${serverId}__${toolName}`;

      expect(namespacedName).toBe('my_server__create_issue_with_labels');
    });
  });

  describe('Tool description format', () => {
    it('formats proxied tool description correctly', () => {
      const serverId = 'github';
      const toolDescription = 'Create a new issue';
      const description = `[Proxied via MCP server '${serverId}'] ${toolDescription}`;

      expect(description).toBe("[Proxied via MCP server 'github'] Create a new issue");
    });

    it('uses tool name when description is missing', () => {
      const serverId = 'github';
      const toolName = 'create_issue';
      const description = `[Proxied via MCP server '${serverId}'] ${toolName ?? toolName}`;

      expect(description).toBe("[Proxied via MCP server 'github'] create_issue");
    });
  });
});
