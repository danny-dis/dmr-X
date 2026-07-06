#!/usr/bin/env bun
/**
 * DMR-X MCP Server — Entry point
 *
 * Starts the MCP server with the appropriate transport.
 *
 * Usage:
 *   # stdio (default — for Claude Code, Cursor, etc.)
 *   node dist/index.js
 *
 *   # SSE over HTTP
 *   DMRX_MCP_TRANSPORT=sse DMRX_MCP_PORT=3100 node dist/index.js
 *
 *   # Streamable HTTP
 *   DMRX_MCP_TRANSPORT=http DMRX_MCP_PORT=3100 node dist/index.js
 *
 * Environment variables:
 *   DMRX_MCP_TRANSPORT  — Transport type: "stdio" (default), "sse", or "http"
 *   DMRX_MCP_PORT       — Port for SSE/HTTP transports (default: 3100)
 *   DMRX_MCP_HOST       — Host for SSE/HTTP transports (default: 127.0.0.1)
 *   DMRX_MCP_API_KEY    — Bearer token(s) for SSE/HTTP transports. Comma-separated for multiple keys. Required in production.
 *
 * Adapter API keys (standard provider env vars):
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, REPLICATE_API_TOKEN,
 *   STABILITY_API_KEY, ELEVENLABS_API_KEY, DEEPGRAM_API_KEY,
 *   COHERE_API_KEY, JINA_API_KEY
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { watchFile, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { MCPClient, type MCPServerConfig } from '@dmr-x/mcp-client';
import { getTelemetryService, type TelemetryConfig } from '@dmr-x/telemetry';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  loadConfigFile,
  resolveConfig,
  resolveConfigInt,
  resolveConfigBool,
  type McpConfigFile,
} from './config.js';
import { createDMRXMcpServer, reconcileExternalTools, type DMRXMcpServerConfig } from './server.js';

// Re-export for programmatic use
export { createDMRXMcpServer, type DMRXMcpServerConfig } from './server.js';
export { TOOL_NAMES, TOOL_DESCRIPTIONS } from './tools.js';
export { getTelemetryService, type TelemetryConfig } from '@dmr-x/telemetry';
export {
  buildAgentCard,
  validateAgentCard,
  serializeAgentCard,
  deserializeAgentCard,
  type AgentCardConfig,
  type AgentCapabilities,
  type AgentAuthentication,
  type AgentSkill,
  type AgentCard,
} from './a2a/agent-card.js';
export {
  A2ATaskManager,
  getTaskManager,
  resetTaskManager,
  type TaskState,
  type TaskMessage,
  type TaskPart,
  type Task,
  type TaskStatus,
  type TaskArtifact,
  type TaskCreateRequest,
  type TaskGetRequest,
  type TaskUpdateRequest,
  type TaskCancelRequest,
} from './a2a/task-manager.js';
export {
  FederationManager,
  getFederationManager,
  resetFederationManager,
  type FederationConfig,
  type FederationPeer,
  type FederatedTool,
  type FederationState,
} from './federation/manager.js';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getEnv(key: string, fallback: string = ''): string {
  return process.env[key] || fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Parses the DMRX_MCP_CLIENT_SERVERS env var (a JSON array of MCPServerConfig).
 * Returns an empty array if the var is unset, empty, or invalid JSON.
 */
function parseExternalMcpServers(): MCPServerConfig[] {
  const raw = process.env.DMRX_MCP_CLIENT_SERVERS;
  if (!raw || raw.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse DMRX_MCP_CLIENT_SERVERS as JSON — aggregator disabled:', error);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error('DMRX_MCP_CLIENT_SERVERS must be a JSON array — aggregator disabled');
    return [];
  }

  // Minimal validation
  const valid: MCPServerConfig[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as any).id === 'string' &&
      typeof (item as any).name === 'string' &&
      ((item as any).transport === 'stdio' || (item as any).transport === 'sse')
    ) {
      valid.push(item as MCPServerConfig);
    } else {
      console.error('Skipping invalid MCP server config entry:', item);
    }
  }

  return valid;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Parses DMRX_MCP_API_KEY into an array of valid keys.
 * Supports comma-separated keys or a single key.
 * Empty string returns an empty array (auth disabled).
 */
function parseApiKeys(config: McpConfigFile | null): string[] {
  const raw = process.env.DMRX_MCP_API_KEY || config?.apiKey || '';
  if (!raw.trim()) return [];
  return raw.split(',').map((k) => k.trim()).filter(Boolean);
}

const configFileForAuth = loadConfigFile();
const MCP_API_KEYS = parseApiKeys(configFileForAuth);

