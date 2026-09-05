/**
 * Companion process boot for the gateway.
 *
 * After the gateway listens, optionally start:
 *  - MCP server (HTTP) with A2A enabled
 *  - G0DM0D3 proxy (via server-manager), already deferred from main.ts
 *
 * Both are gated by env (MCP default on; G0DM0D3 default OFF — opt-in only)
 * and skip if the target is already healthy, so an external always-on
 * supervisor and gateway-managed spawn can coexist.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';

import { logger, resolveGatewayUrl } from '@dmr-x/utils';
import { killTree } from '@dmr-x/server-manager';

/**
 * Resolve bun executable path. On Windows, uv_spawn can't find executables
 * via PATH when launched from a compiled Bun binary, so we resolve the full
 * path eagerly and cache it.
 */
let _bunPath: string | null = null;
function bunPath(): string {
  if (_bunPath) return _bunPath;
  // Prefer the bun that's running this process (embedded Bun runtime)
  const bunExe = process.execPath;
  if (bunExe && bunExe.toLowerCase().includes('bun') && fs.existsSync(bunExe)) {
    _bunPath = bunExe;
    return _bunPath;
  }
  // Fallback: resolve from PATH
  try {
    const resolved = execSync(
      process.platform === 'win32' ? 'where bun' : 'which bun',
      { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim().split('\n')[0];
    if (resolved && fs.existsSync(resolved)) {
      _bunPath = resolved;
      return _bunPath;
    }
  } catch { /* ignore */ }
  // Last resort: return bare name (will fail the same as before)
  _bunPath = 'bun';
  return _bunPath;
}

type ChildLike = {
  pid: number | null;
  kill: (signal?: string) => void;
  exited?: Promise<number>;
};

let mcpChild: ChildLike | null = null;
let mcpStopping = false;
let mcpRestartTimer: ReturnType<typeof setTimeout> | null = null;

function repoRootFromHere(): string {
  // apps/gateway/src/lib → ../../../../
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

// ── Companion PID ledger ────────────────────────────────────────────────────
//
// Companions are spawned AFTER listen(), so on Windows they inherit the
// gateway's listening socket handle. If the gateway is killed hard (crash,
// taskkill, power loss) its graceful shutdown never runs, the companions
// survive — and because they still hold that inherited handle, the gateway's
// own port stays bound by a process that no longer exists. The next boot then
// cannot bind and PM2 restart-loops until someone kills the orphans by hand.
//
// The ledger closes that hole: every spawned companion PID is written to disk,
// and the next boot reaps whatever is still alive before binding. Recovery
// from a hard crash becomes automatic instead of manual.

function companionLedgerPath(): string {
  return path.join(repoRootFromHere(), '.dmrx-data', 'companions.json');
}

function readCompanionLedger(): Record<string, number> {
  try {
    const raw = fs.readFileSync(companionLedgerPath(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Record a companion's PID so a later boot can reap it if we die hard. */
function recordCompanionPid(kind: 'mcp' | 'godmode', pid: number | null | undefined): void {
  if (!pid) return;
  try {
    const file = companionLedgerPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...readCompanionLedger(), [kind]: pid }, null, 2));
  } catch (err) {
    logger.warn({ err, kind, pid }, 'Could not record companion PID');
  }
}

/** PIDs currently LISTENING on `port`, via netstat (Windows) / lsof (POSIX). */
function pidsListeningOn(ports: number[]): number[] {
  const found = new Set<number>();
  const wanted = new Set(ports);
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', timeout: 8000 });
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        // "  TCP    0.0.0.0:47113   0.0.0.0:0   LISTENING   1228"
        const cols = line.trim().split(/\s+/);
        const local = cols[1] ?? '';
        if (!wanted.has(Number(local.slice(local.lastIndexOf(':') + 1)))) continue;
        const pid = Number(cols[cols.length - 1]);
        if (Number.isInteger(pid) && pid > 0) found.add(pid);
      }
    } else {
      const args = ports.map((p) => `-i tcp:${p}`).join(' ');
      const out = execSync(`lsof -t ${args} -sTCP:LISTEN`, { encoding: 'utf8', timeout: 8000 });
      for (const line of out.split(/\r?\n/)) {
        const pid = Number(line.trim());
        if (Number.isInteger(pid) && pid > 0) found.add(pid);
      }
    }
  } catch {
    /* no listener, or the tool is unavailable — nothing to reap */
  }
  return [...found];
}

interface ProcInfo {
  ppid: number;
  cmd: string;
}

/**
 * Snapshot of every process as pid → { ppid, commandLine }.
 *
 * One shell-out for the whole table rather than one per PID: we need both the
 * command line (to prove a process is ours) and the parent link (to walk up to
 * the top of a companion's tree), and the per-PID variant made boot noticeably
 * slower for no benefit.
 */
function processTable(): Map<number, ProcInfo> {
  const table = new Map<number, ProcInfo>();
  try {
    // execFileSync, NOT execSync: the PowerShell one-liner contains `|`, which
    // cmd.exe would parse as a shell pipe before PowerShell ever saw it. That
    // silently produced an empty table, and an empty table makes every process
    // look "not ours" — so the reaper skipped the very orphans it exists to
    // kill. Passing argv directly bypasses the shell entirely.
    const out =
      process.platform === 'win32'
        ? execFileSync(
            'powershell',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)" }',
            ],
            { encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
          )
        : execFileSync('ps', ['-eo', 'pid=,ppid=,args='], {
            encoding: 'utf8',
            timeout: 10000,
            maxBuffer: 16 * 1024 * 1024,
          });

    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let pid: number, ppid: number, cmd: string;
      if (process.platform === 'win32') {
        const first = trimmed.indexOf('|');
        const second = trimmed.indexOf('|', first + 1);
        if (first === -1 || second === -1) continue;
        pid = Number(trimmed.slice(0, first));
        ppid = Number(trimmed.slice(first + 1, second));
        cmd = trimmed.slice(second + 1);
      } else {
        const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!m) continue;
        pid = Number(m[1]);
        ppid = Number(m[2]);
        cmd = m[3];
      }
      if (Number.isInteger(pid) && pid > 0) table.set(pid, { ppid, cmd: cmd ?? '' });
    }
  } catch {
    /* enumeration failed — callers degrade to ledger-only reaping */
  }
  return table;
}

