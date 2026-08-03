import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

import { MCP_CATALOG, MCP_CATALOG_CATEGORIES, getCatalogEntry, renderCatalogArgs } from '@dmr-x/core';
import { MCPServerRegistry, type MCPServerConfig } from '@dmr-x/mcp-client';
import { logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// MCP server management
// ---------------------------------------------------------------------------
//
// The previous implementation of this surface (POST /admin/mcp/aggregation/
// servers) appended JSON to a config file and reported a hardcoded
// `status: 'disconnected', toolCount: 0`. Nothing ever connected, so an
// operator could "add" a server with a typo'd command and get no signal until
// an agent run failed much later.
//
// This module drives the real client — @dmr-x/mcp-client's MCPServerRegistry,
// which already implements connect / listTools / refresh / circuit-breaking —
// and treats the config file purely as persistence. Every mutation is
// validated, then proven against the live server, and only then written.

/** Persisted shape of one aggregation server entry. */
const McpServerSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'id may contain only letters, numbers, hyphens and underscores')
      .optional(),
    name: z.string().min(1).max(128),
    transport: z.enum(['stdio', 'sse']),
    command: z.string().min(1).max(512).optional(),
    args: z.array(z.string().max(2048)).max(64).optional(),
    env: z.record(z.string(), z.string().max(4096)).optional(),
    url: z.string().url().max(2048).optional(),
    apiKey: z.string().max(4096).optional(),
    timeoutMs: z.number().int().min(1000).max(600_000).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    allowedTools: z.array(z.string().max(128)).max(256).optional(),
    enabled: z.boolean().optional(),
  })
  // A transport that is missing its own required field cannot connect, and the
  // registry would throw at connect time with a less specific message.
  .refine((s) => s.transport !== 'stdio' || !!s.command, {
    message: "stdio transport requires 'command'",
    path: ['command'],
  })
  .refine((s) => s.transport !== 'sse' || !!s.url, {
    message: "sse transport requires 'url'",
    path: ['url'],
  });

/** Install a catalog entry: the template id plus the operator's values. */
const McpInstallSchema = z.object({
  catalogId: z.string().min(1).max(64),
  /** Overrides the catalog's display name. */
  name: z.string().min(1).max(128).optional(),
  values: z.record(z.string(), z.string().max(4096)).default({}),
});

export type McpServerInput = z.infer<typeof McpServerSchema>;

/**
 * Live connections owned by the gateway.
 *
 * Deliberately module-scoped: connections are process-wide, and a stdio server
 * is a child process that must not be spawned once per request.
 */
const registry = new MCPServerRegistry();

/** Secret-bearing fields, stripped from every response. */
const SECRET_FIELDS = ['apiKey'] as const;

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

function readServers(): McpServerInput[] {
  const config = readConfig();
  const servers = config.aggregation?.servers;
  return Array.isArray(servers) ? servers : [];
}

function writeServers(servers: McpServerInput[]): void {
  const config = readConfig();
  config.aggregation = { ...(config.aggregation ?? {}), servers };
  writeConfig(config);
}

/**
 * Strip credentials before a server entry leaves the process.
 *
 * `env` is redacted key-by-key rather than dropped: an operator needs to see
 * *which* variables are set to debug a failing server, but not their values.
 */
function redact(server: McpServerInput): Record<string, unknown> {
  const out: Record<string, unknown> = { ...server };
  for (const field of SECRET_FIELDS) {
    if (out[field] !== undefined) out[field] = '••••••••';
  }
  if (server.env) {
    out.env = Object.fromEntries(Object.keys(server.env).map((k) => [k, '••••••••']));
  }
  return out;
}

function toRegistryConfig(server: McpServerInput & { id: string }): MCPServerConfig {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    apiKey: server.apiKey,
    timeoutMs: server.timeoutMs,
    maxRetries: server.maxRetries,
    allowedTools: server.allowedTools,
  };
}

/**
 * Connect a throwaway copy of a server config and report what it exposes.
 *
 * Runs against its own registry under a random id so it can never collide with
 * (or evict) a live connection of the same server, and always disconnects —
 * a stdio entry spawns a child process, and leaking one per failed test would
 * accumulate silently.
 */
