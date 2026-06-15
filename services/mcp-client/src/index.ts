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
export {
  MCPServerRegistry,
  type MCPServerConfig,
  type MCPClientConfig,
  type ConnectedServer,
} from './registry.js';

// Adapter
export { MCPToolAdapter, createAdaptersForRegistry } from './adapter.js';

// Circuit breaker
export {
  CircuitBreaker,
  CircuitBreakerManager,
  type CircuitBreakerConfig,
  type CircuitBreakerStatus,
  type CircuitState,
} from './circuit-breaker.js';
