import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { MCP_CATALOG_MANIFEST } from '../../packages/core/src/mcp-catalog.manifest.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Hermetic fork fixture — mirrors the layout of vendored/servers for the fork
 * entries actually present in the real manifest (see
 * packages/core/src/mcp-catalog.manifest.ts) plus two throwaway fake servers
 * (`fake-fs`, `fake-time`) used only to guard against the manifest leaking a
 * fixture id. The descriptions below deliberately match the upstream
 * vendored/servers values, so the same assertions hold if DMRX_MCP_SERVERS_DIR
 * is pointed at a real vendored clone instead of this fixture.
 */
const FIXTURE_SERVERS_DIR = path.resolve(__dirname, '../fixtures/mcp-servers-src');

// The generator computes SERVERS_DIR at module import time from this env var,
// so it must be set BEFORE the module is loaded (dynamic import + resetModules).
const previousServersDir = process.env.DMRX_MCP_SERVERS_DIR;

let generator: typeof import('../../scripts/generate-mcp-catalog.ts');

describe('mcp-catalog generator', () => {
  beforeAll(async () => {
    process.env.DMRX_MCP_SERVERS_DIR = FIXTURE_SERVERS_DIR;
    vi.resetModules();
    generator = await import('../../scripts/generate-mcp-catalog.ts');
  });

  afterAll(() => {
    // Restore the previous value so the env is not polluted for other tests
    // in the same process. Assigning `undefined` would write the literal
    // string "undefined", so delete the key instead when it was never set.
    if (previousServersDir === undefined) {
      delete process.env.DMRX_MCP_SERVERS_DIR;
    } else {
      process.env.DMRX_MCP_SERVERS_DIR = previousServersDir;
    }
  });

  it('does not leak the fixture fake-* ids into the real manifest', () => {
    const ids = MCP_CATALOG_MANIFEST.map((e) => e.id);
    expect(ids).not.toContain('fake-fs');
    expect(ids).not.toContain('fake-time');
  });

  it('enriches fork entries with the fork description and a derived docsUrl', () => {
    const entries = generator.buildEntriesForTest();
    const byId = new Map(entries.map((e) => [e.id as string, e]));

    const expected: Record<string, { dir: string; description: string }> = {
      filesystem: {
        dir: 'filesystem',
        description: 'MCP server for filesystem access',
      },
      git: {
        dir: 'git',
        description:
          'A Model Context Protocol server providing tools to read, search, and manipulate Git repositories programmatically via LLMs',
      },
      fetch: {
        dir: 'fetch',
        description:
          'A Model Context Protocol server providing tools to fetch and convert web content for usage by LLMs',
      },
      memory: {
        dir: 'memory',
        description: 'MCP server for enabling memory for Claude through a knowledge graph',
      },
      'sequential-thinking': {
        dir: 'sequentialthinking',
        description: 'MCP server for sequential thinking and problem solving',
      },
      everything: {
        dir: 'everything',
        description: 'MCP server that exercises all the features of the MCP protocol',
      },
      time: {
        dir: 'time',
        description:
          'A Model Context Protocol server providing tools for time queries and timezone conversions for LLMs',
      },
    };

    for (const [id, { dir, description }] of Object.entries(expected)) {
      const entry = byId.get(id);
      expect(entry, `fork entry '${id}' should be emitted`).toBeDefined();
      expect(entry!.description).toBe(description);
      expect(entry!.docsUrl).toBe(
        `https://github.com/modelcontextprotocol/servers/tree/main/src/${dir}`,
      );
    }
  });

  it('renders a GENERATED FILE with every fork docsUrl and no undefined objects', () => {
    const output = generator.render();

    expect(output).toContain('GENERATED FILE');
    for (const dir of [
      'filesystem',
      'git',
      'fetch',
      'memory',
      'sequentialthinking',
      'everything',
      'time',
    ]) {
      expect(output).toContain(`https://github.com/modelcontextprotocol/servers/tree/main/src/${dir}`);
    }
    // The generated file's template legitimately contains the word "undefined"
    // (e.g. `getCatalogEntry(...): McpCatalogEntry | undefined`), so scope the
    // no-undefined / no-[object Object] check to the entry literals — that is
    // where an emitter regression would leak a raw value.
    const entriesStart = output.indexOf('readonly McpCatalogEntry[] = [');
    const entriesEnd = output.indexOf('];', entriesStart);
    const entriesSection = output.slice(entriesStart, entriesEnd);
    expect(entriesSection).not.toContain('undefined');
    expect(entriesSection).not.toContain('[object Object]');
  });

  it('emits category, icon, transport and requiredEnv on every entry (tsc bug regression)', () => {
    const entries = generator.buildEntriesForTest();
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry.category, `entry ${entry.id} missing category`).toBeTruthy();
      expect(entry.icon, `entry ${entry.id} missing icon`).toBeTruthy();
      expect(entry.transport, `entry ${entry.id} missing transport`).toBeTruthy();
      expect(Array.isArray(entry.requiredEnv), `entry ${entry.id} missing requiredEnv`).toBe(true);
    }
  });

  it('keeps {{ALLOWED_DIR}} in the filesystem args and declares it in requiredEnv', () => {
    const entries = generator.buildEntriesForTest();
    const filesystem = entries.find((e) => e.id === 'filesystem');

    expect(filesystem).toBeDefined();
    expect(filesystem!.args as string[]).toContain('{{ALLOWED_DIR}}');
    const keys = (filesystem!.requiredEnv as Array<{ key: string }>).map((v) => v.key);
    expect(keys).toContain('ALLOWED_DIR');
  });
});