async function testConnection(
  server: McpServerInput,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; toolCount: number; tools: Array<{ name: string; description?: string }>; errorMessage?: string; latencyMs: number }> {
  const probe = new MCPServerRegistry();
  const probeId = `probe-${randomUUID()}`;
  const started = Date.now();

  try {
    const connected = await Promise.race([
      probe.connect(toRegistryConfig({ ...server, id: probeId })),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    return {
      ok: true,
      toolCount: connected.tools.length,
      tools: connected.tools.map((t) => ({ name: t.name, description: t.description })),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      toolCount: 0,
      tools: [],
      errorMessage: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  } finally {
    // disposeAll tolerates "nothing connected", which is the common case here
    // because a failed connect leaves the probe registry empty.
    try {
      await probe.disposeAll();
    } catch (err) {
      logger.warn({ err, probeId }, 'MCP probe cleanup failed');
    }
  }
}

/**
 * Connect every persisted, enabled server.
 *
 * Called at boot. Failures are logged and skipped rather than thrown: one
 * unreachable upstream must not stop the gateway from starting.
 */
export async function connectPersistedMcpServers(): Promise<void> {
  const servers = readServers();
  for (const server of servers) {
    if (server.enabled === false || !server.id) continue;
    try {
      await registry.connect(toRegistryConfig(server as McpServerInput & { id: string }));
    } catch (err) {
      logger.warn({ err, id: server.id }, 'Failed to connect persisted MCP server at startup');
    }
  }
}

/** Exposed so tool dispatch and the A2A bridge can reach the same connections. */
export function getMcpRegistry(): MCPServerRegistry {
  return registry;
}

export async function mcpAdminRoutes(server: FastifyInstance): Promise<void> {
  // ── Catalog ───────────────────────────────────────────────────────────────

  server.get('/admin/mcp/catalog', async () => ({
    categories: MCP_CATALOG_CATEGORIES,
    entries: MCP_CATALOG,
  }));

  // ── Servers ───────────────────────────────────────────────────────────────

  /**
   * Persisted servers merged with live connection state.
   *
   * `status` and `toolCount` come from the registry, not the file, so a server
   * that is configured but unreachable reads as 'disconnected' instead of the
   * old hardcoded value that made every entry look identical.
   */
  server.get('/admin/mcp/servers', async () => {
    const persisted = readServers();
    const breakers = registry.getCircuitBreakerStatus();

    const servers = persisted.map((s) => {
      const live = s.id ? registry.get(s.id) : undefined;
      return {
        ...redact(s),
        status: live ? 'connected' : s.enabled === false ? 'disabled' : 'disconnected',
        toolCount: live?.tools.length ?? 0,
        connectedAt: live?.connectedAt ?? null,
        tools: live?.tools.map((t) => ({ name: t.name, description: t.description })) ?? [],
        circuitBreaker: s.id ? breakers[s.id] ?? null : null,
      };
    });

    return { servers, total: servers.length };
  });

  /**
   * Dry-run a configuration without persisting it.
   *
   * The UI calls this before save so a bad command or URL is reported while
   * the operator still has the form open.
   */
  server.post('/admin/mcp/servers/test', async (request, reply) => {
    const parsed = McpServerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid server config', details: parsed.error.issues } });
    }
    return reply.send(await testConnection(parsed.data));
  });

  /**
   * Add a server: validate → test → persist → connect.
   *
   * A configuration that cannot connect is rejected with 502 and *not* written.
   * Persisting an unverified entry is what made the old endpoint misleading.
   * `?skipTest=true` exists for servers that are legitimately offline at
   * configuration time; it is opt-in so the safe path is the default.
   */
  server.post('/admin/mcp/servers', async (request, reply) => {
    const parsed = McpServerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid server config', details: parsed.error.issues } });
    }

    const { skipTest } = request.query as { skipTest?: string };
    const input = parsed.data;
    const id = input.id ?? `mcp-${randomUUID().slice(0, 8)}`;

    const servers = readServers();
    if (servers.some((s) => s.id === id)) {
      return reply.code(409).send({ error: { message: `A server with id "${id}" already exists` } });
    }

    const record: McpServerInput & { id: string } = { ...input, id, enabled: input.enabled ?? true };

    let test: Awaited<ReturnType<typeof testConnection>> | null = null;
    if (skipTest !== 'true') {
      test = await testConnection(record);
      if (!test.ok) {
        return reply.code(502).send({
          error: {
            message: `Could not connect to "${record.name}": ${test.errorMessage}`,
            detail: 'Nothing was saved. Fix the configuration and try again, or pass ?skipTest=true to save anyway.',
          },
          test,
        });
      }
    }

    writeServers([...servers, record]);

    // Persist first, then connect. A connect failure here (racy, since the test
    // just succeeded) leaves a saved-but-disconnected entry the operator can
    // retry, which is better than discarding a config we know is valid.
    let connectError: string | null = null;
    if (record.enabled) {
      try {
        await registry.connect(toRegistryConfig(record));
      } catch (err) {
        connectError = err instanceof Error ? err.message : String(err);
        logger.warn({ err, id }, 'MCP server saved but initial connect failed');
      }
    }

    return reply.code(201).send({
      ...redact(record),
      status: connectError ? 'disconnected' : record.enabled ? 'connected' : 'disabled',
      toolCount: test?.toolCount ?? 0,
      tools: test?.tools ?? [],
      connectError,
    });
  });

  /** Re-poll a connected server's tool list. */
  server.post('/admin/mcp/servers/:id/refresh', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!registry.has(id)) {
      // Not connected: try to bring it up from persisted config, which is what
      // an operator pressing "refresh" on a failed server actually wants.
      const record = readServers().find((s) => s.id === id);
      if (!record) return reply.code(404).send({ error: { message: 'Server not found' } });

      try {
        const connected = await registry.connect(toRegistryConfig(record as McpServerInput & { id: string }));
        return reply.send({ id, status: 'connected', toolCount: connected.tools.length, reconnected: true });
      } catch (err) {
        return reply.code(502).send({
          error: { message: err instanceof Error ? err.message : String(err) },
          id,
          status: 'disconnected',
        });
      }
    }

    try {
      await registry.refreshTools(id);
      const live = registry.get(id);
      return reply.send({
        id,
        status: 'connected',
        toolCount: live?.tools.length ?? 0,
        tools: live?.tools.map((t) => ({ name: t.name, description: t.description })) ?? [],
        reconnected: false,
      });
    } catch (err) {
      return reply.code(502).send({ error: { message: err instanceof Error ? err.message : String(err) } });
    }
  });

  /** Update a persisted server. Same test-before-save contract as create. */
  server.put('/admin/mcp/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = McpServerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid server config', details: parsed.error.issues } });
    }

    const servers = readServers();
    const index = servers.findIndex((s) => s.id === id);
    if (index === -1) return reply.code(404).send({ error: { message: 'Server not found' } });

    const record: McpServerInput & { id: string } = { ...parsed.data, id, enabled: parsed.data.enabled ?? true };

    const { skipTest } = request.query as { skipTest?: string };
    if (skipTest !== 'true' && record.enabled) {
      const test = await testConnection(record);
      if (!test.ok) {
        return reply.code(502).send({
          error: { message: `Could not connect to "${record.name}": ${test.errorMessage}`, detail: 'No changes were saved.' },
          test,
        });
      }
    }

    servers[index] = record;
    writeServers(servers);

    // Cycle the live connection so the edit takes effect now rather than at
    // the next restart.
    if (registry.has(id)) {
      try {
        await registry.disconnect(id);
      } catch (err) {
        logger.warn({ err, id }, 'Disconnect during MCP server update failed');
      }
    }
    let connectError: string | null = null;
    if (record.enabled) {
      try {
        await registry.connect(toRegistryConfig(record));
      } catch (err) {
        connectError = err instanceof Error ? err.message : String(err);
      }
    }

    return reply.send({
      ...redact(record),
      status: connectError ? 'disconnected' : record.enabled ? 'connected' : 'disabled',
      toolCount: registry.get(id)?.tools.length ?? 0,
      connectError,
    });
  });

  server.delete('/admin/mcp/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const servers = readServers();
    const remaining = servers.filter((s) => s.id !== id);
    if (remaining.length === servers.length) {
      return reply.code(404).send({ error: { message: 'Server not found' } });
    }

    // Disconnect before removing the record so a stdio child process is
    // reaped rather than orphaned.
    if (registry.has(id)) {
      try {
        await registry.disconnect(id);
      } catch (err) {
        logger.warn({ err, id }, 'Disconnect during MCP server delete failed');
      }
    }

    writeServers(remaining);
    return reply.code(204).send();
  });

  /**
   * One-click install from the curated catalog.
   *
   * Renders the entry's `{{TOKEN}}` args from the operator's values, routes
   * everything else into `env`, then hands off to the same validated,
   * test-before-save path as a manual add.
   */
  server.post('/admin/mcp/servers/install', async (request, reply) => {
    const parsed = McpInstallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid install request', details: parsed.error.issues } });
    }

    const entry = getCatalogEntry(parsed.data.catalogId);
    if (!entry) {
      return reply.code(404).send({ error: { message: `Unknown catalog entry: ${parsed.data.catalogId}` } });
    }

    const values = parsed.data.values;
    const missing = entry.requiredEnv
      .filter((v) => !v.optional && !values[v.key]?.trim())
      .map((v) => v.key);
    if (missing.length > 0) {
      return reply.code(400).send({
        error: { message: `Missing required values: ${missing.join(', ')}` },
        missing,
      });
    }

    const id = entry.id;
    if (readServers().some((s) => s.id === id)) {
      return reply.code(409).send({ error: { message: `"${entry.name}" is already installed` } });
    }

    // Values consumed as positional args are not also exported as env vars —
    // a connection string in argv does not additionally belong in the child's
    // environment.
    const args = renderCatalogArgs(entry.args, values);
    const consumed = new Set(
      (entry.args ?? []).flatMap((a) => [...a.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])),
    );
    const env = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => !consumed.has(k) && v !== ''),
    );

    const body = {
      id,
      name: parsed.data.name ?? entry.name,
      transport: entry.transport,
      ...(entry.command ? { command: entry.command } : {}),
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(entry.url ? { url: entry.url } : {}),
      enabled: true,
    };

    // Re-dispatch through the create route so install and manual add cannot
    // drift apart in validation or connection semantics.
    const response = await server.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers',
      payload: body,
      headers: {
        'content-type': 'application/json',
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
      },
    });

    return reply.code(response.statusCode).send(response.json());
  });

  /**
   * Every tool across every connected server, for the unified tool browser.
   */
  server.get('/admin/mcp/servers/tools', async () => {
    const tools = registry.getAllTools();
    return { tools, total: tools.length };
  });
}
