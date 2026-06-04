/**
 * Zero-modification bootstrap: composes gateway + plugins into a running system.
 *
 * Run with:
 *   bun services/plugin-loader-bootstrap/src/bootstrap.ts
 *   bun services/plugin-loader-bootstrap/src/bootstrap.ts --plugin mcp-server --transport sse --port 3100
 */

import { createServer } from '@dmr-x/gateway/src/server.js';     // gateway's createServer()
import { PluginLoader } from '@dmr-x/plugin-loader';
import { createMCPPlugin } from '@dmr-x/mcp-server/src/plugin-entry.js';

function parseArgs(args: string[]): { [key: string]: string } {
  const result: { [key: string]: string } = {};
  let currentArg: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--')) {
      currentArg = arg.slice(2);
      result[currentArg] = 'true';
    } else if (currentArg) {
      result[currentArg] = arg;
      currentArg = null;
    }
  }

  return result;
}

function createInMemoryStateStore() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    get: async <T>(key: string): Promise<T | undefined> => {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return JSON.parse(entry.value) as T;
    },
    set: async <T>(key: string, value: T, ttlSeconds?: number): Promise<void> => {
      store.set(key, {
        value: JSON.stringify(value),
        expiresAt: Date.now() + (ttlSeconds ?? 86400) * 1000
      });
    },
    delete: async (key: string): Promise<void> => {
      store.delete(key);
    },
    keys: async (prefix?: string): Promise<string[]> => {
      const result: string[] = [];
      for (const [key] of store) {
        if (!prefix || key.startsWith(prefix)) {
          result.push(key);
        }
      }
      return result;
    }
  };
}

async function main() {
  const args = parseArgs(Deno.args);

  // 1. Start the gateway (unchanged — no new deps)
  const gateway = await createServer();

  // 2. Extract gateway internals to inject into plugins
  const deps = {
    router: gateway.router,                                        // Fastify-decorated
    adapterRegistry: gateway.adapterRegistry,
    stateStore: createInMemoryStateStore(),
    logger: console,
    config: { ...process.env },
  };

  // 3. Load plugins
  const loader = new PluginLoader();
  await loader.load({
    enabledPlugins: args.plugins ?? ['mcp-server'],
    pluginOverrides: args.pluginOverrides ? JSON.parse(args.pluginOverrides) : undefined,
  });

  // 4. Start the gateway server
  const port = parseInt(args.port ?? '3000', 10);
  await gateway.listen({ port, host: '0.0.0.0' });

  // 5. Start plugins (MCP plugin will start its transports)
  // The plugin loader's load() method already calls start() on plugins
}

main().catch((error) => {
  console.error('Failed to start plugin bootstrap:', error);
  process.exit(1);
});