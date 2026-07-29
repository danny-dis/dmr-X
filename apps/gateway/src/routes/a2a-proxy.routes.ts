import fs from 'node:fs';

import { logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { validateBaseUrlForSSRF } from './admin-ssrf.js';

// ---------------------------------------------------------------------------
// A2A (Agent-to-Agent) admin proxy
// ---------------------------------------------------------------------------
//
// The A2A implementation lives in the MCP sidecar, a separate process on
// :3100. A browser served by the gateway on :3000 cannot reach it same-origin,
// so the admin UI had no way to show an agent card, list tasks, or cancel one —
// the A2A "page" was a static block of text describing endpoints nobody could
// call.
//
// These routes front the sidecar. They are admin-scoped (under /admin, so the
// gateway's admin auth applies) and deliberately narrow: only the operator
// views are proxied, never the JSON-RPC surface itself, which peer agents must
// continue to reach directly on the sidecar.

const A2A_TIMEOUT_MS = 10_000;

/** Config shape persisted in dmrx-mcp.config.json under `a2a`. */
const A2AConfigSchema = z.object({
  enabled: z.boolean().optional(),
  agentCard: z
    .object({
      name: z.string().min(1).max(128).optional(),
      description: z.string().max(2048).optional(),
      url: z.string().url().max(2048).or(z.literal('')).optional(),
      version: z.string().max(32).optional(),
    })
    .optional(),
  taskTimeout: z.number().int().min(1000).max(600_000).optional(),
});

const PeerProbeSchema = z.object({
  url: z.string().url().max(2048),
});

function configPath(): string {
  return process.env.DMRX_MCP_CONFIG_PATH || 'dmrx-mcp.config.json';
}

function readConfig(): Record<string, any> {
  try {
    const p = configPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    logger.warn({ err }, 'Unreadable MCP config file; treating as empty');
  }
  return {};
}

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}

/** Base URL of the local sidecar. */
function sidecarBase(): string {
  const host = process.env.DMRX_MCP_HOST || '127.0.0.1';
  const port = process.env.DMRX_MCP_PORT || '3100';
  return `http://${host}:${port}`;
}

/**
 * Whether A2A is switched on.
 *
 * Mirrors the sidecar's own gate: the env var wins, falling back to the config
 * file. `sidecar-boot.ts` defaults DMRX_A2A_ENABLED to 'true' when it spawns
 * the sidecar itself, so an operator who never touched the setting still sees
 * A2A as enabled rather than as an unexplained empty page.
 */
function a2aEnabled(): boolean {
  const env = process.env.DMRX_A2A_ENABLED;
  if (env !== undefined) return env === 'true';
  return readConfig().a2a?.enabled === true;
}

/**
 * Call the sidecar, normalising the two failure modes an operator cares about
 * — "the sidecar is not running" and "the sidecar said no" — into distinct,
 * actionable results rather than a generic fetch rejection.
 */
