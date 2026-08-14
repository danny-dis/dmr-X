import { createDMRXMcpServer } from '../../services/mcp-server/dist/index.js';
// v2 SDK: the monolithic @modelcontextprotocol/sdk (v1) was split into
// @modelcontextprotocol/client (Client + transports, incl. InMemoryTransport)
// and @modelcontextprotocol/server. Both are installed as workspace deps.
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

const GATEWAY_URL = process.env.DMRX_GATEWAY_URL || 'http://localhost:3000';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('PASS:', msg);
}
const txtOf = (r) => String(r?.content?.[0]?.text ?? r ?? '');

const { server, state } = createDMRXMcpServer({ gatewayUrl: GATEWAY_URL });
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverT), (async () => {})()]);

const client = new Client({ name: 'verify', version: '1.0.0' }, { capabilities: {} });
await client.connect(clientT);

console.log('=== dmrx_list_skills (before) ===');
const before = await client.callTool({ name: 'dmrx_list_skills', arguments: { limit: 5 } });
console.log(txtOf(before).slice(0, 300));
assert(/total|skills|error/i.test(txtOf(before)), 'dmrx_list_skills responds');

console.log('=== dmrx_import_repo (github link) ===');
const res = await client.callTool({
  name: 'dmrx_import_repo',
  arguments: { repoUrl: 'https://github.com/msitarzewski/agency-agents.git', category: 'agency' },
});
const txt = txtOf(res);
console.log(txt.slice(0, 700));
assert(/imported|success|error/i.test(txt), 'dmrx_import_repo responds');

console.log('=== dmrx_list_skills (after) ===');
const after = await client.callTool({ name: 'dmrx_list_skills', arguments: { limit: 5 } });
console.log(txtOf(after).slice(0, 300));

await client.close();
console.log('DONE');