/**
 * Checks the Authorization header against the configured API keys.
 * Returns an object with authorized: boolean and allowedTools: string[] if the key is authorized.
 * Sends a 401 response and returns authorized: false if unauthorized.
 */
function checkAuthAndGetAllowedTools(
  req: { headers: Record<string, string | string[] | undefined> },
  res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body: string) => void }
): { authorized: boolean; allowedTools?: string[] } {
  if (MCP_API_KEYS.length === 0) return { authorized: true };

  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — missing Bearer token' }));
    return { authorized: false };
  }

  const token = authHeader.slice(7); // strip "Bearer "
  const tokenBuf = Buffer.from(token, 'utf8');

  // 1. Check detailed keyRestrictions/apiKeysConfig in configuration file
  const keyConfigs = configFileForAuth?.apiKeysConfig || [];
  for (const kc of keyConfigs) {
    if (typeof kc.key !== 'string') continue;
    const keyBuf = Buffer.from(kc.key, 'utf8');
    if (tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf)) {
      return { authorized: true, allowedTools: kc.allowedTools };
    }
  }

  // 2. Check JSON env var DMRX_MCP_API_KEYS_CONFIG
  const envConfigRaw = process.env.DMRX_MCP_API_KEYS_CONFIG;
  if (envConfigRaw) {
    try {
      const parsed = JSON.parse(envConfigRaw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry && typeof entry === 'object' && typeof entry.key === 'string') {
            const keyBuf = Buffer.from(entry.key, 'utf8');
            if (tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf)) {
              return { authorized: true, allowedTools: entry.allowedTools };
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to parse DMRX_MCP_API_KEYS_CONFIG env var:', e);
    }
  }

  // 3. Fallback to simple comma-separated check
  for (const validKey of MCP_API_KEYS) {
    const keyBuf = Buffer.from(validKey, 'utf8');
    if (tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf)) {
      return { authorized: true };
    }
  }

  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized — invalid Bearer token' }));
  return { authorized: false };
}

/**
 * Checks the Authorization header against the configured API keys using
 * timing-safe comparison to prevent timing attacks.
 * Returns true if the request is authorized (or no keys are configured).
 * Sends a 401 response and returns false if unauthorized.
 */
function checkAuth(req: { headers: Record<string, string | string[] | undefined> }, res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body: string) => void }): boolean {
  return checkAuthAndGetAllowedTools(req, res).authorized;
}

// ---------------------------------------------------------------------------
// Request body size limits
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = resolveConfigInt(configFileForAuth, 'maxBodyBytes', 'DMRX_MCP_MAX_BODY_BYTES', 10 * 1024 * 1024); // 10MB default

/**
 * Reads the request body with a size limit. Returns null if the body exceeds
 * the limit (and sends a 413 response).
 */
