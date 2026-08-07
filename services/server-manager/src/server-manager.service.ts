/**
 * Server Manager — installs & supervises locally-managed G0DM0D3 servers.
 *
 * Responsibilities:
 *  - cloneIfNeeded(): git clone (pinned repo) of G0DM0D3 into .dmrx-data/servers/g0dm0d3
 *  - installDeps(): `bun install` in the cloned dir
 *  - detectRuntime(): 'docker' when inside a container, else 'bun-native'
 *  - start()/stop(): launch & tear down the managed server (container or child proc)
 *  - healthCheck(): poll GET {url}/v1/health
 *  - persist instance state in server_instances (via @dmr-x/db)
 */

import { spawn, spawnSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

import { applyGodmodePatches } from './patch-godmode.js';

/**
 * Resolve bun executable path. On Windows, uv_spawn can't find executables
 * via PATH when launched from a compiled Bun binary, so we resolve the full
 * path eagerly and cache it.
 */
let _bunPath: string | null = null;
function bunPath(): string {
  if (_bunPath) return _bunPath;
  const bunExe = process.execPath;
  if (bunExe && bunExe.toLowerCase().includes('bun') && fs.existsSync(bunExe)) {
    _bunPath = bunExe;
    return _bunPath;
  }
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
  _bunPath = 'bun';
  return _bunPath;
}

/**
 * Repo + pinned ref for the runtime clone.
 *
 * Defaults to DMR-X's own fork (`danny-dis/G0DM0D3`), not upstream
 * `elder-plinius/G0DM0D3` — the fork is where `scripts/dev/sync-godmode-fork.*`
 * pulls upstream changes into on a schedule we control, so a `git fetch` here
 * never lands code DMR-X hasn't had a chance to review.
 *
 * `DMRX_GODMODE_REF` pins to a specific commit SHA (not a moving branch tip)
 * by default, so every fresh install gets byte-identical G0DM0D3 source
 * regardless of when it runs — `--depth 1` of a bare branch name previously
 * meant "whatever the fork's HEAD happens to be right now," which could
 * silently pick up an unreviewed upstream change on the next re-clone.
 * `cloneIfNeeded()` fetches this ref directly (works for a branch, tag, or
 * commit SHA — not just `clone --branch`, which only accepts branch/tag
 * names), so overriding it to a branch name for local development still
 * works.
 */
const G0DM0D3_REPO = process.env.DMRX_GODMODE_REPO || 'https://github.com/danny-dis/G0DM0D3.git';
const G0DM0D3_REF = process.env.DMRX_GODMODE_REF || 'f6301765fb90eb7b336bdf365319cd2fe44b1187';
/**
 * The project `G0DM0D3_REPO` is a fork of. `danny-dis/G0DM0D3` is a true
 * GitHub fork (its `parent` is set), which is what lets
 * `.github/workflows/godmode-fork-sync.yml` fast-forward it with the
 * `merge-upstream` API instead of maintaining a manual mirror.
 *
 * Kept as a constant rather than resolved from the GitHub API at runtime so
 * an offline gateway can still tell the user what it is tracking.
 */
const G0DM0D3_UPSTREAM =
  process.env.DMRX_GODMODE_UPSTREAM || 'https://github.com/elder-plinius/G0DM0D3';
const SERVER_TYPE = 'g0dm0d3';
const DEFAULT_PORT = 7860;
const CONTAINER_NAME = 'dmrx-g0dm0d3';
const IMAGE_TAG = 'dmrx-g0dm0d3';

export type ServerStatus = 'stopped' | 'installing' | 'running' | 'error';
export type ServerRuntime = 'docker' | 'bun-native';

export interface ServerInstance {
  id: string;
  type: string;
  url: string | null;
  api_key: string | null;
  openrouter_key_ref: string | null;
  /** OpenAI-compatible relay gateway URL (no OpenRouter key needed). */
  llm_base_url?: string | null;
  /** API key for the relay gateway (optional). */
  llm_api_key?: string | null;
  runtime: string | null;
  status: ServerStatus;
  pid: number | null;
  container_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StartOptions {
  /** OpenRouter key to pass through to the managed server. */
  openrouterApiKey?: string;
  /**
   * OpenAI-compatible relay base URL. When set (and no OpenRouter key is
   * available), the managed G0DM0D3 server routes LLM calls through this
   * gateway instead of openrouter.ai — reusing the host's provider vault.
   */
  llmBaseUrl?: string;
  /** API key for the relay gateway (optional; DMR-X LOCAL MODE needs none). */
  llmApiKey?: string;
  /** Local port to bind (host + container). */
  port?: number;
  id?: string;
}

/** Process handle — Bun.spawn returns a Subprocess, Node spawn a ChildProcess. */
type ChildLike = {
  pid: number | null;
  kill: (signal?: string) => void;
} | null;

function nowIso(): string {
  return new Date().toISOString();
}

/** Resolve the CWD / repo root that .dmrx-data lives under. */
function repoRoot(): string {
  // Prefer DMRX repo root if hinted, else process.cwd().
  return process.cwd();
}

function dataDir(): string {
  return path.join(repoRoot(), '.dmrx-data');
}

function serversDir(): string {
  return path.join(dataDir(), 'servers');
}

function g0dm0d3Dir(): string {
  return path.join(serversDir(), SERVER_TYPE);
}

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

/**
 * Kill a process AND its descendants.
 *
 * G0DM0D3 runs three processes deep (`bun x tsx` → `tsx/cli.mjs` → `node`), so
 * killing only the direct child orphans the two that actually hold port 7860.
 * On Windows there are no process groups, and `process.kill(-pid)` throws
 * outright — `taskkill /T` is the only way to reach the whole tree.
 */
export function killTree(pid: number | null | undefined): void {
  if (!pid || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM'); // negative pid = process group
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/** Repo + pinned ref the runtime clone uses — surfaced to the UI so the
 *  install warning reflects reality instead of a hardcoded stale string.
 *
 *  `upstream` is the project the fork tracks. It is reported separately
 *  rather than derived from `repo` because the two only coincide by
 *  convention: pointing `DMRX_GODMODE_REPO` at a personal fork must not make
 *  the UI claim that fork *is* upstream. */
export function getGodmodeRepoInfo(): { repo: string; ref: string; upstream: string } {
  return { repo: G0DM0D3_REPO, ref: G0DM0D3_REF, upstream: G0DM0D3_UPSTREAM };
}

/**
 * The commit actually checked out on disk, or null when nothing is installed.
 *
 * This can legitimately differ from the pinned `G0DM0D3_REF`: `cloneIfNeeded()`
 * is a no-op when the directory already exists, so an install created before a
 * `DMRX_GODMODE_REF` bump keeps running the older commit until it is deleted
 * and re-cloned. Surfacing the real HEAD is the only way the UI can tell the
 * user that "pinned" and "running" have drifted apart.
 */
export function getInstalledGodmodeRef(): string | null {
  const dir = g0dm0d3Dir();
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const res = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 5000,
  });
  if (res.status !== 0) return null;
  const sha = (res.stdout ?? '').trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

/** Returns true when running inside a Docker/containerd container. */
export function detectRuntime(): ServerRuntime {
  if (fs.existsSync('/.dockerenv')) return 'docker';
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd/.test(cgroup)) return 'docker';
  } catch {
    /* not Linux / no cgroup — fall through */
  }
  return 'bun-native';
}

class ServerManagerService {
  /** In-memory handle to the native child process (Bun.spawn). */
  private child: ChildLike = null;

  /** Absolute path of the cloned G0DM0D3 source. */
  get installPath(): string {
    return g0dm0d3Dir();
  }

  /** True once the G0DM0D3 source has been cloned (independent of running state). */
  isInstalled(): boolean {
    const dir = g0dm0d3Dir();
    return fs.existsSync(dir) && fs.existsSync(path.join(dir, 'package.json'));
  }

  async cloneIfNeeded(): Promise<{ cloned: boolean; path: string }> {
    const dir = g0dm0d3Dir();
    if (fs.existsSync(dir)) {
      logger.info({ dir }, 'G0DM0D3 already cloned — skipping');
      return { cloned: false, path: dir };
    }
    fs.mkdirSync(serversDir(), { recursive: true });
    logger.info({ dir, repo: G0DM0D3_REPO, ref: G0DM0D3_REF }, 'Cloning G0DM0D3 (pinned ref)');
    try {
      // `git clone --branch <ref> --depth 1` only accepts branch/tag names.
      // init + remote + `fetch --depth 1 origin <ref>` + checkout FETCH_HEAD
      // works for a branch, tag, OR a commit SHA (GitHub allows shallow
      // fetch of any reachable SHA on a public repo), which is what lets
      // DMRX_GODMODE_REF default to a pinned commit instead of a moving
      // branch tip.
      const steps: Array<{ args: string[]; cwd?: string }> = [
        { args: ['init', dir] },
        { args: ['remote', 'add', 'origin', G0DM0D3_REPO], cwd: dir },
        { args: ['fetch', '--depth', '1', 'origin', G0DM0D3_REF], cwd: dir },
        { args: ['checkout', 'FETCH_HEAD'], cwd: dir },
      ];
      for (const step of steps) {
        const res = spawnSync('git', step.args, { cwd: step.cwd, stdio: 'inherit' });
        if (res.status !== 0) {
          throw new Error(`git ${step.args[0]} failed (exit ${res.status})`);
        }
      }
    } catch (err) {
      // Don't leave a half-initialized dir behind — it would be mistaken
      // for a completed clone on the next cloneIfNeeded() call.
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
    return { cloned: true, path: dir };
  }

  async installDeps(): Promise<void> {
    const dir = g0dm0d3Dir();
    logger.info({ dir }, 'Running bun install for G0DM0D3');
    const res = spawnSync(bunPath(), ['install'], { cwd: dir, stdio: 'inherit' });
    if (res.status !== 0) {
      throw new Error(`bun install failed (exit ${res.status})`);
    }
  }

  /**
   * Re-apply the DMR-X relay patches (see patch-godmode.ts). Called after
   * every clone/install AND on every start() — not just when a fresh clone
   * just happened — so an existing checkout that predates a patch-set change
   * gets caught up too, on every platform and every entry point (no bash
   * dependency, unlike the old scripts/dev/patch-g0dm0d3.sh).
   */
  applyPatches(): ReturnType<typeof applyGodmodePatches> {
    return applyGodmodePatches(g0dm0d3Dir());
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private db() {
    return getDb();
  }

  /**
   * sql.js reads are synchronous under the hood — this does the real work for
   * both getOrCreateRow() (kept async for its existing callers) and
   * upsertRow() (which must stay synchronous: it's called fire-and-forget
   * throughout this file, never awaited).
   */
  private getRowSync(id: string): ServerInstance | null {
    const row = this.db()
      .prepare('SELECT * FROM server_instances WHERE id = ?')
      .get(id) as ServerInstance | undefined;
    return row ?? null;
  }

  async getOrCreateRow(id: string, type = SERVER_TYPE): Promise<ServerInstance | null> {
    return this.getRowSync(id);
  }

  upsertRow(row: Partial<ServerInstance> & { id: string }): void {
    // BUG FIXED: this used to call the *async* getOrCreateRow() without
    // awaiting it, then force-cast the resulting Promise to ServerInstance
    // via `as unknown as`. A Promise object is always truthy, so `existing`
    // was always non-null — every upsert took the UPDATE branch, and since
    // no row had ever been INSERTed, every UPDATE silently affected zero
    // rows. server_instances never persisted a single row through this path:
    // status/start/stop looked like they worked (the HTTP handlers return a
    // constructed object, not a DB read-back) but /server/status always
    // reported "stopped" because getRunningInstance() found nothing, no
    // matter how long the managed G0DM0D3 process had actually been running.
    const existing = this.getRowSync(row.id);
    const ts = nowIso();
    if (!existing) {
      this.db()
        .prepare(
          `INSERT INTO server_instances
             (id, type, url, api_key, openrouter_key_ref, llm_base_url, llm_api_key, runtime, status, pid, container_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.type ?? SERVER_TYPE,
          row.url ?? null,
          row.api_key ?? null,
          row.openrouter_key_ref ?? null,
          row.llm_base_url ?? null,
          row.llm_api_key ?? null,
          row.runtime ?? null,
          row.status ?? 'stopped',
          row.pid ?? null,
          row.container_id ?? null,
          ts,
          ts,
        );
    } else {
      this.db()
        .prepare(
          `UPDATE server_instances SET
             url = ?, api_key = ?, openrouter_key_ref = ?, llm_base_url = ?, llm_api_key = ?, runtime = ?,
             status = ?, pid = ?, container_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          row.url ?? existing.url ?? null,
          row.api_key ?? existing.api_key ?? null,
          row.openrouter_key_ref ?? existing.openrouter_key_ref ?? null,
          row.llm_base_url ?? existing.llm_base_url ?? null,
          row.llm_api_key ?? existing.llm_api_key ?? null,
          row.runtime ?? existing.runtime ?? null,
          row.status ?? existing.status ?? null,
          row.pid ?? existing.pid ?? null,
          row.container_id ?? existing.container_id ?? null,
          ts,
          row.id,
        );
    }
  }

  /** Return the first running instance row, if any. */
  getRunningInstance(): ServerInstance | null {
    const row = this.db()
      .prepare("SELECT * FROM server_instances WHERE status = 'running' ORDER BY updated_at DESC LIMIT 1")
      .get() as ServerInstance | undefined;
    return row ?? null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * install(): clone (pinned repo) + install deps only. Does NOT launch.
   * Runs the (potentially long) git clone + bun install in the background so
   * the HTTP request returns immediately; the UI polls /status to follow
   * progress. DB flips to 'stopped' on success, 'error' on failure.
   */
  async install(opts: StartOptions = {}): Promise<ServerInstance> {
    const id = opts.id ?? SERVER_TYPE;
    const port = opts.port ?? DEFAULT_PORT;
    const runtime = detectRuntime();
    const openrouterKey =
      opts.openrouterApiKey ?? process.env.OPENROUTER_API_KEY ?? '';
    const godmodeKey = crypto.randomBytes(24).toString('hex');
    const url = `http://localhost:${port}`;

    // Persist an 'installing' row immediately so the UI shows progress.
    this.upsertRow({
      id,
      type: SERVER_TYPE,
      url,
      api_key: godmodeKey,
      openrouter_key_ref: openrouterKey ? 'env:OPENROUTER_API_KEY' : null,
      runtime,
      status: 'installing',
    });

    // Fire-and-forget the slow clone + install (do NOT await in the request).
    void this.runInstall(id, url, runtime, openrouterKey).catch((err) => {
      logger.error({ err }, 'G0DM0D3 install failed');
      this.upsertRow({ id, status: 'error' });
    });

    return (await this.getOrCreateRow(id))!;
  }

  /** Background clone + dep install; resolves when the clone is ready. */
  private async runInstall(
    id: string,
    url: string,
    runtime: ServerRuntime,
    openrouterKey: string,
  ): Promise<void> {
    await this.cloneIfNeeded();
    await this.installDeps();
    this.applyPatches();
    // Ready to launch; mark stopped (not running — user must press Start).
    this.upsertRow({ id, url, runtime, status: 'stopped' });
  }

  /**
   * Resolve the LLM credentials/env for the managed G0DM0D3 server using a
   * 3-tier fallback so an OpenRouter key is NOT required:
   *   1. explicit opts.openrouterApiKey / process.env.OPENROUTER_API_KEY
   *   2. a key resolved from the host's provider vault (opts.llmApiKey)
   *   3. otherwise relay mode: point G0DM0D3 at opts.llmBaseUrl (an
   *      OpenAI-compatible gateway) — usually DMR-X itself.
   * Returns the env map to merge into the child process.
   */
  private resolveGodmodeEnv(opts: StartOptions): {
    openrouterKey: string;
    llmBaseUrl: string;
    llmApiKey: string;
  } {
    const openrouterKey = opts.openrouterApiKey ?? process.env.OPENROUTER_API_KEY ?? '';
    const llmBaseUrl = opts.llmBaseUrl ?? '';
    const llmApiKey = opts.llmApiKey ?? '';
    return { openrouterKey, llmBaseUrl, llmApiKey };
  }

  /**
   * start(): launch the (already-installed) server. Clones + installs deps
   * first if missing. OpenRouter key is reused from the gateway's environment,
   * otherwise G0DM0D3 relays through an OpenAI-compatible gateway.
   */
  async start(opts: StartOptions = {}): Promise<ServerInstance> {
    const id = opts.id ?? SERVER_TYPE;
    const port = opts.port ?? DEFAULT_PORT;
    const runtime = detectRuntime();

    const { openrouterKey, llmBaseUrl, llmApiKey } = this.resolveGodmodeEnv(opts);
    const godmodeKey = crypto.randomBytes(24).toString('hex');
    const url = `http://localhost:${port}`;

    await this.cloneIfNeeded();
    await this.installDeps();
    this.applyPatches();

    this.upsertRow({
      id,
      type: SERVER_TYPE,
      url,
      api_key: godmodeKey,
      openrouter_key_ref: openrouterKey
        ? 'env:OPENROUTER_API_KEY'
        : llmBaseUrl
          ? `relay:${llmBaseUrl}`
          : null,
      llm_base_url: llmBaseUrl || null,
      llm_api_key: llmApiKey || null,
      runtime,
      status: 'installing',
    });

    try {
      if (runtime === 'docker') {
        await this.startDocker(port, openrouterKey, godmodeKey, llmBaseUrl, llmApiKey);
        this.upsertRow({ id, status: 'running', url, runtime, container_id: CONTAINER_NAME });
      } else {
        await this.startNative(port, openrouterKey, godmodeKey, llmBaseUrl, llmApiKey);
        this.upsertRow({ id, status: 'running', url, runtime, pid: this.child?.pid ?? null });
      }
    } catch (err) {
      this.upsertRow({ id, status: 'error' });
      throw err;
    }

    await this.healthCheck({ url });

    // Return the instance we just wrote. We construct it directly rather than
    // re-reading via getOrCreateRow, because under sql.js the read-back can be
    // inconsistent with the just-performed write in the same tick.
    const finalPid = runtime === 'docker' ? null : this.child?.pid ?? null;
    const finalContainerId = runtime === 'docker' ? CONTAINER_NAME : null;
    return {
      id,
      type: SERVER_TYPE,
      url,
      api_key: godmodeKey,
      openrouter_key_ref: openrouterKey
        ? 'env:OPENROUTER_API_KEY'
        : llmBaseUrl
          ? `relay:${llmBaseUrl}`
          : null,
      llm_base_url: llmBaseUrl || null,
      llm_api_key: llmApiKey || null,
      runtime,
      status: 'running',
      pid: finalPid,
      container_id: finalContainerId,
      created_at: '',
      updated_at: '',
    } as ServerInstance;
  }

  private startDocker(
    port: number,
    openrouterKey: string,
    godmodeKey: string,
    llmBaseUrl: string,
    llmApiKey: string,
  ): void {
    const dir = g0dm0d3Dir();
    // Build (idempotent) then run detached.
    const build = spawnSync('docker', ['build', '-t', IMAGE_TAG, dir], { stdio: 'inherit' });
    if (build.status !== 0) {
      throw new Error(`docker build failed (exit ${build.status})`);
    }
    // Remove any stale container first.
    spawnSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
    const runEnv = [
      '-e', `OPENROUTER_API_KEY=${openrouterKey}`,
      '-e', `GODMODE_API_KEY=${godmodeKey}`,
      '-e', `PORT=${DEFAULT_PORT}`,
    ];
    if (llmBaseUrl) {
      runEnv.push('-e', `G0DM0D3_LLM_BASE_URL=${llmBaseUrl}`);
      runEnv.push('-e', `G0DM0D3_LLM_API_KEY=${llmApiKey}`);
    }
    const run = spawnSync(
      'docker',
      [
        'run',
        '-d',
        '--name', CONTAINER_NAME,
        // Bind to loopback only: the companion must never be reachable off-host.
        '-p', `127.0.0.1:${port}:${DEFAULT_PORT}`,
        ...runEnv,
        IMAGE_TAG,
      ],
      { stdio: 'inherit' },
    );
    if (run.status !== 0) {
      throw new Error(`docker run failed (exit ${run.status})`);
    }
  }

  private startNative(
    port: number,
    openrouterKey: string,
    godmodeKey: string,
    llmBaseUrl: string,
    llmApiKey: string,
  ): Promise<void> {
    const dir = g0dm0d3Dir();
    // The child ALWAYS receives the generated GODMODE_API_KEY, relay mode
    // included. Relaying into the DMR-X provider vault without requiring a key
    // would leave the companion's HTTP endpoint open to anyone who can reach
    // the host (C3) — auth is never disabled.
    const env = buildGodmodeNativeEnv({ port, openrouterKey, godmodeKey, llmBaseUrl, llmApiKey });

    if (isBun()) {
      // Use Bun.spawn for a managed, killable child.
      const BunCtor = (globalThis as { Bun?: { spawn: (cmd: unknown[], opts: Record<string, unknown>) => ChildLike } }).Bun;
      if (BunCtor && BunCtor.spawn) {
        this.child = BunCtor.spawn([bunPath(), 'x', 'tsx', 'api/server.ts'], {
          cwd: dir,
          env,
          stdout: 'inherit',
          stderr: 'inherit',
        });
        return Promise.resolve();
      }
    }

    // Node fallback. Detach + unref so the managed server survives a gateway
    // restart (otherwise it is reaped when the gateway process exits).
    const cp = spawn(bunPath(), ['x', 'tsx', 'api/server.ts'], {
      cwd: dir,
      env,
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    });
    cp.unref();
    this.child = { pid: cp.pid ?? null, kill: () => killTree(cp.pid) } as ChildLike;
    return Promise.resolve();
  }

  async stop(id = SERVER_TYPE): Promise<void> {
    const runtime = detectRuntime();
    if (runtime === 'docker') {
      spawnSync('docker', ['stop', CONTAINER_NAME], { stdio: 'ignore' });
      spawnSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
    } else {
      // Kill by recorded PID, not just the in-memory handle. After a gateway
      // restart the previous G0DM0D3 is adopted (deferGodmodeBoot sees port
      // 7860 already healthy and wires the proxy to it) without repopulating
      // `this.child` — so a handle-only stop left the process running forever
      // while marking the row 'stopped'. That is how ghosts accumulated.
      const known = this.getRunningInstance();
      for (const pid of new Set([this.child?.pid, known?.pid].filter(Boolean) as number[])) {
        killTree(pid);
      }
      this.child = null;
    }
    this.upsertRow({ id, status: 'stopped', pid: null, container_id: null });
  }

  async healthCheck(opts: { url: string; timeoutMs?: number } = { url: '' }): Promise<boolean> {
    const url = opts.url;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;
    const fetchImpl = (globalThis as { fetch: typeof fetch }).fetch;
    while (Date.now() < deadline) {
      try {
        const res = await fetchImpl(`${url}/v1/health`, { method: 'GET' });
        if (res.ok) return true;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }
}

export const serverManager = new ServerManagerService();
export function createServerManager(): ServerManagerService {
  return new ServerManagerService();
}
export { ServerManagerService };

/**
 * Build the environment for a natively-spawned G0DM0D3 child process.
 *
 * The generated `GODMODE_API_KEY` is ALWAYS set — the child must require auth
 * even in relay mode, where it forwards into the DMR-X gateway's provider
 * vault (C3: it used to be omitted when relaying, leaving the child's HTTP
 * endpoint unauthenticated). Kept as a pure, exported function so the env
 * contract is unit-testable without spawning a process.
 */
export interface BuildGodmodeNativeEnvOptions {
  /** Parent env to inherit (defaults to process.env). */
  baseEnv?: NodeJS.ProcessEnv;
  port: number;
  openrouterKey: string;
  godmodeKey: string;
  llmBaseUrl: string;
  llmApiKey: string;
}

export function buildGodmodeNativeEnv(opts: BuildGodmodeNativeEnvOptions): Record<string, string> {
  const env: Record<string, string> = {
    ...(opts.baseEnv ?? process.env),
    OPENROUTER_API_KEY: opts.openrouterKey,
    PORT: String(opts.port),
  };
  if (opts.godmodeKey) env.GODMODE_API_KEY = opts.godmodeKey;
  if (opts.llmBaseUrl) {
    env.G0DM0D3_LLM_BASE_URL = opts.llmBaseUrl;
    env.G0DM0D3_LLM_API_KEY = opts.llmApiKey;
    // Signals the child it's running as DMR-X's internal relay proxy.
    // The rate-limit middleware skips limiting in this mode (single-tenant,
    // no external API key to protect).
    env.GODMODE_RELAY = '1';
  }
  return env;
}
