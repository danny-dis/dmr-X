import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })) }));
import { spawnSync } from 'node:child_process';
import { applyGodmodePatches } from '../../services/server-manager/src/patch-godmode.js';
import { upstreamHeaders } from '../../patches/g0dm0d3/relay.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks(); });

describe('permanent godmode relay patches', () => {
  it('applies missing tool passthrough patches even when base relay patches already exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-patches-'));
    dirs.push(dir);
    for (const [file, text] of Object.entries({
      'api/middleware/rateLimit.ts': "GODMODE_RELAY === '1'",
      'api/routes/chat.ts': "from '../lib/relay'",
      'src/lib/openrouter.ts': 'function openrouterApiUrl',
      'api/routes/research.ts': "'/batch/*splat'",
    })) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); }
    applyGodmodePatches(dir);
    const patches = vi.mocked(spawnSync).mock.calls.map((call) => String(call[1]?.[2]));
    expect(patches.some((patch) => patch.endsWith('api_routes_chat_tools.ts.patch'))).toBe(true);
    expect(patches.some((patch) => patch.endsWith('src_lib_openrouter_tools.ts.patch'))).toBe(true);
  });

  it('sets the recursion guard and free-only policy on internal relay calls', () => {
    const saved = process.env.GODMODE_RELAY;
    process.env.GODMODE_RELAY = '1';
    try {
      const headers = upstreamHeaders();
      expect(headers['X-DMRX-Godmode-Proxy']).toBe('1');
      expect(headers['X-Cost-Filter']).toBe('free');
      expect(headers['X-Free-Tier-Strategy']).toBe('free_only');
    } finally { if (saved === undefined) delete process.env.GODMODE_RELAY; else process.env.GODMODE_RELAY = saved; }
  });

  it('applies the ULTRAPLINIAN/CONSORTIUM relay patches', () => {
    // These four were added after the race engine was found to hard-require an
    // OPENROUTER_API_KEY and to race OpenRouter slugs the DMR-X router cannot
    // resolve. A regression here means every relayed race silently 400s again.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-patches-race-'));
    dirs.push(dir);
    for (const [file, text] of Object.entries({
      'api/middleware/rateLimit.ts': "GODMODE_RELAY === '1'",
      'api/routes/chat.ts': "from '../lib/relay'",
      'src/lib/openrouter.ts': 'function openrouterApiUrl',
      'api/routes/research.ts': "'/batch/*splat'",
      // Race-engine targets, pre-patch (markers deliberately absent so the
      // patcher reaches `git apply` rather than short-circuiting on a marker).
      'api/lib/ultraplinian.ts': 'const PROVIDER_ENDPOINTS = {}',
      'api/routes/ultraplinian.ts': "import { Router } from 'express'",
      'api/lib/consortium.ts': 'export const ORCHESTRATOR_MODELS = []',
      'api/routes/consortium.ts': 'computeAutoTuneParams(a, b, c, d)',
    })) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); }
    applyGodmodePatches(dir);
    const patches = vi.mocked(spawnSync).mock.calls.map((call) => String(call[1]?.[2]));
    for (const expected of [
      'api_lib_ultraplinian.ts.patch',
      'api_routes_ultraplinian.ts.patch',
      'api_lib_consortium.ts.patch',
      'api_routes_consortium.ts.patch',
    ]) {
      expect(patches.some((patch) => patch.endsWith(expected)), `${expected} was not applied`).toBe(true);
    }
  });

  it('every registered patch file exists on disk', () => {
    // A marker rename or a forgotten `git diff > patch` leaves the patcher
    // referencing a missing file; `git apply` then fails silently at runtime
    // (logged as `failed`, not thrown), so catch it here instead.
    const patchesDir = path.resolve(__dirname, '..', '..', 'patches', 'g0dm0d3');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'services', 'server-manager', 'src', 'patch-godmode.ts'),
      'utf8',
    );
    const referenced = [...src.matchAll(/patchFile:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(fs.existsSync(path.join(patchesDir, file)), `${file} is missing`).toBe(true);
    }
  });
});
