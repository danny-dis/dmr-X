/**
 * Live verification: DMR-X MCP aggregation + HOT-RELOAD.
 *
 * Proves, against a running dmrx-mcp process (NO restarts):
 *   1. an external stdio MCP server added to dmrx-mcp.config.json is connected
 *      and its tools re-exposed downstream, namespaced <serverId>__<tool>
 *   2. proxied calls actually EXECUTE upstream and return upstream output
 *   3. removing the server hot-removes its tools
 *   4. re-adding a DIFFERENT server hot-adds and its tool is callable
 * The dmrx-mcp PID is captured before and after and asserted unchanged.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const URL_ = process.env.MCP_URL ?? 'http://127.0.0.1:47114/mcp';
const KEY = process.env.MCP_KEY ?? 'test-mcp-key';
const REPO = 'C:/Users/pc/Documents/projects/DMR-X';
const CFG = `${REPO}/dmrx-mcp.config.json`;
const BAK = `${CFG}.verify-bak`;

const results: Array<{ n: string; ok: boolean; ev: string }> = [];
const rec = (n: string, ok: boolean, ev: unknown) => {
  const s = typeof ev === 'string' ? ev : JSON.stringify(ev);
  results.push({ n, ok, ev: (s ?? '').slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}\n      ${(s ?? '').slice(0, 300)}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function portOwnerPid(): string {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const port = new URL(URL_).port || '47114';
    const line = out.split(/\r?\n/).find((l) => l.includes(`:${port} `) && /LISTENING/.test(l));
    return line ? line.trim().split(/\s+/).pop()! : 'unknown';
  } catch { return 'unknown'; }
}

function setServers(servers: unknown[]) {
  const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
  cfg.aggregation = { ...(cfg.aggregation ?? {}), enabled: true, servers };
  writeFileSync(CFG, JSON.stringify(cfg, null, 2));
}

const mkServer = (id: string, tag: string) => ({
  id, name: `Test ${id} MCP`, transport: 'stdio',
  command: 'bun', args: ['scripts/test-echo-mcp.ts'],
  cwd: `${REPO}/services/mcp-server`,
  env: { ECHO_TAG: tag },
  timeoutMs: 30000, maxRetries: 3, enabled: true,
});

async function connect() {
  const t = new StreamableHTTPClientTransport(new URL(URL_), {
    requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
  });
  const c = new Client({ name: 'agg-verify', version: '1.0.0' });
  await c.connect(t);
  return c;
}

async function toolNames(): Promise<string[]> {
  const c = await connect();
  const l = await c.listTools();
  await c.close();
  return l.tools.map((t) => t.name);
}

async function main() {
  copyFileSync(CFG, BAK);
  const pidBefore = portOwnerPid();
  rec('captured dmrx-mcp port owner pid', pidBefore !== 'unknown', `pid=${pidBefore}`);

  const baseline = await toolNames();
  rec('baseline: no aggregated test tools', !baseline.some((n) => n.includes('echo_ping')),
    `${baseline.length} tools, none aggregated`);

  // --- 1. HOT ADD server "alpha" -------------------------------------------
  setServers([mkServer('alpha', 'alpha')]);
  await sleep(9000);
  let names = await toolNames();
  const alphaPing = names.find((n) => n.endsWith('echo_ping'));
  rec('HOT-ADD: alpha tools re-exposed downstream (no restart)', !!alphaPing,
    `count ${baseline.length}->${names.length}; found=${alphaPing}`);
  rec('HOT-ADD: tools are namespaced <serverId>__<tool>', alphaPing === 'alpha__echo_ping', `name=${alphaPing}`);

  // --- 2. proxied EXECUTION ------------------------------------------------
  if (alphaPing) {
    const c = await connect();
    try {
      const r: any = await c.callTool({ name: alphaPing, arguments: { args: { message: 'hello-agg' } } }, undefined, { timeout: 40000 });
      const txt = (r.content ?? []).map((p: any) => p.text ?? '').join('');
      rec('PROXY CALL executes upstream (echo_ping)', txt.includes('pong: hello-agg'), txt);
    } catch (e: any) { rec('PROXY CALL executes upstream (echo_ping)', false, e.message); }
    try {
      const r: any = await c.callTool({ name: 'alpha__add_numbers', arguments: { args: { a: 17, b: 25 } } }, undefined, { timeout: 40000 });
      const txt = (r.content ?? []).map((p: any) => p.text ?? '').join('');
      rec('PROXY CALL computes upstream (add_numbers 17+25)', txt.includes('42'), txt);
    } catch (e: any) { rec('PROXY CALL computes upstream (add_numbers 17+25)', false, e.message); }
    await c.close();
  }

  // --- 3. HOT REMOVE -------------------------------------------------------
  setServers([]);
  await sleep(9000);
  names = await toolNames();
  rec('HOT-REMOVE: alpha tools gone (no restart)', !names.some((n) => n.startsWith('alpha__')),
    `count=${names.length}; alpha tools=${names.filter((n) => n.startsWith('alpha__')).join(',') || 'none'}`);

  // --- 4. HOT RE-ADD a DIFFERENT server id --------------------------------
  setServers([mkServer('bravo', 'bravo')]);
  await sleep(9000);
  names = await toolNames();
  const bravoPing = names.find((n) => n.startsWith('bravo__') && n.endsWith('echo_ping'));
  rec('HOT-READD: bravo tools appear under new namespace', !!bravoPing, `found=${bravoPing}; count=${names.length}`);
  if (bravoPing) {
    const c = await connect();
    try {
      const r: any = await c.callTool({ name: bravoPing, arguments: { args: { message: 'second-server' } } }, undefined, { timeout: 40000 });
      const txt = (r.content ?? []).map((p: any) => p.text ?? '').join('');
      rec('HOT-READD: bravo tool is immediately callable', txt.includes('pong: second-server'), txt);
    } catch (e: any) { rec('HOT-READD: bravo tool is immediately callable', false, e.message); }
    await c.close();
  }

  // --- 5. restore + prove SAME process served all of it -------------------
  copyFileSync(BAK, CFG);
  await sleep(6000);
  const pidAfter = portOwnerPid();
  rec('NO RESTART: same pid served every phase', pidBefore === pidAfter && pidAfter !== 'unknown',
    `before=${pidBefore} after=${pidAfter}`);
  const restored = await toolNames();
  rec('cleanup: config restored, aggregated tools removed',
    !restored.some((n) => n.startsWith('alpha__') || n.startsWith('bravo__')), `count=${restored.length}`);

  console.log('\n===== AGGREGATION SUMMARY =====');
  const pass = results.filter((r) => r.ok).length;
  console.log(`${pass}/${results.length} passed`);
  results.filter((r) => !r.ok).forEach((f) => console.log(` FAILED - ${f.n}: ${f.ev}`));
  process.exit(0);
}

main().catch((e) => { try { copyFileSync(BAK, CFG); } catch {} console.error('HARNESS ERROR', e); process.exit(1); });
