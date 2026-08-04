#!/usr/bin/env bun
/**
 * Manual re-apply of the DMR-X G0DM0D3 relay patches.
 *
 * The gateway already does this automatically on every install()/start()
 * (see services/server-manager/src/server-manager.service.ts, which calls
 * applyGodmodePatches() from patch-godmode.ts) — this CLI exists only for
 * ad-hoc re-application without going through the HTTP API, e.g. after
 * manually editing patches/g0dm0d3/ or poking at a checkout by hand.
 *
 * Usage:
 *   bun scripts/dev/patch-godmode-cli.ts [installDir]
 *
 * Defaults to <repoRoot>/.dmrx-data/servers/g0dm0d3 (matching where
 * server-manager clones it when the gateway is started from the repo root).
 */
import path from 'node:path';

import { applyGodmodePatches } from '../../services/server-manager/src/patch-godmode.js';

const installDir =
  process.argv[2] || path.join(process.cwd(), '.dmrx-data', 'servers', 'g0dm0d3');

const result = applyGodmodePatches(installDir);

console.log(`[patch-godmode] install dir: ${installDir}`);
console.log(`[patch-godmode] applied: ${result.applied.join(', ') || '(none)'}`);
console.log(`[patch-godmode] skipped (already applied): ${result.skipped.join(', ') || '(none)'}`);
if (result.failed.length > 0) {
  console.error(`[patch-godmode] FAILED: ${result.failed.join(', ')}`);
  process.exit(1);
}
