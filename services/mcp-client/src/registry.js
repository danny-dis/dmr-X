import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createLogger } from '@dmr-x/utils';
const logger = createLogger('mcp-client:registry');
/**
 * Registry that manages connections to MCP servers.
 * Tracks all connected servers and their discovered tools.
 */
export class MCPServerRegistry {
    servers = new Map();
    /**
     * Connect to an MCP server based on its configuration.
     */
    async connect(serverConfig) {
        if (this.servers.has(serverConfig.id)) {
            throw new Error(`MCP server already connected: ${serverConfig.id}`);
        }
        logger.info({ id: serverConfig.id, transport: serverConfig.transport }, 'Connecting to MCP server');
        const client = new Client({ name: 'dmr-x-mcp-client', version: '0.1.0' }, { capabilities: {} });
        let transport;
        if (serverConfig.transport === 'stdio') {
            if (!serverConfig.command) {
                throw new Error(`stdio transport requires 'command' for server ${serverConfig.id}`);
            }
            transport = new StdioClientTransport({
                command: serverConfig.command,
                args: serverConfig.args,
                env: serverConfig.env,
            });
        }
        else if (serverConfig.transport === 'sse') {
            if (!serverConfig.url) {
                throw new Error(`sse transport requires 'url' for server ${serverConfig.id}`);
            }
            transport = new SSEClientTransport(new URL(serverConfig.url));
        }
        else {
            throw new Error(`Unknown transport type: ${serverConfig.transport}`);
        }
        await client.connect(transport);
        // Discover tools from the server
        const toolsResult = await client.listTools();
        const tools = (toolsResult.tools || []).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        }));
        const connected = {
            config: serverConfig,
            client,
            connectedAt: new Date(),
            tools,
        };
        this.servers.set(serverConfig.id, connected);
        logger.info({ id: serverConfig.id, toolCount: tools.length }, 'MCP server connected and tools discovered');
        return connected;
    }
    /**
     * Disconnect from an MCP server.
     */
    async disconnect(serverId) {
        const server = this.servers.get(serverId);
        if (!server) {
            throw new Error(`MCP server not found: ${serverId}`);
        }
        await server.client.close();
        this.servers.delete(serverId);
        logger.info({ id: serverId }, 'MCP server disconnected');
    }
    /**
     * Get a connected server by ID.
     */
    get(serverId) {
        return this.servers.get(serverId);
    }
    /**
     * List all connected server IDs.
     */
    list() {
        return Array.from(this.servers.keys());
    }
    /**
     * Get all connected servers.
     */
    listAll() {
        return Array.from(this.servers.values());
    }
    /**
     * Get all tools across all connected servers.
     * Returns tools with their server ID for routing.
     */
    getAllTools() {
        const tools = [];
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
    findServerForTool(toolName) {
        for (const server of this.servers.values()) {
            if (server.tools.some((t) => t.name === toolName)) {
                return server;
            }
        }
        return undefined;
    }
    /**
     * Invoke a tool on a specific server.
     */
    async callTool(serverId, toolName, args) {
        const server = this.servers.get(serverId);
        if (!server) {
            throw new Error(`MCP server not found: ${serverId}`);
        }
        logger.info({ serverId, toolName }, 'Calling MCP tool');
        const result = await server.client.callTool({ name: toolName, arguments: args });
        logger.info({ serverId, toolName }, 'MCP tool call completed');
        return result;
    }
    /**
     * Refresh the tool list for a connected server.
     */
    async refreshTools(serverId) {
        const server = this.servers.get(serverId);
        if (!server) {
            throw new Error(`MCP server not found: ${serverId}`);
        }
        const toolsResult = await server.client.listTools();
        server.tools = (toolsResult.tools || []).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        }));
        logger.info({ serverId, toolCount: server.tools.length }, 'MCP server tools refreshed');
    }
    /**
     * Check if a server is connected.
     */
    has(serverId) {
        return this.servers.has(serverId);
    }
    /**
     * Disconnect all servers.
     */
    async disposeAll() {
        const ids = Array.from(this.servers.keys());
        for (const id of ids) {
            try {
                await this.disconnect(id);
            }
            catch (error) {
                logger.error({ id, error }, 'Error disconnecting MCP server');
            }
        }
        this.servers.clear();
    }
}
//# sourceMappingURL=registry.js.map