async function callSidecar(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; reason: 'unreachable' | 'error'; message: string; status?: number }> {
  const url = `${sidecarBase()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), A2A_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        // The sidecar accepts its own agent key; forward it when configured so
        // a locked-down sidecar still answers the gateway.
        ...(process.env.DMRX_MCP_AGENT_API_KEY
          ? { 'x-dmr-tenant-key': process.env.DMRX_MCP_AGENT_API_KEY }
          : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body: pass the text through so the message is not swallowed.
    }

    if (!res.ok) {
      const message =
        (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>)
          ? String((body as Record<string, unknown>).error)
          : null) ?? `Sidecar returned ${res.status}`;
      return { ok: false, reason: 'error', message, status: res.status };
    }

    return { ok: true, status: res.status, body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'unreachable', message };
  } finally {
    clearTimeout(timer);
  }
}

export async function a2aProxyRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Is A2A reachable, and where?
   *
   * Answers the three questions the page header asks — is the sidecar up, is
   * A2A switched on, and what URL do peers use — in one request, so the UI can
   * render an honest state instead of a spinner over a dead port.
   */
  server.get('/admin/a2a/status', async () => {
    const enabled = a2aEnabled();
    const base = sidecarBase();

    if (!enabled) {
      return {
        enabled: false,
        reachable: false,
        base,
        agentCardUrl: null,
        jsonRpcUrl: null,
        // Told plainly so the empty state can name the exact fix.
        hint: 'A2A is disabled. Set DMRX_A2A_ENABLED=true (or enable it below) and restart the MCP sidecar.',
      };
    }

    const probe = await callSidecar('/.well-known/agent-card.json');

    return {
      enabled: true,
      reachable: probe.ok,
      base,
      agentCardUrl: `${base}/.well-known/agent-card.json`,
      jsonRpcUrl: `${base}/a2a`,
      protocolVersion:
        probe.ok && probe.body && typeof probe.body === 'object'
          ? (probe.body as Record<string, unknown>).protocolVersion ?? null
          : null,
      error: probe.ok ? null : probe.message,
      hint: probe.ok
        ? null
        : probe.reason === 'unreachable'
          ? `The MCP sidecar is not answering on ${base}. It starts with the gateway unless DMRX_MCP_AUTOSTART=false.`
          : probe.message,
    };
  });

  /** The agent card this instance publishes. */
  server.get('/admin/a2a/agent-card', async (_request, reply) => {
    if (!a2aEnabled()) {
      return reply.code(409).send({ error: { message: 'A2A is disabled' } });
    }

    const result = await callSidecar('/.well-known/agent-card.json');
    if (!result.ok) {
      return reply.code(502).send({ error: { message: result.message, reason: result.reason } });
    }
    return reply.send(result.body);
  });

  /**
   * A2A configuration.
   *
   * Previously only reachable at /admin/mcp/a2a/config, where the body was
   * merged into the config file with no validation at all. That endpoint stays
   * for compatibility; this one validates.
   */
  server.get('/admin/a2a/config', async () => {
    const config = readConfig();
    return (
      config.a2a ?? {
        enabled: false,
        agentCard: { name: 'DMR-X Agent', description: 'DMR-X MCP Server Agent', url: '' },
        taskTimeout: 60_000,
      }
    );
  });

  server.put('/admin/a2a/config', async (request, reply) => {
    const parsed = A2AConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid A2A config', details: parsed.error.issues } });
    }

    const config = readConfig();
    config.a2a = {
      ...(config.a2a ?? {}),
      ...parsed.data,
      agentCard: { ...(config.a2a?.agentCard ?? {}), ...(parsed.data.agentCard ?? {}) },
    };
    writeConfig(config);

    return reply.send({
      success: true,
      a2a: config.a2a,
      // The sidecar reads this file at boot, so a write here is not live until
      // it restarts. Saying so prevents "I changed it and nothing happened".
      requiresSidecarRestart: true,
    });
  });

  /** Tasks this agent is working on, for the operator task list. */
  server.get('/admin/a2a/tasks', async (request, reply) => {
    if (!a2aEnabled()) {
      return reply.code(409).send({ error: { message: 'A2A is disabled' } });
    }

    const { state, contextId, limit } = request.query as { state?: string; contextId?: string; limit?: string };
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    if (contextId) params.set('contextId', contextId);
    if (limit) params.set('limit', limit);
    const qs = params.toString();

    const result = await callSidecar(`/a2a/tasks${qs ? `?${qs}` : ''}`);
    if (!result.ok) {
      return reply.code(502).send({ error: { message: result.message, reason: result.reason } });
    }
    return reply.send(result.body);
  });

  server.get('/admin/a2a/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await callSidecar(`/a2a/tasks/${encodeURIComponent(id)}`);
    if (!result.ok) {
      const code = result.status === 404 ? 404 : 502;
      return reply.code(code).send({ error: { message: result.message, reason: result.reason } });
    }
    return reply.send(result.body);
  });

  /** Cancel a running task through the sidecar's JSON-RPC endpoint. */
  server.post('/admin/a2a/tasks/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await callSidecar('/a2a', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `admin-cancel-${Date.now()}`,
        method: 'tasks/cancel',
        params: { id },
      }),
    });

    if (!result.ok) {
      return reply.code(502).send({ error: { message: result.message, reason: result.reason } });
    }

    // JSON-RPC signals failure in the body with HTTP 200, so a transport-level
    // success is not yet an application-level one.
    const body = result.body as { error?: { message?: string; code?: number }; result?: unknown };
    if (body?.error) {
      return reply.code(400).send({
        error: { message: body.error.message ?? 'Cancel failed', code: body.error.code },
      });
    }

    return reply.send({ success: true, task: body?.result ?? null });
  });

  /**
   * Fetch and summarise a remote agent's card.
   *
   * Outbound A2A is not implemented — nothing consumes a peer card yet — so
   * this is explicitly a read-only probe that lets an operator confirm a peer
   * is reachable and see what it claims to do. Behind the SSRF validator
   * because the URL comes from user input.
   */
  server.post('/admin/a2a/peers/probe', async (request, reply) => {
    const parsed = PeerProbeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid probe request', details: parsed.error.issues } });
    }

    let validated;
    try {
      validated = await validateBaseUrlForSSRF(parsed.data.url);
    } catch (err) {
      return reply.code(400).send({
        error: { message: err instanceof Error ? err.message : 'URL rejected by SSRF policy' },
      });
    }

    // Accept either the card URL itself or the agent's base URL.
    const base = validated.url.replace(/\/+$/, '');
    const candidates = base.endsWith('.json')
      ? [base]
      : [`${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), A2A_TIMEOUT_MS);
    try {
      for (const url of candidates) {
        try {
          const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
          if (!res.ok) continue;
          // A remote card is untrusted input — read it defensively rather
          // than trusting any field to be present or well-typed.
          const card = (await res.json()) as Record<string, any> | null;
          return reply.send({
            ok: true,
            url,
            card,
            summary: {
              name: card?.name ?? null,
              description: card?.description ?? null,
              protocolVersion: card?.protocolVersion ?? null,
              preferredTransport: card?.preferredTransport ?? null,
              capabilities: card?.capabilities ?? null,
              skillCount: Array.isArray(card?.skills) ? card.skills.length : 0,
            },
          });
        } catch {
          // Try the next candidate path before giving up.
        }
      }

      return reply.code(502).send({
        error: { message: `No agent card found at ${candidates.join(' or ')}` },
      });
    } finally {
      clearTimeout(timer);
    }
  });
}
