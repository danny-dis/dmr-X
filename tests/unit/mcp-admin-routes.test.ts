import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { MCP_CATALOG, renderCatalogArgs, getCatalogEntry } from '../../packages/core/src/mcp-catalog.js';
import {
  buildCatalogInstallBody,
  mcpAdminRoutes,
} from '../../apps/gateway/src/routes/mcp-admin.routes.js';

let tmpDir: string;
let configFile: string;
let app: FastifyInstance;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-mcp-admin-'));
  configFile = path.join(tmpDir, 'dmrx-mcp.config.json');
  process.env.DMRX_MCP_CONFIG_PATH = configFile;

  app = Fastify();
  await app.register(mcpAdminRoutes, { prefix: '/v1' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  delete process.env.DMRX_MCP_CONFIG_PATH;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function readPersisted(): any[] {
  if (!fs.existsSync(configFile)) return [];
  return JSON.parse(fs.readFileSync(configFile, 'utf-8')).aggregation?.servers ?? [];
}

/**
 * A stdio command that is guaranteed not to be a working MCP server. Used to
 * exercise the failure path without depending on the network.
 */
const UNCONNECTABLE = {
  name: 'Broken Server',
  transport: 'stdio' as const,
  command: 'dmrx-definitely-not-a-real-binary-xyz',
  args: [],
};

describe('MCP admin — validation', () => {
  it('rejects a stdio server with no command', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers',
      payload: { name: 'No command', transport: 'stdio' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Invalid server config');
    // The old endpoint cast the body `as` with no validation and wrote it.
    expect(readPersisted()).toHaveLength(0);
  });

  it('rejects an sse server with no url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers',
      payload: { name: 'No url', transport: 'sse' },
    });

    expect(res.statusCode).toBe(400);
    expect(readPersisted()).toHaveLength(0);
  });

  it('rejects an unknown transport', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers',
      payload: { name: 'Weird', transport: 'carrier-pigeon', url: 'https://example.com' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects an id containing path characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers',
      payload: { id: '../../etc/passwd', name: 'Sneaky', transport: 'stdio', command: 'echo' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('MCP admin — test before save', () => {
  it('does not persist a server that cannot connect', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers',
      payload: UNCONNECTABLE,
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().test.ok).toBe(false);
    // The whole point: a broken config leaves no trace.
    expect(readPersisted()).toHaveLength(0);
  });

  it('reports the failure reason rather than a generic error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers/test',
      payload: UNCONNECTABLE,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.toolCount).toBe(0);
    expect(typeof body.errorMessage).toBe('string');
    expect(body.errorMessage.length).toBeGreaterThan(0);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('persists an unconnectable server only when skipTest is explicitly set', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers?skipTest=true',
      payload: UNCONNECTABLE,
    });

    expect(res.statusCode).toBe(201);
    const persisted = readPersisted();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].name).toBe('Broken Server');
    // Saved, but honestly reported as not connected.
    expect(res.json().status).toBe('disconnected');
  });

  it('refuses a duplicate id', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers?skipTest=true',
      payload: { ...UNCONNECTABLE, id: 'dupe' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers?skipTest=true',
      payload: { ...UNCONNECTABLE, id: 'dupe' },
    });

    expect(res.statusCode).toBe(409);
    expect(readPersisted()).toHaveLength(1);
  });
});

describe('MCP admin — listing and secrets', () => {
  it('reports real status instead of a hardcoded value', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers?skipTest=true',
      payload: { ...UNCONNECTABLE, id: 'srv-1' },
    });

    const res = await app.inject({ method: 'GET', url: '/v1/admin/mcp/servers' });
    const { servers } = res.json();

    expect(servers).toHaveLength(1);
    expect(servers[0].status).toBe('disconnected');
    expect(servers[0].toolCount).toBe(0);
  });

  it('never echoes an apiKey or env values back to the client', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers?skipTest=true',
      payload: {
        id: 'secretive',
        name: 'Secretive',
        transport: 'sse',
        url: 'https://example.com/sse',
        apiKey: 'sk-super-secret-value',
        env: { TOKEN: 'another-secret' },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/v1/admin/mcp/servers' });
    const raw = res.payload;

    expect(raw).not.toContain('sk-super-secret-value');
    expect(raw).not.toContain('another-secret');
    // The key names still show, so an operator can debug what is configured.
    expect(res.json().servers[0].env).toHaveProperty('TOKEN');
  });

  it('deletes a server', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers?skipTest=true',
      payload: { ...UNCONNECTABLE, id: 'gone' },
    });

    const res = await app.inject({ method: 'DELETE', url: '/v1/admin/mcp/servers/gone' });

    expect(res.statusCode).toBe(204);
    expect(readPersisted()).toHaveLength(0);
  });

  it('404s deleting an unknown server', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/admin/mcp/servers/nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('MCP admin — catalog', () => {
  it('serves the curated catalog with categories', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/mcp/catalog' });
    const body = res.json();

    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.categories).toHaveProperty('development');
  });

  it('rejects an install missing a required credential', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers/install',
      payload: { catalogId: 'github', values: {} },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().missing).toContain('GITHUB_PERSONAL_ACCESS_TOKEN');
    expect(readPersisted()).toHaveLength(0);
  });

  it('404s an unknown catalog id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers/install',
      payload: { catalogId: 'not-a-real-server', values: {} },
    });

    expect(res.statusCode).toBe(404);
  });

  it('treats a whitespace-only credential as missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mcp/servers/install',
      payload: { catalogId: 'github', values: { GITHUB_PERSONAL_ACCESS_TOKEN: '   ' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().missing).toContain('GITHUB_PERSONAL_ACCESS_TOKEN');
  });
});

