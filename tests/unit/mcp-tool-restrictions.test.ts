import { describe, it, expect } from 'vitest';

import { createDMRXMcpServer, isToolAllowed } from '../../services/mcp-server/src/server.js';
import { TOOL_NAMES } from '../../services/mcp-server/src/tools.js';

describe('MCP Tool Restrictions', () => {
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
  });
});