function readBodyWithLimit(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  maxBytes: number = MAX_BODY_BYTES
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Request body too large — max ${maxBytes} bytes` }));
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

// ---------------------------------------------------------------------------
// CORS configuration
// ---------------------------------------------------------------------------

const CORS_ORIGIN = resolveConfig(configFileForAuth, 'corsOrigin', 'DMRX_MCP_CORS_ORIGIN', '*');

function setCorsHeaders(res: import('node:http').ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function handlePreflight(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Session idle timeout and cleanup
// ---------------------------------------------------------------------------

const SESSION_TIMEOUT_MS = resolveConfigInt(configFileForAuth, 'sessionTimeoutMs', 'DMRX_MCP_SESSION_TIMEOUT_MS', 5 * 60 * 1000); // 5 min default

// Module-level telemetry config (set in main())
let telemetryConfig: TelemetryConfig = {
  serviceName: 'dmr-x-mcp',
  metricsPort: 9465,
  metricsPath: '/metrics',
  otlpEndpoint: 'http://localhost:4318/v1/traces',
  enableTracing: true,
  enableMetrics: true,
};

interface SessionEntry {
  lastActivity: Date;
  cleanup?: () => void;
}

const sessionActivityMap = new Map<string, SessionEntry>();

function touchSession(sessionId: string, cleanup?: () => void): void {
  sessionActivityMap.set(sessionId, { lastActivity: new Date(), cleanup });
}

function removeSession(sessionId: string): void {
  const entry = sessionActivityMap.get(sessionId);
  if (entry?.cleanup) entry.cleanup();
  sessionActivityMap.delete(sessionId);
}

/**
 * Starts a periodic sweep that removes sessions idle longer than SESSION_TIMEOUT_MS.
 */
function startSessionSweep(getSessions: () => Map<string, unknown>): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessionActivityMap) {
      if (now - entry.lastActivity.getTime() > SESSION_TIMEOUT_MS) {
        console.error(`Sweeping idle MCP session: ${id}`);
        removeSession(id);
      }
    }
  }, Math.max(SESSION_TIMEOUT_MS / 2, 30_000)); // sweep at least every 30s
}

// ---------------------------------------------------------------------------
// Build server config from environment
// ---------------------------------------------------------------------------

interface BuiltConfig {
  mcpConfig: DMRXMcpServerConfig;
  externalMcpClient: MCPClient | null;
  telemetryConfig: TelemetryConfig;
}

// ---------------------------------------------------------------------------
// Module-level state for live config reload
// ---------------------------------------------------------------------------

/**
 * Holds references to the running McpServer and its state for live
 * external MCP server management (add/remove without restart).
 */
interface LiveServerHandle {
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
  state: import('./server.js').ServerState;
}

let liveHandle: LiveServerHandle | null = null;

const MCP_CONFIG_WATCH_INTERVAL = 2000; // 2 seconds

async function buildConfig(): Promise<BuiltConfig> {
  const configFile = loadConfigFile();
  const adapterConfigs: Record<string, { baseUrl: string; apiKey?: string }> = {};

  // OpenAI
  const openaiKey = process.env.OPENAI_API_KEY || configFile?.adapters?.openai?.apiKey;
  if (openaiKey) {
    adapterConfigs.openai = {
      baseUrl: resolveConfig(configFile, 'adapters.openai.baseUrl', 'OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      apiKey: openaiKey,
    };
  }

  // Anthropic
  const anthropicKey = process.env.ANTHROPIC_API_KEY || configFile?.adapters?.anthropic?.apiKey;
  if (anthropicKey) {
    adapterConfigs.anthropic = {
      baseUrl: resolveConfig(configFile, 'adapters.anthropic.baseUrl', 'ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
      apiKey: anthropicKey,
    };
  }

  // Ollama (local — no key needed)
  adapterConfigs.ollama = {
    baseUrl: resolveConfig(configFile, 'adapters.ollama.baseUrl', 'OLLAMA_BASE_URL', 'http://localhost:11434'),
  };

  // Replicate
  const replicateKey = process.env.REPLICATE_API_TOKEN || configFile?.adapters?.replicate?.apiKey;
  if (replicateKey) {
    adapterConfigs.replicate = {
      baseUrl: resolveConfig(configFile, 'adapters.replicate.baseUrl', 'REPLICATE_BASE_URL', 'https://api.replicate.com/v1'),
      apiKey: replicateKey,
    };
  }

  // Stability AI
  const stabilityKey = process.env.STABILITY_API_KEY || configFile?.adapters?.stability?.apiKey;
  if (stabilityKey) {
    adapterConfigs.stability = {
      baseUrl: resolveConfig(configFile, 'adapters.stability.baseUrl', 'STABILITY_BASE_URL', 'https://api.stability.ai/v2beta'),
      apiKey: stabilityKey,
    };
  }

  // ElevenLabs
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY || configFile?.adapters?.elevenlabs?.apiKey;
  if (elevenLabsKey) {
    adapterConfigs.elevenlabs = {
      baseUrl: resolveConfig(configFile, 'adapters.elevenlabs.baseUrl', 'ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io/v1'),
      apiKey: elevenLabsKey,
    };
  }

  // Deepgram
  const deepgramKey = process.env.DEEPGRAM_API_KEY || configFile?.adapters?.deepgram?.apiKey;
  if (deepgramKey) {
    adapterConfigs.deepgram = {
      baseUrl: resolveConfig(configFile, 'adapters.deepgram.baseUrl', 'DEEPGRAM_BASE_URL', 'https://api.deepgram.com/v1'),
      apiKey: deepgramKey,
    };
  }

  // Cohere
  const cohereKey = process.env.COHERE_API_KEY || configFile?.adapters?.cohere?.apiKey;
  if (cohereKey) {
    adapterConfigs.cohere = {
      baseUrl: resolveConfig(configFile, 'adapters.cohere.baseUrl', 'COHERE_BASE_URL', 'https://api.cohere.com/v2'),
      apiKey: cohereKey,
    };
  }

  // Jina
  const jinaKey = process.env.JINA_API_KEY || configFile?.adapters?.jina?.apiKey;
  if (jinaKey) {
    adapterConfigs.jina = {
      baseUrl: resolveConfig(configFile, 'adapters.jina.baseUrl', 'JINA_BASE_URL', 'https://api.jina.ai/v1'),
      apiKey: jinaKey,
    };
  }

  // Parse external MCP servers from config file or env var
  let externalServers: MCPServerConfig[] = [];
  // First try aggregation.servers (new path from UI)
  if (configFile?.aggregation?.servers?.length) {
    externalServers = configFile.aggregation.servers.filter(
      (s): s is MCPServerConfig =>
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        (s.transport === 'stdio' || s.transport === 'sse')
    );
  }
  // Then fall back to externalServers (legacy)
  if (externalServers.length === 0 && configFile?.externalServers?.length) {
    externalServers = configFile.externalServers.filter(
      (s): s is MCPServerConfig =>
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        (s.transport === 'stdio' || s.transport === 'sse')
    );
  }
  // Then fall back to env var
  if (externalServers.length === 0) {
    externalServers = parseExternalMcpServers();
  }

  let externalMcpClient: MCPClient | null = null;
  if (externalServers.length > 0) {
    externalMcpClient = new MCPClient();
    try {
      await externalMcpClient.connect({ servers: externalServers });
    } catch (error) {
      // The MCPClient.connect method is resilient — it logs and continues
      // connecting other servers. So we don't bail out on individual failures.
      console.error('External MCPClient.connect() reported errors (see logs above)');
    }
  }

  return {
    mcpConfig: {
      router: {
        epsilon: resolveConfig(configFile, 'router.epsilon', 'DMRX_ROUTER_EPSILON', 0.05),
        defaultQualityTarget: resolveConfig(configFile, 'router.defaultQualityTarget', 'DMRX_DEFAULT_QUALITY_TARGET', 'balanced'),
        enableDecomposition: resolveConfigBool(configFile, 'router.enableDecomposition', 'DMRX_ENABLE_DECOMPOSITION', false),
      },
      adapterConfigs,
      allowedTools: configFile?.allowedTools || (process.env.DMRX_MCP_ALLOWED_TOOLS ? process.env.DMRX_MCP_ALLOWED_TOOLS.split(',').map((t) => t.trim()) : undefined),
      externalMcpClient: externalMcpClient ?? undefined,
      toolSearch: configFile?.toolSearch || {
        bm25Weight: resolveConfigInt(configFile, 'toolSearch.bm25Weight', 'DMRX_TOOL_SEARCH_BM25_WEIGHT', 0.4),
        semanticWeight: resolveConfigInt(configFile, 'toolSearch.semanticWeight', 'DMRX_TOOL_SEARCH_SEMANTIC_WEIGHT', 0.6),
        rrfConstant: resolveConfigInt(configFile, 'toolSearch.rrfConstant', 'DMRX_TOOL_SEARCH_RRF_CONSTANT', 60),
        maxResults: resolveConfigInt(configFile, 'toolSearch.maxResults', 'DMRX_TOOL_SEARCH_MAX_RESULTS', 10),
        minScore: resolveConfigInt(configFile, 'toolSearch.minScore', 'DMRX_TOOL_SEARCH_MIN_SCORE', 0.01),
        enableBM25: resolveConfigBool(configFile, 'toolSearch.enableBM25', 'DMRX_TOOL_SEARCH_ENABLE_BM25', true),
        enableSemantic: resolveConfigBool(configFile, 'toolSearch.enableSemantic', 'DMRX_TOOL_SEARCH_ENABLE_SEMANTIC', true),
        embeddingConfig: {
          provider: resolveConfig(configFile, 'toolSearch.embeddingConfig.provider', 'DMRX_TOOL_SEARCH_EMBEDDING_PROVIDER', 'ollama') as 'ollama' | 'openai' | 'remote',
          ollamaUrl: resolveConfig(configFile, 'toolSearch.embeddingConfig.ollamaUrl', 'DMRX_TOOL_SEARCH_OLLAMA_URL', 'http://localhost:11434'),
          ollamaModel: resolveConfig(configFile, 'toolSearch.embeddingConfig.ollamaModel', 'DMRX_TOOL_SEARCH_OLLAMA_MODEL', 'nomic-embed-text'),
          openaiApiKey: resolveConfig(configFile, 'toolSearch.embeddingConfig.openaiApiKey', 'OPENAI_API_KEY', ''),
          openaiModel: resolveConfig(configFile, 'toolSearch.embeddingConfig.openaiModel', 'DMRX_TOOL_SEARCH_OPENAI_MODEL', 'text-embedding-3-small'),
          remoteUrl: resolveConfig(configFile, 'toolSearch.embeddingConfig.remoteUrl', 'DMRX_TOOL_SEARCH_REMOTE_URL', ''),
          remoteApiKey: resolveConfig(configFile, 'toolSearch.embeddingConfig.remoteApiKey', 'DMRX_TOOL_SEARCH_REMOTE_API_KEY', ''),
        },
      },
      rbac: {
        enabled: resolveConfigBool(configFile, 'rbac.enabled', 'DMRX_RBAC_ENABLED', false),
        defaultEffect: resolveConfig(configFile, 'rbac.defaultEffect', 'DMRX_RBAC_DEFAULT_EFFECT', 'allow') as 'allow' | 'deny',
        policiesPath: resolveConfig(configFile, 'rbac.policiesPath', 'DMRX_RBAC_POLICIES_PATH', ''),
        auditLogging: resolveConfigBool(configFile, 'rbac.auditLogging', 'DMRX_RBAC_AUDIT_LOGGING', true),
      },
      guardrails: {
        enabled: resolveConfigBool(configFile, 'guardrails.enabled', 'DMRX_GUARDRAILS_ENABLED', false),
        piiRedaction: resolveConfigBool(configFile, 'guardrails.piiRedaction', 'DMRX_GUARDRAILS_PII_REDACTION', true),
        contentFiltering: resolveConfigBool(configFile, 'guardrails.contentFiltering', 'DMRX_GUARDRAILS_CONTENT_FILTERING', true),
        blockedKeywords: resolveConfig(configFile, 'guardrails.blockedKeywords', 'DMRX_GUARDRAILS_BLOCKED_KEYWORDS', '').split(',').filter(Boolean),
        logDetections: resolveConfigBool(configFile, 'guardrails.logDetections', 'DMRX_GUARDRAILS_LOG_DETECTIONS', true),
      },
      audit: {
        enabled: resolveConfigBool(configFile, 'audit.enabled', 'DMRX_AUDIT_ENABLED', false),
        retentionDays: resolveConfigInt(configFile, 'audit.retentionDays', 'DMRX_AUDIT_RETENTION_DAYS', 90),
        includeBodies: resolveConfigBool(configFile, 'audit.includeBodies', 'DMRX_AUDIT_INCLUDE_BODIES', false),
      },
      a2a: {
        enabled: resolveConfigBool(configFile, 'a2a.enabled', 'DMRX_A2A_ENABLED', false),
        agentCard: {
          name: resolveConfig(configFile, 'a2a.agentCard.name', 'DMRX_A2A_AGENT_NAME', 'DMR-X Agent'),
          description: resolveConfig(configFile, 'a2a.agentCard.description', 'DMRX_A2A_AGENT_DESCRIPTION', 'DMR-X MCP Server with intelligent routing'),
          version: resolveConfig(configFile, 'a2a.agentCard.version', 'DMRX_A2A_AGENT_VERSION', '0.5.0'),
          url: resolveConfig(configFile, 'a2a.agentCard.url', 'DMRX_A2A_AGENT_URL', 'http://localhost:3100'),
        },
      },
      federation: {
        enabled: resolveConfigBool(configFile, 'federation.enabled', 'DMRX_FEDERATION_ENABLED', false),
        instanceId: resolveConfig(configFile, 'federation.instanceId', 'DMRX_FEDERATION_INSTANCE_ID', ''),
        instanceName: resolveConfig(configFile, 'federation.instanceName', 'DMRX_FEDERATION_INSTANCE_NAME', `DMR-X-${Date.now()}`),
        discoveryMethod: resolveConfig(configFile, 'federation.discoveryMethod', 'DMRX_FEDERATION_DISCOVERY_METHOD', 'static') as 'mdns' | 'static' | 'consul',
        mdnsServiceName: resolveConfig(configFile, 'federation.mdnsServiceName', 'DMRX_FEDERATION_MDNS_SERVICE_NAME', 'dmrx-mcp'),
        mdnsServiceType: resolveConfig(configFile, 'federation.mdnsServiceType', 'DMRX_FEDERATION_MDNS_SERVICE_TYPE', '_mcp._tcp'),
        syncInterval: resolveConfigInt(configFile, 'federation.syncInterval', 'DMRX_FEDERATION_SYNC_INTERVAL', 30),
        heartbeatInterval: resolveConfigInt(configFile, 'federation.heartbeatInterval', 'DMRX_FEDERATION_HEARTBEAT_INTERVAL', 10),
        peerTimeout: resolveConfigInt(configFile, 'federation.peerTimeout', 'DMRX_FEDERATION_PEER_TIMEOUT', 60),
        enableToolProxy: resolveConfigBool(configFile, 'federation.enableToolProxy', 'DMRX_FEDERATION_ENABLE_TOOL_PROXY', true),
        maxRemoteTools: resolveConfigInt(configFile, 'federation.maxRemoteTools', 'DMRX_FEDERATION_MAX_REMOTE_TOOLS', 100),
      },
    },
    externalMcpClient,
    telemetryConfig: {
      serviceName: 'dmr-x-mcp',
      metricsPort: resolveConfigInt(configFile, 'telemetry.metricsPort', 'DMRX_MCP_METRICS_PORT', 9465),
      metricsPath: resolveConfig(configFile, 'telemetry.metricsPath', 'DMRX_MCP_METRICS_PATH', '/metrics'),
      otlpEndpoint: resolveConfig(configFile, 'telemetry.otlpEndpoint', 'DMRX_OTLP_ENDPOINT', 'http://localhost:4318/v1/traces'),
      enableTracing: resolveConfigBool(configFile, 'telemetry.enableTracing', 'DMRX_OTEL_TRACING', true),
      enableMetrics: resolveConfigBool(configFile, 'telemetry.enableMetrics', 'DMRX_OTEL_METRICS', true),
    },
  };
}

// ---------------------------------------------------------------------------
// Transport setup
// ---------------------------------------------------------------------------

async function startStdio(config: DMRXMcpServerConfig): Promise<void> {
  const result = createDMRXMcpServer(config);
  const { server, state } = result;
  liveHandle = { server, state };
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startSSE(config: DMRXMcpServerConfig): Promise<void> {
  // Dynamically import to avoid pulling in HTTP deps for stdio-only usage
  const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
  const http = await import('node:http');
  const { handleA2ARoutes } = await import('./a2a/handler.js');

  const configFile = loadConfigFile();
  const port = resolveConfigInt(configFile, 'port', 'DMRX_MCP_PORT', 3100);
  const host = resolveConfig(configFile, 'host', 'DMRX_MCP_HOST', '127.0.0.1');

  const sessions = new Map<string, { server: ReturnType<typeof createDMRXMcpServer>['server']; transport: InstanceType<typeof SSEServerTransport> }>();

  // Start periodic session sweep
  const sweepInterval = startSessionSweep(() => sessions as unknown as Map<string, unknown>);

  // Get tools for Agent Card
  const { server: tempServer, state: tempState } = createDMRXMcpServer(config);
  const toolsForAgentCard = tempState.sdkTools.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  const httpServer = http.createServer(async (req, res) => {
    // CORS preflight
    setCorsHeaders(res);
    if (handlePreflight(req, res)) return;

    // Handle A2A routes
    if (config.a2a?.enabled) {
      const a2aHandled = await handleA2ARoutes(req, res, config.a2a, toolsForAgentCard);
      if (a2aHandled) return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/sse' && req.method === 'GET') {
      const authResult = checkAuthAndGetAllowedTools(req, res);
      if (!authResult.authorized) return;
      // Create a new SSE session
      const { server } = createDMRXMcpServer({
        ...config,
        allowedTools: authResult.allowedTools,
      });
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;

      sessions.set(sessionId, { server, transport });
      touchSession(sessionId, () => {
        sessions.delete(sessionId);
      });

      transport.onclose = () => {
        removeSession(sessionId);
        sessions.delete(sessionId);
      };

      res.on('close', () => {
        removeSession(sessionId);
        sessions.delete(sessionId);
      });

      await server.connect(transport);
      return;
    }

    if (url.pathname === '/messages' && req.method === 'POST') {
      if (!checkAuth(req, res)) return;
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid sessionId' }));
        return;
      }

      // Touch session to reset idle timer
      touchSession(sessionId);

      const session = sessions.get(sessionId)!;
      await session.transport.handlePostMessage(req, res);
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'sse', sessions: sessions.size }));
      return;
    }

    if (url.pathname === '/tools') {
      const authResult = checkAuthAndGetAllowedTools(req, res);
      if (!authResult.authorized) return;
      // Create temp server/state to get full tools list
      const { state: tempState } = createDMRXMcpServer({
        ...config,
        allowedTools: authResult.allowedTools,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools: tempState.sdkTools }));
      return;
    }

    if (url.pathname === '/metrics') {
      // Prometheus metrics are served by the TelemetryService's own HTTP server
      // but we also proxy here for convenience
      try {
        const metricsUrl = `http://127.0.0.1:${telemetryConfig.metricsPort}${telemetryConfig.metricsPath}`;
        const metricsRes = await fetch(metricsUrl);
        const metricsBody = await metricsRes.text();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(metricsBody);
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Metrics unavailable' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(port, host, () => {
    console.log(`DMR-X MCP server (SSE) listening on http://${host}:${port}`);
    console.log(`  SSE endpoint:    http://${host}:${port}/sse`);
    console.log(`  Message endpoint: http://${host}:${port}/messages`);
    console.log(`  Health endpoint:  http://${host}:${port}/health`);
    if (config.a2a?.enabled) {
      console.log(`  Agent Card:      http://${host}:${port}/.well-known/agent.json`);
      console.log(`  A2A Tasks:       http://${host}:${port}/a2a/tasks/send`);
    }
  });

  // Cleanup sweep on process exit
  process.on('SIGINT', () => clearInterval(sweepInterval));
  process.on('SIGTERM', () => clearInterval(sweepInterval));
}

