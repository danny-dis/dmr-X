/**
 * @dmr-x/mcp-client
 *
 * MCP (Model Context Protocol) client for DMR-X.
 * Connects to external MCP servers and exposes their tools
 * as DMR-X provider adapters for unified routing.
 */
export { MCPClient } from './client.js';
export { MCPServerRegistry, type MCPServerConfig, type MCPClientConfig, type ConnectedServer, } from './registry.js';
export { MCPToolAdapter, createAdaptersForRegistry } from './adapter.js';
//# sourceMappingURL=index.d.ts.map