describe('MCP catalog templates', () => {
  it('every entry is internally consistent', () => {
    for (const entry of MCP_CATALOG) {
      if (entry.transport === 'stdio') {
        expect(entry.command, `${entry.id} needs a command`).toBeTruthy();
      } else {
        expect(entry.url, `${entry.id} needs a url`).toBeTruthy();
      }

      // Every {{TOKEN}} in args must have a matching requiredEnv entry,
      // otherwise the generated form cannot collect it and the token would
      // survive into argv verbatim.
      const tokens = (entry.args ?? []).flatMap((a) =>
        [...a.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]),
      );
      const declared = new Set(entry.requiredEnv.map((v) => v.key));
      for (const token of tokens) {
        expect(declared.has(token), `${entry.id} uses {{${token}}} but does not declare it`).toBe(true);
      }
    }
  });

  it('has unique ids', () => {
    const ids = MCP_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains the current catalog set', () => {
    const ids = MCP_CATALOG.map((e) => e.id);
    for (const id of [
      'playwright',
      'chrome-devtools',
      'context7',
      'pglite',
      'todoist',
      'figma',
      'exa',
      'tavily',
      'stripe',
      'supabase',
    ]) {
      expect(ids, `catalog should contain ${id}`).toContain(id);
    }
    expect(ids).not.toContain('puppeteer');
  });

  it('describes http (streamable) catalog entries', () => {
    const stripe = getCatalogEntry('stripe')!;
    const supabase = getCatalogEntry('supabase')!;

    for (const entry of [stripe, supabase]) {
      expect(entry.transport).toBe('http');
      expect(entry.url).toBeTruthy();
      expect(entry.command).toBeUndefined();
    }

    expect(stripe.requiredEnv.map((v) => v.key)).toContain('STRIPE_API_KEY');
  });

  it('substitutes placeholders into args', () => {
    const entry = getCatalogEntry('filesystem')!;
    const args = renderCatalogArgs(entry.args, { ALLOWED_DIR: '/srv/data' });

    expect(args).toContain('/srv/data');
    expect(args.join(' ')).not.toContain('{{');
  });

  it('leaves an unsupplied placeholder intact rather than blanking it', () => {
    const entry = getCatalogEntry('filesystem')!;
    const args = renderCatalogArgs(entry.args, {});

    // An empty allowlist path would read as "current directory" to the
    // filesystem server — the token must survive so the failure is visible.
    expect(args).toContain('{{ALLOWED_DIR}}');
  });
});

describe('buildCatalogInstallBody — credential routing', () => {
  it('routes an http entry secret into apiKey, not env (stripe)', () => {
    const body = buildCatalogInstallBody(
      getCatalogEntry('stripe')!,
      { STRIPE_API_KEY: 'sk_test_x' },
      { id: 'stripe' },
    );

    expect(body.transport).toBe('http');
    expect(body.apiKey).toBe('sk_test_x');
    expect(body.env).toBeUndefined();
    expect(body.url).toBeTruthy();
    expect(body.command).toBeUndefined();
    expect(body.enabled).toBe(true);
  });

  it('routes an http entry secret into apiKey, not env (supabase)', () => {
    const body = buildCatalogInstallBody(
      getCatalogEntry('supabase')!,
      { SUPABASE_ACCESS_TOKEN: 'sbp_example' },
      { id: 'supabase' },
    );

    expect(body.transport).toBe('http');
    expect(body.apiKey).toBe('sbp_example');
    expect(body.env).toBeUndefined();
    expect(body.url).toBe('https://mcp.supabase.com/mcp');
    expect(body.enabled).toBe(true);
  });

  it('keeps secret values in env for stdio entries (no apiKey)', () => {
    const body = buildCatalogInstallBody(
      getCatalogEntry('github')!,
      { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example' },
      { id: 'github' },
    );

    expect(body.transport).toBe('stdio');
    expect(body.apiKey).toBeUndefined();
    expect(body.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example' });
  });

  it('handles an http entry with no values', () => {
    const body = buildCatalogInstallBody(getCatalogEntry('stripe')!, {}, { id: 'stripe' });

    expect(body.transport).toBe('http');
    expect(body.apiKey).toBeUndefined();
    expect(body.env).toBeUndefined();
  });
});