async function startStreamableHTTP(config: DMRXMcpServerConfig): Promise<void> {
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const http = await import('node:http');
  const { handleA2ARoutes } = await import('./a2a/handler.js');

  const configFile = loadConfigFile();
  const port = resolveConfigInt(configFile, 'port', 'DMRX_MCP_PORT', 3100);
  const host = resolveConfig(configFile, 'host', 'DMRX_MCP_HOST', '127.0.0.1');

  const sessions = new Map<string, { server: ReturnType<typeof createDMRXMcpServer>['server']; transport: InstanceType<typeof StreamableHTTPServerTransport> }>();

  // Start periodic session sweep
  const sweepInterval = startSessionSweep(() => sessions as unknown as Map<string, unknown>);

  // Get tools for Agent Card
  const { server: tempServer, state: tempState } = createDMRXMcpServer(config);
  const toolsForAgentCard = tempState.sdkTools.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  const httpServer = http.createServer(async (req, res) => {
    // CORS preflight
    setCorsHeaders(res);
    if (handlePreflight(req, res)) return;

    // Handle A2A routes
    if (config.a2a?.enabled) {
      const a2aHandled = await handleA2ARoutes(req, res, config.a2a, toolsForAgentCard);
      if (a2aHandled) return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/mcp') {
      const authResult = checkAuthAndGetAllowedTools(req, res);
      if (!authResult.authorized) return;
      // Check for existing session
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        // Touch session to reset idle timer
        touchSession(sessionId);
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      // New session
      if (req.method === 'POST') {
        const { server } = createDMRXMcpServer({
          ...config,
          allowedTools: authResult.allowedTools,
        });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { server, transport });
            touchSession(sid, () => {
              sessions.delete(sid);
            });
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            removeSession(transport.sessionId);
            sessions.delete(transport.sessionId);
          }
        };

        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'streamable-http', sessions: sessions.size }));
      return;
    }

    if (url.pathname === '/tools') {
      const authResult = checkAuthAndGetAllowedTools(req, res);
      if (!authResult.authorized) return;
      // Create temp server/state to get full tools list
      const { state: tempState } = createDMRXMcpServer({
        ...config,
        allowedTools: authResult.allowedTools,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools: tempState.sdkTools }));
      return;
    }

    if (url.pathname === '/metrics') {
      try {
        const metricsUrl = `http://127.0.0.1:${telemetryConfig.metricsPort}${telemetryConfig.metricsPath}`;
        const metricsRes = await fetch(metricsUrl);
        const metricsBody = await metricsRes.text();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(metricsBody);
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Metrics unavailable' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(port, host, () => {
    console.log(`DMR-X MCP server (Streamable HTTP) listening on http://${host}:${port}`);
    console.log(`  MCP endpoint:    http://${host}:${port}/mcp`);
    console.log(`  Health endpoint:  http://${host}:${port}/health`);
    if (config.a2a?.enabled) {
      console.log(`  Agent Card:      http://${host}:${port}/.well-known/agent.json`);
      console.log(`  A2A Tasks:       http://${host}:${port}/a2a/tasks/send`);
    }
  });

  // Cleanup sweep on process exit
  process.on('SIGINT', () => clearInterval(sweepInterval));
  process.on('SIGTERM', () => clearInterval(sweepInterval));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function disposeAndExit(client: MCPClient | null, code: number): Promise<void> {
  if (client) {
    try {
      await client.dispose();
    } catch (err) {
      console.error('Error disposing external MCP client:', err);
    }
  }
  process.exit(code);
}

