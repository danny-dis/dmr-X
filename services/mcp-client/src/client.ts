import { createLogger } from '@dmr-x/utils';
import { MCPServerRegistry } from './registry.js';
import { MCPToolAdapter, createAdaptersForRegistry } from './adapter.js';
import type { MCPServerConfig, MCPClientConfig, ConnectedServer } from './registry.js';
import type { ProviderConfig } from '@dmr-x/adapters';

const logger = createLogger('mcp-client');

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
export class MCPClient {
  private registry: MCPServerRegistry;
  private adapters = new Map<string, MCPToolAdapter>();

  constructor() {
    this.registry = new MCPServerRegistry();
  }

  /**
   * Connect to all MCP servers defined in the configuration.
   * Creates adapter wrappers for each connected server.
   */
  async connect(config: MCPClientConfig): Promise<void> {
    logger.info({ serverCount: config.servers.length }, 'Connecting to MCP servers');

    for (const serverConfig of config.servers) {
      try {
        await this.connectServer(serverConfig);
      } catch (error) {
        logger.error(
          { serverId: serverConfig.id, error },
          'Failed to connect to MCP server'
        );
        // Continue connecting other servers even if one fails
      }
    }

    const connectedCount = this.registry.list().length;
    logger.info({ connectedCount }, 'MCP client connection complete');
  }

  /**
   * Connect to a single MCP server and create its adapter.
   */
  async connectServer(serverConfig: MCPServerConfig): Promise<ConnectedServer> {
    const server = await this.registry.connect(serverConfig);

    // Create and initialize adapter for this server
    const adapter = new MCPToolAdapter(this.registry, serverConfig.id);
    await adapter.initialize({ baseUrl: '' } as ProviderConfig);
    this.adapters.set(serverConfig.id, adapter);

    logger.info(
      { serverId: serverConfig.id, toolCount: server.tools.length },
      'MCP server adapter ready'
    );

    return server;
  }

  /**
   * Disconnect from a specific MCP server and remove its adapter.
   */
  async disconnectServer(serverId: string): Promise<void> {
    const adapter = this.adapters.get(serverId);
    if (adapter) {
      await adapter.dispose();
      this.adapters.delete(serverId);
    }
    await this.registry.disconnect(serverId);
  }

  /**
   * Get the adapter for a specific server.
   */
  getAdapter(serverId: string): MCPToolAdapter | undefined {
    return this.adapters.get(serverId);
  }

  /**
   * Get all adapters as an array.
   * These can be registered with DMR-X's AdapterRegistry.
   */
  getAdapters(): MCPToolAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get the underlying server registry.
   */
  getRegistry(): MCPServerRegistry {
    return this.registry;
  }

  /**
   * List all connected server IDs.
   */
  listServers(): string[] {
    return this.registry.list();
  }

  /**
   * Get all tools across all connected servers.
   */
  listAllTools(): Array<{
    serverId: string;
    serverName: string;
    toolName: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }> {
    return this.registry.getAllTools();
  }

  /**
   * Get the server that hosts a specific tool.
   */
  findServerForTool(toolName: string): ConnectedServer | undefined {
    return this.registry.findServerForTool(toolName);
  }

  /**
   * Invoke a tool directly, finding the right server automatically.
   * Returns the tool result.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const server = this.registry.findServerForTool(toolName);
    if (!server) {
      throw new Error(`No MCP server found hosting tool: ${toolName}`);
    }

    return this.registry.callTool(server.config.id, toolName, args);
  }

  /**
   * Refresh the tool list for a specific server.
   */
  async refreshServer(serverId: string): Promise<void> {
    await this.registry.refreshTools(serverId);
  }

  /**
   * Run health checks on all connected servers.
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [id, adapter] of this.adapters) {
      const status = await adapter.healthCheck();
      results.set(id, status.healthy);
    }

    return results;
  }

  /**
   * Disconnect all servers and clean up.
   */
  async dispose(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.dispose();
    }
    this.adapters.clear();
    await this.registry.disposeAll();

    logger.info('MCP client disposed');
  }
}
