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
 *   DMRX_MCP_API_KEY    — Bearer token required on SSE/HTTP transports (required in production)
 *
 * Adapter API keys (standard provider env vars):
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, REPLICATE_API_TOKEN,
 *   STABILITY_API_KEY, ELEVENLABS_API_KEY, DEEPGRAM_API_KEY,
 *   COHERE_API_KEY, JINA_API_KEY
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDMRXMcpServer } from './server.js';
// Re-export for programmatic use
export { createDMRXMcpServer } from './server.js';
export { TOOL_NAMES, TOOL_DESCRIPTIONS } from './tools.js';
// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------
function getEnv(key, fallback = '') {
    return process.env[key] || fallback;
}
function getEnvInt(key, fallback) {
    const val = process.env[key];
    if (!val)
        return fallback;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
}
// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
const MCP_API_KEY = process.env.DMRX_MCP_API_KEY || '';
/**
 * Checks the Authorization header against the configured API key.
 * Returns true if the request is authorized (or no key is configured).
 * Sends a 401 response and returns false if unauthorized.
 */
function checkAuth(req, res) {
    if (!MCP_API_KEY)
        return true;
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader === `Bearer ${MCP_API_KEY}`) {
        return true;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — missing or invalid Bearer token' }));
    return false;
}
// ---------------------------------------------------------------------------
// Build server config from environment
// ---------------------------------------------------------------------------
function buildConfig() {
    const adapterConfigs = {};
    // OpenAI
    if (process.env.OPENAI_API_KEY) {
        adapterConfigs.openai = {
            baseUrl: getEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
            apiKey: process.env.OPENAI_API_KEY,
        };
    }
    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
        adapterConfigs.anthropic = {
            baseUrl: getEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
            apiKey: process.env.ANTHROPIC_API_KEY,
        };
    }
    // Ollama (local — no key needed)
    adapterConfigs.ollama = {
        baseUrl: getEnv('OLLAMA_BASE_URL', 'http://localhost:11434'),
    };
    // Replicate
    if (process.env.REPLICATE_API_TOKEN) {
        adapterConfigs.replicate = {
            baseUrl: getEnv('REPLICATE_BASE_URL', 'https://api.replicate.com/v1'),
            apiKey: process.env.REPLICATE_API_TOKEN,
        };
    }
    // Stability AI
    if (process.env.STABILITY_API_KEY) {
        adapterConfigs.stability = {
            baseUrl: getEnv('STABILITY_BASE_URL', 'https://api.stability.ai/v2beta'),
            apiKey: process.env.STABILITY_API_KEY,
        };
    }
    // ElevenLabs
    if (process.env.ELEVENLABS_API_KEY) {
        adapterConfigs.elevenlabs = {
            baseUrl: getEnv('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io/v1'),
            apiKey: process.env.ELEVENLABS_API_KEY,
        };
    }
    // Deepgram
    if (process.env.DEEPGRAM_API_KEY) {
        adapterConfigs.deepgram = {
            baseUrl: getEnv('DEEPGRAM_BASE_URL', 'https://api.deepgram.com/v1'),
            apiKey: process.env.DEEPGRAM_API_KEY,
        };
    }
    // Cohere
    if (process.env.COHERE_API_KEY) {
        adapterConfigs.cohere = {
            baseUrl: getEnv('COHERE_BASE_URL', 'https://api.cohere.com/v2'),
            apiKey: process.env.COHERE_API_KEY,
        };
    }
    // Jina
    if (process.env.JINA_API_KEY) {
        adapterConfigs.jina = {
            baseUrl: getEnv('JINA_BASE_URL', 'https://api.jina.ai/v1'),
            apiKey: process.env.JINA_API_KEY,
        };
    }
    return {
        router: {
            epsilon: 0.05,
            defaultQualityTarget: 'balanced',
            enableDecomposition: false,
        },
        adapterConfigs,
    };
}
// ---------------------------------------------------------------------------
// Transport setup
// ---------------------------------------------------------------------------
async function startStdio(config) {
    const { server } = createDMRXMcpServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
async function startSSE(config) {
    // Dynamically import to avoid pulling in HTTP deps for stdio-only usage
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const http = await import('node:http');
    const port = getEnvInt('DMRX_MCP_PORT', 3100);
    const host = getEnv('DMRX_MCP_HOST', '127.0.0.1');
    const sessions = new Map();
    const httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname === '/sse' && req.method === 'GET') {
            if (!checkAuth(req, res))
                return;
            // Create a new SSE session
            const { server } = createDMRXMcpServer(config);
            const transport = new SSEServerTransport('/messages', res);
            const sessionId = transport.sessionId;
            sessions.set(sessionId, { server, transport });
            transport.onclose = () => {
                sessions.delete(sessionId);
            };
            res.on('close', () => {
                sessions.delete(sessionId);
            });
            await server.connect(transport);
            return;
        }
        if (url.pathname === '/messages' && req.method === 'POST') {
            if (!checkAuth(req, res))
                return;
            const sessionId = url.searchParams.get('sessionId');
            if (!sessionId || !sessions.has(sessionId)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing or invalid sessionId' }));
                return;
            }
            const session = sessions.get(sessionId);
            await session.transport.handlePostMessage(req, res);
            return;
        }
        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', transport: 'sse', sessions: sessions.size }));
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
}
async function startStreamableHTTP(config) {
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const http = await import('node:http');
    const port = getEnvInt('DMRX_MCP_PORT', 3100);
    const host = getEnv('DMRX_MCP_HOST', '127.0.0.1');
    const sessions = new Map();
    const httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname === '/mcp') {
            if (!checkAuth(req, res))
                return;
            // Check for existing session
            const sessionId = req.headers['mcp-session-id'];
            if (sessionId && sessions.has(sessionId)) {
                const session = sessions.get(sessionId);
                await session.transport.handleRequest(req, res);
                return;
            }
            // New session
            if (req.method === 'POST') {
                const { server } = createDMRXMcpServer(config);
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => crypto.randomUUID(),
                    onsessioninitialized: (sid) => {
                        sessions.set(sid, { server, transport });
                    },
                });
                transport.onclose = () => {
                    if (transport.sessionId) {
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
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });
    httpServer.listen(port, host, () => {
        console.error(`DMR-X MCP server (Streamable HTTP) listening on http://${host}:${port}`);
        console.error(`  MCP endpoint:    http://${host}:${port}/mcp`);
        console.error(`  Health endpoint:  http://${host}:${port}/health`);
    });
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const transport = getEnv('DMRX_MCP_TRANSPORT', 'stdio').toLowerCase();
    const config = buildConfig();
    if (transport !== 'stdio' && !MCP_API_KEY) {
        if (process.env.NODE_ENV === 'production') {
            console.error('FATAL: DMRX_MCP_API_KEY must be set in production. Refusing to start without authentication.');
            process.exit(1);
        }
        console.warn('WARNING: MCP server running without authentication — set DMRX_MCP_API_KEY to secure it');
    }
    switch (transport) {
        case 'stdio':
            await startStdio(config);
            break;
        case 'sse':
            await startSSE(config);
            break;
        case 'http':
        case 'streamable':
        case 'streamable-http':
            await startStreamableHTTP(config);
            break;
        default:
            console.error(`Unknown transport: ${transport}. Use "stdio", "sse", or "http".`);
            process.exit(1);
    }
}
main().catch((error) => {
    console.error('Fatal error starting DMR-X MCP server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map