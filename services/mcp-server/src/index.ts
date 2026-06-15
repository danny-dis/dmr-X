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
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDMRXMcpServer, type DMRXMcpServerConfig } from './server.js';
import { MCPClient, type MCPServerConfig } from '@dmr-x/mcp-client';
import { getTelemetryService, type TelemetryConfig } from '@dmr-x/telemetry';
import {
  loadConfigFile,
  resolveConfig,
  resolveConfigInt,
  resolveConfigBool,
  type McpConfigFile,
} from './config.js';

// Re-export for programmatic use
export { createDMRXMcpServer, type DMRXMcpServerConfig } from './server.js';
export { TOOL_NAMES, TOOL_DESCRIPTIONS } from './tools.js';
export { getTelemetryService, type TelemetryConfig } from '@dmr-x/telemetry';

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
 * Checks the Authorization header against the configured API keys using
 * timing-safe comparison to prevent timing attacks.
 * Returns true if the request is authorized (or no keys are configured).
 * Sends a 401 response and returns false if unauthorized.
 */
function checkAuth(req: { headers: Record<string, string | string[] | undefined> }, res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body: string) => void }): boolean {
  if (MCP_API_KEYS.length === 0) return true;

  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — missing Bearer token' }));
    return false;
  }

  const token = authHeader.slice(7); // strip "Bearer "
  const tokenBuf = Buffer.from(token, 'utf8');

  for (const validKey of MCP_API_KEYS) {
    const keyBuf = Buffer.from(validKey, 'utf8');
    // Buffers must be same length for timingSafeEqual; pad shorter one
    if (tokenBuf.length !== keyBuf.length) continue;
    if (timingSafeEqual(tokenBuf, keyBuf)) return true;
  }

  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized — invalid Bearer token' }));
  return false;
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
  if (configFile?.externalServers?.length) {
    externalServers = configFile.externalServers.filter(
      (s): s is MCPServerConfig =>
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        (s.transport === 'stdio' || s.transport === 'sse')
    );
  }
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
      externalMcpClient: externalMcpClient ?? undefined,
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
  const { server } = createDMRXMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startSSE(config: DMRXMcpServerConfig): Promise<void> {
  // Dynamically import to avoid pulling in HTTP deps for stdio-only usage
  const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
  const http = await import('node:http');

  const configFile = loadConfigFile();
  const port = resolveConfigInt(configFile, 'port', 'DMRX_MCP_PORT', 3100);
  const host = resolveConfig(configFile, 'host', 'DMRX_MCP_HOST', '127.0.0.1');

  const sessions = new Map<string, { server: ReturnType<typeof createDMRXMcpServer>['server']; transport: InstanceType<typeof SSEServerTransport> }>();

  // Start periodic session sweep
  const sweepInterval = startSessionSweep(() => sessions as unknown as Map<string, unknown>);

  const httpServer = http.createServer(async (req, res) => {
    // CORS preflight
    setCorsHeaders(res);
    if (handlePreflight(req, res)) return;

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/sse' && req.method === 'GET') {
      if (!checkAuth(req, res)) return;
      // Create a new SSE session
      const { server } = createDMRXMcpServer(config);
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
    console.error(`DMR-X MCP server (SSE) listening on http://${host}:${port}`);
    console.error(`  SSE endpoint:    http://${host}:${port}/sse`);
    console.error(`  Message endpoint: http://${host}:${port}/messages`);
    console.error(`  Health endpoint:  http://${host}:${port}/health`);
  });

  // Cleanup sweep on process exit
  process.on('SIGINT', () => clearInterval(sweepInterval));
  process.on('SIGTERM', () => clearInterval(sweepInterval));
}

async function startStreamableHTTP(config: DMRXMcpServerConfig): Promise<void> {
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const http = await import('node:http');

  const configFile = loadConfigFile();
  const port = resolveConfigInt(configFile, 'port', 'DMRX_MCP_PORT', 3100);
  const host = resolveConfig(configFile, 'host', 'DMRX_MCP_HOST', '127.0.0.1');

  const sessions = new Map<string, { server: ReturnType<typeof createDMRXMcpServer>['server']; transport: InstanceType<typeof StreamableHTTPServerTransport> }>();

  // Start periodic session sweep
  const sweepInterval = startSessionSweep(() => sessions as unknown as Map<string, unknown>);

  const httpServer = http.createServer(async (req, res) => {
    // CORS preflight
    setCorsHeaders(res);
    if (handlePreflight(req, res)) return;

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/mcp') {
      if (!checkAuth(req, res)) return;
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
        const { server } = createDMRXMcpServer(config);
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
    console.error(`DMR-X MCP server (Streamable HTTP) listening on http://${host}:${port}`);
    console.error(`  MCP endpoint:    http://${host}:${port}/mcp`);
    console.error(`  Health endpoint:  http://${host}:${port}/health`);
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
    console.error(`Telemetry started — metrics at http://127.0.0.1:${tc.metricsPort}${tc.metricsPath}`);
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
}

main().catch((error) => {
  console.error('Fatal error starting DMR-X MCP server:', error);
  process.exit(1);
});