async function main(): Promise<void> {
  const configFile = loadConfigFile();
  const transport = resolveConfig(configFile, 'transport', 'DMRX_MCP_TRANSPORT', 'stdio').toLowerCase();
  const { mcpConfig, externalMcpClient, telemetryConfig: tc } = await buildConfig();
  telemetryConfig = tc;

  // Start telemetry service (Prometheus metrics + OTel tracing)
  const telemetry = getTelemetryService(tc);
  try {
    await telemetry.start();
    console.log(`Telemetry started — metrics at http://127.0.0.1:${tc.metricsPort}${tc.metricsPath}`);
  } catch (err) {
    console.error('Failed to start telemetry (continuing without):', err);
  }

  if (transport !== 'stdio' && MCP_API_KEYS.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error('FATAL: DMRX_MCP_API_KEY must be set in production. Refusing to start without authentication.');
      await disposeAndExit(externalMcpClient, 1);
      return;
    }
    console.warn('WARNING: MCP server running without authentication — set DMRX_MCP_API_KEY to secure it');
  }

  // Register shutdown handlers
  const shutdown = async (signal: string) => {
    console.error(`\nReceived ${signal}, shutting down...`);
    try {
      await telemetry.shutdown();
    } catch {
      // Ignore telemetry shutdown errors
    }
    await disposeAndExit(externalMcpClient, 0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  switch (transport) {
    case 'stdio':
      await startStdio(mcpConfig);
      break;
    case 'sse':
      await startSSE(mcpConfig);
      break;
    case 'http':
    case 'streamable':
    case 'streamable-http':
      await startStreamableHTTP(mcpConfig);
      break;
    default:
      console.error(`Unknown transport: ${transport}. Use "stdio", "sse", or "http".`);
      await disposeAndExit(externalMcpClient, 1);
  }

  // Start config file watcher for live aggregation server changes
  if (liveHandle) {
    startConfigWatcher();
  }
}

/**
 * Watch dmrx-mcp.config.json for changes to the aggregation servers list
 * and live-reconcile external MCP server connections and tool registrations.
 */
function startConfigWatcher(): void {
  // Determine the config file path (same resolution as loadConfigFile)
  const configPath = process.env.DMRX_MCP_CONFIG
    ? resolve(process.cwd(), process.env.DMRX_MCP_CONFIG)
    : resolve(process.cwd(), 'dmrx-mcp.config.json');

  // Track the last known set of aggregation server IDs to detect changes
  let knownServerIds = new Set<string>();
  const registry = liveHandle!.state.externalMcpClient?.getRegistry();
  if (registry) {
    for (const s of registry.listAll()) {
      knownServerIds.add(s.config.id);
    }
  }

  watchFile(configPath, { interval: MCP_CONFIG_WATCH_INTERVAL }, async () => {
    const handle = liveHandle;
    if (!handle) return;

    // If the file doesn't exist (yet), skip this poll cycle
    if (!existsSync(configPath)) return;

    try {
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      // Read desired aggregation servers (from either config path or env var)
      const desiredServers: MCPServerConfig[] = [];
      if (config?.aggregation?.servers?.length) {
        for (const s of config.aggregation.servers) {
          if (s && typeof s.id === 'string' && typeof s.name === 'string' &&
              (s.transport === 'stdio' || s.transport === 'sse')) {
            desiredServers.push(s as MCPServerConfig);
          }
        }
      }

      const desiredIds = new Set(desiredServers.map(s => s.id));
      const currentClient = handle.state.externalMcpClient;

      // Quick check: if server IDs are identical, no change needed
      if (knownServerIds.size === desiredIds.size &&
          [...knownServerIds].every(id => desiredIds.has(id))) {
        return;
      }

      console.error(`[config-watcher] Aggregation servers changed: ${knownServerIds.size} -> ${desiredIds.size}`);

      // Disconnect servers no longer in config
      if (currentClient) {
        for (const id of knownServerIds) {
          if (!desiredIds.has(id) && currentClient.listServers().includes(id)) {
            try {
              await currentClient.disconnectServer(id);
              console.error(`[config-watcher] Disconnected server: ${id}`);
            } catch (err) {
              console.error(`[config-watcher] Error disconnecting server ${id}:`, err);
            }
          }
        }

        // Connect new servers from config
        for (const serverCfg of desiredServers) {
          if (!knownServerIds.has(serverCfg.id) && !currentClient.listServers().includes(serverCfg.id)) {
            try {
              await currentClient.connectServer(serverCfg);
              console.error(`[config-watcher] Connected server: ${serverCfg.id}`);
            } catch (err) {
              console.error(`[config-watcher] Error connecting server ${serverCfg.id}:`, err);
            }
          }
        }
      }

      // Update known IDs
      knownServerIds = desiredIds;

      // Reconcile tool registrations on the McpServer instance
      handle.state.lastError = null;
      reconcileExternalTools(handle.server, handle.state);
    } catch (err) {
      console.error('[config-watcher] Failed to process config change:', err);
    }
  });

  console.error(`[config-watcher] Watching ${configPath} for aggregation server changes`);
}

main().catch((error) => {
  console.error('Fatal error starting DMR-X MCP server:', error);
  process.exit(1);
});
