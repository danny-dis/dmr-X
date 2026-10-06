import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGodmodeNativeEnv, ServerManagerService } from '../../services/server-manager/src/server-manager.service.js';

afterEach(() => vi.unstubAllEnvs());

describe('managed Godmode uses DMR-X, not a direct provider', () => {
  it('defaults to the DMR-X gateway even if an OpenRouter provider key exists', () => {
    vi.stubEnv('DMRX_GATEWAY_URL', 'http://localhost:47113');
    vi.stubEnv('OPENROUTER_API_KEY', 'provider-only-credential');
    vi.stubEnv('G0DM0D3_LLM_BASE_URL', '');
    const manager = new ServerManagerService();
    const resolved = (manager as any).resolveGodmodeEnv({ openrouterApiKey: 'caller-provider-credential' });
    expect(resolved.llmBaseUrl).toBe('http://localhost:47113/v1');
    expect(resolved.openrouterKey).toBe('');
  });

  it('refuses to launch inference when a required relay patch failed', async () => {
    const service = new ServerManagerService();
    vi.spyOn(service, 'cloneIfNeeded').mockResolvedValue({ cloned: false, path: 'test-fixture' });
    vi.spyOn(service, 'installDeps').mockResolvedValue();
    vi.spyOn(service, 'applyPatches').mockReturnValue({ applied: [], skipped: [], failed: ['src/lib/openrouter.ts'] });
    vi.spyOn(service, 'upsertRow').mockImplementation(() => {});
    vi.spyOn(service, 'healthCheck').mockResolvedValue(true);
    const start = vi.spyOn(service as any, 'startNative').mockResolvedValue(undefined);
    await expect(service.start()).rejects.toThrow(/relay patches.*openrouter/i);
    expect(start).not.toHaveBeenCalled();
  });

  it('does not expose the parent OpenRouter credential to a relay child', () => {
    const env = buildGodmodeNativeEnv({
      baseEnv: { OPENROUTER_API_KEY: 'inherited-provider-credential' },
      port: 47115, openrouterKey: 'explicit-provider-credential', godmodeKey: 'companion-credential',
      llmBaseUrl: 'http://localhost:47113/v1', llmApiKey: '',
    });
    expect(env.OPENROUTER_API_KEY).toBe('');
    expect(env.GODMODE_RELAY).toBe('1');
    expect(env.G0DM0D3_LLM_BASE_URL).toBe('http://localhost:47113/v1');
    expect(env.GODMODE_API_KEY).toBe('companion-credential');
  });
});
