import type { IncomingMessage, ServerResponse } from 'node:http';

type Authenticate = (req: IncomingMessage, res: ServerResponse) => {
  authorized: boolean;
  allowedTools?: string[];
};

/** Shared boundary for both HTTP transports, before A2A or MCP dispatch. */
export function guardHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  configuredOrigins: string,
  authenticate: Authenticate,
): boolean {
  const origin = req.headers.origin;
  const allowedOrigins = configuredOrigins.split(',').map((value) => value.trim()).filter((value) => value && value !== '*' && value !== 'null');
  // A wildcard is not an Origin validation policy. Native clients omit Origin.
  if (origin !== undefined && (typeof origin !== 'string' || !allowedOrigins.includes(origin))) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden Origin' }));
    return false;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, X-DMR-Tenant-Key');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return false;
  }

  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  // Discovery remains public; task and RPC routes require the same credentials
  // as MCP. Tool-only keys cannot gain broader execution through the A2A API.
  if (pathname === '/a2a' || pathname.startsWith('/a2a/')) {
    const auth = authenticate(req, res);
    if (!auth.authorized) return false;
    if (auth.allowedTools !== undefined) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tool-restricted keys cannot access A2A' }));
      return false;
    }
  }
  return true;
}
