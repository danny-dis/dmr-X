/**
 * Real-world test for MCP/A2A optimizations.
 * Exercises: toolIndex O(1) lookup, parallel connect, batch cap, compact JSON.
 */
import { MCPServerRegistry } from '../services/mcp-client/dist/registry.js';

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}`);
  }
}

// ── Test 1: toolIndex O(1) lookup ──────────────────────────────────────────
console.log('\n[1] toolIndex O(1) lookup');
{
  const registry = new MCPServerRegistry();

  // Simulate 5 servers × 20 tools each = 100 tools
  for (let s = 0; s < 5; s++) {
    const server = {
      config: { id: `server-${s}`, name: `Server ${s}` },
      tools: [],
    };
    for (let t = 0; t < 20; t++) {
      const toolName = `tool-${s}-${t}`;
      server.tools.push({ name: toolName, description: `Tool ${t} on server ${s}` });
    }
    registry['indexServerTools'](server);
    registry['servers'].set(`server-${s}`, server);
  }

  // Verify lookups work
  const lookup1 = registry.findServerForTool('tool-2-15');
  assert('finds tool-2-15 on server-2', lookup1 && lookup1.config.id === 'server-2');

  const lookup2 = registry.findServerForTool('tool-0-0');
  assert('finds tool-0-0 on server-0', lookup2 && lookup2.config.id === 'server-0');

  const lookup3 = registry.findServerForTool('tool-4-19');
  assert('finds tool-4-19 on server-4', lookup3 && lookup3.config.id === 'server-4');

  // Unindex server-2 and verify its tools are gone
  const server2 = registry['servers'].get('server-2');
  registry['unindexServerTools'](server2);
  const lookupAfter = registry.findServerForTool('tool-2-15');
  assert('tool-2-15 no longer found after unindex', lookupAfter === undefined);

  // Benchmark: 1000 lookups
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    registry.findServerForTool(`tool-${i % 5}-${(i * 7) % 20}`);
  }
  const elapsed = performance.now() - start;
  console.log(`  1000 lookups: ${elapsed.toFixed(2)}ms (${(elapsed / 1000).toFixed(4)}ms each)`);
}

// ── Test 2: Parallel connect via Promise.allSettled ────────────────────────
console.log('\n[2] MCPClient.connect uses Promise.allSettled');
{
  const fs = await import('node:fs');
  const clientSource = fs.readFileSync('services/mcp-client/src/client.ts', 'utf-8');
  assert('uses Promise.allSettled', clientSource.includes('Promise.allSettled'));
  assert('no sequential for-loop over connectServer', !clientSource.match(/for\s*\([^)]+\)\s*\{[^}]*connectServer/));
}

// ── Test 3: connectPersistedMcpServers is parallel ─────────────────────────
console.log('\n[3] connectPersistedMcpServers uses Promise.allSettled');
{
  const fs = await import('node:fs');
  const adminSource = fs.readFileSync('apps/gateway/src/routes/mcp-admin.routes.ts', 'utf-8');
  assert('uses Promise.allSettled', adminSource.includes('Promise.allSettled'));
  assert('no sequential for-of loop', !adminSource.match(/for\s*\(const server of servers\)/));
}

// ── Test 4: A2A handler batch cap ──────────────────────────────────────────
console.log('\n[4] JSON-RPC batch size cap');
{
  const fs = await import('node:fs');
  const handlerSource = fs.readFileSync('services/mcp-server/src/a2a/handler.ts', 'utf-8');
  assert('MAX_BATCH_SIZE constant defined', handlerSource.includes('MAX_BATCH_SIZE = 100'));
  assert('batch length check present', handlerSource.includes('parsed.length > MAX_BATCH_SIZE'));
}

// ── Test 5: A2A handler compact JSON ────────────────────────────────────────
console.log('\n[5] JSON responses are compact (no pretty-print)');
{
  const fs = await import('node:fs');
  const handlerSource = fs.readFileSync('services/mcp-server/src/a2a/handler.ts', 'utf-8');
  assert('no JSON.stringify(data, null, 2)', !handlerSource.includes('JSON.stringify(data, null, 2)'));
  assert('uses JSON.stringify(data) for sendJson', handlerSource.includes('JSON.stringify(data)'));
}

// ── Test 6: Push notification timeout ───────────────────────────────────────
console.log('\n[6] Push webhook has timeout');
{
  const fs = await import('node:fs');
  const persistSource = fs.readFileSync('services/mcp-server/src/a2a/persistence.ts', 'utf-8');
  assert('PUSH_TIMEOUT_MS defined', persistSource.includes('PUSH_TIMEOUT_MS'));
  assert('AbortController used', persistSource.includes('AbortController'));
  assert('signal attached to fetch', persistSource.includes('signal: ctrl.signal'));
}

// ── Test 7: Upstream watcher parallel + timeout ─────────────────────────────
console.log('\n[7] Upstream watcher is parallel with per-upstream timeout');
{
  const fs = await import('node:fs');
  const indexSource = fs.readFileSync('services/mcp-server/src/index.ts', 'utf-8');
  assert('LIVENESS_TIMEOUT_MS defined', indexSource.includes('LIVENESS_TIMEOUT_MS'));
  assert('Promise.allSettled in watcher', indexSource.includes('Promise.allSettled'));
  assert('AbortController in watcher', indexSource.includes('AbortController'));
}

// ── Test 8: Config watcher parallel ─────────────────────────────────────────
console.log('\n[8] Config watcher applies changes in parallel');
{
  const fs = await import('node:fs');
  const indexSource = fs.readFileSync('services/mcp-server/src/index.ts', 'utf-8');
  const configWatcherSection = indexSource.slice(
    indexSource.indexOf('function startConfigWatcher')
  );
  assert('uses Promise.all in config watcher', configWatcherSection.includes('Promise.all'));
  assert('collects removals array', configWatcherSection.includes('removals.push'));
  assert('collects additions array', configWatcherSection.includes('additions.push'));
}

// ── Test 9: A2A TaskManager max tasks ceiling ───────────────────────────────
console.log('\n[9] A2A TaskManager eviction ceiling');
{
  const fs = await import('node:fs');
  const tmSource = fs.readFileSync('services/mcp-server/src/a2a/task-manager.ts', 'utf-8');
  assert('DEFAULT_MAX_TASKS defined', tmSource.includes('DEFAULT_MAX_TASKS = 1000'));
  assert('evict() called after create', tmSource.includes('this.evict()'));
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
