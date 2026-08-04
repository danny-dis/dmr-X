import { describe, expect, it } from 'vitest';

import { buildGodmodeNativeEnv } from '../../services/server-manager/src/server-manager.service.js';

function baseEnv(): Record<string, string> {
  return { PATH: '/usr/bin', HOME: '/root', FOO: 'bar' };
}

const OPTS = {
  port: 7860,
  openrouterKey: 'or-key',
  godmodeKey: 'generated-godmode-key',
  llmBaseUrl: '',
  llmApiKey: '',
};

describe('buildGodmodeNativeEnv', () => {
  it('inherits the base env and sets the process port + openrouter key', () => {
    const env = buildGodmodeNativeEnv({ baseEnv: baseEnv(), ...OPTS });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.FOO).toBe('bar');
    expect(env.PORT).toBe('7860');
    expect(env.OPENROUTER_API_KEY).toBe('or-key');
  });

  it('ALWAYS sets GODMODE_API_KEY when a key is generated', () => {
    const env = buildGodmodeNativeEnv({ baseEnv: baseEnv(), ...OPTS });
    expect(env.GODMODE_API_KEY).toBe('generated-godmode-key');
  });

  it('ALWAYS sets GODMODE_API_KEY in relay mode (llmBaseUrl set) — C3', () => {
    const env = buildGodmodeNativeEnv({
      baseEnv: baseEnv(),
      ...OPTS,
      llmBaseUrl: 'http://localhost:47113/v1',
      llmApiKey: 'gateway-key',
    });
    expect(env.GODMODE_API_KEY).toBe('generated-godmode-key');
    expect(env.G0DM0D3_LLM_BASE_URL).toBe('http://localhost:47113/v1');
    expect(env.G0DM0D3_LLM_API_KEY).toBe('gateway-key');
    expect(env.GODMODE_RELAY).toBe('1');
  });

  it('leaves GODMODE_API_KEY unset only when no key was generated', () => {
    const env = buildGodmodeNativeEnv({
      baseEnv: baseEnv(),
      ...OPTS,
      godmodeKey: '',
      llmBaseUrl: 'http://localhost:47113/v1',
    });
    expect(env.GODMODE_API_KEY).toBeUndefined();
  });

  it('does not set relay vars when not in relay mode', () => {
    const env = buildGodmodeNativeEnv({ baseEnv: baseEnv(), ...OPTS });
    expect(env.G0DM0D3_LLM_BASE_URL).toBeUndefined();
    expect(env.G0DM0D3_LLM_API_KEY).toBeUndefined();
    expect(env.GODMODE_RELAY).toBeUndefined();
  });
});
