/**
 * DMR-X MCP Server
 *
 * Exposes DMR-X routing capabilities as MCP tools.
 * Transport-agnostic: works with stdio, SSE, and Streamable HTTP transports.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Router, type RouterConfig } from '@dmr-x/router';
import { AdapterRegistry } from '@dmr-x/adapters';
import type { CandidateSet } from '@dmr-x/core';
export interface DMRXMcpServerConfig {
    /** Router configuration */
    router?: RouterConfig;
    /** Pre-loaded candidate set (if not using registry) */
    candidates?: CandidateSet;
    /** Adapter configurations keyed by provider ID */
    adapterConfigs?: Record<string, {
        baseUrl: string;
        apiKey?: string;
    }>;
    /** Enable task decomposition for complex prompts */
    enableDecomposition?: boolean;
}
interface ServerState {
    router: Router;
    adapterRegistry: AdapterRegistry;
    candidates: CandidateSet;
    startTime: number;
    requestCount: number;
    lastError: string | null;
}
export declare function createDMRXMcpServer(config?: DMRXMcpServerConfig): {
    server: McpServer;
    state: ServerState;
};
export {};
//# sourceMappingURL=server.d.ts.map