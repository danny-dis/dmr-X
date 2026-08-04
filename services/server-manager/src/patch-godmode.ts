/**
 * Cross-platform patch applier for the vendored G0DM0D3 proxy.
 *
 * G0DM0D3 is spawned as DMR-X's internal relay (see `startNative` in
 * server-manager.service.ts): it forwards LLM calls to DMR-X itself via
 * `G0DM0D3_LLM_BASE_URL` instead of talking to OpenRouter directly. Upstream
 * G0DM0D3 doesn't know about that env var, so `patches/g0dm0d3/` carries the
 * edits that teach it relay mode (see `patches/g0dm0d3/README.md`).
 *
 * Previously those edits were applied by `scripts/dev/patch-g0dm0d3.sh`
 * (bash + perl), invoked ONLY from `scripts/dev/run-alwayson.sh`. That means
 * every other entry point — `bun run dev:gateway`, `bun run start`,
 * `run-alwayson.ps1`, or just double-clicking the binary on Windows — never
 * patched the clone, and godmode failed every relayed call with
 * `400 missing_api_key`. Worse, that bash script had drifted out of sync
 * with the current patch set (it edited `chat.ts` to reference an
 * undefined `relayMode` variable — a ReferenceError waiting to happen).
 *
 * This module is pure Node/TS (fs + `git apply`, no perl, no bash) and is
 * called directly from `ServerManagerService.install()`/`start()`, so it
 * runs on every platform and every entry point automatically, with no
 * separate script to remember to invoke.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '@dmr-x/utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * `patches/g0dm0d3/` lives at the repo root. This module lives at
 * `services/server-manager/src/`, three levels below — resolve relative to
 * *this file*, not `process.cwd()`, since callers boot the gateway from
 * different working directories (repo root via alwayson scripts, or
 * `apps/gateway` via `bun run dev:gateway`/`turbo`).
 */
function patchesDir(): string {
  return path.resolve(__dirname, '..', '..', '..', 'patches', 'g0dm0d3');
}

interface PatchStep {
  /** File the patch touches, relative to the G0DM0D3 checkout root. */
  target: string;
  /** Patch file, relative to patches/g0dm0d3/. */
  patchFile: string;
  /** Substring present in `target` iff the patch is already applied. */
  marker: string;
}

const RELAY_LIB_SRC = 'relay.ts';
const RELAY_LIB_DEST = path.join('api', 'lib', 'relay.ts');

const STEPS: PatchStep[] = [
  {
    target: path.join('api', 'middleware', 'rateLimit.ts'),
    patchFile: 'api_middleware_rateLimit.ts.patch',
    marker: "GODMODE_RELAY === '1'",
  },
  {
    target: path.join('api', 'routes', 'chat.ts'),
    patchFile: 'api_routes_chat.ts.patch',
    marker: "from '../lib/relay'",
  },
  {
    target: path.join('src', 'lib', 'openrouter.ts'),
    patchFile: 'src_lib_openrouter.ts.patch',
    marker: 'function openrouterApiUrl',
  },
  {
    // Independent of relay mode: on the pinned commit, this route registers
    // with a bare `*` wildcard, which path-to-regexp v6+ (Express 5.2.1,
    // pinned in G0DM0D3's own package.json) rejects at import time — the
    // whole server process crashes before it can bind to a port. Not a
    // DMR-X-specific bug, but it blocks godmode entirely, so it's patched
    // here alongside the relay changes rather than filed upstream and
    // waited on.
    target: path.join('api', 'routes', 'research.ts'),
    patchFile: 'api_routes_research.ts.patch',
    marker: "'/batch/*splat'",
  },
];

export interface GodmodePatchResult {
  applied: string[];
  skipped: string[];
  failed: string[];
}

/**
 * Idempotently apply the DMR-X relay patches to a G0DM0D3 checkout at
 * `installDir`. Safe to call on every gateway boot / server start — a no-op
 * once the patches (and relay.ts) are already present, verified by marker
 * string rather than by trusting `git apply`'s exit code alone (a re-applied
 * patch and an already-patched file both look like "failure" to `git apply`,
 * so the marker is the ground truth).
 */
export function applyGodmodePatches(installDir: string): GodmodePatchResult {
  const result: GodmodePatchResult = { applied: [], skipped: [], failed: [] };

  if (!fs.existsSync(installDir)) {
    logger.warn({ installDir }, '[godmode-patch] install dir does not exist — skipping');
    return result;
  }

  const pDir = patchesDir();
  if (!fs.existsSync(pDir)) {
    logger.warn({ pDir }, '[godmode-patch] patches directory not found — skipping');
    return result;
  }

  // 1. relay.ts — a whole new file, so there is nothing for `git apply` to
  // diff against. Copy it into place whenever content differs (covers both
  // "missing" and "stale from an older patch set").
  try {
    const relaySrc = path.join(pDir, RELAY_LIB_SRC);
    const relayDest = path.join(installDir, RELAY_LIB_DEST);
    const srcContent = fs.readFileSync(relaySrc, 'utf8');
    const destContent = fs.existsSync(relayDest) ? fs.readFileSync(relayDest, 'utf8') : null;
    if (destContent !== srcContent) {
      fs.mkdirSync(path.dirname(relayDest), { recursive: true });
      fs.writeFileSync(relayDest, srcContent, 'utf8');
      result.applied.push(RELAY_LIB_DEST);
    } else {
      result.skipped.push(RELAY_LIB_DEST);
    }
  } catch (err) {
    logger.error({ err }, '[godmode-patch] failed to install relay.ts');
    result.failed.push(RELAY_LIB_DEST);
  }

  // 2. git apply each .patch, first checking the marker so re-runs are cheap
  // and safe even though `git apply` itself is not re-run-safe.
  for (const step of STEPS) {
    const targetPath = path.join(installDir, step.target);
    try {
      if (!fs.existsSync(targetPath)) {
        logger.warn({ targetPath }, '[godmode-patch] patch target missing — skipping');
        result.failed.push(step.target);
        continue;
      }
      const before = fs.readFileSync(targetPath, 'utf8');
      if (before.includes(step.marker)) {
        result.skipped.push(step.target);
        continue;
      }
      const patchPath = path.join(pDir, step.patchFile);
      const res = spawnSync('git', ['apply', '--whitespace=nowarn', patchPath], {
        cwd: installDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      if (res.status === 0) {
        result.applied.push(step.target);
        continue;
      }
      // `git apply` failed — re-check the marker in case the file already
      // matched the patched shape closely enough to be a real no-op rather
      // than a genuine conflict (e.g. re-run after a partial prior apply).
      const after = fs.readFileSync(targetPath, 'utf8');
      if (after.includes(step.marker)) {
        result.skipped.push(step.target);
      } else {
        logger.error(
          { target: step.target, stderr: res.stderr, stdout: res.stdout },
          '[godmode-patch] git apply failed',
        );
        result.failed.push(step.target);
      }
    } catch (err) {
      logger.error({ err, target: step.target }, '[godmode-patch] unexpected error applying patch');
      result.failed.push(step.target);
    }
  }

  if (result.applied.length > 0 || result.failed.length > 0) {
    logger.info(
      { applied: result.applied, skipped: result.skipped.length, failed: result.failed },
      '[godmode-patch] applyGodmodePatches done',
    );
  }
  return result;
}
