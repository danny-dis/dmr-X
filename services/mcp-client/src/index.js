/**
 * @dmr-x/mcp-client
 *
 * MCP (Model Context Protocol) client for DMR-X.
 * Connects to external MCP servers and exposes their tools
 * as DMR-X provider adapters for unified routing.
 */
// Main client
export { MCPClient } from './client.js';
// Server registry
export { MCPServerRegistry, } from './registry.js';
// Adapter
export { MCPToolAdapter, createAdaptersForRegistry } from './adapter.js';
//# sourceMappingURL=index.js.map