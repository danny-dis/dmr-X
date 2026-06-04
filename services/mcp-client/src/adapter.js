import { generateRequestId } from '@dmr-x/utils';
import { createLogger } from '@dmr-x/utils';
const logger = createLogger('mcp-client:adapter');
/**
 * Wraps an MCP server's tools as a DMR-X ProviderAdapter.
 *
 * Each MCP tool becomes a callable "model" in DMR-X's routing system.
 * The adapter translates between DMR-X's UnifiedRequest/UnifiedResponse
 * format and MCP's tool call protocol.
 */
export class MCPToolAdapter {
    providerId;
    supportedModalities = ['llm'];
    registry;
    serverId;
    initialized = false;
    constructor(registry, serverId) {
        this.registry = registry;
        this.serverId = serverId;
        this.providerId = `mcp-${serverId}`;
    }
    async initialize(_config) {
        const server = this.registry.get(this.serverId);
        if (!server) {
            throw new Error(`MCP server not connected: ${this.serverId}`);
        }
        this.initialized = true;
        logger.info({ serverId: this.serverId, providerId: this.providerId }, 'MCP adapter initialized');
    }
    async healthCheck() {
        const start = Date.now();
        const server = this.registry.get(this.serverId);
        if (!server) {
            return {
                healthy: false,
                latencyMs: Date.now() - start,
                error: `MCP server not connected: ${this.serverId}`,
            };
        }
        try {
            // Refresh tools as a health check
            await this.registry.refreshTools(this.serverId);
            return { healthy: true, latencyMs: Date.now() - start };
        }
        catch (error) {
            return {
                healthy: false,
                latencyMs: Date.now() - start,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        const server = this.registry.get(this.serverId);
        if (!server) {
            throw new Error(`MCP server not connected: ${this.serverId}`);
        }
        const start = Date.now();
        const requestId = generateRequestId();
        // Extract tool call from the request.
        // MCP tools are invoked via the tool_calls in the last assistant message,
        // or by treating the request's metadata as the tool invocation target.
        const toolCall = this.extractToolCall(request);
        if (!toolCall) {
            throw new Error('No tool call found in request. MCP adapter requires a tool_calls field or metadata.toolName.');
        }
        const { toolName, arguments: toolArgs } = toolCall;
        logger.info({ serverId: this.serverId, toolName, requestId }, 'Executing MCP tool via adapter');
        try {
            const result = await this.registry.callTool(this.serverId, toolName, toolArgs);
            const latencyMs = Date.now() - start;
            // Convert MCP tool result to UnifiedResponse
            return this.toolResultToResponse(requestId, toolName, result, latencyMs);
        }
        catch (error) {
            throw new Error(`MCP tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async *executeStream(request, options) {
        this.assertInitialized();
        const server = this.registry.get(this.serverId);
        if (!server) {
            throw new Error(`MCP server not connected: ${this.serverId}`);
        }
        const requestId = generateRequestId();
        const toolCall = this.extractToolCall(request);
        if (!toolCall) {
            throw new Error('No tool call found in request. MCP adapter requires a tool_calls field or metadata.toolName.');
        }
        const { toolName, arguments: toolArgs } = toolCall;
        logger.info({ serverId: this.serverId, toolName, requestId }, 'Executing MCP tool stream via adapter');
        let index = 0;
        try {
            // MCP tools return a single result, so we simulate streaming by
            // yielding the complete result as a single chunk followed by done.
            const result = await this.registry.callTool(this.serverId, toolName, toolArgs);
            const content = this.extractContentString(result);
            yield {
                type: 'token',
                data: {
                    content,
                    role: 'assistant',
                },
                index: index++,
            };
            yield {
                type: 'done',
                data: {
                    requestId,
                    modelId: toolName,
                },
                index: index++,
            };
        }
        catch (error) {
            yield {
                type: 'error',
                data: {
                    code: 'MCP_TOOL_ERROR',
                    message: error instanceof Error ? error.message : 'Unknown error',
                },
                index: index++,
            };
        }
    }
    async listModels() {
        this.assertInitialized();
        const server = this.registry.get(this.serverId);
        if (!server) {
            return [];
        }
        return server.tools.map((tool) => ({
            modelId: `${this.serverId}/${tool.name}`,
            modality: 'llm',
            capabilities: this.buildCapabilities(tool),
        }));
    }
    async dispose() {
        this.initialized = false;
        logger.info({ serverId: this.serverId, providerId: this.providerId }, 'MCP adapter disposed');
    }
    assertInitialized() {
        if (!this.initialized) {
            throw new Error(`MCP adapter ${this.providerId} not initialized`);
        }
    }
    /**
     * Extract tool call information from a UnifiedRequest.
     * Supports multiple patterns:
     * 1. Standard tool_calls from assistant message
     * 2. metadata.toolName + metadata.toolArguments for direct invocation
     */
    extractToolCall(request) {
        // Pattern 1: Direct tool invocation via metadata
        if (request.metadata?.toolName && typeof request.metadata.toolName === 'string') {
            return {
                toolName: request.metadata.toolName,
                arguments: request.metadata.toolArguments || {},
            };
        }
        // Pattern 2: Tool calls from messages
        if (request.messages && request.messages.length > 0) {
            const lastMessage = request.messages[request.messages.length - 1];
            if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
                const tc = lastMessage.tool_calls[0];
                let args = {};
                try {
                    args = JSON.parse(tc.function.arguments);
                }
                catch (parseErr) {
                    // If arguments is not valid JSON, pass as-is
                    logger.debug({ toolName: tc.function.name }, 'Non-JSON tool arguments, passing raw');
                    args = { raw: tc.function.arguments };
                }
                return {
                    toolName: tc.function.name,
                    arguments: args,
                };
            }
        }
        return null;
    }
    /**
     * Convert an MCP tool result into a DMR-X UnifiedResponse.
     */
    toolResultToResponse(requestId, toolName, result, latencyMs) {
        const content = this.extractContentString(result);
        return {
            modality: 'llm',
            requestId,
            providerId: this.providerId,
            modelId: `${this.serverId}/${toolName}`,
            message: {
                role: 'assistant',
                content,
            },
            finishReason: 'stop',
            latencyMs,
        };
    }
    /**
     * Extract a string representation from an MCP tool result.
     * MCP results can have content arrays with text/image/resource items.
     */
    extractContentString(result) {
        if (typeof result === 'string') {
            return result;
        }
        if (result && typeof result === 'object') {
            const obj = result;
            // MCP CallToolResult has a content array
            if (Array.isArray(obj.content)) {
                const parts = [];
                for (const item of obj.content) {
                    if (item && typeof item === 'object') {
                        const contentItem = item;
                        if (contentItem.type === 'text' && typeof contentItem.text === 'string') {
                            parts.push(contentItem.text);
                        }
                        else if (contentItem.type === 'image') {
                            parts.push(`[image: ${contentItem.mimeType || 'unknown'}]`);
                        }
                        else if (contentItem.type === 'resource') {
                            parts.push(`[resource: ${contentItem.uri || 'unknown'}]`);
                        }
                    }
                }
                return parts.join('\n');
            }
            // Fallback: stringify the whole result
            return JSON.stringify(result, null, 2);
        }
        return String(result);
    }
    /**
     * Build capability strings from an MCP tool definition.
     */
    buildCapabilities(tool) {
        const capabilities = ['mcp_tool', `tool:${tool.name}`];
        if (tool.inputSchema) {
            const schema = tool.inputSchema;
            if (schema.required && Array.isArray(schema.required)) {
                for (const param of schema.required) {
                    capabilities.push(`param:${param}`);
                }
            }
        }
        return capabilities;
    }
}
/**
 * Creates MCPToolAdapter instances for all servers in the registry.
 * Each connected server gets its own adapter wrapping its tools.
 */
export function createAdaptersForRegistry(registry) {
    const adapters = [];
    for (const server of registry.listAll()) {
        const adapter = new MCPToolAdapter(registry, server.config.id);
        adapters.push(adapter);
    }
    return adapters;
}
//# sourceMappingURL=adapter.js.map