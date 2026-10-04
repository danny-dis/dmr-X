import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `resolveGatewayKey` keeps module-level state (auto-provisioned key). Reset
// the module between tests so each case starts from a clean slate.
const ORIGINAL = process.env.DMRX_MCP_AGENT_API_KEY;

beforeEach(() => {
  delete process.env.DMRX_MCP_AGENT_API_KEY;
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.DMRX_MCP_AGENT_API_KEY;
  } else {
    process.env.DMRX_MCP_AGENT_API_KEY = ORIGINAL;
  }
  vi.resetModules();
});

async function load() {
  return import('../../services/mcp-server/src/tenant-key.js') as Promise<typeof import('../../services/mcp-server/src/tenant-key.js')>;
}

describe('resolveGatewayKey()', () => {
  it('restores the outer context when the HTTP request scope returns', async () => {
    const mod = await load();
    expect(typeof mod.runWithRequestHeaders).toBe('function');
    const value = await mod.runWithRequestHeaders({ 'x-dmr-tenant-key': 'scoped-company' }, async () => {
      await Promise.resolve();
      return mod.resolveGatewayKey();
    });
    expect(value).toBe('scoped-company');
    expect(mod.resolveGatewayKey()).toBeUndefined();
  });
  it('does not borrow another concurrent request\'s tenant key after an await', async () => {
    const { setLastRequestHeaders, resolveGatewayKey } = await load();
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const first = new Promise<string | undefined>((resolve) => {
      setImmediate(async () => {
        setLastRequestHeaders({ 'x-dmr-tenant-key': 'company-a' });
        firstStarted();
        await firstPaused;
        resolve(resolveGatewayKey());
      });
    });
    await started;
    const second = await new Promise<string | undefined>((resolve) => {
      setImmediate(() => {
        setLastRequestHeaders({ 'x-dmr-tenant-key': 'company-b' });
        resolve(resolveGatewayKey());
        releaseFirst();
      });
    });
    expect(await first).toBe('company-a');
    expect(second).toBe('company-b');
    expect(resolveGatewayKey()).toBeUndefined();
  });
  it('prefers an X-DMR-Tenant-Key header when present', async () => {
    const { resolveGatewayKey, DMR_TENANT_KEY_HEADER } = await load();
    const headers = { [DMR_TENANT_KEY_HEADER]: 'tenant-abc' };
    expect(resolveGatewayKey(headers)).toBe('tenant-abc');
  });

  it('ignores a whitespace-only tenant key header and falls through', async () => {
    process.env.DMRX_MCP_AGENT_API_KEY = 'fallback-key';
    const { resolveGatewayKey, DMR_TENANT_KEY_HEADER } = await load();
    const headers = { [DMR_TENANT_KEY_HEADER]: '   ' };
    expect(resolveGatewayKey(headers)).toBe('fallback-key');
  });

  it('falls back to DMRX_MCP_AGENT_API_KEY when no header is given', async () => {
    process.env.DMRX_MCP_AGENT_API_KEY = 'shared-key';
    const { resolveGatewayKey } = await load();
    expect(resolveGatewayKey({})).toBe('shared-key');
  });

  it('supports the header value as an array (picks the first)', async () => {
    process.env.DMRX_MCP_AGENT_API_KEY = 'fallback-key';
    const { resolveGatewayKey, DMR_TENANT_KEY_HEADER } = await load();
    const headers = { [DMR_TENANT_KEY_HEADER]: ['first', 'second'] };
    expect(resolveGatewayKey(headers)).toBe('first');
  });

  it('uses the auto-provisioned key when neither header nor env is set', async () => {
    const mod = await load();
    mod.setAutoProvisionedKey('auto-key');
    expect(mod.resolveGatewayKey({})).toBe('auto-key');
  });

  it('returns undefined when nothing is configured', async () => {
    const { resolveGatewayKey } = await load();
    expect(resolveGatewayKey({})).toBeUndefined();
  });
});
