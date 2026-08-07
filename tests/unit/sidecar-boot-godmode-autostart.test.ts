import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  resolveGatewayUrl: vi.fn(),
  killTree: vi.fn(),
  getRunningInstance: vi.fn(),
  healthCheck: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  isInitialized: vi.fn(),
  setGodmodeConfig: vi.fn(),
  initialize: vi.fn(),
}));

// @dmr-x/utils is aliased in vitest.config.ts, so the bare id resolves to the
// same canonical file sidecar-boot.ts sees. @dmr-x/server-manager and
// @dmr-x/godmode resolve (via apps/gateway/node_modules junctions) to their
// real package sources, so the mocks must be keyed by those file paths or the
// dynamic imports inside deferGodmodeBoot bypass them.
vi.mock('@dmr-x/utils', () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error },
  resolveGatewayUrl: mocks.resolveGatewayUrl,
}));
vi.mock('../../services/server-manager/src/index.ts', () => ({
  killTree: mocks.killTree,
  serverManager: {
    getRunningInstance: mocks.getRunningInstance,
    healthCheck: mocks.healthCheck,
    start: mocks.start,
    stop: mocks.stop,
  },
}));
vi.mock('../../services/godmode/src/index.ts', () => ({
  getGodmodeService: () => ({ isInitialized: mocks.isInitialized, initialize: mocks.initialize }),
  setGodmodeConfig: mocks.setGodmodeConfig,
}));

import { deferGodmodeBoot } from '../../apps/gateway/src/lib/sidecar-boot.js';

const LEDGER = '.dmrx-data/companions.json';
function restoreLedger(): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) as Record<string, unknown>;
    delete parsed.godmode;
    if (Object.keys(parsed).length === 0) fs.rmSync(LEDGER, { force: true });
    else fs.writeFileSync(LEDGER, JSON.stringify(parsed, null, 2));
  } catch {
    /* no ledger file — nothing to restore */
  }
}

describe('deferGodmodeBoot autostart gating (C2)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.DMRX_GODMODE_AUTOSTART;
    mocks.resolveGatewayUrl.mockReturnValue('http://localhost:47113');
    mocks.isInitialized.mockReturnValue(false);
    mocks.getRunningInstance.mockReturnValue(null);
    mocks.start.mockResolvedValue({
      url: 'http://localhost:7860',
      pid: 4242,
      llm_base_url: 'http://localhost:47113/v1',
      llm_api_key: undefined,
    });
    // Deterministic "nothing listening on 7860" — the in-boot probe must fail
    // so the boot proceeds to serverManager.start().
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
  });

  afterEach(() => {
    delete process.env.DMRX_GODMODE_AUTOSTART;
    vi.unstubAllGlobals();
    restoreLedger();
  });

  it('skips launch when DMRX_GODMODE_AUTOSTART is unset', async () => {
    delete process.env.DMRX_GODMODE_AUTOSTART;
    await expect(deferGodmodeBoot()).resolves.toBeUndefined();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('skips launch when DMRX_GODMODE_AUTOSTART=false', async () => {
    process.env.DMRX_GODMODE_AUTOSTART = 'false';
    await expect(deferGodmodeBoot()).resolves.toBeUndefined();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('launches when DMRX_GODMODE_AUTOSTART=true', async () => {
    process.env.DMRX_GODMODE_AUTOSTART = 'true';
    await deferGodmodeBoot();
    expect(mocks.start).toHaveBeenCalledWith({
      openrouterApiKey: '',
      llmBaseUrl: 'http://localhost:47113/v1',
    });
    expect(mocks.initialize).toHaveBeenCalled();
  });
});
