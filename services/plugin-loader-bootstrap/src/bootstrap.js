"use strict";
/**
 * Zero-modification bootstrap: composes gateway + plugins into a running system.
 *
 * Run with:
 *   bun services/plugin-loader-bootstrap/src/bootstrap.ts
 *   bun services/plugin-loader-bootstrap/src/bootstrap.ts --plugin mcp-server --transport sse --port 3100
 */
Object.defineProperty(exports, "__esModule", { value: true });
const server_js_1 = require("@dmr-x/gateway/src/server.js"); // gateway's createServer()
const plugin_loader_1 = require("@dmr-x/plugin-loader");
function parseArgs(args) {
    const result = {};
    let currentArg = null;
    for (const arg of args) {
        if (arg.startsWith('--')) {
            currentArg = arg.slice(2);
            result[currentArg] = 'true';
        }
        else if (currentArg) {
            result[currentArg] = arg;
            currentArg = null;
        }
    }
    return result;
}
function createInMemoryStateStore() {
    const store = new Map();
    return {
        get: async (key) => {
            const entry = store.get(key);
            if (!entry)
                return undefined;
            if (Date.now() > entry.expiresAt) {
                store.delete(key);
                return undefined;
            }
            return JSON.parse(entry.value);
        },
        set: async (key, value, ttlSeconds) => {
            store.set(key, {
                value: JSON.stringify(value),
                expiresAt: Date.now() + (ttlSeconds ?? 86400) * 1000
            });
        },
        delete: async (key) => {
            store.delete(key);
        },
        keys: async (prefix) => {
            const result = [];
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
    const gateway = await (0, server_js_1.createServer)();
    // 2. Extract gateway internals to inject into plugins
    const deps = {
        router: gateway.router, // Fastify-decorated
        adapterRegistry: gateway.adapterRegistry,
        stateStore: createInMemoryStateStore(),
        logger: console,
        config: { ...process.env },
    };
    // 3. Load plugins
    const loader = new plugin_loader_1.PluginLoader();
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
//# sourceMappingURL=bootstrap.js.map