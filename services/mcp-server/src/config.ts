/**
 * DMR-X MCP Server — Configuration file support
 *
 * Loads configuration from a JSON config file (dmrx-mcp.config.json)
 * in the working directory. Environment variables take precedence
 * over config file values.
 *
 * Config file location (in order of precedence):
 *   1. DMRX_MCP_CONFIG env var (explicit path)
 *   2. ./dmrx-mcp.config.json (current working directory)
 *
 * The config file is optional — all settings can be provided via env vars.
 *
 * Example config file:
 * ```json
 * {
 *   "transport": "sse",
 *   "port": 3100,
 *   "host": "0.0.0.0",
 *   "apiKey": "your-secret-key",
 *   "router": {
 *     "epsilon": 0.05,
 *     "defaultQualityTarget": "balanced"
 *   },
 *   "telemetry": {
 *     "enabled": true,
 *     "metricsPort": 9465,
 *     "otlpEndpoint": "http://localhost:4318/v1/traces"
 *   },
 *   "rateLimit": {
 *     "dmrx_chat": "100/hour",
 *     "dmrx_batch": "10/minute"
 *   }
 * }
 * ```
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpConfigFile {
  /** Transport type: "stdio", "sse", or "http" */
  transport?: string;
  /** Port for SSE/HTTP transports */
  port?: number;
  /** Host for SSE/HTTP transports */
  host?: string;
  /** Bearer token for SSE/HTTP transports */
  apiKey?: string;
  /** Maximum request body size in bytes */
  maxBodyBytes?: number;
  /** CORS origin */
  corsOrigin?: string;
  /** Session idle timeout in milliseconds */
  sessionTimeoutMs?: number;

  /** Router configuration */
  router?: {
    epsilon?: number;
    defaultQualityTarget?: string;
    enableDecomposition?: boolean;
  };

  /** Adapter configurations keyed by provider ID */
  adapters?: Record<string, {
    baseUrl?: string;
    apiKey?: string;
  }>;

  /** External MCP server configurations (legacy) */
  externalServers?: Array<{
    id: string;
    name: string;
    transport: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
  }>;

  /** MCP aggregation configuration */
  aggregation?: {
    /** Aggregated external MCP servers */
    servers?: Array<{
      id: string;
      name: string;
      transport: 'stdio' | 'sse';
      command?: string;
      args?: string[];
      url?: string;
      status?: string;
      toolCount?: number;
    }>;
  };

  /** Telemetry configuration */
  telemetry?: {
    enabled?: boolean;
    metricsPort?: number;
    metricsPath?: string;
    otlpEndpoint?: string;
    enableTracing?: boolean;
    enableMetrics?: boolean;
  };

  /** Per-tool rate limit configurations (e.g., {"dmrx_chat": "100/hour"}) */
  rateLimit?: Record<string, string>;

  /** Global allowed tools filter patterns */
  allowedTools?: string[];

  /** Key-specific tool and server configuration */
  apiKeysConfig?: Array<{
    key: string;
    allowedTools?: string[];
  }>;

  /** Tool search configuration */
  toolSearch?: {
    /** BM25 weight in hybrid search fusion (0-1) */
    bm25Weight?: number;
    /** Semantic weight in hybrid search fusion (0-1) */
    semanticWeight?: number;
    /** RRF constant for result fusion */
    rrfConstant?: number;
    /** Maximum results to return */
    maxResults?: number;
    /** Minimum score threshold */
    minScore?: number;
    /** Enable/disable BM25 search */
    enableBM25?: boolean;
    /** Enable/disable semantic search */
    enableSemantic?: boolean;
    /** Embedding configuration for semantic search */
    embeddingConfig?: {
      /** Embedding provider: 'ollama', 'openai', or 'remote' */
      provider: 'ollama' | 'openai' | 'remote';
      /** Ollama server URL (for local embeddings) */
      ollamaUrl?: string;
      /** Ollama model name */
      ollamaModel?: string;
      /** OpenAI API key (for OpenAI embeddings) */
      openaiApiKey?: string;
      /** OpenAI model name */
      openaiModel?: string;
      /** Remote embedding service URL */
      remoteUrl?: string;
      /** Remote embedding service API key */
      remoteApiKey?: string;
    };
  };

  /** RBAC policy configuration */
  rbac?: {
    /** Enable RBAC */
    enabled?: boolean;
    /** Default effect when no policy matches */
    defaultEffect?: 'allow' | 'deny';
    /** Policy files directory */
    policiesPath?: string;
    /** Enable audit logging */
    auditLogging?: boolean;
  };

  /** Guardrails configuration */
  guardrails?: {
    /** Enable guardrails */
    enabled?: boolean;
    /** Enable PII detection and redaction */
    piiRedaction?: boolean;
    /** Enable content filtering */
    contentFiltering?: boolean;
    /** Content filter keywords */
    blockedKeywords?: string[];
    /** Log detected PII (for audit) */
    logDetections?: boolean;
  };

  /** Audit logging configuration */
  audit?: {
    /** Enable audit logging */
    enabled?: boolean;
    /** Audit log retention in days */
    retentionDays?: number;
    /** Include request/response bodies */
    includeBodies?: boolean;
  };

  /** A2A (Agent-to-Agent) protocol configuration */
  a2a?: {
    /** Enable A2A protocol */
    enabled?: boolean;
    /** Agent Card configuration */
    agentCard?: {
      /** Agent name */
      name?: string;
      /** Agent description */
      description?: string;
      /** Agent version */
      version?: string;
      /** Agent URL */
      url?: string;
    };
  };

  /** Federation configuration for multi-instance tool sharing */
  federation?: {
    /** Enable federation */
    enabled?: boolean;
    /** Instance ID (unique identifier for this instance) */
    instanceId?: string;
    /** Instance name (human-readable name) */
    instanceName?: string;
    /** Discovery method: 'mdns', 'static', or 'consul' */
    discoveryMethod?: 'mdns' | 'static' | 'consul';
    /** Static peers (for static discovery) */
    peers?: Array<{
      /** Peer instance ID */
      id: string;
      /** Peer name */
      name: string;
      /** Peer URL */
      url: string;
    }>;
    /** mDNS service name (for mDNS discovery) */
    mdnsServiceName?: string;
    /** mDNS service type (for mDNS discovery) */
    mdnsServiceType?: string;
    /** Sync interval in seconds */
    syncInterval?: number;
    /** Heartbeat interval in seconds */
    heartbeatInterval?: number;
    /** Peer timeout in seconds */
    peerTimeout?: number;
    /** Enable tool proxying from remote instances */
    enableToolProxy?: boolean;
    /** Maximum remote tools to proxy */
    maxRemoteTools?: number;
  };
}