/**
 * Does this process belong to THIS DMR-X checkout? Guards the port-based reap
 * so we never kill an unrelated program that happens to sit on one of our
 * ports — we only ever reap something demonstrably ours.
 */
function isOurCompanion(cmd: string | undefined): boolean {
  if (!cmd) return false; // unidentifiable — leave it alone
  const root = repoRootFromHere().toLowerCase();
  const lower = cmd.toLowerCase();
  // The packaged binary is installed OUTSIDE the checkout (~/.dmr-x/bin/dmrx.exe),
  // so the repo-root gate below can never match it. It is still unmistakably our
  // own gateway, and while a previous generation of it holds the port a
  // supervised boot cannot bind — which is precisely the restart loop this
  // reaper exists to break.
  if (lower.includes('.dmr-x\\bin\\dmrx') || lower.includes('.dmr-x/bin/dmrx')) return true;
  if (!lower.includes(root)) {
    // Tier 3: bare gateway entry match — last resort for zombies whose cmd line
    // is truncated or whose cwd differs. We require BOTH "gateway" and "main"
    // to avoid killing an unrelated bun process that happens to share a port.
    const isGatewayEntry =
      (lower.includes('gateway') && lower.includes('main.ts')) ||
      (lower.includes('gateway') && lower.includes('main.js')) ||
      lower.includes('apps/gateway') ||
      lower.includes('apps\\gateway');
    return isGatewayEntry;
  }
  return (
    lower.includes('mcp-server') ||
    lower.includes('g0dm0d3') ||
    lower.includes('api/server.ts') ||
    lower.includes('api\\server.ts') ||
    lower.includes('gateway/src/main.ts') ||
    lower.includes('gateway\\src\\main.ts')
  );
}

