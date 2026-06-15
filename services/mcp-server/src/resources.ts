/**
 * MCP Resources for DMR-X.
 *
 * Resources are read-only data entities exposed via URI-based access.
 * They separate read-only data from actionable tools.
 *
 * URI schemes:
 *   dmrx://models          — Available models list
 *   dmrx://providers       — Provider health status
 *   dmrx://contexts/{id}   — Saved conversation contexts
 *   dmrx://config          — Server configuration (redacted)
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ResourceConfig {
  /** Base path for the MCP server file system (if needed) */
  basePath?: string;
}

/**
 * Registers MCP resources on the given server.
 */
export function registerResources(server: McpServer, config: ResourceConfig = {}): void {
  // -----------------------------------------------------------------------
  // Resource: dmrx://models — Available models list
  // -----------------------------------------------------------------------
  server.resource(
    'available-models',
    'dmrx://models',
    {
      description: 'List of all available AI models in DMR-X, including capabilities and health status',
      mimeType: 'application/json',
    },
    async (uri) => {
      // This will be populated at runtime by the server state
      // For now, return a placeholder that the tool handler can fill
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            description: 'Use dmrx_models tool to get current model list',
            note: 'This resource provides a snapshot; use the tool for real-time data',
          }, null, 2),
        }],
      };
    }
  );

  // -----------------------------------------------------------------------
  // Resource: dmrx://providers — Provider health status
  // -----------------------------------------------------------------------
  server.resource(
    'provider-health',
    'dmrx://providers',
    {
      description: 'Health status of all configured AI providers',
      mimeType: 'application/json',
    },
    async (uri) => {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            description: 'Use dmrx_status tool with include_providers=true for real-time health data',
            note: 'This resource provides a snapshot; use the tool for real-time data',
          }, null, 2),
        }],
      };
    }
  );

  // -----------------------------------------------------------------------
  // Resource: dmrx://config — Server configuration (redacted)
  // -----------------------------------------------------------------------
  server.resource(
    'server-config',
    'dmrx://config',
    {
      description: 'DMR-X MCP server configuration (API keys redacted)',
      mimeType: 'application/json',
    },
    async (uri) => {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            version: '0.1.0',
            transport: process.env.DMRX_MCP_TRANSPORT || 'stdio',
            port: parseInt(process.env.DMRX_MCP_PORT || '3100', 10),
            host: process.env.DMRX_MCP_HOST || '127.0.0.1',
            auth: !!process.env.DMRX_MCP_API_KEY,
            cors: process.env.DMRX_MCP_CORS_ORIGIN || '*',
            rateLimit: process.env.DMRX_MCP_RATE_LIMIT || 'none',
            sessionTimeout: parseInt(process.env.DMRX_MCP_SESSION_TIMEOUT_MS || '300000', 10),
            maxBodySize: parseInt(process.env.DMRX_MCP_MAX_BODY_BYTES || '10485760', 10),
            aggregator: {
              enabled: !!process.env.DMRX_MCP_CLIENT_SERVERS,
              servers: process.env.DMRX_MCP_CLIENT_SERVERS ? 'configured' : 'none',
            },
          }, null, 2),
        }],
      };
    }
  );

  // -----------------------------------------------------------------------
  // Resource Template: dmrx://contexts/{id} — Saved conversation contexts
  // -----------------------------------------------------------------------
  server.resource(
    'context',
    new ResourceTemplate('dmrx://contexts/{id}', { list: undefined }),
    {
      description: 'A saved conversation context by ID',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      // Context data is stored in-memory; this is a placeholder
      // The actual data is managed by the context tools
      const id = variables.id;
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            contextId: id,
            description: 'Use dmrx_context_load tool to retrieve context data',
            note: 'Contexts are stored in-memory and lost on restart',
          }, null, 2),
        }],
      };
    }
  );
}