// ---------------------------------------------------------------------------
// Config file loading
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAMES = ['dmrx-mcp.config.json'];

/**
 * Attempt to load and parse the config file. Returns null if no config
 * file is found or if parsing fails.
 */
export function loadConfigFile(): McpConfigFile | null {
  // Check explicit config path first
  const explicitPath = process.env.DMRX_MCP_CONFIG;
  if (explicitPath) {
    return loadFromPath(explicitPath);
  }

  // Try default config file names in current directory
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) {
      return loadFromPath(filePath);
    }
  }

  return null;
}

function loadFromPath(filePath: string): McpConfigFile | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) {
      console.error(`Config file ${filePath} is not a valid JSON object — ignoring`);
      return null;
    }
    console.error(`Loaded config from ${filePath}`);
    return parsed as McpConfigFile;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`Failed to parse config file ${filePath}: ${error.message} — ignoring`);
    } else {
      console.error(`Failed to read config file ${filePath}: ${error} — ignoring`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Config merging helpers
// ---------------------------------------------------------------------------

/**
 * Get a config value with env var taking precedence over config file.
 * Env var name pattern: DMRX_MCP_<KEY> (e.g., DMRX_MCP_PORT for port).
 */
export function resolveConfig<T>(
  configFile: McpConfigFile | null,
  key: string,
  envVar: string,
  defaultValue: T
): T {
  // Env var takes precedence
  const envVal = process.env[envVar];
  if (envVal !== undefined && envVal !== '') {
    return envVal as unknown as T;
  }

  // Config file value
  if (configFile) {
    const parts = key.split('.');
    let current: unknown = configFile;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (current !== undefined) {
      return current as T;
    }
  }

  return defaultValue;
}

/**
 * Get a numeric config value with env var taking precedence.
 */
export function resolveConfigInt(
  configFile: McpConfigFile | null,
  key: string,
  envVar: string,
  defaultValue: number
): number {
  const raw = resolveConfig<string | number>(configFile, key, envVar, defaultValue);
  if (typeof raw === 'number') return raw;
  const parsed = parseInt(String(raw), 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a boolean config value with env var taking precedence.
 */
export function resolveConfigBool(
  configFile: McpConfigFile | null,
  key: string,
  envVar: string,
  defaultValue: boolean
): boolean {
  const raw = resolveConfig<string | boolean>(configFile, key, envVar, defaultValue);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    return raw.toLowerCase() === 'true' || raw === '1';
  }
  return defaultValue;
}
