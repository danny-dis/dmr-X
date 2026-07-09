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
