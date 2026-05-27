import { Client } from '@modelcontextprotocol/sdk/client/index.js';
/**
 * Configuration for a single MCP server connection.
 */
export interface MCPServerConfig {
    /** Unique identifier for this server */
    id: string;
    /** Human-readable name */
    name: string;
    /** Transport type: 'stdio' for local processes, 'sse' for HTTP SSE */
    transport: 'stdio' | 'sse';
    /** Command to run (for stdio transport) */
    command?: string;
    /** Arguments for the command (for stdio transport) */
    args?: string[];
    /** Environment variables (for stdio transport) */
    env?: Record<string, string>;
    /** URL for SSE transport */
    url?: string;
}
/**
 * Top-level configuration containing all MCP servers.
 */
export interface MCPClientConfig {
    servers: MCPServerConfig[];
}
/**
 * A connected MCP server with its client and metadata.
 */
export interface ConnectedServer {
    config: MCPServerConfig;
    client: Client;
    connectedAt: Date;
    tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
    }>;
}
/**
 * Registry that manages connections to MCP servers.
 * Tracks all connected servers and their discovered tools.
 */
export declare class MCPServerRegistry {
    private servers;
    /**
     * Connect to an MCP server based on its configuration.
     */
    connect(serverConfig: MCPServerConfig): Promise<ConnectedServer>;
    /**
     * Disconnect from an MCP server.
     */
    disconnect(serverId: string): Promise<void>;
    /**
     * Get a connected server by ID.
     */
    get(serverId: string): ConnectedServer | undefined;
    /**
     * List all connected server IDs.
     */
    list(): string[];
    /**
     * Get all connected servers.
     */
    listAll(): ConnectedServer[];
    /**
     * Get all tools across all connected servers.
     * Returns tools with their server ID for routing.
     */
    getAllTools(): Array<{
        serverId: string;
        serverName: string;
        toolName: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
    }>;
    /**
     * Find which server hosts a specific tool.
     */
    findServerForTool(toolName: string): ConnectedServer | undefined;
    /**
     * Invoke a tool on a specific server.
     */
    callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
    /**
     * Refresh the tool list for a connected server.
     */
    refreshTools(serverId: string): Promise<void>;
    /**
     * Check if a server is connected.
     */
    has(serverId: string): boolean;
    /**
     * Disconnect all servers.
     */
    disposeAll(): Promise<void>;
}
//# sourceMappingURL=registry.d.ts.map