import { createLogger } from '@dmr-x/utils';
import {
  Client,
  SdkHttpError,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { CircuitBreakerManager, type CircuitBreakerStatus } from './circuit-breaker.js';

const logger = createLogger('mcp-client:registry');

/**
 * Configuration for a single MCP server connection.
 */
export interface MCPServerConfig {
  /** Unique identifier for this server */
  id: string;
  /** Human-readable name */
  name: string;
  /** Transport type: 'stdio' for local processes, 'sse' for legacy HTTP SSE, 'http' for streamable HTTP */
  transport: 'stdio' | 'sse' | 'http';
  /** Command to run (for stdio transport) */
  command?: string;
  /** Arguments for the command (for stdio transport) */
  args?: string[];
  /** Environment variables (for stdio transport) */
  env?: Record<string, string>;
  /** URL for SSE transport */
  url?: string;
  /** API key or token for authentication with this server */
  apiKey?: string;
  /** Timeout in milliseconds for tool calls (default: 30000) */
  timeoutMs?: number;
  /** Max retries for transient failures (default: 3) */
  maxRetries?: number;
  /** OPTIONAL per-server allowlist of upstream tool names (e.g. ["create_issue","read_file"]).
   *  When set, any call to a tool on this server not in the list is rejected at dispatch.
   *  Omit for the default open behavior (all aggregated tools callable). */
  allowedTools?: string[];
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
 * Includes circuit breaker, timeout, and retry logic for resilient upstream calls.
 */
export class MCPServerRegistry {
  private servers = new Map<string, ConnectedServer>();
  private circuitBreakers = new CircuitBreakerManager();
  private configOverrides = new Map<string, { timeoutMs: number; maxRetries: number }>();
  private pendingReconnects = new Map<string, MCPServerConfig>();

  /**
   * Connect to an MCP server based on its configuration.
   */
  async connect(serverConfig: MCPServerConfig): Promise<ConnectedServer> {
    if (this.servers.has(serverConfig.id)) {
      throw new Error(`MCP server already connected: ${serverConfig.id}`);
    }

    logger.info({ id: serverConfig.id, transport: serverConfig.transport }, 'Connecting to MCP server');

    const client = new Client(
      { name: 'dmr-x-mcp-client', version: '0.1.0' },
      { capabilities: {} }
    );

    let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

    if (serverConfig.transport === 'stdio') {
      if (!serverConfig.command) {
        throw new Error(`stdio transport requires 'command' for server ${serverConfig.id}`);
      }
      transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env as Record<string, string>,
      });
    } else if (serverConfig.transport === 'sse') {
      transport = this.buildSseTransport(serverConfig);
    } else if (serverConfig.transport === 'http') {
      if (!serverConfig.url) {
        throw new Error(`http transport requires 'url' for server ${serverConfig.id}`);
      }

      // Streamable HTTP (v2 SDK): the transport performs version negotiation
      // during connect. Advertise JSON/SSE and inject credentials.
      const headers: Record<string, string> = {
        Accept: 'application/json, text/event-stream',
      };
      if (serverConfig.apiKey) {
        headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
      }

      transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
        requestInit: { headers },
      });
    } else {
      throw new Error(`Unknown transport type: ${serverConfig.transport}`);
    }

    try {
      await client.connect(transport);
    } catch (error) {
      // Backward-compat rule for streamable HTTP: the v2 transport performs its
      // own version negotiation; if the server rejects the HTTP transport with
      // 400/404/405 it is likely an SSE-only legacy server, so retry over the
      // legacy SSE transport (best-effort).
      if (serverConfig.transport === 'http' && this.shouldFallbackToSse(error)) {
        logger.warn(
          { id: serverConfig.id, url: serverConfig.url, error },
          'Streamable HTTP connect rejected with 400/404/405; falling back to legacy SSE transport'
        );
        await client.close().catch(() => undefined);
        transport = this.buildSseTransport(serverConfig);
        await client.connect(transport);
      } else {
        throw error;
      }
    }

    // Discover tools from the server
    const toolsResult = await client.listTools();
    const tools = (toolsResult.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));

    const connected: ConnectedServer = {
      config: serverConfig,
      client,
      connectedAt: new Date(),
      tools,
    };

    this.servers.set(serverConfig.id, connected);

    // Store per-server config overrides for timeout/retry
    this.configOverrides.set(serverConfig.id, {
      timeoutMs: serverConfig.timeoutMs ?? parseInt(process.env.DMRX_MCP_UPSTREAM_TIMEOUT_MS || '30000', 10),
      maxRetries: serverConfig.maxRetries ?? parseInt(process.env.DMRX_MCP_UPSTREAM_MAX_RETRIES || '3', 10),
    });

    logger.info(
      { id: serverConfig.id, toolCount: tools.length },
      'MCP server connected and tools discovered'
    );

    return connected;
  }

  /**
   * Build a legacy SSE client transport for a server config.
   */
  private buildSseTransport(serverConfig: MCPServerConfig): SSEClientTransport {
    if (!serverConfig.url) {
      throw new Error(`sse transport requires 'url' for server ${serverConfig.id}`);
    }

    // Build headers with credential injection
    const headers: Record<string, string> = {};
    if (serverConfig.apiKey) {
      headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
    }

    return new SSEClientTransport(new URL(serverConfig.url), {
      requestInit: {
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      },
    });
  }

  /**
   * Best-effort detection of a streamable-HTTP rejection that signals an
   * SSE-only legacy server (HTTP 400/404/405), so the caller can fall back.
   */
  private shouldFallbackToSse(error: unknown): boolean {
    return (
      error instanceof SdkHttpError &&
      (error.status === 400 || error.status === 404 || error.status === 405)
    );
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    // Store config for potential reconnection
    this.pendingReconnects.set(serverId, server.config);

    await server.client.close();
    this.servers.delete(serverId);
    logger.info({ id: serverId }, 'MCP server disconnected');
  }

  /**
   * Get a connected server by ID.
   */
  get(serverId: string): ConnectedServer | undefined {
    return this.servers.get(serverId);
  }

  /**
   * List all connected server IDs.
   */
  list(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Get all connected servers.
   */
  listAll(): ConnectedServer[] {
    return Array.from(this.servers.values());
  }

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
  }> {
    const tools: Array<{
      serverId: string;
      serverName: string;
      toolName: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }> = [];

    for (const server of this.servers.values()) {
      for (const tool of server.tools) {
        tools.push({
          serverId: server.config.id,
          serverName: server.config.name,
          toolName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }

    return tools;
  }

  /**
   * Find which server hosts a specific tool.
   */
  findServerForTool(toolName: string): ConnectedServer | undefined {
    for (const server of this.servers.values()) {
      if (server.tools.some((t) => t.name === toolName)) {
        return server;
      }
    }
    return undefined;
  }

  /**
   * Invoke a tool on a specific server with circuit breaker, timeout, and retry.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    // Check circuit breaker
    const breaker = this.circuitBreakers.getOrCreate(serverId);
    const breakerError = breaker.check(serverId);
    if (breakerError) {
      throw new Error(breakerError);
    }

    const config = this.configOverrides.get(serverId) || { timeoutMs: 30000, maxRetries: 3 };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        logger.info({ serverId, toolName, attempt }, 'Calling MCP tool');

        // Execute with timeout
        const result = await this.callToolWithTimeout(server, toolName, args, config.timeoutMs);

        breaker.recordSuccess();
        logger.info({ serverId, toolName, attempt }, 'MCP tool call completed');
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) — only on transient failures
        const isTransient = !lastError.message.includes('not found') &&
                           !lastError.message.includes('invalid') &&
                           !lastError.message.includes('unauthorized');

        if (!isTransient || attempt >= config.maxRetries) {
          break;
        }

        // Exponential backoff: 1s, 2s, 4s, ...
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 30_000);
        logger.warn({ serverId, toolName, attempt, delayMs }, 'Retrying MCP tool call after transient error');
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // All retries exhausted
    breaker.recordFailure();
    throw lastError || new Error(`MCP tool call failed after ${config.maxRetries} retries`);
  }

  /**
   * Calls a tool with a timeout using AbortController.
   */
  private async callToolWithTimeout(
    server: ConnectedServer,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`MCP tool call timed out after ${timeoutMs}ms: ${toolName}`));
      }, timeoutMs);

      server.client.callTool({ name: toolName, arguments: args })
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Returns circuit breaker status for all connected servers.
   */
  getCircuitBreakerStatus(): Record<string, CircuitBreakerStatus> {
    return this.circuitBreakers.getStatus();
  }

  /**
   * Refresh the tool list for a connected server.
   */
  async refreshTools(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    const toolsResult = await server.client.listTools();
    server.tools = (toolsResult.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));

    logger.info({ serverId, toolCount: server.tools.length }, 'MCP server tools refreshed');
  }

  /**
   * Check if a server is connected.
   */
  has(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  /**
   * Attempt to reconnect to a disconnected server.
   * Uses exponential backoff with a maximum of 30s between attempts.
   */
  async reconnect(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (server) {
      logger.info({ serverId }, 'Server already connected, skipping reconnection');
      return true;
    }

    // Find the original config from the disconnect
    const config = this.pendingReconnects.get(serverId);
    if (!config) {
      logger.warn({ serverId }, 'No config found for reconnection');
      return false;
    }

    const maxAttempts = 5;
    const baseDelayMs = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        logger.info({ serverId, attempt }, 'Attempting reconnection');
        await this.connect(config);
        this.pendingReconnects.delete(serverId);
        logger.info({ serverId }, 'Reconnection successful');
        return true;
      } catch (error) {
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), 30_000);
        logger.warn({ serverId, attempt, delayMs, error }, 'Reconnection failed, retrying');
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    logger.error({ serverId }, 'Reconnection failed after max attempts');
    this.pendingReconnects.delete(serverId);
    return false;
  }

  /**
   * Schedule a reconnection attempt for a disconnected server.
   */
  scheduleReconnect(config: MCPServerConfig): void {
    this.pendingReconnects.set(config.id, config);
    // Attempt reconnection in background
    this.reconnect(config.id).catch((error) => {
      logger.error({ serverId: config.id, error }, 'Background reconnection failed');
    });
  }

  /**
   * Disconnect all servers.
   */
  async disposeAll(): Promise<void> {
    const ids = Array.from(this.servers.keys());
    for (const id of ids) {
      try {
        await this.disconnect(id);
      } catch (error) {
        logger.error({ id, error }, 'Error disconnecting MCP server');
      }
    }
    this.servers.clear();
    this.pendingReconnects.clear();
  }
}