/**
 * Walk up from `pid` to the highest ancestor that is still one of ours.
 *
 * Killing only the PID found on a port is not enough. G0DM0D3's chain is
 * `bun x tsx` → `tsx/cli.mjs` → `node`, the port is held by the deepest one,
 * and EVERY process in that chain inherited the gateway's listening socket —
 * so leaving the middle of the chain alive keeps the gateway's port bound.
 */
function topmostOurAncestor(pid: number, table: Map<number, ProcInfo>): number {
  let current = pid;
  const seen = new Set<number>([pid]);
  for (;;) {
    const info = table.get(current);
    if (!info) return current;
    const parent = info.ppid;
    if (!parent || parent <= 0 || seen.has(parent)) return current;
    if (!isOurCompanion(table.get(parent)?.cmd)) return current;
    seen.add(parent);
    current = parent;
  }
}

/**
 * Kill companions left over from a previous gateway generation.
 *
 * MUST run before listen(): the whole point is to release the socket a stale
 * companion is still holding. Best-effort throughout — a PID that is gone,
 * recycled, or unkillable must never stop the gateway from booting.
 *
 * Two discovery paths, because neither alone is sufficient:
 *
 *  - The PID ledger catches companions whose recorded process is still alive.
 *  - Port ownership catches the case the ledger CANNOT: G0DM0D3 runs as
 *    `bun x tsx` → `tsx/cli.mjs` → `node`, and the recorded top-level wrapper
 *    dies together with the gateway. Its two descendants survive, get
 *    reparented, and keep both 47115 and the *inherited* gateway socket open —
 *    unreachable from the recorded PID, so a ledger-only reap left the gateway
 *    permanently unable to bind.
 */
export async function reapStaleCompanions(): Promise<void> {
  const candidates = new Set<number>();

  for (const pid of Object.values(readCompanionLedger())) {
    if (typeof pid === 'number' && pid > 0) candidates.add(pid);
  }

  const ports = [
    Number(process.env.PORT || 3000),
    Number(process.env.DMRX_MCP_PORT || 47114),
    47115, // G0DM0D3
  ].filter((p) => Number.isInteger(p) && p > 0);

  for (const pid of pidsListeningOn(ports)) candidates.add(pid);

  candidates.delete(process.pid);
  if (candidates.size === 0) return;

  const table = processTable();
  const targets = new Set<number>();

  for (const pid of candidates) {
    try {
      process.kill(pid, 0); // signal 0 probes liveness without touching it
    } catch {
      continue; // already gone — netstat still lists sockets of dead owners
    }
    if (!isOurCompanion(table.get(pid)?.cmd)) {
      logger.warn({ pid }, 'Process on a DMR-X port is not ours — leaving it alone');
      continue;
    }
    targets.add(topmostOurAncestor(pid, table));
  }

  for (const pid of targets) {
    try {
      killTree(pid);
      logger.info({ pid }, 'Reaped stale companion tree from a previous gateway run');
    } catch (err) {
      logger.warn({ err, pid }, 'Could not reap stale companion');
    }
  }

  // Wait for the OS to release the sockets we just killed. Without this,
  // reapStaleCompanions() returns immediately and the next listen() can still
  // hit EADDRINUSE because the kernel hasn't finished tearing down the socket.
  const reapDeadline = Date.now() + 8000;
  while (Date.now() < reapDeadline) {
    const stillHeld = pidsListeningOn(ports).filter((p) => p !== process.pid);
    if (stillHeld.length === 0) break;
    logger.info(
      { ports, stillHeld },
      'Waiting for OS to release DMR-X port(s) after reaping stale companions',
    );
    // 500 ms is short enough to not slow boots noticeably, long enough to let
    // the kernel reap the socket.
    try {
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      /* never */
    }
  }

  try {
    fs.rmSync(companionLedgerPath(), { force: true });
  } catch {
    /* ledger is advisory — a stale file is harmless */
  }
}

