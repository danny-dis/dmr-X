import type { ProviderAdapter, ProviderConfig, HealthStatus, ModelInfo, ExecuteOptions } from '@dmr-x/adapters';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import type { MCPServerRegistry } from './registry.js';
/**
 * Wraps an MCP server's tools as a DMR-X ProviderAdapter.
 *
 * Each MCP tool becomes a callable "model" in DMR-X's routing system.
 * The adapter translates between DMR-X's UnifiedRequest/UnifiedResponse
 * format and MCP's tool call protocol.
 */
export declare class MCPToolAdapter implements ProviderAdapter {
    readonly providerId: string;
    readonly supportedModalities: Modality[];
    private registry;
    private serverId;
    private initialized;
    constructor(registry: MCPServerRegistry, serverId: string);
    initialize(_config: ProviderConfig): Promise<void>;
    healthCheck(): Promise<HealthStatus>;
    execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
    executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;
    listModels(): Promise<ModelInfo[]>;
    dispose(): Promise<void>;
    private assertInitialized;
    /**
     * Extract tool call information from a UnifiedRequest.
     * Supports multiple patterns:
     * 1. Standard tool_calls from assistant message
     * 2. metadata.toolName + metadata.toolArguments for direct invocation
     */
    private extractToolCall;
    /**
     * Convert an MCP tool result into a DMR-X UnifiedResponse.
     */
    private toolResultToResponse;
    /**
     * Extract a string representation from an MCP tool result.
     * MCP results can have content arrays with text/image/resource items.
     */
    private extractContentString;
    /**
     * Build capability strings from an MCP tool definition.
     */
    private buildCapabilities;
}
/**
 * Creates MCPToolAdapter instances for all servers in the registry.
 * Each connected server gets its own adapter wrapping its tools.
 */
export declare function createAdaptersForRegistry(registry: MCPServerRegistry): MCPToolAdapter[];
//# sourceMappingURL=adapter.d.ts.map