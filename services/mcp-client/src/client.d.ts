import { MCPServerRegistry } from './registry.js';
import { MCPToolAdapter } from './adapter.js';
import type { MCPServerConfig, MCPClientConfig, ConnectedServer } from './registry.js';
/**
 * MCP Client for DMR-X.
 *
 * Manages connections to external MCP servers and exposes their tools
 * as DMR-X provider adapters. This allows the DMR-X router to route
 * requests to MCP-connected tools and services.
 *
 * Usage:
 *   const client = new MCPClient();
 *   await client.connect({ servers: [...] });
 *   const adapters = client.getAdapters();
 *   // Register adapters with DMR-X's adapter registry
 */
export declare class MCPClient {
    private registry;
    private adapters;
    constructor();
    /**
     * Connect to all MCP servers defined in the configuration.
     * Creates adapter wrappers for each connected server.
     */
    connect(config: MCPClientConfig): Promise<void>;
    /**
     * Connect to a single MCP server and create its adapter.
     */
    connectServer(serverConfig: MCPServerConfig): Promise<ConnectedServer>;
    /**
     * Disconnect from a specific MCP server and remove its adapter.
     */
    disconnectServer(serverId: string): Promise<void>;
    /**
     * Get the adapter for a specific server.
     */
    getAdapter(serverId: string): MCPToolAdapter | undefined;
    /**
     * Get all adapters as an array.
     * These can be registered with DMR-X's AdapterRegistry.
     */
    getAdapters(): MCPToolAdapter[];
    /**
     * Get the underlying server registry.
     */
    getRegistry(): MCPServerRegistry;
    /**
     * List all connected server IDs.
     */
    listServers(): string[];
    /**
     * Get all tools across all connected servers.
     */
    listAllTools(): Array<{
        serverId: string;
        serverName: string;
        toolName: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
    }>;
    /**
     * Get the server that hosts a specific tool.
     */
    findServerForTool(toolName: string): ConnectedServer | undefined;
    /**
     * Invoke a tool directly, finding the right server automatically.
     * Returns the tool result.
     */
    callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
    /**
     * Refresh the tool list for a specific server.
     */
    refreshServer(serverId: string): Promise<void>;
    /**
     * Run health checks on all connected servers.
     */
    healthCheckAll(): Promise<Map<string, boolean>>;
    /**
     * Disconnect all servers and clean up.
     */
    dispose(): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map