function resolveMcpEntry(root: string): string | null {
  // Built output is preferred, but Bun executes TypeScript directly, so an
  // unbuilt checkout must still be able to boot the sidecar. Without the
  // src/index.ts fallback a missing dist/ silently disabled MCP autostart.
  const candidates = [
    path.join(root, 'services/mcp-server/dist/index.js'),
    path.join(process.cwd(), 'services/mcp-server/dist/index.js'),
    path.join(process.cwd(), '../../services/mcp-server/dist/index.js'),
    path.join(root, 'services/mcp-server/src/index.ts'),
    path.join(process.cwd(), 'services/mcp-server/src/index.ts'),
    path.join(process.cwd(), '../../services/mcp-server/src/index.ts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function httpOk(url: string, timeoutMs = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Under PM2, companions must NOT inherit the gateway's stdio.
 *
 * PM2 treats end-of-stdio as part of "the process is gone". A companion that
 * inherited those pipes keeps them open after the gateway itself exits, so PM2
 * never sees the stream close: it reports the app as `waiting restart` with a
 * climbing restart counter while a perfectly healthy gateway is still serving
 * the port, and its bookkeeping never re-converges. Detaching the companion's
 * stdio is what lets PM2 reap the gateway cleanly.
 *
 * Outside PM2 (plain `bun run`, debugging) inheriting is genuinely useful —
 * the sidecar's startup banner and errors land in the same terminal — so the
 * behaviour is conditional rather than unconditionally dropped.
 */
function companionStdio(): 'inherit' | 'ignore' {
  return process.env.pm_id !== undefined ? 'ignore' : 'inherit';
}

function spawnMcpProcess(entry: string, env: NodeJS.ProcessEnv, cwd: string): ChildLike {
  const BunCtor = (globalThis as { Bun?: { spawn: (cmd: string[], opts: Record<string, unknown>) => ChildLike } }).Bun;
  if (BunCtor?.spawn) {
    return BunCtor.spawn([bunPath(), entry], {
      cwd,
      env,
      stdout: companionStdio(),
      stderr: companionStdio(),
    });
  }

  const cp: ChildProcess = spawn(bunPath(), [entry], {
    cwd,
    env,
    stdio: 'ignore',
    detached: false,
    // No shell. `bunPath()` is already a fully-resolved executable, and going
    // through cmd.exe put a shell between us and bun: `cp.kill()` then
    // terminated the shell while bun survived holding the inherited listening
    // socket — the orphan-that-wedges-the-port case this file exists to avoid.
    shell: false,
  });
  return {
    pid: cp.pid ?? null,
    kill: (s?: string) => {
      try {
        cp.kill((s as NodeJS.Signals) ?? 'SIGTERM');
      } catch {
        /* already gone */
      }
    },
    exited: new Promise((resolve) => {
      cp.on('exit', (code) => resolve(code ?? 1));
    }),
  };
}

function scheduleMcpRestart(entry: string, env: NodeJS.ProcessEnv, cwd: string): void {
  if (mcpStopping) return;
  if (mcpRestartTimer) clearTimeout(mcpRestartTimer);
  mcpRestartTimer = setTimeout(() => {
    mcpRestartTimer = null;
    if (mcpStopping) return;
    logger.warn('MCP sidecar exited — restarting in-loop');
    void launchMcp(entry, env, cwd);
  }, 3000);
  mcpRestartTimer.unref?.();
}

async function launchMcp(entry: string, env: NodeJS.ProcessEnv, cwd: string): Promise<void> {
  const child = spawnMcpProcess(entry, env, cwd);
  mcpChild = child;
  recordCompanionPid('mcp', child.pid);
  logger.info({ pid: child.pid, entry }, 'MCP sidecar spawned (A2A enabled)');
  if (child.exited) {
    void child.exited.then((code) => {
      if (mcpChild === child) mcpChild = null;
      logger.warn({ code }, 'MCP sidecar process exited');
      scheduleMcpRestart(entry, env, cwd);
    });
  }
}

/**
 * Start the MCP HTTP server with A2A if not already healthy.
 * Controlled by DMRX_MCP_AUTOSTART (default: true).
 */
export async function deferMcpBoot(): Promise<void> {
  if ((process.env.DMRX_MCP_AUTOSTART ?? 'true') === 'false') {
    logger.info('MCP autostart disabled (DMRX_MCP_AUTOSTART=false)');
    return;
  }

  const host = process.env.DMRX_MCP_HOST || '127.0.0.1';
  const port = process.env.DMRX_MCP_PORT || "47114";
  const healthUrl = `http://${host}:${port}/health`;

  if (await httpOk(healthUrl)) {
    logger.info({ healthUrl }, 'MCP already healthy — skipping sidecar spawn');
    return;
  }

  const root = repoRootFromHere();
  const entry = resolveMcpEntry(root);
  if (!entry) {
    logger.warn({ root }, 'MCP autostart skipped — services/mcp-server/dist/index.js not found (run bunx tsc -b in services/mcp-server)');
    return;
  }

  const gatewayUrl = resolveGatewayUrl();
  const agentKey =
    process.env.DMRX_MCP_AGENT_API_KEY ||
    process.env.DMRX_ADMIN_API_KEY ||
    'dmrx-local';
  const dataDir = process.env.DMRX_MCP_DATA_DIR || path.join(root, '.dmrx-data-mcp');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DMRX_MCP_TRANSPORT: 'http',
    DMRX_MCP_PORT: port,
    DMRX_MCP_HOST: host,
    DMRX_MCP_AGENT_API_KEY: agentKey,
    DMRX_A2A_ENABLED: process.env.DMRX_A2A_ENABLED ?? 'true',
    DMRX_A2A_AGENT_URL: process.env.DMRX_A2A_AGENT_URL || `http://${host}:${port}`,
    DMRX_A2A_DB_PATH: process.env.DMRX_A2A_DB_PATH || path.join(dataDir, 'a2a.db'),
    DMRX_GATEWAY_URL: gatewayUrl,
    DMRX_DATA_DIR: dataDir,
  };

  mcpStopping = false;
  await launchMcp(entry, env, root);

  // Best-effort wait so logs show ready/fail without blocking callers long.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await httpOk(healthUrl, 1500)) {
      logger.info({ healthUrl }, 'MCP sidecar healthy (A2A agent card available)');
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  logger.warn({ healthUrl }, 'MCP sidecar spawned but /health not ready within 20s');
}

/** Stop the gateway-managed MCP child (no-op if externally supervised). */
export function stopMcpSidecar(): void {
  mcpStopping = true;
  if (mcpRestartTimer) {
    clearTimeout(mcpRestartTimer);
    mcpRestartTimer = null;
  }
  if (!mcpChild) return;
  try {
    mcpChild.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  mcpChild = null;
}

/**
 * Deferred G0DM0D3 auto-boot (relay mode). Same logic previously inline in main.ts.
 * Controlled by DMRX_GODMODE_AUTOSTART (default: false — strictly opt-in; set
 * DMRX_GODMODE_AUTOSTART=true to enable). Auto-cloning and executing a
 * third-party GitHub repo must never happen by default, so the default is OFF.
 */
export async function deferGodmodeBoot(): Promise<void> {
  try {
    if ((process.env.DMRX_GODMODE_AUTOSTART ?? 'false') !== 'true') {
      logger.info('G0DM0D3 autostart disabled (set DMRX_GODMODE_AUTOSTART=true to opt in)');
      return;
    }
    logger.info('G0DM0D3 companion boot starting…');
    const { getGodmodeService, setGodmodeConfig } = await import('@dmr-x/godmode');
    // The godmode routes initialize the service from env config at registration
    // time WITHOUT checking reachability, so `isInitialized()` alone is not
    // proof the sidecar is actually up. Skip the spawn only when the proxy is
    // genuinely reachable — otherwise an initialized-but-dead service would
    // silently defeat autostart (the sidecar never gets spawned).
    if (getGodmodeService().isInitialized()) {
      const reachable = await getGodmodeService().healthCheck().catch(() => false);
      if (reachable) {
        logger.info('G0DM0D3 proxy already initialized and reachable — skipping');
        return;
      }
      logger.info('G0DM0D3 proxy initialized but unreachable — booting sidecar');
    }
    const { serverManager } = await import('@dmr-x/server-manager');
    const live = serverManager.getRunningInstance();
    const liveHealthy = live?.url
      ? await serverManager.healthCheck({ url: live.url, timeoutMs: 2500 }).catch(() => false)
      : false;
    if (liveHealthy) {
      logger.info({ url: live!.url }, 'G0DM0D3 already running and healthy — proxy ready');
      setGodmodeConfig({
        baseUrl: live!.url!,
        apiKey: live!.api_key ?? undefined,
        openrouterApiKey: '',
        llmBaseUrl: live!.llm_base_url ?? undefined,
        llmApiKey: live!.llm_api_key ?? undefined,
      });
      await getGodmodeService().initialize();
      return;
    }
    // Also accept a live process even if server_instances row is missing (fresh DB).
    if (await httpOk('http://127.0.0.1:47115/v1/health', 2000)) {
      const gatewayUrl = resolveGatewayUrl();
      setGodmodeConfig({
        baseUrl: 'http://localhost:47115',
        // Same adoption rule as godmode-guard restartGodmodeProxy: fall back to
        // the persisted row's key when no env key is set, so a gateway-managed
        // orphaned sidecar is still called authenticated (B-006 follow-up).
        apiKey: process.env.GODMODE_API_KEY || serverManager.getRunningInstance()?.api_key || undefined,
        openrouterApiKey: '',
        llmBaseUrl: `${gatewayUrl}/v1`,
        llmApiKey: process.env.DMRX_ADMIN_API_KEY || undefined,
      });
      await getGodmodeService().initialize();
      logger.info({ url: 'http://localhost:47115' }, 'G0DM0D3 already listening — proxy wired');
      return;
    }

    const gatewayUrl = resolveGatewayUrl();
    const started = await serverManager.start({
      openrouterApiKey: '',
      llmBaseUrl: `${gatewayUrl}/v1`,
    });
    setGodmodeConfig({
      baseUrl: started.url ?? 'http://localhost:47115',
      apiKey: started.api_key ?? undefined,
      openrouterApiKey: '',
      llmBaseUrl: started.llm_base_url ?? `${gatewayUrl}/v1`,
      llmApiKey: started.llm_api_key ?? undefined,
    });
    await getGodmodeService().initialize();
    recordCompanionPid('godmode', started.pid ?? serverManager.getRunningInstance()?.pid ?? null);
    logger.info({ url: started.url, relay: true }, 'Auto-booted G0DM0D3 proxy (relay mode → DMR-X vault)');
  } catch (bootErr) {
    logger.warn({ err: bootErr }, 'G0DM0D3 auto-boot failed; auto-free will fall back to a concrete model until /godmode/server/start');
  }
}

/**
 * Stop the gateway-managed G0DM0D3 child.
 *
 * The gateway shutdown path previously tore down only the MCP sidecar, so every
 * restart orphaned the G0DM0D3 process tree still holding port 47115. The next
 * boot then adopted that orphan (deferGodmodeBoot treats a healthy 47115 as
 * "already listening"), which hid the leak: one live server, but no supervisor
 * owned it any more. Best-effort — a failure here must never block shutdown.
 */
export async function stopGodmode(): Promise<void> {
  try {
    const { serverManager } = await import('@dmr-x/server-manager');
    await serverManager.stop();
  } catch (err) {
    logger.warn({ err }, 'G0DM0D3 stop failed (may already be gone)');
  }
}

/** Fire MCP + godmode boots in parallel after listen(). */
export function startCompanionServices(): void {
  void deferMcpBoot();
  void deferGodmodeBoot();
}
