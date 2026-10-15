import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { initDb, closeDb } from '../packages/db/src/index.js';
import { registryService } from '../services/registry/src/index.js';
import { serverManager } from '../services/server-manager/src/index.js';
import { setGodmodeConfig, getGodmodeService } from '../services/godmode/src/index.js';
import { godmodeRoutes } from '../apps/gateway/src/routes/godmode.routes.js';

/**
 * Exercise current source handlers without restarting production.
 * DMRX_DATA_DIR must point at an explicitly prepared disposable SQLite backup.
 * Inference is REAL: existing authenticated companion -> existing DMR-X router.
 * No model/provider output is intercepted or synthesized.
 */
const statePath = process.argv[2];
if (!statePath || !process.env.DMRX_DEDICATED_TEST_DATA_DIR) {
  throw new Error('Usage: DMRX_DEDICATED_TEST_DATA_DIR=<disposable backup dir> bun scripts/verify-godmode-dedicated.ts <state.json>');
}
if (process.env.DMRX_DATA_DIR !== process.env.DMRX_DEDICATED_TEST_DATA_DIR) {
  throw new Error('DMRX_DATA_DIR must equal the explicitly isolated test data directory');
}
await initDb();
const live = serverManager.getRunningInstance();
if (!live?.url || !live?.api_key) throw new Error('Existing authenticated companion must be present in the metadata snapshot');
setGodmodeConfig({ baseUrl: live.url, apiKey: live.api_key, llmBaseUrl: live.llm_base_url ?? 'http://127.0.0.1:47113/v1', llmApiKey: live.llm_api_key ?? '', openrouterApiKey: '' });
await getGodmodeService().initialize();
if (!(await getGodmodeService().healthCheck())) throw new Error('Existing companion is not healthy; refusing lifecycle actions');
const candidates = registryService.getCandidates();
const app = Fastify({ logger: false });
app.decorate('router', { getCandidates: () => candidates, route: () => { throw new Error('Dedicated verification must never enter plain inference'); } });
app.get('/health', async () => ({ status: 'ok', role: 'isolated-source-godmode-verifier' }));
await app.register(godmodeRoutes, { prefix: '/v1' });
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('No isolated listener address');
mkdirSync(path.dirname(statePath), { recursive: true });
writeFileSync(statePath, JSON.stringify({ pid: process.pid, port: address.port, url: `http://127.0.0.1:${address.port}`, candidateCount: candidates.length, existingCompanion: live.url, inference: 'real existing GODMODE companion and DMR-X router', productionRestarted: false }, null, 2));
console.log('DEDICATED_GODMODE_READY', address.port, 'candidates', candidates.length);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  closeDb();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
